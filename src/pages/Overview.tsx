import { useState, useEffect } from 'react';
import { fetchTransactions, computeMonthBalance } from '../lib/api';
import type { Transaction } from '../types';
import { Loader2, ChevronLeft, ChevronRight, AlertTriangle, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { cn } from '../lib/utils';

export function Overview() {
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Derived State
    const [totalBalance, setTotalBalance] = useState(0);
    const [totalIncome, setTotalIncome] = useState(0);
    const [totalExpense, setTotalExpense] = useState(0);
    const [toBeBalancedCount, setToBeBalancedCount] = useState(0);

    const getMonthStr = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}-01`;
    };

    useEffect(() => {
        async function load() {
            setIsLoading(true);
            try {
                const [txs, balanceData] = await Promise.all([
                    fetchTransactions(getMonthStr(currentMonth)),
                    computeMonthBalance(getMonthStr(currentMonth))
                ]);

                setTransactions(txs);
                setTotalIncome(balanceData.income);
                setTotalExpense(balanceData.expense);
                setTotalBalance(balanceData.balance);

                // Calculate TBB count locally
                const tbb = txs.filter(t => t.to_be_balanced).length;
                setToBeBalancedCount(tbb);

            } catch (err) {
                console.error("Failed to load data", err);
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

    const formatUSD = (cents: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
    };

    return (
        <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

            {/* Header */}
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Overview</h1>
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

            {/* Loading */}
            {isLoading ? (
                <div className="flex justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
                </div>
            ) : (
                <>
                    {/* To Be Balanced Alert */}
                    {toBeBalancedCount > 0 && (
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 rounded-xl flex items-center gap-3 text-amber-800 dark:text-amber-400">
                            <AlertTriangle className="w-5 h-5" />
                            <span className="font-medium">
                                You have {toBeBalancedCount} transaction{toBeBalancedCount !== 1 ? 's' : ''} marked as "To be Balanced".
                            </span>
                        </div>
                    )}

                    {/* Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Balance */}
                        <div className="bg-white dark:bg-zinc-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-700 md:col-span-3 lg:col-span-1">
                            <div className="flex items-center gap-3 mb-2 text-gray-500 dark:text-gray-400">
                                <Wallet className="w-5 h-5" />
                                <h3 className="text-sm font-medium uppercase tracking-wide">Net Balance</h3>
                            </div>
                            <p className={cn("text-4xl font-bold", totalBalance >= 0 ? "text-gray-900 dark:text-white" : "text-pink-600")}>
                                {formatUSD(totalBalance)}
                            </p>
                        </div>

                        {/* Income */}
                        <div className="bg-white dark:bg-zinc-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-700">
                            <div className="flex items-center gap-3 mb-2 text-teal-600 dark:text-teal-400">
                                <TrendingUp className="w-5 h-5" />
                                <h3 className="text-sm font-medium uppercase tracking-wide">Income</h3>
                            </div>
                            <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                {formatUSD(totalIncome)}
                            </p>
                        </div>

                        {/* Expense */}
                        <div className="bg-white dark:bg-zinc-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-700">
                            <div className="flex items-center gap-3 mb-2 text-pink-600 dark:text-pink-400">
                                <TrendingDown className="w-5 h-5" />
                                <h3 className="text-sm font-medium uppercase tracking-wide">Expense</h3>
                            </div>
                            <p className="text-2xl font-bold text-gray-900 dark:text-white">
                                {formatUSD(totalExpense)}
                            </p>
                        </div>
                    </div>

                    {/* Empty State */}
                    {transactions.length === 0 && (
                        <div className="text-center p-12 text-gray-500">
                            No data for this month.
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
