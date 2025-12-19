import { describe, it, expect } from 'vitest';
import { calculateEndDate } from './recurrence';

describe('recurrence utility', () => {
    describe('calculateEndDate', () => {
        it('calculates monthly_day correctly', () => {
            // Jan 15, 3 occurrences -> Jan 15, Feb 15, Mar 15
            expect(calculateEndDate('2024-01-15', 3, 'monthly_day')).toBe('2024-03-15');
        });

        it('calculates every_n_days correctly', () => {
            // Jan 1, 3 occurrences, every 10 days -> Jan 1, Jan 11, Jan 21
            expect(calculateEndDate('2024-01-01', 3, 'every_n_days', 10)).toBe('2024-01-21');
        });

        it('calculates every_n_months correctly', () => {
            // Jan 1, 2 occurrences, every 3 months -> Jan 1, Apr 1
            expect(calculateEndDate('2024-01-01', 2, 'every_n_months', 3)).toBe('2024-04-01');
        });

        it('returns start date if count is 1', () => {
            expect(calculateEndDate('2024-01-15', 1, 'monthly_day')).toBe('2024-01-15');
        });

        it('handles year rollover', () => {
            expect(calculateEndDate('2023-11-15', 3, 'monthly_day')).toBe('2024-01-15');
        });
    });
});
