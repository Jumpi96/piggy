import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { fetchAllImportEntries, fetchCreditCards, fetchParameters, upsertParameter } from '../lib/api';
import {
    CONFIGURABLE_KINDS, DEFAULT_IMPORT_SETTINGS, IMPORT_KIND_LABELS, IMPORT_SETTINGS_KEY, IMPORT_SOURCE_LABELS,
    parseImportSettings, unmappedAccountRefs,
} from '../lib/imports';
import { getTodayLocalDate } from '../lib/dates';
import { sortCreditCards } from '../lib/creditCards';
import type { CardRule, CreditCard, ImportEntry, ImportSettings, ImportSource } from '../types';

const inputClass = 'p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm';

/** Settings for the automatic importers (read by the app and by the importer Lambdas). */
export function ImportsSettings() {
    const [settings, setSettings] = useState<ImportSettings>(DEFAULT_IMPORT_SETTINGS);
    const [cards, setCards] = useState<CreditCard[]>([]);
    const [entries, setEntries] = useState<ImportEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const [params, cardData, entryData] = await Promise.all([
                    fetchParameters(),
                    fetchCreditCards(),
                    fetchAllImportEntries(),
                ]);
                const saved = params.find(p => p.key === IMPORT_SETTINGS_KEY);
                const stored = parseImportSettings(saved?.value);
                // Never saved: start importing from today, so movements already logged by hand
                // don't flood the Inbox. A saved null `since` means "no cutoff" and is kept.
                setSettings(saved ? stored : { ...stored, since: getTodayLocalDate() });
                setCards(sortCreditCards(cardData));
                setEntries(entryData);
            } catch (err) {
                console.error('[Imports] Failed to load settings', err);
                setMessage('Failed to load import settings.');
            } finally {
                setIsLoading(false);
            }
        }
        load();
    }, []);

    const updateRule = (index: number, patch: Partial<CardRule>) => {
        setSettings(s => ({
            ...s,
            card_rules: s.card_rules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
        }));
    };

    const addRule = (text: string = '') => {
        setSettings(s => ({
            ...s,
            card_rules: [...s.card_rules, { text, field: 'account_ref', credit_card_id: cards[0]?.id ?? '' }],
        }));
    };

    const removeRule = (index: number) => {
        setSettings(s => ({ ...s, card_rules: s.card_rules.filter((_, i) => i !== index) }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        setMessage(null);
        try {
            const cleaned: ImportSettings = {
                ...settings,
                card_rules: settings.card_rules
                    .map(r => ({ ...r, text: r.text.trim() }))
                    .filter(r => r.text && r.credit_card_id),
            };
            await upsertParameter(IMPORT_SETTINGS_KEY, cleaned);
            setSettings(cleaned);
            setMessage('Saved.');
        } catch (err) {
            console.error('[Imports] Failed to save settings', err);
            setMessage('Failed to save import settings.');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-emerald-600" /></div>;
    }

    const unmapped = unmappedAccountRefs(entries, settings.card_rules);
    const sources = Object.keys(IMPORT_SOURCE_LABELS) as ImportSource[];

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 space-y-4">
                <div>
                    <h3 className="text-lg font-bold">What to import</h3>
                    <p className="text-xs text-gray-500">Imported movements land in the Inbox until you add or dismiss them.</p>
                </div>
                {sources.map(source => (
                    <div key={source} className="space-y-2">
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{IMPORT_SOURCE_LABELS[source]}</p>
                        {CONFIGURABLE_KINDS.filter(k => k.source === source).map(({ kind }) => (
                            <label key={kind} className="flex items-center gap-3 text-sm cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={settings.kinds[kind] ?? false}
                                    onChange={(e) => setSettings(s => ({ ...s, kinds: { ...s.kinds, [kind]: e.target.checked } }))}
                                    className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                {IMPORT_KIND_LABELS[kind]}
                            </label>
                        ))}
                    </div>
                ))}
                <div className="space-y-1 max-w-xs">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Import movements from</label>
                    <input
                        type="date"
                        value={settings.since ?? ''}
                        onChange={(e) => setSettings(s => ({ ...s, since: e.target.value || null }))}
                        className={`${inputClass} w-full`}
                    />
                    <p className="text-xs text-gray-500">Older movements are skipped.</p>
                </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 space-y-4">
                <div>
                    <h3 className="text-lg font-bold">Card mapping</h3>
                    <p className="text-xs text-gray-500">
                        When an entry contains this text, it is prefilled with the card. Rules are checked top to bottom; the first match wins.
                    </p>
                </div>

                {settings.card_rules.length === 0 && <p className="text-sm text-gray-500">No rules yet.</p>}

                <div className="space-y-2">
                    {settings.card_rules.map((rule, index) => (
                        <div key={index} className="flex flex-wrap items-center gap-2">
                            <input
                                type="text"
                                value={rule.text}
                                onChange={(e) => updateRule(index, { text: e.target.value })}
                                placeholder="e.g. terminada en 1234"
                                className={`${inputClass} flex-1 min-w-40`}
                            />
                            <select
                                value={rule.field}
                                onChange={(e) => updateRule(index, { field: e.target.value as CardRule['field'] })}
                                className={inputClass}
                            >
                                <option value="account_ref">in card reference</option>
                                <option value="body">anywhere in the email</option>
                            </select>
                            <select
                                value={rule.credit_card_id}
                                onChange={(e) => updateRule(index, { credit_card_id: e.target.value })}
                                className={inputClass}
                            >
                                <option value="" disabled>Select card</option>
                                {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <button
                                type="button"
                                onClick={() => removeRule(index)}
                                className="p-2 text-gray-400 hover:text-red-600"
                                aria-label="Remove rule"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={() => addRule()}
                    className="text-sm font-medium text-emerald-600 flex items-center gap-1 hover:underline"
                >
                    <Plus className="w-4 h-4" /> Add rule
                </button>

                {unmapped.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-xs text-gray-500">Card references seen in imports with no rule yet (tap to add one):</p>
                        <div className="flex flex-wrap gap-2">
                            {unmapped.map(ref => (
                                <button
                                    key={ref}
                                    type="button"
                                    onClick={() => addRule(ref)}
                                    className="px-2 py-1 rounded-md bg-gray-100 dark:bg-zinc-800 text-xs font-mono hover:bg-gray-200 dark:hover:bg-zinc-700"
                                >
                                    {ref}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                    Save Import Settings
                </button>
                {message && <span className="text-sm text-gray-500">{message}</span>}
            </div>
        </div>
    );
}
