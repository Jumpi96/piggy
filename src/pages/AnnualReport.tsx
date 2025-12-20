import { useState, useEffect, useMemo } from 'react';
import { fetchTransactionsRange } from '../lib/api';
import type { Transaction } from '../types';
import { Loader2, FileText, TrendingUp, TrendingDown, Wallet, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  aggregateExpensesByMonth,
  aggregateIncomeByCategory,
  aggregateExpensesByCategory,
  calculateMonthlySummary,
} from '../lib/annualReportUtils';
import { MonthlyTrendsLineChart } from '../components/charts/MonthlyTrendsLineChart';
import { MonthlyBalanceBarChart } from '../components/charts/MonthlyBalanceBarChart';
import { CategoryPieChart } from '../components/charts/CategoryPieChart';

export function AnnualReport() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        // Fetch month by month to avoid 1000 row limit
        const allTransactions: Transaction[] = [];
        const today = new Date();
        const currentYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1; // 1-12

        // Determine how many months to fetch (up to current month if viewing current year)
        const maxMonth = selectedYear === currentYear ? currentMonth : 12;

        // Fetch each month separately
        for (let month = 1; month <= maxMonth; month++) {
          const monthStr = String(month).padStart(2, '0');
          const monthStart = `${selectedYear}-${monthStr}-01`;

          // Calculate month end
          const nextMonth = month === 12 ? 1 : month + 1;
          const nextYear = month === 12 ? selectedYear + 1 : selectedYear;
          const monthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

          const monthTxs = await fetchTransactionsRange(monthStart, monthEnd);
          allTransactions.push(...monthTxs);
        }
        setTransactions(allTransactions);
      } catch (err) {
        console.error('Failed to load annual data', err);
        setError('Failed to load annual report data. Please try again.');
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [selectedYear]);

  // Computed data
  const expensesByMonth = useMemo(() => aggregateExpensesByMonth(transactions, selectedYear), [transactions, selectedYear]);
  const expensesByCategory = useMemo(() => aggregateExpensesByCategory(transactions), [transactions]);
  const incomeByCategory = useMemo(() => aggregateIncomeByCategory(transactions), [transactions]);
  const monthlySummary = useMemo(() => calculateMonthlySummary(transactions, selectedYear), [transactions, selectedYear]);

  const totalIncome = useMemo(() => {
    return transactions
      .filter(t => t.direction === 'income')
      .reduce((sum, t) => sum + (t.amount_cents / (t.exchange_rate?.rate || 1)), 0);
  }, [transactions]);

  const totalExpense = useMemo(() => {
    return transactions
      .filter(t => t.direction === 'expense')
      .reduce((sum, t) => sum + (t.amount_cents / (t.exchange_rate?.rate || 1)), 0);
  }, [transactions]);

  const netBalance = totalIncome - totalExpense;

  const formatUSD = (cents: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  };

  const formatMonth = (monthStr: string) => {
    const [, month] = monthStr.split('-');
    const date = new Date(selectedYear, parseInt(month, 10) - 1);
    return date.toLocaleDateString('en-US', { month: 'long' });
  };

  const changeYear = (delta: number) => {
    setSelectedYear(selectedYear + delta);
  };

  // Income data formatted for pie chart
  const incomeChartData = incomeByCategory.map((item, index) => ({
    name: item.category,
    value: item.amount,
    count: transactions.filter(t => t.direction === 'income' && t.category === item.category).length,
    color: ['#0ea5e9', '#38bdf8', '#7dd3fc', '#0284c7'][index % 4], // sky colors
  }));

  const expenseChartData = expensesByCategory.map((item, index) => ({
    name: item.category,
    value: item.amount,
    count: transactions.filter(t => t.direction === 'expense' && t.category === item.category).length,
    color: ['#ef4444', '#f97316', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'][index % 6], // reds/warm colors
  }));

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 text-emerald-600" />
            Annual Report
          </h1>
          <p className="text-sm text-gray-500 font-mono mt-1">
            📊 YEAR: {selectedYear}
          </p>
        </div>

        {/* Year Selector */}
        <div className="flex items-center gap-4 bg-white dark:bg-zinc-800 p-2 rounded-lg shadow-sm border border-gray-100 dark:border-zinc-700">
          <button
            onClick={() => changeYear(-1)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-700 rounded transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-medium min-w-[80px] text-center">
            {selectedYear}
          </span>
          <button
            onClick={() => changeYear(1)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-700 rounded transition-colors"
            disabled={selectedYear >= new Date().getFullYear()}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-xl text-red-800 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Income */}
            <div className="bg-white dark:bg-zinc-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 hover:border-sky-200 transition-colors">
              <div className="flex items-center gap-2 text-sky-600 mb-2">
                <TrendingUp className="w-5 h-5" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Total Income</h3>
              </div>
              <p className="text-3xl font-bold text-zinc-900 dark:text-white">
                {formatUSD(totalIncome)}
              </p>
            </div>

            {/* Total Expenses */}
            <div className="bg-white dark:bg-zinc-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 hover:border-red-200 transition-colors">
              <div className="flex items-center gap-2 text-red-600 mb-2">
                <TrendingDown className="w-5 h-5" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Total Expenses</h3>
              </div>
              <p className="text-3xl font-bold text-zinc-900 dark:text-white">
                {formatUSD(totalExpense)}
              </p>
            </div>

            {/* Net Balance */}
            <div className="bg-white dark:bg-zinc-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 hover:border-emerald-200 transition-colors">
              <div className="flex items-center gap-2 text-emerald-600 mb-2">
                <Wallet className="w-5 h-5" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Net Balance</h3>
              </div>
              <p className={cn(
                "text-3xl font-bold",
                netBalance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
              )}>
                {formatUSD(netBalance)}
              </p>
            </div>
          </div>

          {/* Expenses Section */}
          <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-700">
              <h2 className="text-lg font-bold">Expenses Breakdown</h2>
              <p className="text-xs text-zinc-500 mt-1">Monthly expenses by category</p>
            </div>
            <div className="p-6 space-y-8">
              {/* Expenses Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 dark:bg-zinc-900/50">
                    <tr className="border-b border-zinc-200 dark:border-zinc-700">
                      <th className="text-left p-3 font-semibold text-zinc-700 dark:text-zinc-300">Month</th>
                      <th className="text-right p-3 font-semibold text-zinc-700 dark:text-zinc-300">Debts</th>
                      <th className="text-right p-3 font-semibold text-zinc-700 dark:text-zinc-300">Investments</th>
                      <th className="text-right p-3 font-semibold text-zinc-700 dark:text-zinc-300">Living</th>
                      <th className="text-right p-3 font-semibold text-zinc-700 dark:text-zinc-300">Recreation</th>
                      <th className="text-right p-3 font-semibold text-zinc-700 dark:text-zinc-300">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expensesByMonth.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center p-8 text-zinc-400">
                          No expense data for this year
                        </td>
                      </tr>
                    ) : (
                      expensesByMonth.map((month) => (
                        <tr key={month.month} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                          <td className="p-3 font-medium">{formatMonth(month.month)}</td>
                          <td className="p-3 text-right font-mono">{formatUSD(month.categories.Debts || 0)}</td>
                          <td className="p-3 text-right font-mono">{formatUSD(month.categories.Investments || 0)}</td>
                          <td className="p-3 text-right font-mono">{formatUSD(month.categories.Living || 0)}</td>
                          <td className="p-3 text-right font-mono">{formatUSD(month.categories.Recreation || 0)}</td>
                          <td className="p-3 text-right font-mono font-bold">{formatUSD(month.total)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Trends Chart */}
                {expensesByMonth.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Monthly Trends</h3>
                    <div className="h-[400px]">
                      <MonthlyTrendsLineChart data={expensesByMonth} />
                    </div>
                  </div>
                )}

                {/* Expenses Pie Chart */}
                {expensesByCategory.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Category Distribution</h3>
                    <div className="h-[400px]">
                      <CategoryPieChart data={expenseChartData} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Income Section */}
          <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-700">
              <h2 className="text-lg font-bold">Income Summary</h2>
              <p className="text-xs text-zinc-500 mt-1">Annual income by category</p>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Income Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 dark:bg-zinc-900/50">
                      <tr className="border-b border-zinc-200 dark:border-zinc-700">
                        <th className="text-left p-3 font-semibold text-zinc-700 dark:text-zinc-300">Category</th>
                        <th className="text-right p-3 font-semibold text-zinc-700 dark:text-zinc-300">Amount</th>
                        <th className="text-right p-3 font-semibold text-zinc-700 dark:text-zinc-300">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incomeByCategory.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="text-center p-8 text-zinc-400">
                            No income data for this year
                          </td>
                        </tr>
                      ) : (
                        incomeByCategory.map((cat) => (
                          <tr key={cat.category} className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                            <td className="p-3 font-medium">{cat.category}</td>
                            <td className="p-3 text-right font-mono">{formatUSD(cat.amount)}</td>
                            <td className="p-3 text-right font-mono">{cat.percentage.toFixed(1)}%</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Income Pie Chart */}
                {incomeByCategory.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">Distribution</h3>
                    <div className="h-[300px]">
                      <CategoryPieChart data={incomeChartData} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Monthly Balance Overview */}
          {monthlySummary.length > 0 && (
            <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-700">
                <h2 className="text-lg font-bold">Monthly Balance Overview</h2>
                <p className="text-xs text-zinc-500 mt-1">Income vs expenses comparison by month</p>
              </div>
              <div className="p-6">
                <div className="h-[400px]">
                  <MonthlyBalanceBarChart data={monthlySummary} />
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {transactions.length === 0 && (
            <div className="text-center p-12 text-zinc-500 bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-800">
              No transactions found for {selectedYear}
            </div>
          )}
        </>
      )}
    </div>
  );
}
