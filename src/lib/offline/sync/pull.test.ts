import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record when each server query runs so we can assert the watermark predates them.
const selectTimes: number[] = [];
// Rows served per table; each query returns the requested range slice.
let serverRows: Record<string, Array<Record<string, unknown>>> = {};
let lastSync: string | null = null;
// Simulates PostgREST's max_rows: no response holds more rows than this.
let serverMaxRows = Infinity;

function makeBuilder(table: string) {
    let from = 0;
    let to = Infinity;
    const builder = {
        gte: vi.fn((...args: [string, string]) => (void args, builder)),
        order: vi.fn(() => builder),
        range: vi.fn((f: number, t: number) => {
            from = f;
            to = t;
            return builder;
        }),
        then: (resolve: (v: unknown) => void) => {
            const all = serverRows[table] ?? [];
            const page = all.slice(from, to + 1).slice(0, serverMaxRows);
            resolve({ data: page, error: null, count: all.length });
        },
    };
    return builder;
}

const builders: Record<string, ReturnType<typeof makeBuilder>> = {};
const selectMock = vi.fn((table: string) => {
    selectTimes.push(Date.now());
    builders[table] = makeBuilder(table);
    return builders[table];
});
const fromMock = vi.fn((table: string) => ({ select: () => selectMock(table) }));

const setLastSyncMock = vi.fn((_ts: string) => Promise.resolve());
const dbQueryMock = vi.fn((...args: [string, unknown[]?]) => (void args, Promise.resolve({ rows: [] as unknown[] })));

vi.mock('../../supabase', () => ({ supabase: { from: (t: string) => fromMock(t) } }));
vi.mock('../database', () => ({
    getDatabaseAsync: () => Promise.resolve({ query: dbQueryMock }),
    getLastSyncTimestamp: () => Promise.resolve(lastSync),
    setLastSyncTimestamp: (ts: string) => setLastSyncMock(ts),
}));
vi.mock('./queue', () => ({ getPendingChanges: () => Promise.resolve([]), notifyPendingChanges: vi.fn() }));

import { pullChanges } from './pull';

describe('pullChanges', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        selectTimes.length = 0;
        serverRows = {};
        lastSync = null;
        serverMaxRows = Infinity;
        dbQueryMock.mockImplementation(() => Promise.resolve({ rows: [] }));
    });

    it('stamps last-sync from a watermark captured BEFORE the queries run', async () => {
        const result = await pullChanges();
        expect(result.success).toBe(true);
        expect(setLastSyncMock).toHaveBeenCalledTimes(1);
        expect(selectTimes.length).toBeGreaterThan(0);

        const stampedAt = new Date(setLastSyncMock.mock.calls[0][0]).getTime();
        const firstQueryAt = Math.min(...selectTimes);
        // A watermark captured before querying is <= the first query time. The old code
        // captured it after the whole loop, so it would be > the first query time.
        expect(stampedAt).toBeLessThanOrEqual(firstQueryAt);
    });

    it('re-reads a 2 minute overlap before the last watermark', async () => {
        lastSync = '2026-10-06T12:00:00.000Z';
        await pullChanges();
        expect(builders.transactions.gte).toHaveBeenCalledWith('updated_at', '2026-10-06T11:58:00.000Z');
    });

    it('pages past the 1000-row cap instead of keeping only the first page', async () => {
        serverRows.transactions = Array.from({ length: 2500 }, (_, i) => ({
            id: `tx-${String(i).padStart(4, '0')}`,
            updated_at: '2026-10-06T12:00:00.000Z',
        }));
        const result = await pullChanges();
        expect(result.success).toBe(true);
        expect(selectMock.mock.calls.filter(([t]) => t === 'transactions')).toHaveLength(3);
        // Every row reached the local upsert.
        const inserts = dbQueryMock.mock.calls.filter(([sql]) => sql.includes('INSERT INTO transactions'));
        expect(inserts).toHaveLength(2500);
    });

    it('does not skip rows when the server caps pages below PAGE_SIZE', async () => {
        serverMaxRows = 500;
        serverRows.transactions = Array.from({ length: 1200 }, (_, i) => ({
            id: `tx-${String(i).padStart(4, '0')}`,
            updated_at: '2026-10-06T12:00:00.000Z',
        }));
        await pullChanges();
        const inserted = dbQueryMock.mock.calls
            .filter(([sql]) => sql.includes('INSERT INTO transactions'))
            .map(([, params]) => (params as unknown[])[0]);
        expect(new Set(inserted).size).toBe(1200);
    });

    it('does not advance the watermark when a row fails to apply', async () => {
        serverRows.credit_cards = [{ id: 'c1', updated_at: '2026-10-06T12:00:00.000Z' }];
        dbQueryMock.mockImplementation((sql: string) =>
            sql.includes('INSERT INTO credit_cards')
                ? Promise.reject(new Error('boom'))
                : Promise.resolve({ rows: [] }));

        const result = await pullChanges();
        expect(result.success).toBe(false);
        expect(setLastSyncMock).not.toHaveBeenCalled();
    });
});
