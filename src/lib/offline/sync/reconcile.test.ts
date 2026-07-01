import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
const queryMock = vi.fn((sql: string) => {
    // Local count = 4 for transactions (server says 5 -> mismatch), 0 elsewhere.
    const table = /FROM (\w+)/.exec(sql)?.[1];
    return Promise.resolve({ rows: [{ count: table === 'transactions' ? 4 : 0 }] });
});
const getPendingChangesMock = vi.fn(() => Promise.resolve<Array<{ table_name: string; record_id: string }>>([]));

vi.mock('../../supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpcMock(...a) } }));
vi.mock('../database', () => ({ getDatabaseAsync: () => Promise.resolve({ query: queryMock }) }));
vi.mock('./queue', () => ({ getPendingChanges: () => getPendingChangesMock() }));

import { checkReconciliation } from './reconcile';

describe('checkReconciliation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        rpcMock.mockResolvedValue({
            data: [
                { table_name: 'transactions', record_count: 5 },
                { table_name: 'recurring_rules', record_count: 0 },
                { table_name: 'credit_cards', record_count: 0 },
                { table_name: 'exchange_rates', record_count: 0 },
                { table_name: 'parameters', record_count: 0 },
            ],
            error: null,
        });
        getPendingChangesMock.mockResolvedValue([]);
    });

    it('flags a table whose count differs and has no pending changes', async () => {
        const result = await checkReconciliation();
        expect(result.mismatches).toContain('transactions');
    });

    it('does NOT flag a table that has unsynced pending changes (avoids destructive resync)', async () => {
        getPendingChangesMock.mockResolvedValue([{ table_name: 'transactions', record_id: 'tx-1' }]);
        const result = await checkReconciliation();
        expect(result.mismatches).not.toContain('transactions');
    });
});
