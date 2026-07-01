import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    calculateCreditCardEffectiveDate,
    formatLocalDate,
    formatLocalMonth,
    parseLocalDate,
    getTodayLocalDate,
    getMonthStartDay,
    cacheMonthStartDay,
    getPeriodRange,
    getPeriodForDate,
    getCurrentPeriodAnchor,
    getPeriodLabel,
    getPeriodLabelMonth,
    anchorFromPeriodLabelMonth,
    addMonthsClamped,
    shouldDeriveCardEffectiveDate
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

describe('Financial Period Utilities', () => {
    afterEach(() => {
        localStorage.clear();
    });

    describe('getMonthStartDay / cacheMonthStartDay', () => {
        it('defaults to 1 when unset', () => {
            expect(getMonthStartDay()).toBe(1);
        });

        it('reads a cached value', () => {
            cacheMonthStartDay(15);
            expect(getMonthStartDay()).toBe(15);
        });

        it('clamps out-of-range values to [1, 28]', () => {
            cacheMonthStartDay(40);
            expect(getMonthStartDay()).toBe(28);
            cacheMonthStartDay(0);
            expect(getMonthStartDay()).toBe(1);
        });

        it('clears back to default when passed null', () => {
            cacheMonthStartDay(15);
            cacheMonthStartDay(null);
            expect(getMonthStartDay()).toBe(1);
        });
    });

    describe('getPeriodRange', () => {
        it('is a plain calendar month when start day is 1 (parity)', () => {
            expect(getPeriodRange('2026-07')).toEqual({ start: '2026-07-01', end: '2026-08-01' });
            expect(getPeriodRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
        });

        it('shifts to the configured start day', () => {
            cacheMonthStartDay(15);
            expect(getPeriodRange('2026-07')).toEqual({ start: '2026-07-15', end: '2026-08-15' });
        });

        it('handles the year boundary', () => {
            cacheMonthStartDay(15);
            expect(getPeriodRange('2026-12')).toEqual({ start: '2026-12-15', end: '2027-01-15' });
        });

        it('accepts a YYYY-MM-DD anchor (ignores the day part)', () => {
            cacheMonthStartDay(15);
            expect(getPeriodRange('2026-07-01')).toEqual({ start: '2026-07-15', end: '2026-08-15' });
        });
    });

    describe('getPeriodForDate', () => {
        it('is the calendar month when start day is 1 (parity)', () => {
            expect(getPeriodForDate('2026-07-20')).toBe('2026-07');
            expect(getPeriodForDate('2026-07-01')).toBe('2026-07');
        });

        it('assigns dates on/after the start day to their own month', () => {
            cacheMonthStartDay(15);
            expect(getPeriodForDate('2026-07-15')).toBe('2026-07');
            expect(getPeriodForDate('2026-07-20')).toBe('2026-07');
        });

        it('assigns dates before the start day to the previous month', () => {
            cacheMonthStartDay(15);
            expect(getPeriodForDate('2026-07-10')).toBe('2026-06');
        });

        it('handles the year boundary', () => {
            cacheMonthStartDay(15);
            expect(getPeriodForDate('2026-01-05')).toBe('2025-12');
        });
    });

    describe('getCurrentPeriodAnchor', () => {
        beforeEach(() => vi.useFakeTimers());
        afterEach(() => vi.useRealTimers());

        it('returns the anchor month (pinned to the 1st) for today', () => {
            cacheMonthStartDay(15);
            vi.setSystemTime(new Date(2026, 6, 3)); // Jul 3 -> before start day -> June period
            const anchor = getCurrentPeriodAnchor();
            expect(anchor.getFullYear()).toBe(2026);
            expect(anchor.getMonth()).toBe(5); // June
            expect(anchor.getDate()).toBe(1);
        });

        it('uses the current month once the start day has passed', () => {
            cacheMonthStartDay(15);
            vi.setSystemTime(new Date(2026, 6, 20)); // Jul 20 -> July period
            const anchor = getCurrentPeriodAnchor();
            expect(anchor.getMonth()).toBe(6); // July
        });
    });

    describe('getPeriodLabel (majority of days, tie -> end month)', () => {
        it('is the calendar month when start day is 1', () => {
            expect(getPeriodLabel('2026-07')).toBe('July 2026');
        });

        it('uses the start month when it holds the majority (31-day month, start 15)', () => {
            cacheMonthStartDay(15);
            // Jul 15–Aug 14: 17 days in July vs 14 in August -> July
            expect(getPeriodLabel('2026-07')).toBe('July 2026');
        });

        it('defaults to the end month on a tie (28-day Feb, start 15)', () => {
            cacheMonthStartDay(15);
            // Feb 15–Mar 14 (non-leap): 14 vs 14 -> tie -> March
            expect(getPeriodLabel('2026-02')).toBe('March 2026');
        });

        it('uses the start month for a leap February (start 15)', () => {
            cacheMonthStartDay(15);
            // Feb 15–Mar 14 (leap): 15 vs 14 -> February
            expect(getPeriodLabel('2024-02')).toBe('February 2024');
        });

        it('uses the end month when it holds the majority (start 20)', () => {
            cacheMonthStartDay(20);
            // Jul 20–Aug 19: 12 vs 19 -> August
            expect(getPeriodLabel('2026-07')).toBe('August 2026');
            // Dec 20–Jan 19: end month rolls into the next year
            expect(getPeriodLabel('2026-12')).toBe('January 2027');
        });
    });

    describe('getPeriodLabelMonth / anchorFromPeriodLabelMonth', () => {
        afterEach(() => cacheMonthStartDay(null));

        it('labels a period by its majority month and inverts it (start day 20)', () => {
            cacheMonthStartDay(20);
            // Period anchored 2026-07 runs Jul 20 – Aug 19: the majority (and label) is August.
            expect(getPeriodLabelMonth('2026-07')).toBe('2026-08');
            expect(anchorFromPeriodLabelMonth('2026-08')).toBe('2026-07');
            // The label the filter shows must map back to the anchor the breakdown groups by.
            expect(anchorFromPeriodLabelMonth(getPeriodLabelMonth('2026-11'))).toBe('2026-11');
            // Year boundary.
            expect(getPeriodLabelMonth('2026-12')).toBe('2027-01');
            expect(anchorFromPeriodLabelMonth('2027-01')).toBe('2026-12');
        });

        it('is the identity when the start day is 1', () => {
            cacheMonthStartDay(1);
            expect(getPeriodLabelMonth('2026-07')).toBe('2026-07');
            expect(anchorFromPeriodLabelMonth('2026-07')).toBe('2026-07');
        });

        it('stays consistent with getPeriodLabel', () => {
            cacheMonthStartDay(20);
            expect(getPeriodLabel('2026-07')).toBe('August 2026');
            expect(getPeriodLabelMonth('2026-07')).toBe('2026-08');
        });
    });

    describe('addMonthsClamped', () => {
        it('clamps day-31 to the last valid day of the target month', () => {
            expect(formatLocalDate(addMonthsClamped(parseLocalDate('2024-01-31'), 1))).toBe('2024-02-29'); // leap
            expect(formatLocalDate(addMonthsClamped(parseLocalDate('2025-01-31'), 1))).toBe('2025-02-28');
            expect(formatLocalDate(addMonthsClamped(parseLocalDate('2024-01-31'), 3))).toBe('2024-04-30');
        });

        it('is anchored to the original day, not accumulated (no drift)', () => {
            // Reaching March directly keeps day 31; stepping through Feb must not drift.
            expect(formatLocalDate(addMonthsClamped(parseLocalDate('2024-01-31'), 2))).toBe('2024-03-31');
        });

        it('handles year rollover and preserves days <= 28', () => {
            expect(formatLocalDate(addMonthsClamped(parseLocalDate('2023-11-15'), 3))).toBe('2024-02-15');
        });
    });

    describe('shouldDeriveCardEffectiveDate', () => {
        it('derives for a brand-new transaction', () => {
            expect(shouldDeriveCardEffectiveDate({
                isNew: true, enteredDate: '2026-06-24', cardId: 'c1'
            })).toBe(true);
        });

        it('does NOT re-derive when editing an unrelated field on the same card', () => {
            // The core bug: editing a note must not shift the stored effective date.
            expect(shouldDeriveCardEffectiveDate({
                isNew: false, enteredDate: '2026-07-10', storedDate: '2026-07-10',
                storedMethod: 'card', storedCardId: 'c1', cardId: 'c1'
            })).toBe(false);
        });

        it('derives when the user changes the date', () => {
            expect(shouldDeriveCardEffectiveDate({
                isNew: false, enteredDate: '2026-08-01', storedDate: '2026-07-10',
                storedMethod: 'card', storedCardId: 'c1', cardId: 'c1'
            })).toBe(true);
        });

        it('derives when the card is (re)assigned or converted from cash', () => {
            expect(shouldDeriveCardEffectiveDate({
                isNew: false, enteredDate: '2026-07-10', storedDate: '2026-07-10',
                storedMethod: 'card', storedCardId: 'c1', cardId: 'c2'
            })).toBe(true);
            expect(shouldDeriveCardEffectiveDate({
                isNew: false, enteredDate: '2026-07-10', storedDate: '2026-07-10',
                storedMethod: 'cash', storedCardId: null, cardId: 'c1'
            })).toBe(true);
        });
    });
});
