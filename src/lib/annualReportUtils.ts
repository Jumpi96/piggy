import type { Transaction } from '../types';
import { CATEGORIES } from './constants';

// Categories excluded from expense totals in annual report (treated as income reduction)
const EXCLUDED_FROM_ANNUAL_EXPENSES = ['Taxes'];

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
 * Convert a transaction amount to USD cents in FULL precision (no rounding).
 *
 * Rounding is deferred to each function's output so we accumulate in full precision
 * and round once — matching computeMonthBalance and the AnnualReport summary cards.
 * Rounding per transaction (as before) accumulated up to ~0.5c of error per row, so
 * the monthly table disagreed with the cards and with the Overview totals.
 */
function convertToUSD(transaction: Transaction): number {
  const rate = transaction.exchange_rate?.rate || 1;
  return transaction.amount_cents / rate;
}

/**
 * Get expense category names
 */
function getExpenseCategories(excludeCategories?: string[]): string[] {
  return CATEGORIES
    .filter(c => c.direction === 'expense')
    .filter(c => !excludeCategories?.includes(c.name))
    .map(c => c.name);
}

/**
 * Get income category names
 */
function getIncomeCategories(): string[] {
  return CATEGORIES.filter(c => c.direction === 'income').map(c => c.name);
}

/**
 * Aggregate expenses by month and category (excludes Taxes)
 */
export function aggregateExpensesByMonth(
  transactions: Transaction[],
  year: number
): MonthlyExpenseData[] {
  // Exclude Taxes from expense categories for annual report
  const expenseCategories = getExpenseCategories(EXCLUDED_FROM_ANNUAL_EXPENSES);

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

  // Filter to only expenses and exclude Taxes
  const expenseTransactions = transactions.filter(
    t => t.direction === 'expense' && !EXCLUDED_FROM_ANNUAL_EXPENSES.includes(t.category)
  );

  expenseTransactions.forEach(t => {
    const month = t.date.substring(0, 7); // YYYY-MM
    if (monthMap.has(month)) {
      const categoryAmounts = monthMap.get(month)!;
      categoryAmounts[t.category] = (categoryAmounts[t.category] || 0) + convertToUSD(t);
    }
  });

  // Convert to array (already sorted by month due to initialization order).
  // Round each category once at the boundary and derive the total from the rounded
  // category values so the displayed total always equals the sum of the visible rows.
  const result = Array.from(monthMap.entries())
    .map(([month, categories]) => {
      const roundedCategories: Record<string, number> = {};
      let total = 0;
      for (const [cat, val] of Object.entries(categories)) {
        const rounded = Math.round(val);
        roundedCategories[cat] = rounded;
        total += rounded;
      }
      return { month, categories: roundedCategories, total };
    });

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

  // Calculate total income for percentages (full precision).
  const totalIncome = Array.from(categoryMap.values()).reduce((sum, val) => sum + val, 0);

  // Convert to array with percentages; round the displayed amount once.
  const result = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({
      category,
      amount: Math.round(amount),
      percentage: totalIncome > 0 ? (amount / totalIncome) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount); // Sort by amount descending

  return result;
}

/**
 * Aggregate expenses by category for the whole year (excludes Taxes)
 */
export function aggregateExpensesByCategory(
  transactions: Transaction[]
): IncomeCategoryData[] {
  // Exclude Taxes from expense categories for annual report
  const expenseCategories = getExpenseCategories(EXCLUDED_FROM_ANNUAL_EXPENSES);
  const categoryMap = new Map<string, number>();

  // Initialize all categories with 0
  expenseCategories.forEach(cat => {
    categoryMap.set(cat, 0);
  });

  // Filter to only expenses and exclude Taxes
  const expenseTransactions = transactions.filter(
    t => t.direction === 'expense' && !EXCLUDED_FROM_ANNUAL_EXPENSES.includes(t.category)
  );

  // Sum by category
  expenseTransactions.forEach(t => {
    const current = categoryMap.get(t.category) || 0;
    categoryMap.set(t.category, current + convertToUSD(t));
  });

  // Calculate total expense for percentages (full precision).
  const totalExpense = Array.from(categoryMap.values()).reduce((sum, val) => sum + val, 0);

  // Convert to array with percentages; round the displayed amount once.
  const result = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({
      category,
      amount: Math.round(amount),
      percentage: totalExpense > 0 ? (amount / totalExpense) * 100 : 0,
    }))
    .filter(item => item.amount > 0) // Only include categories with spending
    .sort((a, b) => b.amount - a.amount); // Sort by amount descending

  return result;
}

/**
 * Calculate monthly summary (income, expense, balance per month)
 * Taxes are subtracted from income (shown as net income) and excluded from expenses
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
  const monthMap = new Map<string, { income: number; expense: number; taxes: number }>();
  for (let month = 1; month <= maxMonth; month++) {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    monthMap.set(monthStr, { income: 0, expense: 0, taxes: 0 });
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
        if (EXCLUDED_FROM_ANNUAL_EXPENSES.includes(t.category)) {
          monthData.taxes += amount;
        } else {
          monthData.expense += amount;
        }
      }
    }
  });

  // Convert to array with balance. Income is reduced by taxes, expenses exclude taxes.
  // Round the displayed income and expense once, then derive balance from those rounded
  // values so each row reconciles (balance === displayed income - displayed expense).
  const result = Array.from(monthMap.entries())
    .map(([month, data]) => {
      const income = Math.round(data.income - data.taxes); // Net income after taxes
      const expense = Math.round(data.expense);            // Expenses excluding taxes
      return { month, income, expense, balance: income - expense };
    });

  return result;
}

/**
 * Calculate total taxes for the year
 */
export function calculateTotalTaxes(transactions: Transaction[]): number {
  // Only expense-direction Taxes count. Without the direction guard an income row
  // mis-categorised as "Taxes" (e.g. a refund) would be subtracted from gross income,
  // inconsistent with calculateMonthlySummary which only taxes the expense branch.
  const raw = transactions
    .filter(t => t.direction === 'expense' && t.category === 'Taxes')
    .reduce((sum, t) => sum + convertToUSD(t), 0);
  return Math.round(raw);
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
