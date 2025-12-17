import { useState, useEffect } from 'react';
import { fetchTransactions, updateTransaction, deleteTransaction } from '../lib/api';
import type { Transaction } from '../types';
import { Loader2, ChevronLeft, ChevronRight, AlertCircle, CreditCard, Banknote, Edit2, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { TransactionForm } from '../components/TransactionForm';
// import { format } from 'date-fns'; // Avoiding extra deps if possible, but date formatting is annoying without it. Using Intl.

export function TransactionsList() {
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

    // Helper to get YYYY-MM-01
    const getMonthStr = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}-01`;
    };

    const load = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await fetchTransactions(getMonthStr(currentMonth));
            setTransactions(data);
        } catch (err) {
            console.error("Failed to load transactions", err);
            setError("Failed to load transactions.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [currentMonth]);

    const changeMonth = (delta: number) => {
        const newDate = new Date(currentMonth);
        newDate.setMonth(newDate.getMonth() + delta);
        setCurrentMonth(newDate);
    };

    const toggleBalanced = async (id: string, currentStatus: boolean) => {
        // Optimistic update
        setTransactions(prev => prev.map(t =>
            t.id === id ? { ...t, to_be_balanced: !currentStatus } : t
        ));

        try {
            await updateTransaction(id, { to_be_balanced: !currentStatus });
        } catch (err) {
            console.error("Failed to update transaction", err);
            // Revert
            setTransactions(prev => prev.map(t =>
                t.id === id ? { ...t, to_be_balanced: currentStatus } : t
            ));
            setError("Failed to update status");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this transaction?")) return;
        try {
            await deleteTransaction(id);
            setTransactions(prev => prev.filter(t => t.id !== id));
        } catch (err) {
            console.error("Failed to delete", err);
            setError("Failed to delete transaction.");
        }
    };

    const formatMonth = (d: Date) => {
        return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(d);
    };

    const formatCurrency = (amountCents: number, currency: string) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(amountCents / 100);
    };

    return (
        <>
            <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

                {/* Header / Month Selector */}
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold">Transactions</h1>
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

                {/* Error */}
                {error && (
                    <div className="p-4 bg-red-50 text-red-600 rounded-lg">
                        {error}
                    </div>
                )}

                {/* List */}
                {isLoading ? (
                    <div className="flex justify-center p-12">
                        <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
                    </div>
                ) : transactions.length === 0 ? (
                    <div className="text-center p-12 text-gray-500 bg-white dark:bg-zinc-800 rounded-xl border border-dashed border-gray-200 dark:border-zinc-700">
                        No transactions found for this month.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {transactions.map(t => (
                            <div key={t.id} className="bg-white dark:bg-zinc-900 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-pink-200 dark:hover:border-pink-900 transition-colors group">

                                <div className="flex items-start gap-4">
                                    <div className={cn(
                                        "w-2 h-12 rounded-full hidden md:block",
                                        t.direction === 'income' ? "bg-teal-500" : "bg-pink-500"
                                    )}></div>

                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-bold text-lg text-gray-900 dark:text-gray-100">
                                                {t.category}
                                            </span>
                                            {t.to_be_balanced && (
                                                <button
                                                    onClick={() => toggleBalanced(t.id, t.to_be_balanced)}
                                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-500 text-xs font-medium hover:bg-amber-200 transition-colors"
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
                                        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                                            <span className="flex items-center gap-1">
                                                <span className="font-mono text-xs border border-gray-200 dark:border-zinc-700 px-1 rounded bg-gray-50 dark:bg-zinc-800">
                                                    {t.date}
                                                </span>
                                            </span>
                                            <span className="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-xs">
                                                #{t.tag}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between md:justify-end gap-4 md:gap-6">
                                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                                        {t.payment_method === 'card' ? <CreditCard className="w-4 h-4" /> : <Banknote className="w-4 h-4" />}
                                        <span className="hidden sm:inline capitalize">{t.payment_method}</span>
                                    </div>
                                    <div className={cn(
                                        "text-xl font-bold font-mono tracking-tight min-w-[100px] text-right",
                                        t.direction === 'income' ? "text-teal-600 dark:text-teal-400" : "text-pink-600 dark:text-pink-400"
                                    )}>
                                        {t.direction === 'income' ? '+' : '-'}{formatCurrency(t.amount_cents, t.currency_code)}
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1 pl-4 border-l border-gray-100 dark:border-zinc-800">
                                        <button
                                            onClick={() => setEditingTransaction(t)}
                                            className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                                            title="Edit"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(t.id)}
                                            className="p-2 text-gray-400 hover:text-pink-600 dark:hover:text-pink-400 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                                            title="Delete"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Edit Modal */}
            {editingTransaction && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl relative">
                        <button
                            onClick={() => setEditingTransaction(null)}
                            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 z-10"
                        >
                            <X className="w-6 h-6" />
                        </button>
                        <div className="p-1 md:p-4">
                            <TransactionForm
                                initialData={editingTransaction || undefined}
                                onSuccess={() => {
                                    setEditingTransaction(null);
                                    load();
                                }}
                                onCancel={() => setEditingTransaction(null)}
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
