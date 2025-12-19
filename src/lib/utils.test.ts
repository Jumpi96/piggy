import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn utility', () => {
    it('merges tailwind classes correctly', () => {
        expect(cn('px-2 py-2', 'p-4')).toBe('p-4');
    });

    it('handles conditional classes', () => {
        expect(cn('px-2', true && 'py-2', false && 'm-4')).toBe('px-2 py-2');
    });

    it('handles arrays and objects', () => {
        expect(cn(['px-2', 'py-2'], { 'm-4': true, 'p-4': false })).toBe('px-2 py-2 m-4');
    });
});
