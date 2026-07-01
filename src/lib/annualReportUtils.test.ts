import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    aggregateExpensesByMonth,
    aggregateIncomeByCategory,
    calculateMonthlySummary,
    calculateTotalTaxes,
    getAvailableYears
} from './annualReportUtils';
import type { Transaction } from '../types';

describe('annualReportUtils', () => {
    const mockTransactions: Transaction[] = [
        {
            id: '1',
            user_id: 'u1',
            direction: 'expense',
            amount_cents: 10000,
            category: 'Recreation',
            tag: 'movies',
            date: '2024-01-15',
            note: 'cinema',
            created_at: '',
            updated_at: '',
            payment_method: 'cash',
            currency_code: 'USD',
            exchange_rate: { rate: 1 },
            to_be_balanced: false
        },
        {
            id: '2',
            user_id: 'u1',
            direction: 'expense',
            amount_cents: 20000,
            category: 'Living',
            tag: 'rent',
            date: '2024-02-10',
            note: 'rent',
            created_at: '',
            updated_at: '',
            payment_method: 'card',
            currency_code: 'USD',
            exchange_rate: { rate: 1 },
            to_be_balanced: false
        },
        {
            id: '3',
            user_id: 'u1',
            direction: 'income',
            amount_cents: 500000,
            category: 'Salary',
            tag: 'job',
            date: '2024-01-01',
            note: 'payday',
            created_at: '',
            updated_at: '',
            payment_method: 'card',
            currency_code: 'USD',
            exchange_rate: { rate: 1 },
            to_be_balanced: false
        }
    ];

    describe('aggregateExpensesByMonth', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2024, 5, 1)); // June 1st, 2024
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('aggregates expenses by month correctly', () => {
            const result = aggregateExpensesByMonth(mockTransactions, 2024);
            // Result should have 6 months (Jan to Jun) because current date is June
            expect(result).toHaveLength(6);
            expect(result[0].month).toBe('2024-01');
            expect(result[0].total).toBe(10000);
            expect(result[1].total).toBe(20000);
            expect(result[2].total).toBe(0);
        });

        it('returns all 12 months for a past year', () => {
            const result = aggregateExpensesByMonth(mockTransactions, 2023);
            expect(result).toHaveLength(12);
        });

        it('rounds once after summing rather than per transaction (no drift)', () => {
            const mk = (id: string, cents: number): Transaction => ({
                id, user_id: 'u1', direction: 'expense', amount_cents: cents,
                category: 'Recreation', tag: 't', date: '2024-03-15', note: '',
                created_at: '', updated_at: '', payment_method: 'cash',
                currency_code: 'ARS', exchange_rate: { rate: 3 }, to_be_balanced: false,
            });
            // Each row is 100/3 = 33.33: per-transaction rounding would give 33+33=66;
            // summing first gives round(200/3)=67.
            const result = aggregateExpensesByMonth([mk('a', 100), mk('b', 100)], 2024);
            const march = result.find(r => r.month === '2024-03');
            expect(march?.categories['Recreation']).toBe(67);
            expect(march?.total).toBe(67);
        });
    });

    describe('aggregateIncomeByCategory', () => {
        it('aggregates income by category correctly', () => {
            const result = aggregateIncomeByCategory(mockTransactions);
            const salary = result.find(r => r.category === 'Salary');
            expect(salary?.amount).toBe(500000);
            expect(salary?.percentage).toBe(100);
        });
    });

    describe('calculateMonthlySummary', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2024, 5, 1)); // June 1st, 2024
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('calculates monthly summary correctly', () => {
            const result = calculateMonthlySummary(mockTransactions, 2024);
            expect(result).toHaveLength(6);

            const jan = result.find(r => r.month === '2024-01');
            expect(jan?.income).toBe(500000);
            expect(jan?.expense).toBe(10000);
            expect(jan?.balance).toBe(490000);

            const feb = result.find(r => r.month === '2024-02');
            expect(feb?.income).toBe(0);
            expect(feb?.expense).toBe(20000);
            expect(feb?.balance).toBe(-20000);
        });
    });

    describe('calculateTotalTaxes', () => {
        it('counts only expense-direction Taxes (ignores income mis-tagged as Taxes)', () => {
            const mk = (id: string, dir: 'income' | 'expense', cents: number): Transaction => ({
                id, user_id: 'u1', direction: dir, amount_cents: cents,
                category: 'Taxes', tag: 't', date: '2024-01-15', note: '',
                created_at: '', updated_at: '', payment_method: 'cash',
                currency_code: 'USD', exchange_rate: { rate: 1 }, to_be_balanced: false,
            });
            const total = calculateTotalTaxes([mk('a', 'expense', 5000), mk('b', 'income', 3000)]);
            expect(total).toBe(5000);
        });
    });

    describe('getAvailableYears', () => {
        it('returns sorted list of years', () => {
            const txs: any[] = [{ date: '2022-01-01' }, { date: '2024-05-01' }, { date: '2023-12-31' }];
            expect(getAvailableYears(txs)).toEqual([2024, 2023, 2022]);
        });
    });
});
