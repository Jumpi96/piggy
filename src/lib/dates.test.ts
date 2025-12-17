import { describe, it, expect } from 'vitest';
import { calculateCreditCardEffectiveDate } from './dates';

describe('Credit Card Date Shifting', () => {
    const closingDay = 20;
    const paymentDay = 5;

    it('shifts to next month if transaction is before closing date', () => {
        // Jan 10 (before Jan 20) -> Payment Feb 5
        const tDate = new Date('2024-01-10T12:00:00'); // Mid-day to avoid TZ issues
        const effective = calculateCreditCardEffectiveDate(tDate, closingDay, paymentDay);

        expect(effective.getFullYear()).toBe(2024);
        expect(effective.getMonth()).toBe(1); // Feb (0-indexed)
        expect(effective.getDate()).toBe(paymentDay);
    });

    it('shifts to month + 2 if transaction is on closing date', () => {
        // Jan 20 (on Jan 20) -> Payment Mar 5
        const tDate = new Date('2024-01-20T12:00:00');
        const effective = calculateCreditCardEffectiveDate(tDate, closingDay, paymentDay);

        expect(effective.getFullYear()).toBe(2024);
        expect(effective.getMonth()).toBe(2); // Mar
        expect(effective.getDate()).toBe(paymentDay);
    });

    it('shifts to month + 2 if transaction is after closing date', () => {
        // Jan 25 (after Jan 20) -> Payment Mar 5
        const tDate = new Date('2024-01-25T12:00:00');
        const effective = calculateCreditCardEffectiveDate(tDate, closingDay, paymentDay);

        expect(effective.getFullYear()).toBe(2024);
        expect(effective.getMonth()).toBe(2); // Mar
        expect(effective.getDate()).toBe(paymentDay);
    });

    it('handles year rollover (Dec -> Jan)', () => {
        // Dec 10, 2023 (before Dec 20) -> Jan 5, 2024
        const tDate = new Date('2023-12-10T12:00:00');
        const effective = calculateCreditCardEffectiveDate(tDate, closingDay, paymentDay);

        expect(effective.getFullYear()).toBe(2024);
        expect(effective.getMonth()).toBe(0); // Jan
        expect(effective.getDate()).toBe(paymentDay);
    });

    it('handles year rollover (Dec -> Feb)', () => {
        // Dec 25, 2023 (after Dec 20) -> Feb 5, 2024
        const tDate = new Date('2023-12-25T12:00:00');
        const effective = calculateCreditCardEffectiveDate(tDate, closingDay, paymentDay);

        expect(effective.getFullYear()).toBe(2024);
        expect(effective.getMonth()).toBe(1); // Feb
        expect(effective.getDate()).toBe(paymentDay);
    });
});
