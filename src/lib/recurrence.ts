import type { ScheduleType } from '../types';
import { parseLocalDate, formatLocalDate, addMonthsClamped } from './dates';

/**
 * Calculates the end date based on a start date, number of occurrences, and frequency.
 *
 * The end date is the date of the last (count-th) occurrence. Monthly schedules use
 * `addMonthsClamped` so the result is anchored to the start day-of-month and does not
 * drift for day 29–31 rules — consistent with `generateOccurrences`.
 */
export function calculateEndDate(startDate: string, count: number, type: ScheduleType, n: number = 1): string {
    const start = parseLocalDate(startDate);
    // The first occurrence is the start date itself, so the last is at index count - 1.
    const steps = Math.max(0, count - 1);

    let result: Date;
    if (type === 'monthly_day') {
        result = addMonthsClamped(start, steps);
    } else if (type === 'every_n_months') {
        result = addMonthsClamped(start, steps * n);
    } else {
        result = new Date(start);
        result.setDate(result.getDate() + steps * n);
    }

    return formatLocalDate(result);
}
