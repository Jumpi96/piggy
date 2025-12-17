import type { Direction } from '../types';

export const CATEGORIES: { name: string; direction: Direction }[] = [
    // Income
    { name: 'Salary', direction: 'income' },
    { name: 'Reimbursements', direction: 'income' },
    { name: 'Loans', direction: 'income' },
    { name: 'Grants', direction: 'income' },

    // Expense
    { name: 'Recreation', direction: 'expense' },
    { name: 'Living', direction: 'expense' },
    { name: 'Debts', direction: 'expense' },
    { name: 'Investments', direction: 'expense' },
];

export const PAYMENT_METHODS = [
    { value: 'cash', label: 'Cash' },
    { value: 'card', label: 'Credit Card' },
];
