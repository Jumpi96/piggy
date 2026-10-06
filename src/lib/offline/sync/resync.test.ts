// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA_SQL } from '../schema';

// Real local Postgres, so FK and UNIQUE constraints behave exactly as on the device.
let db: PGlite;
let serverRows: Record<string, Array<Record<string, unknown>>> = {};
let failNextQuery = false;

function makeBuilder(table: string) {
    let from = 0;
    let to = Infinity;
    const builder = {
        gte: () => builder,
        order: () => builder,
        range: (f: number, t: number) => {
            from = f;
            to = t;
            return builder;
        },
        then: (resolve: (v: unknown) => void) => {
            if (failNextQuery) {
                failNextQuery = false;
                resolve({ data: null, error: { message: 'TypeError: Failed to fetch' }, count: null });
                return;
            }
            const all = serverRows[table] ?? [];
            resolve({ data: all.slice(from, to + 1), error: null, count: all.length });
        },
    };
    return builder;
}

vi.mock('../../supabase', () => ({
    supabase: { from: (table: string) => ({ select: () => makeBuilder(table) }) },
}));
vi.mock('../database', () => ({
    getDatabaseAsync: () => Promise.resolve(db),
    getLastSyncTimestamp: () => Promise.resolve('2026-10-06T00:00:00.000Z'),
    setLastSyncTimestamp: () => Promise.resolve(),
}));
vi.mock('./queue', () => ({
    getPendingChanges: async () => (await db.query('SELECT * FROM _pending_changes WHERE synced_at IS NULL')).rows,
    notifyPendingChanges: vi.fn(),
}));

import { fullTableResync, pullChanges } from './pull';

const TS = '2026-10-01T00:00:00.000Z';
const card = (id: string) => ({
    id, user_id: 'u1', name: id, closing_day: 10, payment_day: 20, sort_order: 0,
    enabled: true, created_at: TS, updated_at: TS, deleted_at: null,
});
const tx = (id: string, cardId: string | null) => ({
    id, user_id: 'u1', date: '2026-10-01', direction: 'expense', amount_cents: 100,
    currency_code: 'USD', exchange_rate_id: null, category: 'Food', tag: 'x',
    payment_method: cardId ? 'card' : 'cash', credit_card_id: cardId, recurring_rule_id: null,
    original_date: null, to_be_balanced: false, note: null, created_at: TS, updated_at: TS, deleted_at: null,
});

async function insert(table: string, row: Record<string, unknown>) {
    const cols = Object.keys(row);
    await db.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        cols.map(c => row[c])
    );
}

const ids = async (table: string) =>
    (await db.query<{ id: string }>(`SELECT id FROM ${table} ORDER BY id`)).rows.map(r => r.id);

describe('fullTableResync', () => {
    beforeEach(async () => {
        db = new PGlite();
        await db.exec(SCHEMA_SQL);
        await db.query(`INSERT INTO currencies (code, name) VALUES ('USD', 'Dollar')`);
        serverRows = {};
        failNextQuery = false;
    });

    it('resyncs a parent table whose rows are referenced by transactions (used to hit an FK error)', async () => {
        await insert('credit_cards', card('c1'));
        await insert('credit_cards', card('c-gone'));
        await insert('transactions', tx('t1', 'c1'));
        serverRows.credit_cards = [{ ...card('c1'), name: 'renamed' }, card('c2')];

        await fullTableResync('credit_cards');

        expect(await ids('credit_cards')).toEqual(['c1', 'c2']);
        const c1 = await db.query<{ name: string }>(`SELECT name FROM credit_cards WHERE id = 'c1'`);
        expect(c1.rows[0].name).toBe('renamed');
    });

    it('keeps a local-only parent row that is still referenced instead of failing', async () => {
        await insert('credit_cards', card('c-local'));
        await insert('transactions', tx('t1', 'c-local'));
        serverRows.credit_cards = [];

        await fullTableResync('credit_cards');

        expect(await ids('credit_cards')).toEqual(['c-local']);
    });

    it('leaves the local table untouched when the download fails', async () => {
        await insert('transactions', tx('t1', null));
        await insert('transactions', tx('t2', null));
        failNextQuery = true;

        await expect(fullTableResync('transactions')).rejects.toThrow();
        expect(await ids('transactions')).toEqual(['t1', 't2']);
    });

    it('preserves rows with pending local changes', async () => {
        await insert('transactions', { ...tx('t-pending', null), amount_cents: 999 });
        await db.query(
            `INSERT INTO _pending_changes (table_name, record_id, operation, payload) VALUES ('transactions', 't-pending', 'INSERT', '{}')`
        );
        serverRows.transactions = [tx('t-server', null)];

        await fullTableResync('transactions');

        expect(await ids('transactions')).toEqual(['t-pending', 't-server']);
    });
});

describe('pull natural-key repair', () => {
    beforeEach(async () => {
        db = new PGlite();
        await db.exec(SCHEMA_SQL);
        await db.query(`INSERT INTO currencies (code, name) VALUES ('USD', 'Dollar')`);
        serverRows = {};
    });

    const param = (id: string, value: string, updated_at: string) =>
        ({ id, user_id: 'u1', key: 'month_start_day', value, updated_at });

    it('replaces a synced local parameter that holds the same key under another id', async () => {
        await insert('parameters', param('local-id', '"1"', TS));
        serverRows.parameters = [param('server-id', '15', '2026-10-06T12:00:00.000Z')];

        const result = await pullChanges();

        expect(result.success).toBe(true);
        const rows = await db.query<{ id: string; value: string }>(`SELECT id, value FROM parameters`);
        expect(rows.rows).toEqual([{ id: 'server-id', value: '15' }]);
    });

    it('keeps the local parameter while it still has pending changes', async () => {
        await insert('parameters', param('local-id', '"1"', TS));
        await db.query(
            `INSERT INTO _pending_changes (table_name, record_id, operation, payload) VALUES ('parameters', 'local-id', 'INSERT', '{}')`
        );
        serverRows.parameters = [param('server-id', '15', '2026-10-06T12:00:00.000Z')];

        await pullChanges();

        expect(await ids('parameters')).toEqual(['local-id']);
    });
});
