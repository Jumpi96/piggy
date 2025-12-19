import type { Transaction } from '../types';

export interface CategoryData {
  name: string;
  value: number;
  count: number;
  color: string;
  [key: string]: string | number; // Index signature for Recharts compatibility
}

export interface TagData {
  name: string;
  value: number;
  count: number;
  color: string;
  [key: string]: string | number; // Index signature for Recharts compatibility
}

// Color palettes matching the existing design
const incomeCategoryColors: Record<string, string> = {
  'Salary': '#0ea5e9',      // sky-500
  'Reimbursements': '#38bdf8', // sky-400
  'Loans': '#7dd3fc',       // sky-300
  'Grants': '#0284c7',      // sky-600
};

const expenseCategoryColors: Record<string, string> = {
  'Recreation': '#f97316',  // orange-500
  'Living': '#ef4444',      // red-500
  'Debts': '#dc2626',       // red-600
  'Investments': '#f59e0b', // amber-500
};

const tagColors = [
  '#10b981', // emerald-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#6366f1', // indigo-500
  '#06b6d4', // cyan-500
  '#14b8a6', // teal-500
];

/**
 * Convert transaction amount to USD
 */
function convertToUSD(transaction: Transaction): number {
  const rate = transaction.exchange_rate?.rate || 1;
  return transaction.amount_cents / rate;
}

/**
 * Get color for a category based on direction
 */
export function getCategoryColor(category: string, direction: 'income' | 'expense'): string {
  if (direction === 'income') {
    return incomeCategoryColors[category] || '#0ea5e9';
  }
  return expenseCategoryColors[category] || '#ef4444';
}

/**
 * Get color for a tag (cycles through color palette)
 */
export function getTagColor(index: number): string {
  return tagColors[index % tagColors.length];
}

/**
 * Aggregate transactions by category
 */
export function aggregateByCategory(
  transactions: Transaction[],
  direction: 'income' | 'expense'
): CategoryData[] {
  const categoryMap = new Map<string, { value: number; count: number }>();

  transactions
    .filter(t => t.direction === direction)
    .forEach(t => {
      const existing = categoryMap.get(t.category) || { value: 0, count: 0 };
      categoryMap.set(t.category, {
        value: existing.value + convertToUSD(t),
        count: existing.count + 1,
      });
    });

  return Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      name: category,
      value: Math.round(data.value), // Round to whole cents in USD
      count: data.count,
      color: getCategoryColor(category, direction),
    }))
    .sort((a, b) => b.value - a.value); // Sort by value descending
}

/**
 * Aggregate transactions by tag
 */
export function aggregateByTag(
  transactions: Transaction[],
  direction: 'income' | 'expense',
  selectedCategory?: string | null,
  limit?: number
): TagData[] {
  const tagMap = new Map<string, { value: number; count: number }>();

  transactions
    .filter(t => {
      // Filter by direction
      const directionMatch = t.direction === direction;
      // Filter by category if selected
      const categoryMatch = !selectedCategory || t.category === selectedCategory;
      return directionMatch && categoryMatch;
    })
    .forEach(t => {
      const existing = tagMap.get(t.tag) || { value: 0, count: 0 };
      tagMap.set(t.tag, {
        value: existing.value + convertToUSD(t),
        count: existing.count + 1,
      });
    });

  let result = Array.from(tagMap.entries())
    .map(([tag, data], index) => ({
      name: tag,
      value: Math.round(data.value), // Round to whole cents in USD
      count: data.count,
      color: getTagColor(index),
    }))
    .sort((a, b) => b.value - a.value); // Sort by value descending

  // Apply limit if specified
  if (limit && result.length > limit) {
    result = result.slice(0, limit);
  }

  return result;
}
