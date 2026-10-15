import { useEffect, useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { deleteBalanceEntry, fetchCurrencies, fetchExchangeRate, insertBalanceEntry, settleBalance } from '../lib/api';
import { balanceEntryUsdCents, sumBalanceUsdCents } from '../lib/balance';
import { evaluateAmountExpression } from '../lib/amountExpression';
import { getPeriodLabel, getPeriodRange, getTodayLocalDate, parseLocalDate } from '../lib/dates';
import { cn } from '../lib/utils';
import type { BalanceEntry, Currency } from '../types';
import { AmountInput } from './AmountInput';

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

const formatUSD = (cents: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

const formatMoney = (cents: number, currency: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

function entryLabel(entry: BalanceEntry): { title: string; detail: string | null } {
    if (entry.kind === 'settle') return { title: 'Settled', detail: null };
    if (entry.source) {
        return {
            title: `${entry.source.category} · #${entry.source.tag}`,
            detail: entry.source.deleted ? 'Transaction deleted' : (entry.source.note || entry.note || null),
        };
    }
    return { title: entry.note || 'Adjustment', detail: entry.transaction_id ? 'Linked transaction' : null };
}

/**
 * A period's balance ledger: every amount put into the balance, the total, a manual
 * adjustment and settling. It only tracks — nothing here moves money.
 */
export function BalanceLedger({ monthStart, entries, onChanged, onClose }: {
    monthStart: string; // period anchor, YYYY-MM-01
    entries: BalanceEntry[];
    onChanged: () => void;
    onClose: () => void;
}) {
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [isAdding, setIsAdding] = useState(false);
    const [sign, setSign] = useState<1 | -1>(1);
    const [amount, setAmount] = useState('');
    const [currencyCode, setCurrencyCode] = useState('USD');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchCurrencies().then(setCurrencies).catch(err => console.error(err));
    }, []);

    const total = sumBalanceUsdCents(entries);
    const { start, end } = getPeriodRange(monthStart);
    const today = getTodayLocalDate();
    // A manual entry lands today when today is in this period, else on its first day.
    const entryDate = today >= start && today < end ? today : start;

    const run = async (action: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await action();
            onChanged();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    const addAdjustment = () => run(async () => {
        const value = evaluateAmountExpression(amount);
        if (value === null || value <= 0) throw new Error('Invalid amount');
        await insertBalanceEntry({
            date: entryDate,
            amount_cents: sign * Math.round(value * 100),
            currency_code: currencyCode,
            exchange_rate_id: await fetchExchangeRate(currencyCode, entryDate),
            note: note.trim() || null,
        });
        setAmount('');
        setNote('');
        setIsAdding(false);
    });

    const remove = (entry: BalanceEntry) => {
        if (!confirm('Remove this entry from the balance?')) return;
        run(() => deleteBalanceEntry(entry.id));
    };

    const settle = () => {
        if (!confirm(`Set ${getPeriodLabel(monthStart)}'s balance to 0? This only updates the ledger.`)) return;
        run(() => settleBalance(monthStart));
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100 dark:border-zinc-800 flex flex-col max-h-[90vh]">
                <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Balance · {getPeriodLabel(monthStart)}</h2>
                        <p className="text-xs text-gray-500">Positive: needs money from savings. Negative: can go back to them.</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                        <X className="w-6 h-6 text-gray-500" />
                    </button>
                </div>

                <div className="p-4 flex items-center justify-between gap-4 bg-zinc-50 dark:bg-zinc-800/50">
                    <div>
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total</span>
                        <p className={cn("text-3xl font-black", total > 0 ? "text-red-600" : total < 0 ? "text-sky-600" : "text-gray-900 dark:text-white")}>
                            {formatUSD(total)}
                        </p>
                    </div>
                    <button
                        onClick={settle}
                        disabled={busy || total === 0}
                        className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-40"
                    >
                        Settle to 0
                    </button>
                </div>

                <div className="overflow-y-auto divide-y divide-gray-50 dark:divide-zinc-800">
                    {entries.length === 0 && (
                        <p className="p-6 text-center text-sm text-gray-400 italic">Nothing in this month's balance.</p>
                    )}
                    {entries.map(entry => {
                        const { title, detail } = entryLabel(entry);
                        const usd = balanceEntryUsdCents(entry);
                        return (
                            <div key={entry.id} className="px-4 py-3 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className={cn("text-sm font-semibold truncate", entry.kind === 'settle' ? "text-emerald-600" : "text-gray-900 dark:text-white")}>
                                        {title}
                                    </p>
                                    <p className="text-xs text-gray-400 truncate">
                                        {shortDate.format(parseLocalDate(entry.date))}{detail ? ` · ${detail}` : ''}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <div className="text-right">
                                        <p className={cn("font-mono text-sm font-bold", entry.amount_cents > 0 ? "text-red-600" : "text-sky-600")}>
                                            {entry.amount_cents > 0 ? '+' : '−'}{formatMoney(Math.abs(entry.amount_cents), entry.currency_code)}
                                        </p>
                                        {entry.currency_code !== 'USD' && (
                                            <p className="text-[10px] font-mono text-gray-400">≈ {formatUSD(usd)}</p>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => remove(entry)}
                                        disabled={busy}
                                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                                        title="Remove from the balance"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="p-4 border-t border-gray-100 dark:border-zinc-800 space-y-3">
                    {error && <div className="p-2 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
                    {!isAdding ? (
                        <button
                            onClick={() => setIsAdding(true)}
                            className="w-full py-2 rounded-xl bg-gray-100 dark:bg-zinc-800 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors"
                        >
                            Add adjustment
                        </button>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex bg-gray-100 dark:bg-zinc-800 p-1 rounded-lg">
                                {([1, -1] as const).map(s => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => setSign(s)}
                                        className={cn(
                                            "flex-1 py-1.5 rounded-md text-xs font-semibold transition-all",
                                            sign === s
                                                ? cn("bg-white dark:bg-zinc-700 shadow-sm", s === 1 ? "text-red-600" : "text-sky-600")
                                                : "text-gray-500"
                                        )}
                                    >
                                        {s === 1 ? '+ Needs from savings' : '− Back to savings'}
                                    </button>
                                ))}
                            </div>
                            <div className="relative grid grid-cols-3 gap-2">
                                <div className="col-span-2">
                                    <AmountInput
                                        value={amount}
                                        onChange={setAmount}
                                        className="w-full p-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent font-bold focus:ring-2 focus:ring-emerald-500 outline-none"
                                    />
                                </div>
                                <select
                                    value={currencyCode}
                                    onChange={(e) => setCurrencyCode(e.target.value)}
                                    className="p-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-emerald-500 outline-none"
                                >
                                    {(currencies.length ? currencies : [{ code: 'USD', name: 'USD' }]).map(c => (
                                        <option key={c.code} value={c.code}>{c.code}</option>
                                    ))}
                                </select>
                            </div>
                            <input
                                type="text"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="Note (optional)"
                                className="w-full p-2 rounded-lg border border-gray-200 dark:border-zinc-700 bg-transparent text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setIsAdding(false)}
                                    className="flex-1 py-2 rounded-xl bg-gray-100 dark:bg-zinc-800 text-sm font-semibold text-gray-600 dark:text-gray-300"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={addAdjustment}
                                    disabled={busy}
                                    className="flex-[2] py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center"
                                >
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
