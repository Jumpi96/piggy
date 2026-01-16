import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * Normalizes a string for case-and-accent-insensitive comparison.
 * e.g., "Café" -> "cafe"
 */
export function normalizeForComparison(str: string): string {
    return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}
