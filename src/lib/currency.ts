
import type { ExchangeRate } from '../types';

/**
 * Finds the exchange rate for a given currency and month.
 * 
 * Rules:
 * - One active rate per currency per month
 * - New transactions use the latest rate for that currency+month
 */
export function getExchangeRateForMonth(
    rates: ExchangeRate[],
    currencyCode: string,
    date: Date
): ExchangeRate | undefined {
    const year = date.getFullYear();
    const month = date.getMonth(); // 0-indexed

    return rates.find(r => {
        if (r.currency_code !== currencyCode) return false;

        // Assume r.month is YYYY-MM-DD string
        const [rYear, rMonth] = r.month.split('-').map(Number); // returns 1-indexed month

        return rYear === year && (rMonth - 1) === month;
    });
}

/**
 * Converts a native amount to USD (cents) using a rate.
 * 
 * Rules:
 * - Store amounts in cents
 * - Convert to USD during computation
 * - Rate is 1 USD = X Currency
 * - Formula: USD = Native / Rate
 */
export function convertToUSD(amountCents: number, rate: number): number {
    if (rate === 0) return 0; // Avoid division by zero
    // Should we round?
    // Spec says: "Display USD rounded to 2 decimals"
    // But for computation (balance), we might want higher precision or standard consistent rounding.
    // Usually financial: round to nearest cent.
    return Math.round(amountCents / rate);
}
