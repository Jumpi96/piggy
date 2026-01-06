import { describe, it, expect } from 'vitest';
import { generateOccurrences, mergeTransactions } from './recurringUtils';
import type { RecurringRule, Transaction } from '../types';

describe('recurringUtils', () => {
    const baseRule: RecurringRule = {
        id: 'rule-1',
        user_id: 'user-1',
        direction: 'expense',
        amount_cents: 1000,
        currency_code: 'USD',
        category: 'Food',
        tag: 'lunch',
        payment_method: 'cash',
        active: true,
        start_date: '2024-01-01',
        created_at: '2024-01-01T00:00:00Z',
        schedule_type: 'every_n_days',
        schedule_config: { n: 1 }
    };

    describe('generateOccurrences', () => {
        it('generates daily occurrences correctly', () => {
            const occurrences = generateOccurrences(baseRule, '2024-01-01', '2024-01-06');
            expect(occurrences).toHaveLength(5);
            expect(occurrences[0].date).toBe('2024-01-01');
            expect(occurrences[4].date).toBe('2024-01-05');
            expect(occurrences[0].id).toBe('virtual-rule-1-2024-01-01');
        });

        it('respects end_date', () => {
            const ruleWithEnd = { ...baseRule, end_date: '2024-01-03' };
            const occurrences = generateOccurrences(ruleWithEnd, '2024-01-01', '2024-01-10');
            expect(occurrences).toHaveLength(3);
            expect(occurrences[2].date).toBe('2024-01-03');
        });

        it('respects exception_dates', () => {
            const ruleWithExceptions = { ...baseRule, exception_dates: ['2024-01-02', '2024-01-04'] };
            const occurrences = generateOccurrences(ruleWithExceptions, '2024-01-01', '2024-01-06');
            expect(occurrences).toHaveLength(3);
            expect(occurrences.map(o => o.date)).toEqual(['2024-01-01', '2024-01-03', '2024-01-05']);
        });

        it('handles monthly_day schedule correctly', () => {
            const monthlyRule: RecurringRule = {
                ...baseRule,
                schedule_type: 'monthly_day',
                schedule_config: {}
            };
            const occurrences = generateOccurrences(monthlyRule, '2024-01-01', '2024-03-31');
            expect(occurrences).toHaveLength(3);
            expect(occurrences.map(o => o.date)).toEqual(['2024-01-01', '2024-02-01', '2024-03-01']);
        });

        it('handles every_n_months schedule correctly', () => {
            const rule = { ...baseRule, schedule_type: 'every_n_months' as const, schedule_config: { n: 3 } };
            const occurrences = generateOccurrences(rule, '2024-01-01', '2024-10-01');
            expect(occurrences).toHaveLength(3);
            expect(occurrences.map(o => o.date)).toEqual(['2024-01-01', '2024-04-01', '2024-07-01']);
        });
    });

    describe('mergeTransactions', () => {
        const virtual = generateOccurrences(baseRule, '2024-01-01', '2024-01-03');
        const physical: Transaction[] = [
            {
                id: 'phys-1',
                user_id: 'user-1',
                direction: 'expense',
                amount_cents: 1200, // Changed amount
                currency_code: 'USD',
                date: '2024-01-02',
                category: 'Food',
                tag: 'lunch',
                payment_method: 'cash',
                recurring_rule_id: 'rule-1',
                original_date: '2024-01-02',
                created_at: '2024-01-02T10:00:00Z',
                updated_at: '2024-01-02T10:00:00Z',
                to_be_balanced: false
            }
        ];

        it('hides virtual occurrences when physical counterpart exists', () => {
            const merged = mergeTransactions(virtual, physical);
            expect(merged).toHaveLength(2); // 1 virtual (01-01) + 1 physical (01-02 override)
            expect(merged.map(m => m.id)).toContain('phys-1');
            expect(merged.map(m => m.id)).not.toContain('virtual-rule-1-2024-01-02');

            const overridden = merged.find(m => m.date === '2024-01-02');
            expect(overridden?.amount_cents).toBe(1200);
        });

        it('keeps regular physical transactions', () => {
            const regularPhysical: Transaction[] = [
                {
                    id: 'phys-2',
                    user_id: 'user-1',
                    direction: 'income',
                    amount_cents: 50000,
                    currency_code: 'USD',
                    date: '2024-01-05',
                    category: 'Salary',
                    tag: 'job',
                    payment_method: 'cash',
                    created_at: '2024-01-05T00:00:00Z',
                    updated_at: '2024-01-05T00:00:00Z',
                    to_be_balanced: false
                }
            ];
            const merged = mergeTransactions(virtual, regularPhysical);
            expect(merged).toHaveLength(3); // 2 virtual + 1 physical
            expect(merged.map(m => m.id)).toContain('phys-2');
        });
    });
});
