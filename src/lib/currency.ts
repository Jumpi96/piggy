export interface RateRow {
    id?: string;
    currency_code: string;
    rate: number;
    created_at: string;
}

/**
 * Picks the exchange rate that was effective for a transaction's month, best-effort.
 *
 * Exchange rates carry no explicit effective date — only `created_at` — but a rate
 * created during month M applies from the 1st of M onward (see the repoint logic in
 * `insertExchangeRate`). So for a transaction dated D we pick the most recently created
 * rate whose creation month is <= D's month ("the rate that was in effect that month").
 *
 * If the transaction predates every recorded rate for its currency (a very old month),
 * we fall back to the latest rate — the same lenient behaviour as a missing rate — since
 * there is no better guess.
 *
 * Returns `{ rate: 1 }` for USD (the base currency) and `null` when no rate exists for a
 * non-USD currency, so callers can treat the amount as unconvertible.
 */
export function pickRateForDate(
    rates: RateRow[],
    currencyCode: string,
    date: string
): { id?: string; rate: number } | null {
    const code = (currencyCode || '').trim().toUpperCase();
    if (!code) return null;
    if (code === 'USD') return { rate: 1 };

    const forCurrency = rates.filter(r => r.currency_code.trim().toUpperCase() === code);
    if (forCurrency.length === 0) return null;

    const txnMonth = date.slice(0, 7); // YYYY-MM
    // Rates created in the transaction's month or earlier; `created_at` is an ISO string
    // so a YYYY-MM prefix compare is enough to bucket by month.
    const applicable = forCurrency.filter(r => r.created_at.slice(0, 7) <= txnMonth);
    const pool = applicable.length > 0 ? applicable : forCurrency;

    const best = pool.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
    return { id: best.id, rate: Number(best.rate) };
}
