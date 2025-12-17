import type { ScheduleType } from '../types';

/**
 * Calculates the end date based on a start date, number of occurrences, and frequency.
 */
export function calculateEndDate(startDate: string, count: number, type: ScheduleType, n: number = 1): string {
    const date = new Date(startDate);

    // The first occurrence is the start date itself, so we advance count - 1 times
    for (let i = 1; i < count; i++) {
        if (type === 'monthly_day') {
            date.setMonth(date.getMonth() + 1);
        } else if (type === 'every_n_days') {
            date.setDate(date.getDate() + n);
        } else if (type === 'every_n_months') {
            date.setMonth(date.getMonth() + n);
        }
    }

    return date.toISOString().split('T')[0];
}
