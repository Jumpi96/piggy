import type { Transaction } from '../types';
import { CATEGORIES } from './constants';

export interface MonthlyExpenseData {
  month: string; // YYYY-MM format
  categories: Record<string, number>; // Category name -> amount in cents
  total: number;
}

export interface IncomeCategoryData {
  category: string;
  amount: number; // in cents
  percentage: number;
}

export interface MonthlySummary {
  month: string; // YYYY-MM format
  income: number; // in cents
  expense: number; // in cents
  balance: number; // in cents
}

/**
 * Convert transaction amount to USD cents
 */
function convertToUSD(transaction: Transaction): number {
  const rate = transaction.exchange_rate?.rate || 1;
  return Math.round(transaction.amount_cents / rate);
}

/**
 * Get expense category names
 */
function getExpenseCategories(): string[] {
  return CATEGORIES.filter(c => c.direction === 'expense').map(c => c.name);
}

/**
 * Get income category names
 */
function getIncomeCategories(): string[] {
  return CATEGORIES.filter(c => c.direction === 'income').map(c => c.name);
}

/**
 * Aggregate expenses by month and category
 */
export function aggregateExpensesByMonth(
  transactions: Transaction[],
  year: number
): MonthlyExpenseData[] {
  const expenseCategories = getExpenseCategories();

  // Determine max month to show (up to current month if viewing current year)
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const maxMonth = year === currentYear ? currentMonth : 12;

  // Initialize months up to maxMonth with zero values
  const monthMap = new Map<string, Record<string, number>>();
  for (let month = 1; month <= maxMonth; month++) {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const categoryAmounts: Record<string, number> = {};
    expenseCategories.forEach(cat => {
      categoryAmounts[cat] = 0;
    });
    monthMap.set(monthStr, categoryAmounts);
  }

  // Filter to only expenses and populate actual data
  const expenseTransactions = transactions.filter(t => t.direction === 'expense');

  expenseTransactions.forEach(t => {
    const month = t.date.substring(0, 7); // YYYY-MM
    if (monthMap.has(month)) {
      const categoryAmounts = monthMap.get(month)!;
      categoryAmounts[t.category] = (categoryAmounts[t.category] || 0) + convertToUSD(t);
    }
  });

  // Convert to array (already sorted by month due to initialization order)
  const result = Array.from(monthMap.entries())
    .map(([month, categories]) => ({
      month,
      categories,
      total: Object.values(categories).reduce((sum, val) => sum + val, 0),
    }));

  return result;
}

/**
 * Aggregate income by category for the whole year
 */
export function aggregateIncomeByCategory(
  transactions: Transaction[]
): IncomeCategoryData[] {
  const incomeCategories = getIncomeCategories();
  const categoryMap = new Map<string, number>();

  // Initialize all categories with 0
  incomeCategories.forEach(cat => {
    categoryMap.set(cat, 0);
  });

  // Filter to only income
  const incomeTransactions = transactions.filter(t => t.direction === 'income');

  // Sum by category
  incomeTransactions.forEach(t => {
    const current = categoryMap.get(t.category) || 0;
    categoryMap.set(t.category, current + convertToUSD(t));
  });

  // Calculate total income for percentages
  const totalIncome = Array.from(categoryMap.values()).reduce((sum, val) => sum + val, 0);

  // Convert to array with percentages
  const result = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: totalIncome > 0 ? (amount / totalIncome) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount); // Sort by amount descending

  return result;
}

/**
 * Calculate monthly summary (income, expense, balance per month)
 */
export function calculateMonthlySummary(
  transactions: Transaction[],
  year: number
): MonthlySummary[] {
  // Determine max month to show (up to current month if viewing current year)
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const maxMonth = year === currentYear ? currentMonth : 12;

  // Initialize months up to maxMonth with zero values
  const monthMap = new Map<string, { income: number; expense: number }>();
  for (let month = 1; month <= maxMonth; month++) {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    monthMap.set(monthStr, { income: 0, expense: 0 });
  }

  // Populate with actual transaction data
  transactions.forEach(t => {
    const month = t.date.substring(0, 7); // YYYY-MM
    if (monthMap.has(month)) {
      const monthData = monthMap.get(month)!;
      const amount = convertToUSD(t);

      if (t.direction === 'income') {
        monthData.income += amount;
      } else {
        monthData.expense += amount;
      }
    }
  });

  // Convert to array with balance (already sorted due to initialization order)
  const result = Array.from(monthMap.entries())
    .map(([month, data]) => ({
      month,
      income: data.income,
      expense: data.expense,
      balance: data.income - data.expense,
    }));

  return result;
}

/**
 * Get list of years that have transaction data
 */
export function getAvailableYears(transactions: Transaction[]): number[] {
  const years = new Set<number>();

  transactions.forEach(t => {
    const year = parseInt(t.date.substring(0, 4), 10);
    years.add(year);
  });

  return Array.from(years).sort((a, b) => b - a); // Sort descending (newest first)
}
