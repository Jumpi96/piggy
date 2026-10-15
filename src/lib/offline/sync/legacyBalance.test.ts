import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LegacyBalanceFlag } from './legacyBalance';

const meta = new Map<string, string>();
// Local state the conversion looks at, per transaction id.
let queued = new Set<string>();
let localEntries = new Set<string>();
let deleted = new Set<string>();
let serverEntries = new Set<string>();
let serverError: { message: string } | null = null;
const inserted: unknown[][] = [];

const dbQuery = vi.fn((sql: string, params: unknown[] = []) => {
    const id = params[0] as string;
    if (sql.includes('FROM _pending_changes')) return Promise.resolve({ rows: queued.has(id) ? [{}] : [] });
    if (sql.includes('FROM balance_entries')) return Promise.resolve({ rows: localEntries.has(id) ? [{}] : [] });
    if (sql.includes('FROM transactions')) return Promise.resolve({ rows: [{ deleted_at: deleted.has(id) ? 'x' : null }] });
    if (sql.includes('INSERT INTO balance_entries')) {
        inserted.push(params);
        return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
});

vi.mock('../database', () => ({
    getDatabaseAsync: () => Promise.resolve({ query: dbQuery }),
    getSyncMeta: (key: string) => Promise.resolve(meta.get(key) ?? null),
    setSyncMeta: (key: string, value: string) => {
        meta.set(key, value);
        return Promise.resolve();
    },
}));
vi.mock('../../supabase', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: (_col: string, id: string) => ({
                    limit: () => Promise.resolve(serverError
                        ? { data: null, error: serverError }
                        : { data: serverEntries.has(id) ? [{ id: 'srv' }] : [], error: null }),
                }),
            }),
        }),
    },
}));
const trackChange = vi.fn((...args: unknown[]) => Promise.resolve(args.length));
vi.mock('./queue', () => ({ trackChange: (...args: unknown[]) => trackChange(...args) }));

import { convertLegacyBalanceFlags } from './legacyBalance';
import { LEGACY_BALANCE_FLAGS_KEY } from '../schema';

function flag(id: string, direction: 'expense' | 'income' = 'expense'): LegacyBalanceFlag {
    return { id, user_id: 'u1', date: '2026-10-10', direction, amount_cents: 5000, currency_code: 'ARS', exchange_rate_id: 'r1' };
}

function remember(...flags: LegacyBalanceFlag[]) {
    meta.set(LEGACY_BALANCE_FLAGS_KEY, JSON.stringify(flags));
}

function remembered(): string[] {
    const raw = meta.get(LEGACY_BALANCE_FLAGS_KEY);
    return raw ? (JSON.parse(raw) as LegacyBalanceFlag[]).map(f => f.id) : [];
}

describe('convertLegacyBalanceFlags', () => {
    beforeEach(() => {
        meta.clear();
        queued = new Set();
        localEntries = new Set();
        deleted = new Set();
        serverEntries = new Set();
        serverError = null;
        inserted.length = 0;
        dbQuery.mockClear();
        trackChange.mockClear();
    });

    it('does nothing when no flags were remembered', async () => {
        expect(await convertLegacyBalanceFlags()).toBe(0);
        expect(dbQuery).not.toHaveBeenCalled();
    });

    it('adds a signed, linked entry for a flag the server never saw', async () => {
        remember(flag('t-exp'), flag('t-inc', 'income'));
        expect(await convertLegacyBalanceFlags()).toBe(2);

        // (id, user_id, date, amount, currency, rate, transaction_id, kind, ...)
        expect(inserted.map(p => [p[6], p[3], p[4], p[5], p[7]])).toEqual([
            ['t-exp', 5000, 'ARS', 'r1', 'entry'],
            ['t-inc', -5000, 'ARS', 'r1', 'entry'],
        ]);
        expect(trackChange.mock.calls.map(c => [c[0], c[2]])).toEqual([
            ['balance_entries', 'INSERT'],
            ['balance_entries', 'INSERT'],
        ]);
        expect(remembered()).toEqual([]);
    });

    it('skips flags the server migration (or this device) already turned into an entry', async () => {
        remember(flag('on-server'), flag('local'));
        serverEntries.add('on-server');
        localEntries.add('local');
        expect(await convertLegacyBalanceFlags()).toBe(0);
        expect(inserted).toEqual([]);
        expect(remembered()).toEqual([]);
    });

    it('waits while the transaction is still queued, or the server check fails', async () => {
        remember(flag('queued'));
        queued.add('queued');
        expect(await convertLegacyBalanceFlags()).toBe(0);
        expect(remembered()).toEqual(['queued']);

        queued.clear();
        serverError = { message: 'offline' };
        expect(await convertLegacyBalanceFlags()).toBe(0);
        expect(remembered()).toEqual(['queued']);

        serverError = null;
        expect(await convertLegacyBalanceFlags()).toBe(1);
        expect(remembered()).toEqual([]);
    });

    it('drops flags whose transaction was deleted meanwhile', async () => {
        remember(flag('gone'));
        deleted.add('gone');
        expect(await convertLegacyBalanceFlags()).toBe(0);
        expect(inserted).toEqual([]);
        expect(remembered()).toEqual([]);
    });
});
