// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { SCHEMA_SQL } from './offline/schema';
import { balancedByTransaction, signedBalanceCents, sumBalanceUsdCents } from './balance';

// Real local Postgres for the ledger API, so the joins, rates and period windows behave
// as on the device.
let db: PGlite;

vi.mock('./offline/database', () => ({
    getDatabaseAsync: () => Promise.resolve(db),
    getCurrentUserId: () => Promise.resolve('u1'),
}));
vi.mock('./offline/sync', () => ({
    trackChange: vi.fn(() => Promise.resolve()),
    triggerBackgroundSync: vi.fn(),
}));

import * as api from './api';
import { trackChange } from './offline/sync';

const TS = '2026-10-01T00:00:00.000Z';

async function insert(table: string, row: Record<string, unknown>) {
    const cols = Object.keys(row);
    await db.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        cols.map(c => row[c])
    );
}

const tx = (id: string, extra: Record<string, unknown> = {}) => ({
    id, user_id: 'u1', date: '2026-10-05', direction: 'expense', amount_cents: 10000,
    currency_code: 'USD', exchange_rate_id: null, category: 'Living', tag: 'Dentist',
    payment_method: 'cash', credit_card_id: null, recurring_rule_id: null,
    original_date: null, note: null, created_at: TS, updated_at: TS, deleted_at: null,
    ...extra,
});

describe('balance helpers', () => {
    it('signs expenses as owed from savings and incomes as going back', () => {
        expect(signedBalanceCents('expense', 500)).toBe(500);
        expect(signedBalanceCents('income', 500)).toBe(-500);
    });

    it('totals in whole USD cents through each entry rate', () => {
        expect(sumBalanceUsdCents([
            { amount_cents: 1000, exchange_rate: { rate: 1 } },
            { amount_cents: 100000, exchange_rate: { rate: 1000 } }, // ARS 1,000 = $1
            { amount_cents: -250, exchange_rate: null },
        ])).toBe(850);
    });

    it('sums the amounts linked to each transaction', () => {
        const map = balancedByTransaction([
            { transaction_id: 't1', amount_cents: 300 },
            { transaction_id: 't1', amount_cents: 200 },
            { transaction_id: null, amount_cents: 999 },
        ]);
        expect([...map]).toEqual([['t1', 500]]);
    });
});

describe('balance ledger api', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        db = new PGlite();
        await db.exec(SCHEMA_SQL);
        await insert('currencies', { code: 'USD', name: 'US Dollar' });
        await insert('currencies', { code: 'ARS', name: 'Peso' });
        await insert('exchange_rates', { id: 'r1', user_id: 'u1', currency_code: 'ARS', rate: 1000, created_at: TS, updated_at: TS });
    });

    it('lists only the period, with rates and the linked transaction for labels', async () => {
        await insert('transactions', tx('t1'));
        await api.insertBalanceEntry({ date: '2026-10-05', amount_cents: 5000, currency_code: 'USD', transaction_id: 't1' });
        await api.insertBalanceEntry({ date: '2026-10-20', amount_cents: -300000, currency_code: 'ARS', exchange_rate_id: 'r1', note: 'Refund' });
        await api.insertBalanceEntry({ date: '2026-11-01', amount_cents: 777, currency_code: 'USD' });

        const entries = await api.fetchBalanceEntries('2026-10-01');
        expect(entries.map(e => e.date)).toEqual(['2026-10-20', '2026-10-05']);
        expect(entries[0].exchange_rate).toEqual({ rate: 1000 });
        expect(entries[0].source).toBeNull();
        expect(entries[1].source).toEqual({ category: 'Living', tag: 'Dentist', note: null, deleted: false });
        expect(sumBalanceUsdCents(entries)).toBe(5000 - 300);
    });

    it('settles a period to 0 with a USD settle entry, and does nothing when already settled', async () => {
        await api.insertBalanceEntry({ date: '2026-10-05', amount_cents: 12345, currency_code: 'USD' });
        await api.insertBalanceEntry({ date: '2026-10-06', amount_cents: 150000, currency_code: 'ARS', exchange_rate_id: 'r1' });

        const settle = await api.settleBalance('2026-10-01');
        expect(settle).toMatchObject({ kind: 'settle', currency_code: 'USD', amount_cents: -(12345 + 150), date: '2026-10-01' });
        expect(sumBalanceUsdCents(await api.fetchBalanceEntries('2026-10-01'))).toBe(0);
        expect(await api.settleBalance('2026-10-01')).toBeNull();

        // Settling never touches another month or adds a transaction.
        expect((await db.query('SELECT * FROM transactions')).rows).toHaveLength(0);
        expect(vi.mocked(trackChange).mock.calls.map(c => [c[0], c[2]])).toEqual([
            ['balance_entries', 'INSERT'], ['balance_entries', 'INSERT'], ['balance_entries', 'INSERT'],
        ]);
    });

    it('removes or detaches the entries of deleted transactions', async () => {
        await insert('transactions', tx('t1'));
        await insert('transactions', tx('t2'));
        const a = await api.insertBalanceEntry({ date: '2026-10-05', amount_cents: 100, currency_code: 'USD', transaction_id: 't1' });
        const b = await api.insertBalanceEntry({ date: '2026-10-05', amount_cents: 200, currency_code: 'USD', transaction_id: 't2' });

        await api.resolveLinkedBalanceEntries(['t1'], 'remove');
        await api.resolveLinkedBalanceEntries(['t2', 'virtual-rule:2026-10-05'], 'detach');

        const rows = (await db.query<{ id: string; transaction_id: string | null; deleted_at: string | null }>(
            'SELECT id, transaction_id, deleted_at FROM balance_entries ORDER BY amount_cents'
        )).rows;
        expect(rows).toEqual([
            { id: a.id, transaction_id: 't1', deleted_at: expect.any(String) },
            { id: b.id, transaction_id: null, deleted_at: null },
        ]);
        expect(vi.mocked(trackChange).mock.calls.slice(2).map(c => c[3])).toEqual([
            { id: a.id, deleted_at: expect.any(String) },
            { id: b.id, transaction_id: null, updated_at: expect.any(String) },
        ]);
    });

    it('finds entries by transaction and skips virtual ids', async () => {
        await insert('transactions', tx('t1'));
        await api.insertBalanceEntry({ date: '2026-10-05', amount_cents: 100, currency_code: 'USD', transaction_id: 't1' });
        await api.updateBalanceEntryAmount((await api.fetchBalanceEntriesForTransactions(['t1']))[0].id, 40);

        const linked = await api.fetchBalanceEntriesForTransactions(['t1', 'virtual-x:2026-10-01']);
        expect(linked.map(e => e.amount_cents)).toEqual([40]);
        expect(await api.fetchBalanceEntriesForTransactions(['virtual-x:2026-10-01'])).toEqual([]);
    });
});
