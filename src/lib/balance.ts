import type { BalanceEntry, Direction } from '../types';

/**
 * Signed ledger amount for money balanced from a transaction: an unexpected expense is
 * owed from savings (> 0), an unexpected income goes back to them (< 0).
 */
export function signedBalanceCents(direction: Direction, cents: number): number {
    return direction === 'expense' ? Math.abs(cents) : -Math.abs(cents);
}

/** An entry's amount in USD cents (unrounded), with the same `rate || 1` fallback as transactions. */
export function balanceEntryUsdCents(entry: Pick<BalanceEntry, 'amount_cents' | 'exchange_rate'>): number {
    return Number(entry.amount_cents) / (entry.exchange_rate?.rate || 1);
}

/** A ledger's total in whole USD cents. 0 means the period is settled. */
export function sumBalanceUsdCents(entries: Array<Pick<BalanceEntry, 'amount_cents' | 'exchange_rate'>>): number {
    return Math.round(entries.reduce((acc, e) => acc + balanceEntryUsdCents(e), 0));
}

/** Signed amount (entry currency, cents) per linked transaction id. */
export function balancedByTransaction(entries: Array<Pick<BalanceEntry, 'transaction_id' | 'amount_cents'>>): Map<string, number> {
    const out = new Map<string, number>();
    for (const e of entries) {
        if (!e.transaction_id) continue;
        out.set(e.transaction_id, (out.get(e.transaction_id) ?? 0) + Number(e.amount_cents));
    }
    return out;
}
