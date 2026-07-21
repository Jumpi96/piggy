import { useState, useEffect } from 'react';
import { fetchCreditTransactions, fetchCreditCards, deleteTransaction, skipRecurringOccurrence, updateRecurringRule, deleteFutureTransactionsForRule } from '../lib/api';
import type { Transaction, CreditCard } from '../types';
import { Loader2, Calendar, CreditCard as CardIcon, Plus, CheckCircle2, Circle, Edit2, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { TransactionForm } from '../components/TransactionForm';
import { formatLocalDate, getPersistentMonth, setPersistentMonth, parseLocalDate, getCurrentPeriodAnchor, getMonthStartDay, formatLocalMonth, getPeriodRange, getPeriodLabel, formatPeriodRangeLabel } from '../lib/dates';
import { useSyncData } from '../hooks/useSyncData';

export function CreditReport() {
    // Default to the current financial period (card transactions land here via
    // their payment day). With a custom start day the period already models the
    // cycle; on the default calendar month (start day 1) keep the historical
    // "review next month once past the 15th" behaviour so credit users still land
    // on the upcoming payment period.
    const getInitialMonth = () => {
        const saved = localStorage.getItem('selected_month');
        if (saved) return getPersistentMonth();
        if (getMonthStartDay() > 1) return getCurrentPeriodAnchor();

        const now = new Date();
        const d = new Date(now.getFullYear(), now.getMonth(), 1);
        if (now.getDate() > 15) {
            d.setMonth(d.getMonth() + 1);
        }
        return d;
    };

    const [currentMonth, setCurrentMonth] = useState(getInitialMonth());
    const [selectedCardId, setSelectedCardId] = useState<string>('');
    const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
    const [showChecked, setShowChecked] = useState(false);

    // Subscribe to sync data
    const lastDataUpdate = useSyncData();

    // Modal state
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | undefined>(undefined);
    const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null);

    useEffect(() => {
        async function loadCards() {
            try {
                const cards = await fetchCreditCards(true);
                const sorted = cards.sort((a, b) => {
                    if (a.enabled === b.enabled) return a.name.localeCompare(b.name);
                    return a.enabled ? -1 : 1;
                });
                setCreditCards(sorted);
                if (sorted.length > 0 && !selectedCardId) {
                    setSelectedCardId(sorted[0].id);
                }
            } catch (err) {
                console.error(err);
            }
        }
        loadCards();
    }, []);

    const loadTransactions = async () => {
        if (!selectedCardId) return;
        setIsLoading(true);
        try {
            // fetchCreditTransactions takes a half-open range [start, end); pass the
            // period's exclusive end directly so physical and recurring charges on the
            // period's last day are included consistently.
            const { start: startStr, end: endExclusive } = getPeriodRange(formatLocalMonth(currentMonth));

            const txs = await fetchCreditTransactions(selectedCardId, startStr, endExclusive);
            setTransactions(txs);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadTransactions();
    }, [selectedCardId, currentMonth, lastDataUpdate]);

    const toggleCheck = (id: string) => {
        const next = new Set(checkedItems);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setCheckedItems(next);
    };

    const handleDelete = async (t: Transaction) => {
        if (t.recurring_rule_id) {
            // Show modal for recurring transactions
            setDeletingTransaction(t);
        } else {
            if (!confirm("Delete this transaction?")) return;
            try {
                await deleteTransaction(t.id);
                loadTransactions();
            } catch (err) {
                alert("Failed to delete");
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
            alert("Failed to delete");
        }
    };

    const formatUSD = (cents: number, code: string) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: code
        }).format(cents / 100);
    };

    // Calculate totals per currency (expenses add, reimbursements subtract)
    const totals: Record<string, number> = {};
    transactions.forEach(t => {
        const amount = t.direction === 'income' ? -t.amount_cents : t.amount_cents;
        totals[t.currency_code] = (totals[t.currency_code] || 0) + amount;
    });

    const changeMonth = (delta: number) => {
        const next = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
        setCurrentMonth(next);
        setPersistentMonth(next);
    };

    const checkedTransactions = transactions.filter(t => checkedItems.has(t.id));
    const uncheckedTransactions = transactions.filter(t => !checkedItems.has(t.id));

    const getGroupTotal = (txs: Transaction[]) => {
        const gTotals: Record<string, number> = {};
        txs.forEach(t => {
            const amount = t.direction === 'income' ? -t.amount_cents : t.amount_cents;
            gTotals[t.currency_code] = (gTotals[t.currency_code] || 0) + amount;
        });
        return Object.entries(gTotals)
            .map(([code, cents]) => formatUSD(cents, code))
            .join(', ');
    };

    const renderTransactionItem = (t: Transaction) => (
        <div
            key={t.id}
            className={cn(
                "group flex items-center gap-4 p-4 rounded-xl border transition-all",
                checkedItems.has(t.id)
                    ? "bg-gray-50 dark:bg-zinc-800/50 border-gray-100 dark:border-zinc-800/50 opacity-60"
                    : "bg-white dark:bg-zinc-900 border-gray-100 dark:border-zinc-800 hover:border-emerald-200 dark:hover:border-emerald-900"
            )}
        >
            <button onClick={() => toggleCheck(t.id)} className="shrink-0">
                {checkedItems.has(t.id)
                    ? <CheckCircle2 className="w-6 h-6 text-sky-500" />
                    : <Circle className="w-6 h-6 text-gray-300 dark:text-zinc-700 group-hover:text-emerald-400 transition-colors" />
                }
            </button>

            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                    <h4 className="font-bold text-sm truncate">{t.tag}</h4>
                    <span className={cn("font-mono text-sm font-bold", t.direction === 'income' ? "text-sky-600" : "text-gray-900 dark:text-white")}>
                        {formatUSD(t.amount_cents, t.currency_code)}
                    </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-800 text-gray-500 uppercase tracking-wider">
                        {t.category}
                    </span>
                    <span className="text-[10px] text-gray-400 font-medium">
                        {t.date}
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={() => { setEditingTransaction(t); setIsFormOpen(true); }}
                    className="p-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-gray-400 hover:text-emerald-600 rounded-lg transition-colors"
                >
                    <Edit2 className="w-4 h-4" />
                </button>
                <button
                    onClick={() => handleDelete(t)}
                    className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-600 rounded-lg transition-colors"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
        </div>
    );

    return (
        <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6 pb-24">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <CardIcon className="w-6 h-6 text-emerald-500" />
                        Credit Report
                    </h1>
                    <p className="text-sm text-gray-500 font-mono">
                        🐷 PERIOD: {formatPeriodRangeLabel(formatLocalMonth(currentMonth))}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 bg-white dark:bg-zinc-800 p-2 rounded-lg shadow-sm border border-gray-100 dark:border-zinc-700">
                        <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-700 rounded transition-colors">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-sm font-bold min-w-[100px] text-center">
                            {getPeriodLabel(formatLocalMonth(currentMonth))}
                        </span>
                        <button onClick={() => changeMonth(1)} className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-700 rounded transition-colors">
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>

                    <select
                        value={selectedCardId}
                        onChange={(e) => setSelectedCardId(e.target.value)}
                        className="bg-white dark:bg-zinc-800 border-gray-100 dark:border-zinc-700 rounded-lg text-sm font-bold shadow-sm"
                    >
                        {creditCards
                            .filter(c => c.enabled || c.id === selectedCardId)
                            .map(c => (
                                <option key={c.id} value={c.id}>{c.name} {!c.enabled && '(Disabled)'}</option>
                            ))
                        }
                    </select>

                    <button
                        onClick={() => { setEditingTransaction(undefined); setIsFormOpen(true); }}
                        className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-500/20"
                    >
                        <Plus className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Totals Section */}
            <div className="bg-zinc-900 text-white p-6 rounded-2xl shadow-xl shadow-zinc-950/20 space-y-4">
                <div className="flex items-center gap-2 text-zinc-400">
                    <Calendar className="w-4 h-4" />
                    <h2 className="text-xs font-bold uppercase tracking-widest">💰 Monthly Totals</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {Object.entries(totals).map(([code, cents]) => (
                        <div key={code} className="flex flex-col">
                            <span className="text-xs text-zinc-500 font-bold">{code}</span>
                            <span className="text-2xl font-black">{formatUSD(cents, code)}</span>
                        </div>
                    ))}
                    {Object.keys(totals).length === 0 && (
                        <div className="text-zinc-500 italic text-sm py-2">No transactions for this card this month.</div>
                    )}
                </div>
            </div>

            {/* Transaction List */}
            <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest px-2">Credit Items Review</h3>
                {isLoading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-emerald-500" /></div>
                ) : (
                    <div className="space-y-6">
                        {/* Checked Items Section (at the top) */}
                        {checkedTransactions.length > 0 && (
                            <div className="space-y-2">
                                <button
                                    onClick={() => setShowChecked(!showChecked)}
                                    className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-zinc-800/50 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-xl transition-colors group border border-transparent hover:border-gray-200 dark:hover:border-zinc-700"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-1.5 bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 rounded-lg">
                                            <CheckCircle2 className="w-4 h-4" />
                                        </div>
                                        <span className="font-bold text-xs text-gray-500 dark:text-zinc-400">
                                            Reviewed ({checkedTransactions.length})
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="font-mono text-[10px] font-bold text-gray-400">
                                            {getGroupTotal(checkedTransactions)}
                                        </span>
                                        <ChevronRight className={cn("w-4 h-4 text-gray-400 transition-transform", showChecked && "rotate-90")} />
                                    </div>
                                </button>

                                {showChecked && (
                                    <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                                        {checkedTransactions.map(renderTransactionItem)}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Unchecked Items Section */}
                        <div className="space-y-2">
                            {uncheckedTransactions.map(renderTransactionItem)}

                            {uncheckedTransactions.length === 0 && checkedTransactions.length > 0 && (
                                <div className="text-center py-12 bg-gray-50/50 dark:bg-zinc-900/30 rounded-2xl border-2 border-dashed border-gray-100 dark:border-zinc-800/50 text-gray-400">
                                    <div className="text-2xl mb-2">🎉</div>
                                    <p className="text-sm font-medium">All items reviewed for this period!</p>
                                </div>
                            )}

                            {transactions.length === 0 && !isLoading && (
                                <div className="text-center py-12 bg-gray-50 dark:bg-zinc-900/50 rounded-2xl border-2 border-dashed border-gray-200 dark:border-zinc-800 text-gray-400">
                                    All clear! No credit transactions found.
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Form Modal */}
            {
                isFormOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
                            <TransactionForm
                                initialData={editingTransaction}
                                defaultCardId={selectedCardId}
                                onSuccess={() => { setIsFormOpen(false); loadTransactions(); }}
                                onCancel={() => setIsFormOpen(false)}
                            />
                        </div>
                    </div>
                )
            }
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
        </div >
    );
}
