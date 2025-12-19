import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from './api';
import { supabase } from './supabase';

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
    });

    it('fetchCurrencies calls supabase correctly', async () => {
        const mockData = [{ code: 'USD', name: 'US Dollar' }];
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
        });

        const currencies = await api.fetchCurrencies();
        expect(currencies).toEqual(mockData);
        expect(supabase.from).toHaveBeenCalledWith('currencies');
    });

    it('fetchTransactions calls supabase correctly', async () => {
        const mockData = [{ id: '1', date: '2024-01-15' }];
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lt: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
        });

        const transactions = await api.fetchTransactions('2024-01-01');
        expect(transactions).toEqual(mockData);
        expect(supabase.from).toHaveBeenCalledWith('transactions');
    });

    it('insertTransaction calls supabase correctly', async () => {
        const input = { amount_cents: 100, category: 'Food', date: '2024-01-01' } as any;
        const mockData = { id: '123', ...input };
        (supabase.from as any).mockReturnValue({
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockData, error: null }),
        });

        const result = await api.insertTransaction(input);
        expect(result).toEqual(mockData);
        expect(supabase.from).toHaveBeenCalledWith('transactions');
    });

    it('fetchExchangeRate returns rate id', async () => {
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'rate-123' }, error: null }),
        });

        const rateId = await api.fetchExchangeRate('USD');
        expect(rateId).toBe('rate-123');
    });

    it('fetchDistinctTags dedups and sorts tags', async () => {
        const mockData = [{ tag: 'food' }, { tag: 'food' }, { tag: 'rent' }];
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: mockData, error: null }),
        });

        const tags = await api.fetchDistinctTags();
        expect(tags).toEqual(['food', 'rent']);
    });

    it('updateTransaction calls supabase correctly', async () => {
        (supabase.from as any).mockReturnValue({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: '1' }, error: null }),
        });
        await api.updateTransaction('1', { amount_cents: 200 } as any);
        expect(supabase.from).toHaveBeenCalledWith('transactions');
    });

    it('deleteTransaction calls update with deleted_at', async () => {
        const updateMock = vi.fn().mockReturnThis();
        (supabase.from as any).mockReturnValue({
            update: updateMock,
            eq: vi.fn().mockReturnThis(),
        });
        await api.deleteTransaction('1');
        expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
    });

    it('fetchCreditCards calls supabase correctly', async () => {
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
        });
        await api.fetchCreditCards();
        expect(supabase.from).toHaveBeenCalledWith('credit_cards');
    });

    it('fetchTransactionsRange calls supabase correctly', async () => {
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lt: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
        });
        await api.fetchTransactionsRange('2024-01-01', '2024-02-01');
        expect(supabase.from).toHaveBeenCalledWith('transactions');
    });

    it('insertExchangeRate call repoint rpc', async () => {
        (supabase.from as any).mockReturnValue({
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'new-rate-id' }, error: null }),
        });
        (supabase.rpc as any).mockResolvedValue({ error: null });

        await api.insertExchangeRate('USD', 1000);
        expect(supabase.rpc).toHaveBeenCalledWith('repoint_exchange_rate', expect.any(Object));
    });

    it('computeMonthBalance calls rpc', async () => {
        (supabase.rpc as any).mockResolvedValue({ data: { income: 100, expense: 50, balance: 50 }, error: null });
        const result = await api.computeMonthBalance('2024-01-01');
        expect(result.balance).toBe(50);
        expect(supabase.rpc).toHaveBeenCalledWith('compute_month_balance', { target_month: '2024-01-01' });
    });

    it('upsertParameter calls upsert', async () => {
        (supabase.from as any).mockReturnValue({
            upsert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { key: 'theme', value: 'dark' }, error: null }),
        });
        await api.upsertParameter('theme', 'dark');
        expect(supabase.from).toHaveBeenCalledWith('parameters');
    });

    it('fetchCreditTransactions calls supabase correctly', async () => {
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
        });
        await api.fetchCreditTransactions('card-1', '2024-01-01', '2024-01-31');
        expect(supabase.from).toHaveBeenCalledWith('transactions');
    });

    it('fetchLatestRates dedups correctly', async () => {
        const mockData = [
            { currency_code: 'USD', rate: 1, created_at: '2' },
            { currency_code: 'USD', rate: 0.9, created_at: '1' },
            { currency_code: 'EUR', rate: 0.8, created_at: '3' },
        ];
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
        });
        const rates = await api.fetchLatestRates();
        expect(rates).toHaveLength(2);
        expect(rates.find(r => r.currency_code === 'USD')?.rate).toBe(1);
    });

    it('fetchRecurringRules calls supabase correctly', async () => {
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
        });
        await api.fetchRecurringRules();
        expect(supabase.from).toHaveBeenCalledWith('recurring_rules');
    });

    it('insertRecurringRule calls supabase correctly', async () => {
        (supabase.from as any).mockReturnValue({
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: {}, error: null }),
        });
        await api.insertRecurringRule({ amount_cents: 100 } as any);
        expect(supabase.from).toHaveBeenCalledWith('recurring_rules');
    });

    it('updateRecurringRule calls supabase correctly', async () => {
        (supabase.from as any).mockReturnValue({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: {}, error: null }),
        });
        await api.updateRecurringRule('1', { amount_cents: 200 } as any);
        expect(supabase.from).toHaveBeenCalledWith('recurring_rules');
    });

    it('deleteRecurringRule calls update with deleted_at', async () => {
        (supabase.from as any).mockReturnValue({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        });
        await api.deleteRecurringRule('1');
        expect(supabase.from).toHaveBeenCalledWith('recurring_rules');
    });

    it('ensureRecurringGenerated calls rpc', async () => {
        (supabase.rpc as any).mockResolvedValue({ error: null });
        await api.ensureRecurringGenerated('2024-12-31');
        expect(supabase.rpc).toHaveBeenCalledWith('ensure_recurring_generated', { until_date: '2024-12-31' });
    });

    it('fetchParameters calls supabase correctly', async () => {
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: [], error: null }),
        });
        await api.fetchParameters();
        expect(supabase.from).toHaveBeenCalledWith('parameters');
    });

    it('insertCreditCard calls supabase correctly', async () => {
        (supabase.from as any).mockReturnValue({
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'card-1' }, error: null }),
        });
        const result = await api.insertCreditCard('My Card', 20, 5);
        expect(result.id).toBe('card-1');
        expect(supabase.from).toHaveBeenCalledWith('credit_cards');
    });

    it('deleteCreditCard calls update with deleted_at', async () => {
        (supabase.from as any).mockReturnValue({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        });
        await api.deleteCreditCard('card-1');
        expect(supabase.from).toHaveBeenCalledWith('credit_cards');
    });

    it('fetchDistinctTags handles error', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: null, error: new Error('Api Error') }),
        });
        const tags = await api.fetchDistinctTags();
        expect(tags).toEqual([]);
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('fetchExchangeRate handles error', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error('Api Error') }),
        });
        const rate = await api.fetchExchangeRate('USD');
        expect(rate).toBeNull();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});
