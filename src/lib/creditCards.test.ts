import { describe, expect, it } from 'vitest';
import { resequenceCreditCards, sortCreditCards } from './creditCards';
import type { CreditCard } from '../types';

const card = (overrides: Partial<CreditCard>): CreditCard => ({
    id: 'card',
    user_id: 'user',
    name: 'Card',
    closing_day: 10,
    payment_day: 20,
    sort_order: 0,
    enabled: true,
    created_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
});

describe('credit card ordering', () => {
    it('sorts by manual order with stable fallbacks', () => {
        const cards = [
            card({ id: 'b', name: 'Beta', sort_order: 1, created_at: '2026-01-02T00:00:00.000Z' }),
            card({ id: 'a', name: 'Alpha', sort_order: 0, created_at: '2026-01-03T00:00:00.000Z' }),
            card({ id: 'c', name: 'Charlie', sort_order: 1, created_at: '2026-01-01T00:00:00.000Z' }),
        ];

        expect(sortCreditCards(cards).map(c => c.id)).toEqual(['a', 'c', 'b']);
    });

    it('reassigns contiguous order values', () => {
        const cards = [
            card({ id: 'first', sort_order: 9 }),
            card({ id: 'second', sort_order: 4 }),
        ];

        expect(resequenceCreditCards(cards).map(c => [c.id, c.sort_order])).toEqual([
            ['first', 0],
            ['second', 1],
        ]);
    });
});
