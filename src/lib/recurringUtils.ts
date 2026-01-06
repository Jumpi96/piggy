import type { RecurringRule, Transaction } from '../types';
import { formatLocalDate, parseLocalDate } from './dates';

/**
 * Generates virtual occurrences for a recurring rule within a date range.
 */
export function generateOccurrences(
    rule: RecurringRule,
    start: string,
    end: string,
    rates: Array<{ currency_code: string; rate: number }> = []
): Transaction[] {
    const occurrences: Transaction[] = [];
    if (!rule.active) return occurrences;

    const normalizedCode = rule.currency_code.trim().toUpperCase();
    const ruleRate = rates.find(r => r.currency_code.trim().toUpperCase() === normalizedCode)?.rate
        || (normalizedCode === 'USD' ? 1 : null);

    const startDate = parseLocalDate(rule.start_date);
    const endDate = rule.end_date ? parseLocalDate(rule.end_date) : null;
    const rangeStart = parseLocalDate(start);
    const rangeEnd = parseLocalDate(end);

    let nextDate = new Date(startDate);

    // Skip ahead as much as possible if startDate is far behind rangeStart
    if (nextDate < rangeStart) {
        if (rule.schedule_type === 'monthly_day') {
            const monthsDiff = (rangeStart.getFullYear() - nextDate.getFullYear()) * 12 + (rangeStart.getMonth() - nextDate.getMonth());
            if (monthsDiff > 1) {
                nextDate.setMonth(nextDate.getMonth() + monthsDiff - 1);
            }
        } else if (rule.schedule_type === 'every_n_months') {
            const n = Math.max(1, Number(rule.schedule_config.n || 1));
            const totalMonthsDiff = (rangeStart.getFullYear() - nextDate.getFullYear()) * 12 + (rangeStart.getMonth() - nextDate.getMonth());
            if (totalMonthsDiff > n) {
                const jumps = Math.floor(totalMonthsDiff / n);
                nextDate.setMonth(nextDate.getMonth() + (jumps - 1) * n);
            }
        } else if (rule.schedule_type === 'every_n_days') {
            const n = Math.max(1, Number(rule.schedule_config.n || 1));
            const diffTime = rangeStart.getTime() - nextDate.getTime();
            const daysDiff = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            if (daysDiff > n) {
                const jumps = Math.floor(daysDiff / n);
                nextDate.setDate(nextDate.getDate() + (jumps - 1) * n);
            }
        }
    }

    const exceptionDates = new Set(rule.exception_dates || []);

    // A safety limit to prevent infinite loops or excessive memory usage
    let count = 0;
    while (count < 1000) {
        const dateStr = formatLocalDate(nextDate);

        // If we past the end range, we can stop (exclusive)
        if (nextDate >= rangeEnd) break;

        // If we have an end date and we past it, we can stop
        if (endDate && nextDate > endDate) break;

        if (nextDate >= rangeStart && !exceptionDates.has(dateStr)) {
            occurrences.push({
                id: `virtual-${rule.id}-${dateStr}`,
                user_id: rule.user_id,
                date: dateStr,
                original_date: dateStr,
                direction: rule.direction,
                amount_cents: rule.amount_cents,
                currency_code: rule.currency_code,
                category: rule.category,
                tag: rule.tag,
                payment_method: rule.payment_method,
                credit_card_id: rule.credit_card_id,
                recurring_rule_id: rule.id,
                to_be_balanced: false,
                note: rule.note,
                exchange_rate: ruleRate ? { rate: ruleRate } : null,
                created_at: rule.created_at,
                updated_at: rule.created_at,
            });
        }

        // Advance nextDate based on schedule type
        const n = Math.max(1, Number(rule.schedule_config.n || 1));
        if (rule.schedule_type === 'monthly_day') {
            nextDate.setMonth(nextDate.getMonth() + 1);
        } else if (rule.schedule_type === 'every_n_days') {
            nextDate.setDate(nextDate.getDate() + n);
        } else if (rule.schedule_type === 'every_n_months') {
            nextDate.setMonth(nextDate.getMonth() + n);
        } else {
            break;
        }

        count++;
    }

    return occurrences;
}

/**
 * Merges virtual occurrences with physical overrides.
 * Virtual occurrences that have a physical counterpart (matched by recurring_rule_id and original_date) are hidden.
 */
export function mergeTransactions(
    virtual: Transaction[],
    physical: Transaction[]
): Transaction[] {
    const overrides = new Set<string>();

    // Map physical transactions that are overrides
    for (const p of physical) {
        if (p.recurring_rule_id) {
            // For legacy transactions, original_date might be missing. Fallback to date.
            const originalDate = (p.original_date || p.date).trim();
            overrides.add(`${p.recurring_rule_id.trim()}-${originalDate}`);
        }
    }

    // Filter out virtual transactions that have overrides
    const filteredVirtual = virtual.filter(v => {
        const key = `${v.recurring_rule_id ? v.recurring_rule_id.trim() : ''}-${v.original_date ? v.original_date.trim() : ''}`;
        return !overrides.has(key);
    });

    // Merge and sort DESC
    return [...filteredVirtual, ...physical].sort((a, b) => b.date.localeCompare(a.date));
}
