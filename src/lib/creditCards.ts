import type { CreditCard } from '../types';

export function sortCreditCards(cards: CreditCard[]): CreditCard[] {
    return [...cards].sort((a, b) => {
        const orderDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
        if (orderDiff !== 0) return orderDiff;

        const createdDiff = (a.created_at || '').localeCompare(b.created_at || '');
        if (createdDiff !== 0) return createdDiff;

        return a.name.localeCompare(b.name);
    });
}

export function resequenceCreditCards(cards: CreditCard[]): CreditCard[] {
    return cards.map((card, index) => ({ ...card, sort_order: index }));
}
