import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    calculateCreditCardEffectiveDate,
    formatLocalDate,
    formatLocalMonth,
    parseLocalDate,
    getTodayLocalDate
} from './dates';

describe('Date Utilities', () => {
    describe('formatLocalDate', () => {
        it('formats a date correctly to YYYY-MM-DD', () => {
            const date = new Date(2024, 0, 15); // Jan 15, 2024
            expect(formatLocalDate(date)).toBe('2024-01-15');
        });

        it('pads single digit month and day', () => {
            const date = new Date(2024, 4, 5); // May 5, 2024
            expect(formatLocalDate(date)).toBe('2024-05-05');
        });
    });

    describe('formatLocalMonth', () => {
        it('formats a date correctly to YYYY-MM', () => {
            const date = new Date(2024, 0, 15); // Jan 15, 2024
            expect(formatLocalMonth(date)).toBe('2024-01');
        });

        it('pads single digit month', () => {
            const date = new Date(2024, 8, 5); // Sep 5, 2024
            expect(formatLocalMonth(date)).toBe('2024-09');
        });
    });

    describe('parseLocalDate', () => {
        it('parses YYYY-MM-DD correctly', () => {
            const date = parseLocalDate('2024-01-15');
            expect(date.getFullYear()).toBe(2024);
            expect(date.getMonth()).toBe(0); // Jan
            expect(date.getDate()).toBe(15);
        });
    });

    describe('getTodayLocalDate', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('returns today in YYYY-MM-DD format', () => {
            const date = new Date(2024, 3, 20); // April 20, 2024
            vi.setSystemTime(date);
            expect(getTodayLocalDate()).toBe('2024-04-20');
        });
    });

    describe('Credit Card Date Shifting', () => {
        const closingDay = 20;
        const paymentDay = 5;

        it('shifts to next month if transaction is before closing date', () => {
            // Jan 10 (before Jan 20) -> Payment Feb 5
            const tDate = new Date(2024, 0, 10, 12, 0, 0);
            const effective = calculateCreditCardEffectiveDate(tDate, closingDay, paymentDay);

            expect(effective.getFullYear()).toBe(2024);
            expect(effective.getMonth()).toBe(1); // Feb (0-indexed)
            expect(effective.getDate()).toBe(paymentDay);
        });

        it('shifts to month + 2 if transaction is on closing date', () => {
            // Jan 20 (on Jan 20) -> Payment Mar 5
            const tDate = new Date(2024, 0, 20, 12, 0, 0);
            const effective = calculateCreditCardEffectiveDate(tDate, closingDay, paymentDay);

            expect(effective.getFullYear()).toBe(2024);
            expect(effective.getMonth()).toBe(2); // Mar
            expect(effective.getDate()).toBe(paymentDay);
        });

        it('shifts to month + 2 if transaction is after closing date', () => {
            // Jan 25 (after Jan 20) -> Payment Mar 5
            const tDate = new Date(2024, 0, 25, 12, 0, 0);
            const effective = calculateCreditCardEffectiveDate(tDate, closingDay, paymentDay);

            expect(effective.getFullYear()).toBe(2024);
            expect(effective.getMonth()).toBe(2); // Mar
            expect(effective.getDate()).toBe(paymentDay);
        });

        it('handles year rollover (Dec -> Jan)', () => {
            // Dec 10, 2023 (before Dec 20) -> Jan 5, 2024
            const tDate = new Date(2023, 11, 10, 12, 0, 0);
            const effective = calculateCreditCardEffectiveDate(tDate, closingDay, paymentDay);

            expect(effective.getFullYear()).toBe(2024);
            expect(effective.getMonth()).toBe(0); // Jan
            expect(effective.getDate()).toBe(paymentDay);
        });

        it('handles year rollover (Dec -> Feb)', () => {
            // Dec 25, 2023 (after Dec 20) -> Feb 5, 2024
            const tDate = new Date(2023, 11, 25, 12, 0, 0);
            const effective = calculateCreditCardEffectiveDate(tDate, closingDay, paymentDay);

            expect(effective.getFullYear()).toBe(2024);
            expect(effective.getMonth()).toBe(1); // Feb
            expect(effective.getDate()).toBe(paymentDay);
        });

        it('keeps future transaction date if it is already a payment day', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2024, 0, 1)); // Today is Jan 1

            const tDate = new Date(2024, 0, 5); // Transaction on Jan 5 (future)
            const effective = calculateCreditCardEffectiveDate(tDate, closingDay, 5);

            expect(effective.getTime()).toBe(tDate.getTime());
            vi.useRealTimers();
        });

        it('moves to next payment day if today is already a payment day and would be the target', () => {
            vi.useFakeTimers();
            const today = new Date(2024, 1, 5); // Today is Feb 5 (payment day)
            vi.setSystemTime(today);

            // Transaction on Jan 10 (before Jan 20 closing) -> Target Feb 5
            // But Feb 5 is TODAY, so move to Mar 5
            const tDate = new Date(2024, 0, 10);
            const effective = calculateCreditCardEffectiveDate(tDate, closingDay, 5);

            expect(effective.getFullYear()).toBe(2024);
            expect(effective.getMonth()).toBe(2); // March
            expect(effective.getDate()).toBe(5);
            vi.useRealTimers();
        });
    });
});
