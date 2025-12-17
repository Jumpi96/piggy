import { useState, useEffect, Fragment } from 'react';
import { fetchTransactions, deleteTransaction, updateTransaction } from '../lib/api';
import type { Transaction } from '../types';
import { Loader2, ChevronLeft, ChevronRight, AlertCircle, Banknote, CreditCard, Edit2, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { TransactionForm } from '../components/TransactionForm';

export function TransactionsList() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

    useEffect(() => {
        loadTransactions();
    }, [currentMonth]);

    async function loadTransactions() {
        setIsLoading(true);
        try {
            const monthStr = currentMonth.toISOString().slice(0, 7) + "-01";
            const data = await fetchTransactions(monthStr);
            setTransactions(data);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }

    const nextMonth = () => {
        const next = new Date(currentMonth);
        next.setMonth(next.getMonth() + 1);
        setCurrentMonth(next);
    };

    const prevMonth = () => {
        const prev = new Date(currentMonth);
        prev.setMonth(prev.getMonth() - 1);
        setCurrentMonth(prev);
    };

    const monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const formatCurrency = (cents: number, currency: string) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency,
        }).format(cents / 100);
    };

    const toggleBalanced = async (id: string, current: boolean) => {
        try {
            await updateTransaction(id, { to_be_balanced: !current });
            loadTransactions();
        } catch (err) {
            console.error(err);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this transaction?')) return;
        try {
            await deleteTransaction(id);
            loadTransactions();
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <Fragment>
            <div className="max-w-4xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Transactions</h1>
                        <p className="text-gray-500 dark:text-gray-400">Review your income and expenses</p>
                    </div>

                    <div className="flex items-center bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-gray-100 dark:border-zinc-800 p-1">
                        <button onClick={prevMonth} className="p-2 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-md transition-colors">
                            <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                        </button>
                        <span className="px-4 font-medium min-w-[140px] text-center text-gray-900 dark:text-white">
                            {monthLabel}
                        </span>
                        <button onClick={nextMonth} className="p-2 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-md transition-colors">
                            <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                        </button>
                    </div>
                </div>

                {/* List */}
                <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-gray-100 dark:border-zinc-800 overflow-hidden">
                    {isLoading ? (
                        <div className="flex justify-center p-12">
                            <Loader2 className="w-8 h-8 animate-spin text-pink-600" />
                        </div>
                    ) : transactions.length === 0 ? (
                        <div className="p-12 text-center text-gray-500 dark:text-gray-400 italic">
                            No transactions found for this month.
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50 dark:divide-zinc-800">
                            {transactions.map((t) => (
                                <div key={t.id} className="p-4 hover:bg-gray-50/50 dark:hover:bg-zinc-800/30 transition-colors group">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div className="flex items-start gap-4">
                                            <div className={cn(
                                                "p-3 rounded-xl",
                                                t.direction === 'income'
                                                    ? "bg-teal-50 text-teal-600 dark:bg-teal-900/20 dark:text-teal-400"
                                                    : "bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400"
                                            )}>
                                                {t.direction === 'income' ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-semibold text-gray-900 dark:text-white">{t.category}</h3>
                                                    {t.to_be_balanced && (
                                                        <button
                                                            onClick={() => toggleBalanced(t.id, t.to_be_balanced)}
                                                            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded cursor-pointer hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                                                            title="Click to mark as balanced"
                                                        >
                                                            <AlertCircle className="w-3 h-3" />
                                                            To Balance
                                                        </button>
                                                    )}
                                                    {!t.to_be_balanced && (
                                                        <button
                                                            onClick={() => toggleBalanced(t.id, t.to_be_balanced)}
                                                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-amber-500 transition-all ml-1"
                                                            title="Mark as to be balanced"
                                                        >
                                                            <AlertCircle className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                                                    <span className="flex items-center gap-1 font-mono text-xs border border-gray-200 dark:border-zinc-700 px-1 rounded bg-gray-50 dark:bg-zinc-800">
                                                        {t.date}
                                                    </span>
                                                    <span className="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-xs text-gray-600 dark:text-gray-300">
                                                        #{t.tag}
                                                    </span>
                                                    {t.note && (
                                                        <span className="text-xs italic text-gray-400 dark:text-gray-500 truncate max-w-[200px]" title={t.note}>
                                                            {t.note}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between md:justify-end gap-4 md:gap-6">
                                            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                                                {t.payment_method === 'card' ? <CreditCard className="w-4 h-4" /> : <Banknote className="w-4 h-4" />}
                                                <span className="hidden sm:inline capitalize">{t.payment_method}</span>
                                            </div>
                                            <div className={cn(
                                                "text-lg font-bold font-mono tracking-tight text-right",
                                                t.direction === 'income' ? "text-teal-600 dark:text-teal-400" : "text-pink-600 dark:text-pink-400"
                                            )}>
                                                {t.direction === 'income' ? '+' : '-'}{formatCurrency(t.amount_cents, t.currency_code)}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => setEditingTransaction(t)}
                                                    className="p-2 text-gray-400 hover:text-pink-600 dark:hover:text-pink-400 hover:bg-pink-50 dark:hover:bg-pink-900/20 rounded-lg transition-all"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(t.id)}
                                                    className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Edit Modal */}
            {editingTransaction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100 dark:border-zinc-800">
                        <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Edit Transaction</h2>
                            <button onClick={() => setEditingTransaction(null)} className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                                <X className="w-6 h-6 text-gray-500" />
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto max-h-[80vh]">
                            <TransactionForm
                                initialData={editingTransaction}
                                onSuccess={() => {
                                    setEditingTransaction(null);
                                    loadTransactions();
                                }}
                                onCancel={() => setEditingTransaction(null)}
                            />
                        </div>
                    </div>
                </div>
            )}
        </Fragment>
    );
}

function TrendingUp(props: any) {
    return <Banknote {...props} />;
}
function TrendingDown(props: any) {
    return <Banknote {...props} />;
}
