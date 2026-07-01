import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from './api';
import type { RecurringRule } from '../types';

// Mock the offline database module
const mockQuery = vi.fn();
const mockDb = {
    query: mockQuery,
    exec: vi.fn(),
};

vi.mock('./offline/database', () => ({
    getDatabaseAsync: vi.fn(() => Promise.resolve(mockDb)),
    getDatabase: vi.fn(() => mockDb),
    getCurrentUserId: vi.fn(() => Promise.resolve('test-user-123')),
    setCurrentUserId: vi.fn(),
    initDatabase: vi.fn(() => Promise.resolve(mockDb)),
}));

// Mock the sync queue to avoid side effects
vi.mock('./offline/sync/queue', () => ({
    trackChange: vi.fn(() => Promise.resolve()),
    getPendingChanges: vi.fn(() => Promise.resolve([])),
    getPendingChangesCount: vi.fn(() => Promise.resolve(0)),
    subscribePendingChanges: vi.fn(() => () => { }),
}));

// Mock triggerBackgroundSync
vi.mock('./offline/sync', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        triggerBackgroundSync: vi.fn(),
    };
});

// Mock supabase for functions that still use it
vi.mock('./supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            lt: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            upsert: vi.fn().mockReturnThis(),
        })),
        rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
}));

describe('api', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockQuery.mockReset();
        mockQuery.mockResolvedValue({ rows: [] });
    });

    describe('fetchCurrencies', () => {
        it('returns currencies from local database', async () => {
            const mockData = [{ code: 'USD', name: 'US Dollar' }, { code: 'EUR', name: 'Euro' }];
            mockQuery.mockResolvedValueOnce({ rows: mockData });

            const currencies = await api.fetchCurrencies();

            expect(currencies).toEqual(mockData);
            expect(mockQuery).toHaveBeenCalled();
        });
    });

    describe('fetchTransactions', () => {
        it('returns transactions for the month from local database', async () => {
            const mockData = [
                { id: '1', date: '2024-01-15', amount_cents: 1000, exchange_rate_value: null, credit_card_name: null },
                { id: '2', date: '2024-01-20', amount_cents: 2000, exchange_rate_value: 100, credit_card_name: 'Visa' },
            ];
            mockQuery.mockResolvedValueOnce({ rows: mockData });

            const transactions = await api.fetchTransactions('2024-01-01');

            expect(transactions).toHaveLength(2);
            expect(transactions[0].id).toBe('2'); // DESC order: 2024-01-20 comes first
            expect(transactions[1].id).toBe('1');
            expect(transactions[0].credit_card).toEqual({ name: 'Visa' });
            expect(mockQuery).toHaveBeenCalled();
        });
    });

    describe('insertTransaction', () => {
        it('inserts transaction into local database', async () => {
            const input: api.TransactionInput = {
                date: '2024-01-01',
                direction: 'expense',
                amount_cents: 100,
                currency_code: 'USD',
                category: 'Food',
                tag: 'groceries',
                payment_method: 'cash',
                to_be_balanced: false,
            };

            // INSERT returns the row
            mockQuery.mockResolvedValueOnce({ rows: [{ id: 'new-id', ...input }] });

            const result = await api.insertTransaction(input);

            expect(result.amount_cents).toBe(100);
            expect(result.category).toBe('Food');
            expect(mockQuery).toHaveBeenCalled();
        });
    });

    describe('updateTransaction', () => {
        it('updates transaction in local database', async () => {
            // UPDATE then SELECT
            mockQuery
                .mockResolvedValueOnce({ rows: [] }) // UPDATE
                .mockResolvedValueOnce({ rows: [{ id: '1', amount_cents: 200 }] }); // SELECT

            const result = await api.updateTransaction('1', { amount_cents: 200 });

            expect(result.amount_cents).toBe(200);
            expect(mockQuery).toHaveBeenCalledTimes(2);
        });
    });

    describe('deleteTransaction', () => {
        it('soft deletes transaction by setting deleted_at', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            await api.deleteTransaction('1');

            expect(mockQuery).toHaveBeenCalled();
            const callArgs = mockQuery.mock.calls[0][0];
            expect(callArgs).toContain('UPDATE');
            expect(callArgs).toContain('deleted_at');
        });
    });

    describe('fetchCreditCards', () => {
        it('returns credit cards from local database', async () => {
            const mockData = [{ id: '1', name: 'Visa', closing_day: 20, due_day: 10 }];
            mockQuery.mockResolvedValueOnce({ rows: mockData });

            const cards = await api.fetchCreditCards();

            expect(cards).toEqual(mockData);
            expect(mockQuery).toHaveBeenCalled();
        });
    });

    describe('insertCreditCard', () => {
        it('inserts credit card and returns it with generated id', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            const result = await api.insertCreditCard('My Card', 20, 5);

            expect(result.name).toBe('My Card');
            expect(result.closing_day).toBe(20);
            expect(result.payment_day).toBe(5);
            expect(result.id).toBeDefined();
            expect(mockQuery).toHaveBeenCalled();
        });
    });

    describe('deleteCreditCard', () => {
        it('soft deletes credit card', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            await api.deleteCreditCard('card-1');

            expect(mockQuery).toHaveBeenCalled();
            const callArgs = mockQuery.mock.calls[0][0];
            expect(callArgs).toContain('UPDATE');
            expect(callArgs).toContain('deleted_at');
        });
    });

    describe('fetchTransactionsRange', () => {
        it('returns transactions in date range with enriched data', async () => {
            const mockData = [{ id: '1', date: '2024-01-15', exchange_rate_value: null, credit_card_name: null }];
            mockQuery.mockResolvedValueOnce({ rows: mockData });

            const transactions = await api.fetchTransactionsRange('2024-01-01', '2024-02-01');

            expect(transactions).toHaveLength(1);
            expect(transactions[0].id).toBe('1');
            expect(mockQuery).toHaveBeenCalled();
        });
    });

    describe('fetchRecurringRules', () => {
        it('returns recurring rules with parsed schedule_config', async () => {
            const mockData = [{
                id: '1',
                category: 'Housing',
                amount_cents: 100000,
                schedule_config: '{"type":"monthly","day":1}'
            }];
            mockQuery.mockResolvedValueOnce({ rows: mockData });

            const rules = await api.fetchRecurringRules();

            expect(rules).toHaveLength(1);
            expect(rules[0].category).toBe('Housing');
            expect(rules[0].schedule_config).toEqual({ type: 'monthly', day: 1 });
        });
    });

    describe('insertRecurringRule', () => {
        it('inserts recurring rule and returns constructed object', async () => {
            const input: Partial<RecurringRule> = {
                direction: 'expense',
                amount_cents: 100000,
                currency_code: 'USD',
                category: 'Housing',
                tag: 'rent',
                payment_method: 'cash',
                schedule_type: 'monthly_day',
                schedule_config: { day: 1 },
                start_date: '2024-01-01',
            };

            mockQuery.mockResolvedValueOnce({ rows: [] });

            const result = await api.insertRecurringRule(input);

            // insertRecurringRule builds the object locally
            expect(result.amount_cents).toBe(100000);
            expect(result.category).toBe('Housing');
            expect(result.id).toBeDefined();
            expect(mockQuery).toHaveBeenCalled();
        });

        it('uses provided id when one is supplied', async () => {
            const input: Partial<RecurringRule> = {
                id: 'rule-custom-id',
                direction: 'expense',
                amount_cents: 100000,
                currency_code: 'USD',
                category: 'Housing',
                tag: 'rent',
                payment_method: 'cash',
                schedule_type: 'monthly_day',
                schedule_config: { day: 1 },
                start_date: '2024-01-01',
            };

            mockQuery.mockResolvedValueOnce({ rows: [] });

            const result = await api.insertRecurringRule(input);

            expect(result.id).toBe('rule-custom-id');
            expect(mockQuery.mock.calls[0][1][0]).toBe('rule-custom-id');
        });
    });

    describe('deleteRecurringRule', () => {
        it('soft deletes recurring rule', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            await api.deleteRecurringRule('rule-1');

            expect(mockQuery).toHaveBeenCalled();
            const callArgs = mockQuery.mock.calls[0][0];
            expect(callArgs).toContain('UPDATE');
            expect(callArgs).toContain('deleted_at');
        });
    });

    describe('skipRecurringOccurrence', () => {
        it('adds exception using original_date and deletes physical override', async () => {
            mockQuery
                // fetchRecurringRule
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'rule-1',
                        schedule_config: '{"n":1}',
                        exception_dates: '[]'
                    }]
                })
                // updateRecurringRule UPDATE
                .mockResolvedValueOnce({ rows: [] })
                // updateRecurringRule SELECT
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'rule-1',
                        schedule_config: '{"n":1}',
                        exception_dates: '["2024-01-10"]'
                    }]
                })
                // deleteTransaction
                .mockResolvedValueOnce({ rows: [] });

            await api.skipRecurringOccurrence({
                id: 'tx-1',
                recurring_rule_id: 'rule-1',
                date: '2024-01-20',
                original_date: '2024-01-10',
            });

            expect(mockQuery).toHaveBeenCalledTimes(4);

            const updateSql = mockQuery.mock.calls[1][0];
            const updateParams = mockQuery.mock.calls[1][1];
            expect(updateSql).toContain('UPDATE recurring_rules');
            expect(updateParams[1]).toBe(JSON.stringify(['2024-01-10']));

            const deleteSql = mockQuery.mock.calls[3][0];
            const deleteParams = mockQuery.mock.calls[3][1];
            expect(deleteSql).toContain('UPDATE transactions SET deleted_at');
            expect(deleteParams[1]).toBe('tx-1');
        });

        it('adds exception without deleting when occurrence is virtual', async () => {
            mockQuery
                // fetchRecurringRule
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'rule-1',
                        schedule_config: '{"n":1}',
                        exception_dates: '[]'
                    }]
                })
                // updateRecurringRule UPDATE
                .mockResolvedValueOnce({ rows: [] })
                // updateRecurringRule SELECT
                .mockResolvedValueOnce({
                    rows: [{
                        id: 'rule-1',
                        schedule_config: '{"n":1}',
                        exception_dates: '["2024-01-10"]'
                    }]
                });

            await api.skipRecurringOccurrence({
                id: 'virtual-rule-1-2024-01-10',
                recurring_rule_id: 'rule-1',
                date: '2024-01-10',
                original_date: '2024-01-10',
            });

            expect(mockQuery).toHaveBeenCalledTimes(3);
        });
    });

    describe('migrateFutureTransactions', () => {
        it('updates recurring_rule_id with updated_at and user scope', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tx-1' }] });

            await api.migrateFutureTransactions('old-rule', 'new-rule', '2024-01-01');

            const sql = mockQuery.mock.calls[0][0];
            const params = mockQuery.mock.calls[0][1];
            expect(sql).toContain('SET recurring_rule_id = $1');
            expect(sql).toContain('updated_at = $5');
            expect(sql).toContain('WHERE recurring_rule_id = $2');
            expect(sql).toContain('AND user_id = $4');
            expect(params[0]).toBe('new-rule');
            expect(params[1]).toBe('old-rule');
            expect(params[2]).toBe('2024-01-01');
            expect(params[3]).toBe('test-user-123');
        });
    });

    describe('deleteFutureTransactionsForRule', () => {
        it('soft deletes future overrides with updated_at and user scope', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tx-1' }, { id: 'tx-2' }] });

            await api.deleteFutureTransactionsForRule('rule-1', '2024-01-15');

            const sql = mockQuery.mock.calls[0][0];
            const params = mockQuery.mock.calls[0][1];
            expect(sql).toContain('SET deleted_at = $1');
            expect(sql).toContain('updated_at = $1');
            expect(sql).toContain('WHERE recurring_rule_id = $2');
            expect(sql).toContain('AND user_id = $4');
            expect(params[1]).toBe('rule-1');
            expect(params[2]).toBe('2024-01-15');
            expect(params[3]).toBe('test-user-123');
        });
    });

    describe('fetchDistinctTags', () => {
        it('returns tags from transactions', async () => {
            const mockData = [
                { tag: 'groceries' },
                { tag: 'rent' },
            ];
            mockQuery.mockResolvedValueOnce({ rows: mockData });

            const tags = await api.fetchDistinctTags();

            expect(tags).toContain('groceries');
            expect(tags).toContain('rent');
        });

        it('returns empty array when no tags', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            const tags = await api.fetchDistinctTags();

            expect(tags).toEqual([]);
        });
    });

    describe('computeMonthBalance', () => {
        it('computes balance from grouped transactions by direction', async () => {
            // Updated to provide raw transactions since computeMonthBalance now aggregates in code
            const mockRows = [
                { id: '1', date: '2024-01-01', amount_cents: 100000, direction: 'income' },
                { id: '2', date: '2024-01-02', amount_cents: 50000, direction: 'expense' },
            ];
            mockQuery.mockResolvedValueOnce({ rows: mockRows });

            const result = await api.computeMonthBalance('2024-01-01');

            expect(result.income).toBe(100000);
            expect(result.expense).toBe(50000);
            expect(result.balance).toBe(50000);
        });

        it('returns zeros when no transactions', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            const result = await api.computeMonthBalance('2024-01-01');

            expect(result.income).toBe(0);
            expect(result.expense).toBe(0);
            expect(result.balance).toBe(0);
        });
    });

    describe('fetchParameters', () => {
        it('returns parameters from local database', async () => {
            const mockData = [
                { key: 'theme', value: '"dark"' },
                { key: 'currency', value: '"USD"' },
            ];
            mockQuery.mockResolvedValueOnce({ rows: mockData });

            const params = await api.fetchParameters();

            expect(params).toHaveLength(2);
            expect(mockQuery).toHaveBeenCalled();
        });
    });

    describe('upsertParameter', () => {
        it('inserts new parameter when not exists', async () => {
            // First SELECT returns nothing (not found)
            mockQuery.mockResolvedValueOnce({ rows: [] });
            // Then INSERT
            mockQuery.mockResolvedValueOnce({ rows: [{ key: 'theme', value: '"dark"' }] });

            await api.upsertParameter('theme', 'dark');

            expect(mockQuery).toHaveBeenCalledTimes(2);
        });

        it('updates existing parameter', async () => {
            // First SELECT returns existing
            mockQuery.mockResolvedValueOnce({ rows: [{ id: 'param-1' }] });
            // Then UPDATE
            mockQuery.mockResolvedValueOnce({ rows: [{ key: 'theme', value: '"light"' }] });

            await api.upsertParameter('theme', 'light');

            expect(mockQuery).toHaveBeenCalledTimes(2);
        });
    });

    describe('fetchExchangeRate', () => {
        it('returns the rate that was effective for the transaction month', async () => {
            const mockData = [
                { id: 'rate-jun', currency_code: 'ARS', rate: 1200, created_at: '2024-06-10T00:00:00Z' },
                { id: 'rate-may', currency_code: 'ARS', rate: 1000, created_at: '2024-05-10T00:00:00Z' },
            ];
            mockQuery.mockResolvedValueOnce({ rows: mockData });

            // A May transaction should keep May's rate, not the later June one.
            const rateId = await api.fetchExchangeRate('ARS', '2024-05-20');

            expect(rateId).toBe('rate-may');
        });

        it('returns null when no rate found', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            const rateId = await api.fetchExchangeRate('XYZ', '2024-06-01');

            expect(rateId).toBeNull();
        });
    });

    describe('fetchLatestRates', () => {
        it('returns rates ordered by created_at', async () => {
            const mockData = [
                { currency_code: 'USD', rate: 100, created_at: '2024-01-02' },
                { currency_code: 'EUR', rate: 110, created_at: '2024-01-02' },
            ];
            mockQuery.mockResolvedValueOnce({ rows: mockData });

            const rates = await api.fetchLatestRates();

            expect(rates).toHaveLength(2);
            expect(rates.find(r => r.currency_code === 'USD')?.rate).toBe(100);
        });
    });

    describe('fetchCreditTransactions', () => {
        it('returns transactions for credit card with enriched data', async () => {
            const mockData = [{ id: '1', credit_card_id: 'card-1', date: '2024-01-15', exchange_rate_value: null, credit_card_name: 'Visa' }];
            mockQuery.mockResolvedValueOnce({ rows: mockData });

            const transactions = await api.fetchCreditTransactions('card-1', '2024-01-01', '2024-01-31');

            expect(transactions).toHaveLength(1);
            expect(transactions[0].id).toBe('1');
            expect(transactions[0].credit_card).toEqual({ name: 'Visa' });
        });
    });
});
