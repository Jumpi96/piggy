import { useState, useEffect } from 'react';
import { fetchTransactions, computeMonthBalance, fetchParameters, fetchLatestRates } from '../lib/api';
import type { Transaction, Parameter, ExchangeRate } from '../types';
import { Loader2, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Wallet, Calendar } from 'lucide-react';
import { cn } from '../lib/utils';

export function Overview() {
    const [currentMonth, setCurrentMonth] = useState(new Date());
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
    const [toBeBalancedTotal, setToBeBalancedTotal] = useState(0);
    const [availableCash, setAvailableCash] = useState(0);

    const getMonthStr = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}-01`;
    };

    useEffect(() => {
        async function load() {
            setIsLoading(true);
            setError(null);
            try {
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
                const todayStr = new Date().toISOString().split('T')[0];
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
    }, [currentMonth]);

    const changeMonth = (delta: number) => {
        const newDate = new Date(currentMonth);
        newDate.setMonth(newDate.getMonth() + delta);
        setCurrentMonth(newDate);
    };

    const formatMonth = (d: Date) => {
        return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(d);
    };

    const formatUSD = (cents: number, isCents = true) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((isCents ? cents / 100 : cents));
    };

    // Calculations for the new overview
    const today = new Date();
    const isCurrentMonth = currentMonth.getMonth() === today.getMonth() && currentMonth.getFullYear() === today.getFullYear();
    const dayOfMonth = isCurrentMonth ? today.getDate() : 1;

    const lastDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const remainingDays = lastDayOfMonth - dayOfMonth + 1;

    // DayRemainingDiff = total - amountPerDay * (remainingDays - 1)
    const differenceWithExpected = totalBalance - (apd * (remainingDays - 1) * 100);
    const perRemainingDay = totalBalance / remainingDays;

    const projectionDays = [];
    for (let d = dayOfMonth; d <= lastDayOfMonth; d++) {
        const left = lastDayOfMonth - d + 1;
        projectionDays.push({
            day: d,
            value: totalBalance / left
        });
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
                    <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
                </div>
            ) : (
                <>
                    {/* Main Financial Status */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white dark:bg-zinc-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 space-y-4">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 text-zinc-500">
                                    <Wallet className="w-4 h-4" />
                                    <h3 className="text-xs font-bold uppercase tracking-wider">Your Current Situation</h3>
                                </div>
                                <p className={cn("text-3xl font-black", totalBalance >= 0 ? "text-zinc-900 dark:text-white" : "text-pink-600")}>
                                    {formatUSD(totalBalance)}
                                </p>
                            </div>

                            <div className="pt-4 border-t border-zinc-100 dark:border-zinc-700 space-y-3">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-zinc-500">Comparison with expected today:</span>
                                    <span className={cn("font-bold", differenceWithExpected >= 0 ? "text-teal-600" : "text-pink-600")}>
                                        {formatUSD(differenceWithExpected)}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-zinc-500">For each remaining day:</span>
                                    <span className="font-bold text-zinc-900 dark:text-zinc-100 italic">
                                        {formatUSD(perRemainingDay)}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-zinc-500">⚖️ Money to balance:</span>
                                    <span className={cn("font-bold", toBeBalancedTotal >= 0 ? "text-teal-600" : "text-pink-600")}>
                                        {formatUSD(toBeBalancedTotal)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Available Cash Card */}
                        <div className="bg-pink-50/50 dark:bg-pink-900/10 p-6 rounded-2xl border border-pink-100 dark:border-pink-900/30 flex flex-col justify-center items-center text-center space-y-2">
                            <div className="bg-pink-100 dark:bg-pink-900/50 p-2 rounded-full mb-2">
                                <TrendingUp className="w-6 h-6 text-pink-600" />
                            </div>
                            <h3 className="text-sm font-medium text-pink-900 dark:text-pink-300">
                                Your available cash should be:
                            </h3>
                            <p className="text-4xl font-black text-pink-600">
                                {formatUSD(availableCash)}
                            </p>
                            <p className="text-xs text-pink-700/60 dark:text-pink-400/60 max-w-[200px]">
                                (Total income + expenses until today)
                            </p>
                        </div>
                    </div>

                    {/* Projection Table */}
                    <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-700 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-zinc-400" />
                            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Daily Projection</h3>
                        </div>
                        <div className="p-6">
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                                {projectionDays.map(pd => (
                                    <div key={pd.day} className="flex flex-col p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
                                        <span className="text-[10px] font-bold text-zinc-400 uppercase">Day {pd.day}</span>
                                        <span className="text-sm font-bold font-mono text-zinc-600 dark:text-zinc-300 mt-1">
                                            {formatUSD(pd.value)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Original Cards (Hidden or moved to details?) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 opacity-80">
                        {/* Income */}
                        <div className="bg-white dark:bg-zinc-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-700">
                            <div className="flex items-center gap-3 mb-2 text-teal-600 dark:text-teal-400">
                                <TrendingUp className="w-5 h-5" />
                                <h3 className="text-sm font-medium uppercase tracking-wide">Monthly Income</h3>
                            </div>
                            <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                {formatUSD(totalIncome)}
                            </p>
                        </div>

                        {/* Expense */}
                        <div className="bg-white dark:bg-zinc-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-700">
                            <div className="flex items-center gap-3 mb-2 text-pink-600 dark:text-pink-400">
                                <TrendingDown className="w-5 h-5" />
                                <h3 className="text-sm font-medium uppercase tracking-wide">Monthly Expense</h3>
                            </div>
                            <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                {formatUSD(totalExpense)}
                            </p>
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
