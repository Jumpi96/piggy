import { describe, it, expect } from 'vitest';
import { pickRateForDate, type RateRow } from './currency';

describe('pickRateForDate', () => {
    const rates: RateRow[] = [
        { id: 'may', currency_code: 'ARS', rate: 1000, created_at: '2024-05-10T00:00:00Z' },
        { id: 'jun-a', currency_code: 'ARS', rate: 1100, created_at: '2024-06-05T00:00:00Z' },
        { id: 'jun-b', currency_code: 'ARS', rate: 1200, created_at: '2024-06-20T00:00:00Z' },
        { id: 'jul', currency_code: 'ARS', rate: 1500, created_at: '2024-07-15T00:00:00Z' },
    ];

    it('returns { rate: 1 } for USD without touching the list', () => {
        expect(pickRateForDate([], 'USD', '2024-06-15')).toEqual({ rate: 1 });
    });

    it('returns null for an unknown currency', () => {
        expect(pickRateForDate(rates, 'EUR', '2024-06-15')).toBeNull();
    });

    it('picks the latest rate created within the transaction month', () => {
        // Two rates set in June -> the later one wins for every June day.
        expect(pickRateForDate(rates, 'ARS', '2024-06-01')).toEqual({ id: 'jun-b', rate: 1200 });
        expect(pickRateForDate(rates, 'ARS', '2024-06-25')).toEqual({ id: 'jun-b', rate: 1200 });
    });

    it('does not let a later month leak into an earlier month', () => {
        // A May transaction keeps May's rate even though June/July rates exist.
        expect(pickRateForDate(rates, 'ARS', '2024-05-31')).toEqual({ id: 'may', rate: 1000 });
    });

    it('carries the most recent prior rate forward when a month has no rate', () => {
        // No rate was set in August -> July's rate carries forward.
        expect(pickRateForDate(rates, 'ARS', '2024-08-10')).toEqual({ id: 'jul', rate: 1500 });
    });

    it('falls back to the latest rate for a transaction older than any rate', () => {
        // April predates every recorded rate -> best-effort fallback to the latest.
        expect(pickRateForDate(rates, 'ARS', '2024-04-01')).toEqual({ id: 'jul', rate: 1500 });
    });

    it('is case- and whitespace-insensitive on the currency code', () => {
        expect(pickRateForDate(rates, ' ars ', '2024-06-25')).toEqual({ id: 'jun-b', rate: 1200 });
    });
});
