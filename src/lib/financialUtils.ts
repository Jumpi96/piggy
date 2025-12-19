import type { Transaction } from '../types';

/**
 * Calculates the total of transactions marked as "to be balanced".
 * Negative means net income, positive means net expense.
 */
export function calculateToBeBalanced(transactions: Transaction[]): number {
    return transactions
        .filter(t => t.to_be_balanced)
        .reduce((acc, t) => {
            const amount = t.amount_cents / (t.exchange_rate?.rate || 1);
            return acc + (t.direction === 'expense' ? amount : -amount);
        }, 0);
}

/**
 * Calculates current actual cash until a specific date (usually today).
 * Based on all transactions until that date.
 */
export function calculateAvailableCash(transactions: Transaction[], untilDateStr: string): number {
    return transactions
        .filter(t => t.date <= untilDateStr)
        .reduce((acc, t) => {
            const amount = t.amount_cents / (t.exchange_rate?.rate || 1);
            return acc + (t.direction === 'income' ? amount : -amount);
        }, 0);
}

/**
 * Calculates the difference between current balance and what we *should* have 
 * based on an "Amount Per Day" expectation for the rest of the month.
 */
export function calculateDifferenceWithExpected(
    totalBalance: number,
    apd: number,
    remainingDays: number,
    daysModifier: number = 0
): number {
    // totalBalance is in cents (usually, or same unit as apd * 100)
    // apd is in USD. So apd * 100 is in cents.
    return totalBalance - (apd * (remainingDays - daysModifier) * 100);
}

/**
 * Calculates how much we can spend per day for the rest of the month
 * given the current balance.
 */
export function calculatePerRemainingDay(totalBalance: number, remainingDays: number): number {
    if (remainingDays <= 0) return totalBalance;
    return totalBalance / remainingDays;
}

/**
 * Generates a list of day-by-day projections for the rest of the month.
 */
export function generateProjectionDays(
    totalBalance: number,
    startDay: number,
    lastDayOfMonth: number
): { day: number; value: number }[] {
    const projections = [];
    for (let d = startDay; d <= lastDayOfMonth; d++) {
        const left = lastDayOfMonth - d + 1;
        projections.push({
            day: d,
            value: totalBalance / left
        });
    }
    return projections;
}

/**
 * Formats a Date object to YYYY-MM-01 string.
 */
export function getMonthStr(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}-01`;
}
