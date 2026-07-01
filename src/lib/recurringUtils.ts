import type { RecurringRule, Transaction } from '../types';
import { formatLocalDate, parseLocalDate, addMonthsClamped } from './dates';
import { pickRateForDate } from './currency';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Generates virtual occurrences for a recurring rule within a date range.
 *
 * Each occurrence's date is a pure function of the rule's start date and the
 * occurrence index, so the same logical occurrence always yields the same date
 * regardless of the window queried. This is critical: physical overrides are
 * matched to virtuals by `original_date`, so a window-dependent date would let a
 * virtual escape its override and get counted twice (see recurringUtils tests).
 * Monthly schedules clamp to the last valid day (via `addMonthsClamped`) instead
 * of drifting through `Date.setMonth` day-rollover.
 */
export function generateOccurrences(
    rule: RecurringRule,
    start: string,
    end: string,
    rates: Array<{ currency_code: string; rate: number; created_at: string }> = []
): Transaction[] {
    const occurrences: Transaction[] = [];
    if (!rule.active) return occurrences;

    const scheduleType = rule.schedule_type;
    if (scheduleType !== 'monthly_day' && scheduleType !== 'every_n_months' && scheduleType !== 'every_n_days') {
        return occurrences;
    }

    const startDate = parseLocalDate(rule.start_date);
    const endDate = rule.end_date ? parseLocalDate(rule.end_date) : null;
    const rangeStart = parseLocalDate(start);
    const rangeEnd = parseLocalDate(end);
    const exceptionDates = new Set(rule.exception_dates || []);
    const n = Math.max(1, Number(rule.schedule_config.n || 1));

    // Occurrence date as a pure function of the integer index — window-independent.
    const dateForIndex = (index: number): Date => {
        if (scheduleType === 'monthly_day') return addMonthsClamped(startDate, index);
        if (scheduleType === 'every_n_months') return addMonthsClamped(startDate, index * n);
        const d = new Date(startDate);
        d.setDate(d.getDate() + index * n);
        return d;
    };

    // Jump the index close to rangeStart without changing any resulting date.
    // Deliberately undershoots by one step so we never skip a boundary occurrence.
    let index = 0;
    if (startDate < rangeStart) {
        if (scheduleType === 'every_n_days') {
            const daysDiff = Math.floor((rangeStart.getTime() - startDate.getTime()) / MS_PER_DAY);
            index = Math.max(0, Math.floor(daysDiff / n) - 1);
        } else {
            const stepMonths = scheduleType === 'every_n_months' ? n : 1;
            const monthsDiff = (rangeStart.getFullYear() - startDate.getFullYear()) * 12 + (rangeStart.getMonth() - startDate.getMonth());
            index = Math.max(0, Math.floor(monthsDiff / stepMonths) - 1);
        }
    }

    // A safety limit to prevent infinite loops or excessive memory usage
    let count = 0;
    while (count < 1000) {
        const nextDate = dateForIndex(index);

        // If we past the end range, we can stop (exclusive)
        if (nextDate >= rangeEnd) break;

        // If we have an end date and we past it, we can stop
        if (endDate && nextDate > endDate) break;

        if (nextDate >= rangeStart) {
            const dateStr = formatLocalDate(nextDate);
            if (!exceptionDates.has(dateStr)) {
                // Best-effort: use the rate that was effective for this occurrence's month.
                const ruleRate = pickRateForDate(rates, rule.currency_code, dateStr)?.rate ?? null;
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
        }

        index++;
        count++;
    }

    return occurrences;
}

/**
 * Merges virtual occurrences with physical overrides.
 * Virtual occurrences that have a physical counterpart (matched by recurring_rule_id and original_date) are hidden.
 *
 * @param virtual - Virtual transactions generated from recurring rules
 * @param physical - Physical transactions to display
 * @param overridesForFiltering - Additional overrides used only for filtering virtuals (not included in output).
 *                                 Useful when an override was moved to a different date range.
 */
export function mergeTransactions(
    virtual: Transaction[],
    physical: Transaction[],
    overridesForFiltering: Array<{ recurring_rule_id: string | null; original_date: string | null; date: string }> = []
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

    // Also add overrides that are only for filtering (moved to different date range)
    for (const o of overridesForFiltering) {
        if (o.recurring_rule_id) {
            const originalDate = (o.original_date || o.date).trim();
            overrides.add(`${o.recurring_rule_id.trim()}-${originalDate}`);
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
