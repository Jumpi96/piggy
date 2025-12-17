import { describe, it, expect } from 'vitest';
import { getExchangeRateForMonth, convertToUSD } from './currency';
import { ExchangeRate } from '../types';

describe('Currency Logic', () => {
    const mockRates: ExchangeRate[] = [
        {
            id: '1',
            user_id: 'u1',
            currency_code: 'ARS',
            month: '2024-01-01',
            rate: 1000,
            created_at: '2024-01-01T00:00:00Z'
        },
        {
            id: '2',
            user_id: 'u1',
            currency_code: 'ARS',
            month: '2024-02-01',
            rate: 1200,
            created_at: '2024-02-01T00:00:00Z'
        },
        {
            id: '3',
            user_id: 'u1',
            currency_code: 'EUR',
            month: '2024-01-01',
            rate: 0.9, // 1 USD = 0.9 EUR
            created_at: '2024-01-01T00:00:00Z'
        }
    ];

    it('finds correct rate for month', () => {
        const jan15 = new Date('2024-01-15T12:00:00');
        const rate = getExchangeRateForMonth(mockRates, 'ARS', jan15);
        expect(rate).toBeDefined();
        expect(rate?.id).toBe('1');
        expect(rate?.rate).toBe(1000);
    });

    it('finds correct rate for different month', () => {
        const feb20 = new Date('2024-02-20T12:00:00');
        const rate = getExchangeRateForMonth(mockRates, 'ARS', feb20);
        expect(rate).toBeDefined();
        expect(rate?.id).toBe('2');
    });

    it('returns undefined if no rate found', () => {
        const mar1 = new Date('2024-03-01T12:00:00');
        const rate = getExchangeRateForMonth(mockRates, 'ARS', mar1);
        expect(rate).toBeUndefined();
    });

    it('converts to USD correctly', () => {
        // 100000 ARS, Rate 1000 => 100 USD (10000 cents)
        const amount = 100000;
        const rate = 1000;
        const usd = convertToUSD(amount, rate);
        expect(usd).toBe(100);
    });

    it('converts to USD correctly (EUR)', () => {
        // 1000 EUR (cents), Rate 0.9 => 1111 USD (cents)
        const amount = 1000;
        const rate = 0.9;
        const usd = convertToUSD(amount, rate);
        // 1000 / 0.9 = 1111.111... -> 1111
        expect(usd).toBe(1111);
    });
});
