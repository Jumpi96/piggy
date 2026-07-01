import { describe, it, expect } from 'vitest';
import {
    getCategoryColor,
    getTagColor,
    aggregateByCategory,
    aggregateByTag,
    buildDailySeries
} from './chartUtils';
import type { Transaction } from '../types';

describe('chartUtils', () => {
    describe('getCategoryColor', () => {
        it('returns correct color for income categories', () => {
            expect(getCategoryColor('Salary', 'income')).toBe('#0ea5e9');
            expect(getCategoryColor('Unknown', 'income')).toBe('#0ea5e9');
        });

        it('returns correct color for expense categories', () => {
            expect(getCategoryColor('Recreation', 'expense')).toBe('#f97316');
            expect(getCategoryColor('Unknown', 'expense')).toBe('#ef4444');
        });
    });

    describe('getTagColor', () => {
        it('returns a color from the palette', () => {
            expect(getTagColor(0)).toBe('#10b981');
            expect(getTagColor(6)).toBe('#10b981'); // Wraps around
        });
    });

    const mockTransactions: Transaction[] = [
        {
            id: '1',
            user_id: 'u1',
            direction: 'expense',
            amount_cents: 1000,
            category: 'Recreation',
            tag: 'movies',
            date: '2024-01-01',
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
            amount_cents: 2000,
            category: 'Recreation',
            tag: 'games',
            date: '2024-01-02',
            note: 'steam',
            created_at: '',
            updated_at: '',
            payment_method: 'cash',
            currency_code: 'ARS',
            exchange_rate: { rate: 1000 },
            to_be_balanced: false
        },
        {
            id: '3',
            user_id: 'u1',
            direction: 'income',
            amount_cents: 5000,
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

    describe('aggregateByCategory', () => {
        it('aggregates expenses by category correctly', () => {
            const result = aggregateByCategory(mockTransactions, 'expense');
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Recreation');
            // 1000/1 + 2000/1000 = 1002
            expect(result[0].value).toBe(1002);
            expect(result[0].count).toBe(2);
        });

        it('aggregates income by category correctly', () => {
            const result = aggregateByCategory(mockTransactions, 'income');
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Salary');
            expect(result[0].value).toBe(5000);
        });
    });

    describe('aggregateByTag', () => {
        it('aggregates by tag correctly', () => {
            const result = aggregateByTag(mockTransactions, 'expense');
            expect(result).toHaveLength(2);
            expect(result[0].name).toBe('movies');
            expect(result[0].value).toBe(1000);
            expect(result[1].name).toBe('games');
            expect(result[1].value).toBe(2);
        });

        it('filters by category if provided', () => {
            const result = aggregateByTag(mockTransactions, 'expense', 'Recreation');
            expect(result).toHaveLength(2);
        });

        it('filters out other categories if provided', () => {
            const result = aggregateByTag(mockTransactions, 'expense', 'Living');
            expect(result).toHaveLength(0);
        });

        it('respects limit', () => {
            const result = aggregateByTag(mockTransactions, 'expense', null, 1);
            expect(result).toHaveLength(1);
        });
    });

    describe('buildDailySeries', () => {
        it('walks the real date range in chronological order across a month boundary', () => {
            // Period Jul 20 – Aug 19 (start day 20): must stay in real order, not day-of-month.
            const amounts = new Map<string, number>([
                ['2026-07-25', 100],
                ['2026-08-05', 200],
            ]);
            const series = buildDailySeries(amounts, '2026-07-20', '2026-08-20');

            expect(series).toHaveLength(31); // Jul 20..31 (12) + Aug 1..19 (19)
            expect(series[0].date).toBe('2026-07-20');
            expect(series[series.length - 1].date).toBe('2026-08-19');
            // July points come before August points (chronological, not 1..31 day-of-month).
            const jul25 = series.findIndex(p => p.date === '2026-07-25');
            const aug05 = series.findIndex(p => p.date === '2026-08-05');
            expect(jul25).toBeLessThan(aug05);
            expect(series[jul25].amount).toBe(100);
            expect(series[aug05].amount).toBe(200);
            expect(series[jul25].fullLabel).toBe('Jul 25');
            // Zero-spend days are filled in.
            expect(series.find(p => p.date === '2026-07-21')?.amount).toBe(0);
        });
    });
});
