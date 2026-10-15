import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { LEGACY_BALANCE_FLAGS_KEY, SCHEMA_SQL } from './schema';
import { runMigrations } from './database';

/** A database as schema v6 left it: the to_be_balanced flag, no balance ledger. */
async function v6Database(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(SCHEMA_SQL);
    await db.exec(`
        DROP TABLE balance_entries;
        ALTER TABLE transactions ADD COLUMN to_be_balanced BOOLEAN DEFAULT false;
        INSERT INTO _sync_meta (key, value) VALUES ('schema_version', '6')
            ON CONFLICT (key) DO UPDATE SET value = '6';
        INSERT INTO currencies (code, name) VALUES ('ARS', 'Peso');
    `);
    return db;
}

async function addTransaction(db: PGlite, id: string, flagged: boolean, queued: boolean) {
    await db.query(`
        INSERT INTO transactions (id, user_id, date, direction, amount_cents, currency_code, category, tag,
                                  payment_method, to_be_balanced, created_at, updated_at)
        VALUES ($1, 'u1', '2026-10-10', 'expense', 5000, 'ARS', 'Living', 'x', 'cash', $2, 'now', 'now')
    `, [id, flagged]);
    if (queued) {
        await db.query(`INSERT INTO _pending_changes (table_name, record_id, operation, payload) VALUES ('transactions', $1, 'INSERT', '{}')`, [id]);
    }
}

describe('schema v7 migration (balance ledger)', () => {
    it('remembers only flags with queued changes, then drops the flag', async () => {
        const db = await v6Database();
        await addTransaction(db, 'flagged-queued', true, true);
        await addTransaction(db, 'flagged-synced', true, false);   // the server migration converts it
        await addTransaction(db, 'plain-queued', false, true);

        await runMigrations(db);

        const meta = await db.query<{ value: string }>(`SELECT value FROM _sync_meta WHERE key = $1`, [LEGACY_BALANCE_FLAGS_KEY]);
        const flags = JSON.parse(meta.rows[0].value);
        expect(flags).toEqual([expect.objectContaining({
            id: 'flagged-queued', user_id: 'u1', date: '2026-10-10', direction: 'expense',
            amount_cents: 5000, currency_code: 'ARS', exchange_rate_id: null,
        })]);

        const column = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'to_be_balanced'`);
        expect(column.rows).toEqual([]);
        const ledger = await db.query(`SELECT count(*)::int AS n FROM balance_entries`);
        expect(ledger.rows).toEqual([{ n: 0 }]); // nothing converted locally: no duplicates
    });

    it('stores nothing when no flagged transaction is waiting to sync', async () => {
        const db = await v6Database();
        await addTransaction(db, 'flagged-synced', true, false);
        await runMigrations(db);
        const meta = await db.query(`SELECT 1 FROM _sync_meta WHERE key = $1`, [LEGACY_BALANCE_FLAGS_KEY]);
        expect(meta.rows).toEqual([]);
    });
});
