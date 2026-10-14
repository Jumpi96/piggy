import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle2, Inbox as InboxIcon, Loader2, Plus, RotateCcw, X, XCircle } from 'lucide-react';
import {
    fetchImportEntries, dismissImportEntry, reopenImportEntry, fetchParameters, fetchCreditCards,
} from '../lib/api';
import {
    IMPORT_KIND_LABELS, IMPORT_SOURCE_LABELS, IMPORT_SETTINGS_KEY, IMPORT_STATUS_KEY,
    DEFAULT_IMPORT_SETTINGS, entryBodyText, matchCardRule, parseImportSettings,
} from '../lib/imports';
import type { CreditCard, ImportEntry, ImportSettings, ImportSource, ImportStatusParam } from '../types';
import { TransactionForm } from '../components/TransactionForm';
import { cn } from '../lib/utils';
import { parseLocalDate } from '../lib/dates';
import { useSyncData } from '../hooks/useSyncData';

type Tab = 'pending' | 'resolved';

function formatAmount(cents: number, currency: string | null): string {
    const value = cents / 100;
    if (!currency) return value.toFixed(2);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

function formatDate(date: string | null): string {
    if (!date) return 'No date';
    return parseLocalDate(date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatWhen(iso: string | undefined): string {
    if (!iso) return 'never';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'never';
    return d.toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function Inbox() {
    const [tab, setTab] = useState<Tab>('pending');
    const [entries, setEntries] = useState<ImportEntry[]>([]);
    const [settings, setSettings] = useState<ImportSettings>(DEFAULT_IMPORT_SETTINGS);
    const [status, setStatus] = useState<ImportStatusParam>({});
    const [cards, setCards] = useState<CreditCard[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [confirming, setConfirming] = useState<ImportEntry | null>(null);
    const [error, setError] = useState<string | null>(null);

    const lastDataUpdate = useSyncData();

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const [data, params, cardData] = await Promise.all([
                fetchImportEntries(tab),
                fetchParameters(),
                fetchCreditCards(true),
            ]);
            setEntries(data);
            setSettings(parseImportSettings(params.find(p => p.key === IMPORT_SETTINGS_KEY)?.value));
            setStatus((params.find(p => p.key === IMPORT_STATUS_KEY)?.value ?? {}) as ImportStatusParam);
            setCards(cardData);
        } catch (err) {
            console.error('[Inbox] Failed to load', err);
            setError('Failed to load the inbox.');
        } finally {
            setIsLoading(false);
        }
    }, [tab]);

    useEffect(() => { load(); }, [load, lastDataUpdate]);

    const runAction = async (action: () => Promise<void>) => {
        setError(null);
        try {
            await action();
            await load();
        } catch (err) {
            console.error('[Inbox] Action failed', err);
            setError(err instanceof Error ? err.message : 'Action failed');
        }
    };

    const cardName = (entry: ImportEntry): string | null => {
        const rule = matchCardRule(entry, settings.card_rules);
        if (!rule) return null;
        return cards.find(c => c.id === rule.credit_card_id)?.name ?? null;
    };

    const sources = (Object.keys(IMPORT_SOURCE_LABELS) as ImportSource[]).filter(s => status[s]);

    return (
        <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
            <header>
                <h1 className="text-2xl font-bold">Inbox</h1>
                <p className="text-gray-500 dark:text-gray-400">Movements imported from your accounts, waiting for you.</p>
            </header>

            {/* Importer status */}
            {sources.length > 0 && (
                <div className="space-y-2">
                    {sources.map(source => {
                        const s = status[source]!;
                        return (
                            <div
                                key={source}
                                className={cn(
                                    'text-xs rounded-lg px-3 py-2 border',
                                    s.last_error
                                        ? 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900/40 text-red-700 dark:text-red-300'
                                        : 'bg-gray-50 dark:bg-zinc-800/60 border-gray-100 dark:border-zinc-800 text-gray-600 dark:text-gray-400'
                                )}
                            >
                                <span className="font-semibold">{IMPORT_SOURCE_LABELS[source]}</span>
                                {' · last import '}{formatWhen(s.last_ok_at)}
                                {s.last_error && <span className="block mt-0.5">Error: {s.last_error}</span>}
                                {s.forwarding_code && (
                                    <span className="block mt-0.5 text-gray-800 dark:text-gray-200">
                                        Gmail forwarding confirmation code: <span className="font-mono font-bold">{s.forwarding_code}</span>
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Tabs */}
            <div className="flex bg-gray-100 dark:bg-zinc-800 p-1 rounded-lg">
                {(['pending', 'resolved'] as Tab[]).map(t => (
                    <button
                        key={t}
                        type="button"
                        onClick={() => setTab(t)}
                        className={cn(
                            'flex-1 py-2 rounded-md text-sm font-medium transition-all',
                            tab === t
                                ? 'bg-white dark:bg-zinc-700 text-emerald-700 dark:text-emerald-400 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                        )}
                    >
                        {t === 'pending' ? 'Pending' : 'Done'}
                    </button>
                ))}
            </div>

            {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

            {isLoading && entries.length === 0 ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-emerald-600" /></div>
            ) : entries.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-gray-400">
                    <InboxIcon className="w-10 h-10 mb-2" />
                    <p className="text-sm">{tab === 'pending' ? 'Nothing to review.' : 'Nothing resolved in the last 60 days.'}</p>
                </div>
            ) : (
                <ul className="space-y-3">
                    {entries.map(entry => {
                        const mappedCard = cardName(entry);
                        const isIncome = (entry.direction ?? (entry.kind === 'mp_interest' ? 'income' : 'expense')) === 'income';
                        return (
                            <li key={entry.id} className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 p-4 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-semibold truncate">{entry.description || IMPORT_KIND_LABELS[entry.kind]}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {formatDate(entry.date)} · {IMPORT_SOURCE_LABELS[entry.source]} · {IMPORT_KIND_LABELS[entry.kind]}
                                        </p>
                                        {entry.account_ref && entry.source !== 'mercadopago' && (
                                            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5 min-w-0">
                                                {mappedCard && (
                                                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-medium">
                                                        {mappedCard}
                                                    </span>
                                                )}
                                                <span className="truncate">{entry.account_ref}</span>
                                            </p>
                                        )}
                                    </div>
                                    {entry.amount_cents == null ? (
                                        <p className="font-bold text-gray-400">—</p>
                                    ) : (
                                        <p className={cn('font-bold whitespace-nowrap', isIncome ? 'text-sky-600' : 'text-red-600')}>
                                            {isIncome ? '+' : '−'}{formatAmount(entry.amount_cents, entry.currency_code)}
                                        </p>
                                    )}
                                </div>

                                {entry.parse_error && (
                                    <details className="text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 rounded-lg p-2">
                                        <summary className="cursor-pointer flex items-center gap-1">
                                            <AlertTriangle className="w-3.5 h-3.5 inline" /> Needs review: {entry.parse_error}
                                        </summary>
                                        <pre className="mt-2 whitespace-pre-wrap break-words font-sans">{entryBodyText(entry) || JSON.stringify(entry.raw, null, 2)}</pre>
                                    </details>
                                )}

                                {entry.installments != null && entry.installments > 1 && (
                                    <p className="text-xs text-amber-700 dark:text-amber-300">{entry.installments} cuotas</p>
                                )}

                                {tab === 'pending' ? (
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setConfirming(entry)}
                                            className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 flex items-center justify-center gap-1"
                                        >
                                            <Plus className="w-4 h-4" /> Add
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => runAction(() => dismissImportEntry(entry.id))}
                                            className="flex-1 py-2 rounded-lg bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 text-sm font-semibold hover:bg-gray-200 dark:hover:bg-zinc-700 flex items-center justify-center gap-1"
                                        >
                                            <XCircle className="w-4 h-4" /> Dismiss
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between">
                                        <span className={cn(
                                            'text-xs font-semibold flex items-center gap-1',
                                            entry.status === 'confirmed' ? 'text-emerald-600' : 'text-gray-500'
                                        )}>
                                            {entry.status === 'confirmed'
                                                ? <><CheckCircle2 className="w-3.5 h-3.5" /> Added</>
                                                : <><XCircle className="w-3.5 h-3.5" /> Dismissed</>}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => runAction(() => reopenImportEntry(entry.id))}
                                            className="text-xs font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1 hover:underline"
                                        >
                                            <RotateCcw className="w-3.5 h-3.5" /> Reopen
                                        </button>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {confirming && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100 dark:border-zinc-800">
                        <div className="p-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                            <div className="min-w-0">
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add from Inbox</h2>
                                <p className="text-xs text-gray-500 truncate">
                                    {IMPORT_SOURCE_LABELS[confirming.source]} · {confirming.description || IMPORT_KIND_LABELS[confirming.kind]}
                                </p>
                            </div>
                            <button onClick={() => setConfirming(null)} className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                                <X className="w-6 h-6 text-gray-500" />
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto max-h-[80vh]">
                            <TransactionForm
                                key={confirming.id}
                                importEntry={confirming}
                                importSettings={settings}
                                onSuccess={() => {
                                    setConfirming(null);
                                    load();
                                }}
                                onCancel={() => setConfirming(null)}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
