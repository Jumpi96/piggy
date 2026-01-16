import { useState, useEffect, useMemo } from 'react';
import { fetchTransactions, computeMonthBalance, fetchParameters, fetchLatestRates } from '../lib/api';
import type { Transaction, ExchangeRate } from '../types';
import { Loader2, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Wallet, Calendar, PieChart as PieChartIcon, Filter } from 'lucide-react';
import { cn } from '../lib/utils';
import { CategoryPieChart } from '../components/charts/CategoryPieChart';
import { TagBarChart } from '../components/charts/TagBarChart';
import { aggregateByCategory, aggregateByTag } from '../lib/chartUtils';
import { DailySpendingChart } from '../components/charts/DailySpendingChart';
import { formatLocalDate, getPersistentMonth, setPersistentMonth } from '../lib/dates';

import { useSyncData } from '../hooks/useSyncData';

export function Overview() {
    const [currentMonth, setCurrentMonth] = useState(getPersistentMonth());
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Settings & Rates
    const [apd, setApd] = useState<number>(0);
    const [latestRates, setLatestRates] = useState<ExchangeRate[]>([]);

    // Derived State
    const [totalBalance, setTotalBalance] = useState(0);
    const [totalIncome, setTotalIncome] = useState(0);
    const [totalExpense, setTotalExpense] = useState(0);
    const [taxes, setTaxes] = useState(0);
    const [toBeBalancedTotal, setToBeBalancedTotal] = useState(0);
    const [availableCash, setAvailableCash] = useState(0);

    // Visualization filters
    const [visualizationMode, setVisualizationMode] = useState<'income' | 'expense'>('expense');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [showTopTagsOnly, setShowTopTagsOnly] = useState(true);

    const lastDataUpdate = useSyncData();

    const getMonthStr = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}-01`;
    };

    const changeMonth = (delta: number) => {
        const next = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
        setCurrentMonth(next);
        setPersistentMonth(next);
    };

    useEffect(() => {
        async function load() {
            setIsLoading(true);
            setError(null);
            try {
                // Assuming getMonthStr is a utility function available globally or imported elsewhere
                // If not, this line will cause an error.
                const monthStr = getMonthStr(currentMonth);

                const [txs, balanceData, params, rates] = await Promise.all([
                    fetchTransactions(monthStr),
                    computeMonthBalance(monthStr),
                    fetchParameters(),
                    fetchLatestRates()
                ]);

                setTransactions(txs);
                setTotalIncome(balanceData.income);
                setTotalExpense(balanceData.expense);
                setTotalBalance(balanceData.balance);
                setTaxes(balanceData.taxes);
                setLatestRates(rates as ExchangeRate[]);

                const apdParam = params.find(p => p.key === 'amount_per_day');
                setApd(apdParam ? parseFloat(apdParam.value) : 0);

                // Money to balance: Sum(Expenses) - Sum(Incomes) for marked transactions
                // Negative means unexpected incomes, positive means unexpected expenses.
                const tbb = txs.filter(t => t.to_be_balanced).reduce((acc, t) => {
                    const amount = t.amount_cents / (t.exchange_rate?.rate || 1);
                    return acc + (t.direction === 'expense' ? amount : -amount);
                }, 0);
                setToBeBalancedTotal(tbb);

                // Available cash should be (until today)
                const todayStr = formatLocalDate(new Date());
                const cashUntilToday = txs
                    .filter(t => t.date <= todayStr)
                    .reduce((acc, t) => {
                        const amount = t.amount_cents / (t.exchange_rate?.rate || 1);
                        return acc + (t.direction === 'income' ? amount : -amount);
                    }, 0);
                setAvailableCash(cashUntilToday);

            } catch (err) {
                console.error("Failed to load data", err);
                setError("Failed to load financial data. Please check your connection or settings.");
            } finally {
                setIsLoading(false);
            }
        }
        load();
    }, [currentMonth, lastDataUpdate]);

    const formatMonth = (d: Date) => {
        return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(d);
    };

    const formatUSD = (cents: number, isCents = true) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((isCents ? cents / 100 : cents));
    };

    // Data aggregation for charts (exclude Taxes from spending insights)
    const categoryData = useMemo(() => {
        const excludeCategories = visualizationMode === 'expense' ? ['Taxes'] : undefined;
        return aggregateByCategory(transactions, visualizationMode, excludeCategories);
    }, [transactions, visualizationMode]);

    const tagData = useMemo(() => {
        const excludeCategories = visualizationMode === 'expense' ? ['Taxes'] : undefined;
        return aggregateByTag(
            transactions,
            visualizationMode,
            selectedCategory,
            showTopTagsOnly ? 10 : undefined,
            excludeCategories
        );
    }, [transactions, visualizationMode, selectedCategory, showTopTagsOnly]);

    // Calculations for the new overview
    const today = new Date();
    const currentMonthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const todayMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const isPastMonth = currentMonthStart < todayMonthStart;
    const isCurrentMonth = currentMonthStart.getTime() === todayMonthStart.getTime();
    const isFutureMonth = currentMonthStart > todayMonthStart;

    const dayOfMonth = isCurrentMonth ? today.getDate() : 1;
    const lastDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const remainingDays = lastDayOfMonth - dayOfMonth + 1;

    // For "Expected vs Today", we subtract the expected spend for the remaining days of the month.
    // For a past month, there are no remaining days, so it should equal the total balance.
    // For the current month, we subtract days *after* today.
    const effectiveRemainingDays = isCurrentMonth
        ? Math.max(0, lastDayOfMonth - today.getDate())
        : (isFutureMonth ? lastDayOfMonth : 0);

    const differenceWithExpected = totalBalance - (apd * effectiveRemainingDays * 100);
    const perRemainingDay = isPastMonth ? 0 : totalBalance / remainingDays;

    const projectionDays = [];
    if (!isPastMonth) {
        for (let d = dayOfMonth; d <= lastDayOfMonth; d++) {
            const left = lastDayOfMonth - d + 1;
            projectionDays.push({
                day: d,
                value: totalBalance / left
            });
        }
    }

    return (
        <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        Financial Overview
                    </h1>
                    <p className="text-sm text-gray-500 font-mono">
                        🐷 PERIOD: {currentMonth.getFullYear()}-{String(currentMonth.getMonth() + 1).padStart(2, '0')}
                    </p>
                </div>
                <div className="flex items-center gap-4 bg-white dark:bg-zinc-800 p-2 rounded-lg shadow-sm border border-gray-100 dark:border-zinc-700">
                    <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-700 rounded transition-colors">
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <span className="font-medium min-w-[140px] text-center">
                        {formatMonth(currentMonth)}
                    </span>
                    <button onClick={() => changeMonth(1)} className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-700 rounded transition-colors">
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Quick Stats Header */}
            <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-wrap gap-x-8 gap-y-4 text-xs font-mono">
                <div className="flex items-center gap-2">
                    <span className="opacity-60">💳 Base: $; ApD:</span>
                    <span className="font-bold">{formatUSD(apd, false)}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="opacity-60">🔁 Rates:</span>
                    <span className="font-bold flex gap-3">
                        {latestRates.filter(r => r.currency_code !== 'USD').map(r => (
                            <span key={r.currency_code}>1 USD per {r.rate} {r.currency_code}</span>
                        ))}
                    </span>
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
                    {/* Hero Financial Status */}
                    <div className="bg-emerald-600 dark:bg-emerald-700 p-8 rounded-3xl shadow-xl shadow-emerald-500/20 text-white space-y-8 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="space-y-2 text-center md:text-left">
                            <div className="flex items-center justify-center md:justify-start gap-2 opacity-80">
                                <Wallet className="w-5 h-5" />
                                <h3 className="text-sm font-black uppercase tracking-[0.2em]">Current Situation</h3>
                            </div>
                            <p className="text-5xl md:text-7xl font-black tracking-tighter">
                                {formatUSD(totalBalance)}
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 border-t border-white/20">
                            <div className="space-y-1">
                                <span className="text-[10px] font-black uppercase opacity-70 tracking-widest">Expected vs Today</span>
                                <div className="flex items-baseline gap-2">
                                    <p className="text-2xl font-black">{formatUSD(differenceWithExpected)}</p>
                                    <span className={cn("text-xs", differenceWithExpected >= 0 ? "opacity-60" : "text-red-200")}>
                                        {differenceWithExpected >= 0 ? '↗' : '↘'}
                                    </span>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] font-black uppercase opacity-70 tracking-widest">Budget Per Day Left</span>
                                <p className="text-2xl font-black">{formatUSD(perRemainingDay)}</p>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] font-black uppercase opacity-70 tracking-widest">To be Balanced</span>
                                <div className="flex items-baseline gap-2">
                                    <p className={cn("text-2xl font-black", toBeBalancedTotal > 0 ? "text-red-200" : "text-white")}>{formatUSD(toBeBalancedTotal)}</p>
                                    <span className="text-xs opacity-60">⚖️</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Secondary Stats Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        {/* Available Cash (Demoted) */}
                        <div className="bg-white dark:bg-zinc-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 flex flex-col justify-between hover:border-emerald-200 transition-colors">
                            <div className="flex items-center gap-2 text-zinc-500 mb-2">
                                <TrendingUp className="w-4 h-4" />
                                <h3 className="text-[10px] font-bold uppercase tracking-wider">Available Cash Should Be</h3>
                            </div>
                            <div>
                                <p className="text-xl font-bold text-zinc-900 dark:text-white">
                                    {formatUSD(availableCash)}
                                </p>
                                <p className="text-[10px] text-zinc-400 mt-1">
                                    (Until today)
                                </p>
                            </div>
                        </div>

                        {/* Income */}
                        <div className="bg-white dark:bg-zinc-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 flex flex-col justify-between hover:border-sky-200 transition-colors">
                            <div className="flex items-center gap-2 text-sky-600 mb-2">
                                <TrendingUp className="w-4 h-4" />
                                <h3 className="text-[10px] font-bold uppercase tracking-wider">Monthly Income</h3>
                            </div>
                            <div>
                                <p className="text-xl font-bold text-zinc-900 dark:text-white">
                                    {formatUSD(totalIncome)}
                                </p>
                                {taxes > 0 && (
                                    <p className="text-[10px] text-zinc-400 mt-1">
                                        (Taxes: {formatUSD(taxes)})
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Expense (excluding Taxes) */}
                        <div className="bg-white dark:bg-zinc-800 p-5 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 flex flex-col justify-between hover:border-red-200 transition-colors">
                            <div className="flex items-center gap-2 text-red-600 mb-2">
                                <TrendingDown className="w-4 h-4" />
                                <h3 className="text-[10px] font-bold uppercase tracking-wider">Monthly Expense</h3>
                            </div>
                            <p className="text-xl font-bold text-zinc-900 dark:text-white">
                                {formatUSD(totalExpense - taxes)}
                            </p>
                        </div>
                    </div>

                    {/* Spending Insights Section */}
                    <div className="space-y-4">
                        {/* Header with Filter Controls */}
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                                <PieChartIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
                                <h2 className="text-lg font-bold">Spending Insights</h2>
                                <span className="text-xs text-zinc-400 font-mono">All amounts in USD</span>
                            </div>

                            {/* Filter Controls */}
                            <div className="flex items-center gap-3">
                                {/* Direction Toggle */}
                                <div className="inline-flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-1 gap-1">
                                    <button
                                        className={cn(
                                            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                                            visualizationMode === 'expense'
                                                ? "bg-red-500 text-white shadow-sm"
                                                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                                        )}
                                        onClick={() => setVisualizationMode('expense')}
                                    >
                                        Expenses
                                    </button>
                                    <button
                                        className={cn(
                                            "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                                            visualizationMode === 'income'
                                                ? "bg-sky-500 text-white shadow-sm"
                                                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                                        )}
                                        onClick={() => setVisualizationMode('income')}
                                    >
                                        Income
                                    </button>
                                </div>

                                {/* Top Tags Toggle */}
                                <button
                                    className={cn(
                                        "p-2 rounded-lg transition-colors",
                                        showTopTagsOnly
                                            ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
                                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                                    )}
                                    onClick={() => setShowTopTagsOnly(!showTopTagsOnly)}
                                    title={showTopTagsOnly ? "Show all tags" : "Show top 10 tags"}
                                >
                                    <Filter className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Charts Grid */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Category Chart Card */}
                            <div className="bg-white dark:bg-zinc-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                        By Category
                                    </h3>
                                    {selectedCategory && (
                                        <button
                                            onClick={() => setSelectedCategory(null)}
                                            className="text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-medium transition-colors"
                                        >
                                            Clear filter
                                        </button>
                                    )}
                                </div>
                                <div className="h-[300px]">
                                    <CategoryPieChart
                                        data={categoryData}
                                        onSliceClick={setSelectedCategory}
                                        selectedCategory={selectedCategory}
                                    />
                                </div>
                            </div>

                            {/* Tag Chart Card */}
                            <div className="bg-white dark:bg-zinc-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                        By Tag
                                        {selectedCategory && (
                                            <span className="ml-2 text-xs font-normal text-zinc-400">
                                                (filtered by {selectedCategory})
                                            </span>
                                        )}
                                    </h3>
                                    <span className="text-xs text-zinc-400">
                                        {showTopTagsOnly ? 'Top 10' : 'All tags'}
                                    </span>
                                </div>
                                <div className="h-[300px]">
                                    <TagBarChart
                                        data={tagData}
                                        direction={visualizationMode}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Empty State */}
                        {categoryData.length === 0 && tagData.length === 0 && (
                            <div className="text-center p-8 text-zinc-500 bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-800">
                                No transactions to visualize for this period.
                            </div>
                        )}
                    </div>

                    {projectionDays.length > 0 && (
                        <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-700 flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-zinc-400" />
                                <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Daily Projection</h3>
                            </div>
                            <div className="p-6">
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                                    {projectionDays.map(pd => (
                                        <div key={pd.day} className="flex flex-col p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 hover:border-emerald-200 transition-colors">
                                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">Day {pd.day}</span>
                                            <span className="text-sm font-bold font-mono text-zinc-600 dark:text-zinc-300 mt-1">
                                                {formatUSD(pd.value)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Daily Spending Chart - Cash only, excludes recurring & credit cards */}
                    <div className="bg-white dark:bg-zinc-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <TrendingDown className="w-4 h-4 text-orange-500" />
                                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                                    Daily Cash Spending
                                </h3>
                            </div>
                            <span className="text-xs text-zinc-400 font-mono">
                                excl. recurring, cards, to-balance, savings
                            </span>
                        </div>
                        <div className="h-[280px]">
                            <DailySpendingChart
                                transactions={transactions}
                                apd={apd}
                            />
                        </div>
                    </div>

                    {/* Empty State */}
                    {transactions.length === 0 && (
                        <div className="text-center p-12 text-zinc-500 bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-800">
                            No data for this month.
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
