import { useState, useEffect, Fragment, useMemo } from 'react';
import { fetchTransactions, deleteTransaction, updateTransaction, skipRecurringOccurrence, updateRecurringRule, deleteFutureTransactionsForRule } from '../lib/api';
import type { Transaction } from '../types';
import { Loader2, ChevronLeft, ChevronRight, AlertCircle, Banknote, CreditCard, Edit2, Trash2, X, Calendar, TrendingUp as UpIcon, TrendingDown as DownIcon, Search, Repeat } from 'lucide-react';
import { cn } from '../lib/utils';
import { TransactionForm } from '../components/TransactionForm';
import { formatLocalDate, parseLocalDate, getPersistentMonth, setPersistentMonth } from '../lib/dates';

import { useSyncData } from '../hooks/useSyncData';

export function TransactionsList() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [currentMonth, setCurrentMonth] = useState(getPersistentMonth());
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null);
    const [showFuture, setShowFuture] = useState(false);

    // Subscribe to sync data updates
    const lastDataUpdate = useSyncData();

    useEffect(() => {
        const today = new Date();
        const isCurrentMonth = currentMonth.getMonth() === today.getMonth() &&
            currentMonth.getFullYear() === today.getFullYear();
        setShowFuture(!isCurrentMonth);
    }, [currentMonth]);

    useEffect(() => {
        loadTransactions();
    }, [currentMonth, lastDataUpdate]); // Reload when month changes OR data syncs

    async function loadTransactions() {
        // ... rest of function
        setIsLoading(true);
        try {
            const year = currentMonth.getFullYear();
            const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
            const monthStr = `${year}-${month}-01`;
            const data = await fetchTransactions(monthStr);
            setTransactions(data);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    }

    const nextMonth = () => {
        const next = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
        setCurrentMonth(next);
        setPersistentMonth(next);
    };

    const prevMonth = () => {
        const prev = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
        setCurrentMonth(prev);
        setPersistentMonth(prev);
    };

    const monthLabel = currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const formatCurrency = (cents: number, currency: string) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency,
        }).format(cents / 100);
    };

    const toggleBalanced = async (t: Transaction) => {
        try {
            if (t.id.startsWith('virtual-')) {
                // Virtual transaction: need to create a physical override
                const { insertTransaction, fetchExchangeRate } = await import('../lib/api');
                const exchangeRateId = await fetchExchangeRate(t.currency_code, t.date);
                await insertTransaction({
                    direction: t.direction,
                    amount_cents: t.amount_cents,
                    currency_code: t.currency_code,
                    date: t.date,
                    category: t.category,
                    tag: t.tag,
                    payment_method: t.payment_method,
                    credit_card_id: t.credit_card_id || null,
                    exchange_rate_id: exchangeRateId,
                    to_be_balanced: !t.to_be_balanced,
                    note: t.note || null,
                    recurring_rule_id: t.recurring_rule_id || null,
                    original_date: t.original_date || t.date,
                });
            } else {
                // Physical transaction: just update it
                await updateTransaction(t.id, { to_be_balanced: !t.to_be_balanced });
            }
            loadTransactions();
        } catch (err) {
            console.error(err);
        }
    };

    const handleDelete = async (t: Transaction) => {
        if (t.recurring_rule_id) {
            setDeletingTransaction(t);
        } else {
            if (!confirm('Are you sure you want to delete this transaction?')) return;
            try {
                await deleteTransaction(t.id);
                loadTransactions();
            } catch (err) {
                console.error(err);
            }
        }
    };

    const confirmDelete = async (allFuture: boolean) => {
        if (!deletingTransaction || !deletingTransaction.recurring_rule_id) return;

        try {
            if (!allFuture) {
                await skipRecurringOccurrence(deletingTransaction);
            } else {
                const ruleId = deletingTransaction.recurring_rule_id!;
                const dateStr = deletingTransaction.original_date || deletingTransaction.date;
                const originalDate = parseLocalDate(dateStr);
                const prevDay = new Date(originalDate);
                prevDay.setDate(prevDay.getDate() - 1);

                // End the rule
                await updateRecurringRule(ruleId, { end_date: formatLocalDate(prevDay) });

                // Cleanup future physical overrides linked to this rule
                await deleteFutureTransactionsForRule(ruleId, dateStr);
            }
            setDeletingTransaction(null);
            loadTransactions();
        } catch (err) {
            console.error(err);
        }
    };

    const [searchTerm, setSearchTerm] = useState('');
    const todayStr = formatLocalDate(new Date());

    const filteredTransactions = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return transactions;

        if (term.startsWith('tag:')) {
            const tag = term.slice(4).trim();
            return transactions.filter(t => t.tag.toLowerCase().trim() === tag);
        }
        if (term.startsWith('category:')) {
            const cat = term.slice(9).trim();
            return transactions.filter(t => t.category.toLowerCase().trim() === cat);
        }
        // Balance shortcuts: "balance" = balanced, "!balance" = not balanced
        if (term === 'balance') {
            return transactions.filter(t => t.to_be_balanced === true);
        }
        if (term === '!balance') {
            return transactions.filter(t => t.to_be_balanced === false);
        }
        // Method filter: method:cash or method:cards
        if (term === 'method:cash') {
            return transactions.filter(t => t.payment_method === 'cash');
        }
        if (term === 'method:cards') {
            return transactions.filter(t => t.payment_method === 'card');
        }

        return transactions.filter(t => {
            const paymentMethodStr = t.payment_method === 'card' ? (t.credit_card?.name || 'card') : 'cash';
            return (
                t.tag.toLowerCase().includes(term) ||
                t.category.toLowerCase().includes(term) ||
                (t.note?.toLowerCase().includes(term) ?? false) ||
                paymentMethodStr.toLowerCase().includes(term)
            );
        });
    }, [transactions, searchTerm]);

    // Group transactions
    const futureTransactions = filteredTransactions.filter((t: Transaction) => t.date > todayStr).sort((a: Transaction, b: Transaction) => b.date.localeCompare(a.date));
    const visibleTransactions = filteredTransactions.filter((t: Transaction) => t.date <= todayStr);

    const groupTransactionsByDate = (txs: Transaction[]) => {
        const groups: Record<string, Transaction[]> = {};
        txs.forEach(t => {
            if (!groups[t.date]) groups[t.date] = [];
            groups[t.date].push(t);
        });
        return groups;
    };

    const getGroupTotal = (txs: Transaction[]) => {
        const totals: Record<string, number> = {};
        txs.forEach(t => {
            const val = (t.direction === 'income' ? t.amount_cents : -t.amount_cents);
            totals[t.currency_code] = (totals[t.currency_code] || 0) + val;
        });
        return Object.entries(totals).map(([cur, amount]) => {
            const prefix = amount >= 0 ? '' : '-';
            return prefix + formatCurrency(Math.abs(amount), cur);
        }).join(', ');
    };

    const formatDateLabel = (dateStr: string) => {
        if (dateStr === todayStr) return 'Today';
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yestStr = formatLocalDate(yesterday);
        if (dateStr === yestStr) return 'Yesterday';

        return new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'long' }).format(new Date(dateStr + 'T12:00:00'));
    };

    return (
        <Fragment>
            <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6 pb-24">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Transactions</h1>
                        <p className="text-gray-500 dark:text-gray-400">Review your income and expenses</p>
                    </div>

                    <div className="flex items-center bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-gray-100 dark:border-zinc-800 p-1 self-start sm:self-auto">
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

                {/* Search and Filters */}
                <div className="space-y-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by tag, category, note or payment method..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm"
                        />
                    </div>
                    <div className="flex items-center gap-2 px-1">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Pro tip:</span>
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">
                            Use <code className="bg-gray-100 dark:bg-zinc-800 px-1 rounded text-emerald-600 dark:text-emerald-400">tag:NAME</code>, <code className="bg-gray-100 dark:bg-zinc-800 px-1 rounded text-emerald-600 dark:text-emerald-400">category:NAME</code>, <code className="bg-gray-100 dark:bg-zinc-800 px-1 rounded text-emerald-600 dark:text-emerald-400">balance</code>/<code className="bg-gray-100 dark:bg-zinc-800 px-1 rounded text-emerald-600 dark:text-emerald-400">!balance</code>, <code className="bg-gray-100 dark:bg-zinc-800 px-1 rounded text-emerald-600 dark:text-emerald-400">method:cash|cards</code>
                        </span>
                    </div>
                </div>

                {/* List Content */}
                {isLoading ? (
                    <div className="flex justify-center p-12">
                        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
                    </div>
                ) : transactions.length === 0 ? (
                    <div className="p-12 text-center text-gray-500 dark:text-gray-400 italic bg-white dark:bg-zinc-900 rounded-xl border border-dashed border-gray-200 dark:border-zinc-800">
                        No transactions found for this month.
                    </div>
                ) : (
                    <div className="space-y-8">
                        {/* Future / Planned Section */}
                        {futureTransactions.length > 0 && (
                            <div className="space-y-2">
                                <button
                                    onClick={() => setShowFuture(!showFuture)}
                                    className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-zinc-800/50 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors group border border-transparent hover:border-gray-200 dark:hover:border-zinc-700"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-lg">
                                            <Calendar className="w-4 h-4" />
                                        </div>
                                        <span className="font-bold text-sm text-gray-700 dark:text-zinc-300">
                                            Planned for {new Date(futureTransactions[futureTransactions.length - 1].date + 'T12:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} - {new Date(futureTransactions[0].date + 'T12:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="font-mono text-sm font-bold text-gray-500">
                                            {getGroupTotal(futureTransactions)}
                                        </span>
                                        <ChevronRight className={cn("w-4 h-4 text-gray-400 transition-transform", showFuture && "rotate-90")} />
                                    </div>
                                </button>

                                {showFuture && (
                                    <div className="space-y-4 pt-2">
                                        {Object.entries(groupTransactionsByDate(futureTransactions))
                                            .sort((a, b) => b[0].localeCompare(a[0]))
                                            .map(([date, txs]) => (
                                                <div key={date} className="space-y-1">
                                                    <div className="flex items-center justify-between px-2">
                                                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{formatDateLabel(date)}</span>
                                                        <span className="text-[10px] font-mono font-bold text-gray-400">{getGroupTotal(txs)}</span>
                                                    </div>
                                                    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 overflow-hidden divide-y divide-gray-50 dark:divide-zinc-800">
                                                        {txs.map(t => (
                                                            <TransactionItem key={t.id} t={t} formatCurrency={formatCurrency} toggleBalanced={toggleBalanced} setEditingTransaction={setEditingTransaction} handleDelete={handleDelete} />
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Current/Past Transactions Grouped by Date */}
                        <div className="space-y-6">
                            {Object.entries(groupTransactionsByDate(visibleTransactions)).sort((a, b) => b[0].localeCompare(a[0])).map(([date, txs]) => (
                                <div key={date} className="space-y-2">
                                    <div className="flex items-center justify-between px-2">
                                        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">{formatDateLabel(date)}</span>
                                        <span className="text-xs font-mono font-bold text-gray-500">{getGroupTotal(txs)}</span>
                                    </div>
                                    <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-md border border-gray-100 dark:border-zinc-800 overflow-hidden divide-y divide-gray-50 dark:divide-zinc-800">
                                        {txs.map(t => (
                                            <TransactionItem key={t.id} t={t} formatCurrency={formatCurrency} toggleBalanced={toggleBalanced} setEditingTransaction={setEditingTransaction} handleDelete={handleDelete} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Delete Modal */}
            {deletingTransaction && deletingTransaction.recurring_rule_id && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-100 dark:border-zinc-800 p-8 space-y-6">
                        <div className="text-center space-y-2">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-zinc-100">Delete Recurring</h3>
                            <p className="text-sm text-gray-500 dark:text-zinc-400">
                                How would you like to handle this deletion?
                            </p>
                        </div>

                        <div className="flex flex-col gap-4">
                            <div className="space-y-1">
                                <button
                                    onClick={() => confirmDelete(false)}
                                    className="w-full bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 py-4 rounded-2xl text-sm font-bold transition-all active:scale-[0.98]"
                                >
                                    Just this one
                                </button>
                                <p className="text-[10px] text-gray-400 dark:text-zinc-500 text-center px-2">
                                    Skips this specific occurrence. The rule will continue to generate future instances.
                                </p>
                            </div>

                            <div className="space-y-1">
                                <button
                                    onClick={() => confirmDelete(true)}
                                    className="w-full bg-red-600 hover:bg-red-700 text-white py-4 rounded-2xl text-sm font-bold transition-all shadow-lg shadow-red-200 dark:shadow-none active:scale-[0.98]"
                                >
                                    This and all future ones
                                </button>
                                <p className="text-[10px] text-gray-400 dark:text-zinc-500 text-center px-2">
                                    Stops the series from today onwards. All future virtual and physical instances will be removed.
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={() => setDeletingTransaction(null)}
                            className="w-full py-2 text-gray-400 dark:text-zinc-600 text-xs font-medium hover:text-gray-600 dark:hover:text-zinc-400 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
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

function TransactionItem({ t, formatCurrency, toggleBalanced, setEditingTransaction, handleDelete }: { t: Transaction, formatCurrency: any, toggleBalanced: any, setEditingTransaction: any, handleDelete: any }) {
    return (
        <div className="p-4 hover:bg-gray-50/50 dark:hover:bg-zinc-800/30 transition-colors group">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                    <div className={cn(
                        "p-3 rounded-xl",
                        t.direction === 'income'
                            ? "bg-sky-50 text-sky-600 dark:bg-sky-900/20 dark:text-sky-400"
                            : "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                    )}>
                        {t.direction === 'income' ? <UpIcon className="w-6 h-6" /> : <DownIcon className="w-6 h-6" />}
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                                {t.category}
                                {t.recurring_rule_id && (
                                    <Repeat className="w-3 h-3 text-gray-400" />
                                )}
                            </h3>
                            {t.to_be_balanced && (
                                <button
                                    onClick={() => toggleBalanced(t)}
                                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded cursor-pointer hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                                    title="Click to mark as balanced"
                                >
                                    <AlertCircle className="w-3 h-3" />
                                    To Balance
                                </button>
                            )}
                            {!t.to_be_balanced && (
                                <button
                                    onClick={() => toggleBalanced(t)}
                                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-amber-500 transition-all ml-1"
                                    title="Mark as to be balanced"
                                >
                                    <AlertCircle className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
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
                        <span className="hidden sm:inline">
                            {t.payment_method === 'card' ? (t.credit_card?.name || 'Card') : 'Cash'}
                        </span>
                    </div>
                    <div className={cn(
                        "text-lg font-bold font-mono tracking-tight text-right",
                        t.direction === 'income' ? "text-sky-600 dark:text-sky-400" : "text-red-600 dark:text-red-400"
                    )}>
                        {t.direction === 'income' ? '+' : '-'}{formatCurrency(t.amount_cents, t.currency_code)}
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setEditingTransaction(t)}
                        className="p-2 text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-all"
                    >
                        <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => handleDelete(t)}
                        className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
