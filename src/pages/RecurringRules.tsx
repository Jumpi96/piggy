import { useState, useEffect, useRef } from 'react';
import { fetchRecurringRules, insertRecurringRule, updateRecurringRule, deleteRecurringRule, fetchCurrencies, fetchDistinctTags, fetchCreditCards } from '../lib/api';
import { calculateEndDate } from '../lib/recurrence';
import { getTodayLocalDate, formatLocalDate } from '../lib/dates';
import { cn, normalizeForComparison } from '../lib/utils';
import { CATEGORIES, PAYMENT_METHODS } from '../lib/constants';
import type { RecurringRule, Currency, ScheduleType, CreditCard } from '../types';
import { Plus, Trash2, Edit2, Loader2, Info, Calendar, HelpCircle } from 'lucide-react';

const SCHEDULE_TYPES = [
    { value: 'monthly_day', label: 'Monthly on Date' },
    { value: 'every_n_days', label: 'Every N Days' },
    { value: 'every_n_months', label: 'Every N Months' }
];

import { useSyncData } from '../hooks/useSyncData';

export function RecurringRulesPage() {
    const [rules, setRules] = useState<RecurringRule[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showForm, setShowForm] = useState(false);

    // Subscribe to sync data
    const lastDataUpdate = useSyncData();

    // Form State
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<RecurringRule>>({
        direction: 'expense',
        currency_code: 'USD',
        payment_method: 'cash',
        schedule_type: 'monthly_day',
        schedule_config: { n: 1 },
        active: true,
        note: '',
        start_date: getTodayLocalDate(),
        end_date: null
    });

    // Autocomplete State
    const [allTags, setAllTags] = useState<string[]>([]);
    const [showTagSuggestions, setShowTagSuggestions] = useState(false);
    const tagInputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);

    const [occurrencesHelper, setOccurrencesHelper] = useState<string>('');

    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [creditCards, setCreditCards] = useState<CreditCard[]>([]);

    const load = async () => {
        setIsLoading(true);
        try {
            const [r, c, t, cards] = await Promise.all([
                fetchRecurringRules(),
                fetchCurrencies(),
                fetchDistinctTags(),
                fetchCreditCards(true)
            ]);
            setRules(r);
            const sortedCurrencies = c.sort((a, b) => a.code.localeCompare(b.code));
            setCurrencies(sortedCurrencies);
            setCreditCards(cards);
            if (sortedCurrencies.length > 0 && !formData.id) {
                setFormData(prev => ({ ...prev, currency_code: sortedCurrencies[0].code }));
            }
            setAllTags(t);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    // Close suggestions on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node) &&
                tagInputRef.current && !tagInputRef.current.contains(event.target as Node)) {
                setShowTagSuggestions(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => { load(); }, [lastDataUpdate]);


    const handleCalculateEndDate = () => {
        const count = parseInt(occurrencesHelper);
        if (isNaN(count) || count <= 0) return;

        const startStr = formData.start_date || getTodayLocalDate();
        const type = formData.schedule_type as ScheduleType;
        const n = formData.schedule_config?.n || 1;

        const endStr = calculateEndDate(startStr, count, type, n);

        setFormData({ ...formData, end_date: endStr });
        setOccurrencesHelper('');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            // Normalize tag casing and accents
            const currentTag = formData.tag || '';
            const normTag = normalizeForComparison(currentTag);
            const existingTag = allTags.find(t => normalizeForComparison(t) === normTag);
            const finalTag = existingTag || currentTag.trim();

            const payload = { ...formData, tag: finalTag };
            if (editingId) {
                await updateRecurringRule(editingId, payload);
            } else {
                await insertRecurringRule(payload);
            }
            setShowForm(false);
            resetForm();
            load();

            // Changes are immediately reflected via virtualization
        } catch (err) {
            console.error(err);
            alert("Failed to save rule");
        }
    };

    const resetForm = () => {
        setEditingId(null);
        setFormData({
            direction: 'expense',
            currency_code: 'USD',
            payment_method: 'cash',
            schedule_type: 'monthly_day',
            schedule_config: { n: 1 },
            active: true,
            note: '',
            start_date: getTodayLocalDate(),
            end_date: null
        });
        setOccurrencesHelper('');
    };

    const handleEdit = (rule: RecurringRule) => {
        setEditingId(rule.id);
        setFormData(rule);
        setShowForm(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Deleting this rule will remove all future transactions. Past transactions will remain unchanged.\n\nContinue?")) return;
        try {
            await deleteRecurringRule(id);

            // Changes are immediately reflected via virtualization

            load();
        } catch (err) {
            console.error(err);
            alert("Failed to delete");
        }
    };


    const [showPast, setShowPast] = useState(false);

    // Filter & Sort
    const today = getTodayLocalDate();

    // Helper to check if rule is "past" (inactive or ended)
    const isPast = (rule: RecurringRule) => {
        if (!rule.active) return true;
        if (rule.end_date && rule.end_date < today) return true;
        return false;
    };

    const activeRules = rules
        .filter(r => !isPast(r))
        .sort((a, b) => a.start_date.localeCompare(b.start_date));

    const pastRules = rules
        .filter(r => isPast(r))
        .sort((a, b) => a.start_date.localeCompare(b.start_date));


    return (
        <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Recurring Rules</h1>
                        <div className="group relative">
                            <button className="p-1 text-zinc-400 hover:text-emerald-500 transition-colors">
                                <HelpCircle className="w-4 h-4" />
                            </button>
                            <div className="absolute left-0 top-full mt-2 w-72 p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                                <h3 className="text-sm font-bold text-zinc-900 dark:text-white mb-2">How it works</h3>
                                <ul className="space-y-3">
                                    <li className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                                        <strong className="text-zinc-900 dark:text-zinc-200 block mb-0.5">Deleting a rule</strong>
                                        Future occurrences disappear. Past manual edits (overrides) are safely kept in history.
                                    </li>
                                    <li className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                                        <strong className="text-zinc-900 dark:text-zinc-200 block mb-0.5">Modifying a rule</strong>
                                        Changes apply to all future dates. Existing fixed transactions remain as they are.
                                    </li>
                                    <li className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                                        <strong className="text-zinc-900 dark:text-zinc-200 block mb-0.5">Ending a rule</strong>
                                        Transactions stop appearing naturally after your chosen end date.
                                    </li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <p className="text-sm text-zinc-500 font-medium">Automate your financial tracking</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => { resetForm(); setShowForm(true); }}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors"
                    >
                        <Plus className="w-4 h-4" /> New Rule
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                </div>
            ) : (
                <div className="space-y-8">
                    {/* Active Rules */}
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {activeRules.map(rule => (
                            <RuleCard
                                key={rule.id}
                                rule={rule}
                                onEdit={() => handleEdit(rule)}
                                onDelete={() => handleDelete(rule.id)}
                                creditCards={creditCards}
                            />
                        ))}
                        {activeRules.length === 0 && (
                            <div className="md:col-span-3 text-center p-12 text-gray-500 border-2 border-dashed border-gray-100 dark:border-zinc-800 rounded-xl">
                                <Plus className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                                <p>No active recurring rules.</p>
                                <button onClick={() => setShowForm(true)} className="mt-4 text-emerald-600 font-medium hover:underline text-sm">Create your first rule</button>
                            </div>
                        )}
                    </div>

                    {/* Past Rules Toggle */}
                    {pastRules.length > 0 && (
                        <div className="space-y-4 pt-4 border-t border-dashed border-gray-200 dark:border-zinc-800">
                            <button
                                onClick={() => setShowPast(!showPast)}
                                className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                            >
                                <div className={cn("p-1 rounded transition-transform duration-200", showPast && "rotate-90")}>
                                    <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[8px] border-b-current rotate-90" />
                                </div>
                                {showPast ? 'Hide' : 'Show'} {pastRules.length} Past Rules
                            </button>

                            {showPast && (
                                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 opacity-60 grayscale-[0.5] hover:grayscale-0 transition-all duration-300">
                                    {pastRules.map(rule => (
                                        <RuleCard
                                            key={rule.id}
                                            rule={rule}
                                            onEdit={() => handleEdit(rule)}
                                            onDelete={() => handleDelete(rule.id)}
                                            creditCards={creditCards}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {showForm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-zinc-900 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-gray-100 dark:border-zinc-800 animate-in fade-in zoom-in duration-200">
                        <div className="p-6 border-b border-gray-50 dark:border-zinc-800 flex items-center justify-between">
                            <h2 className="text-xl font-bold">{editingId ? 'Edit Rule' : 'New Recurring Rule'}</h2>
                            <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                                <Plus className="w-6 h-6 text-gray-400 rotate-45" />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 pb-24 md:pb-6 space-y-5 max-h-[80vh] overflow-y-auto">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Type</label>
                                    <select
                                        value={formData.direction}
                                        onChange={e => setFormData({ ...formData, direction: e.target.value as any })}
                                        className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                    >
                                        <option value="expense">Expense</option>
                                        <option value="income">Income</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Category</label>
                                    <select
                                        value={formData.category}
                                        onChange={e => setFormData({ ...formData, category: e.target.value })}
                                        className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                        required
                                    >
                                        <option value="">Select category...</option>
                                        {CATEGORIES.filter(c => c.direction === formData.direction).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="space-y-2 relative">
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Tag (Title)</label>
                                <input
                                    ref={tagInputRef}
                                    type="text"
                                    value={formData.tag || ''}
                                    onFocus={() => setShowTagSuggestions(true)}
                                    onChange={e => {
                                        setFormData({ ...formData, tag: e.target.value });
                                        setShowTagSuggestions(true);
                                    }}
                                    placeholder="e.g. Rent, Salary..."
                                    className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                    required
                                    autoComplete="off"
                                />

                                {showTagSuggestions && allTags.filter(t => normalizeForComparison(t).includes(normalizeForComparison(formData.tag || ''))).length > 0 && (
                                    <div
                                        ref={suggestionsRef}
                                        className="absolute z-10 w-full mt-1 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg max-h-48 overflow-y-auto"
                                    >
                                        {allTags
                                            .filter(t => normalizeForComparison(t).includes(normalizeForComparison(formData.tag || '')))
                                            .map((suggestion) => (
                                                <button
                                                    key={suggestion}
                                                    type="button"
                                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors"
                                                    onClick={() => {
                                                        setFormData({ ...formData, tag: suggestion });
                                                        setShowTagSuggestions(false);
                                                    }}
                                                >
                                                    {suggestion}
                                                </button>
                                            ))}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Note (Optional)</label>
                                <textarea
                                    value={formData.note || ''}
                                    onChange={e => setFormData({ ...formData, note: e.target.value })}
                                    placeholder="Add extra details..."
                                    rows={2}
                                    className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-emerald-500 outline-none transition-all resize-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Payment Method</label>
                                    <select
                                        value={formData.payment_method}
                                        onChange={e => setFormData({ ...formData, payment_method: e.target.value as any })}
                                        className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                    >
                                        {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                    </select>
                                </div>
                                {formData.payment_method === 'card' && (
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Card</label>
                                        <select
                                            value={formData.credit_card_id || ''}
                                            onChange={e => {
                                                const selectedCard = creditCards.find(c => c.id === e.target.value);
                                                if (selectedCard && !editingId) {
                                                    // Calculate next payment day
                                                    const today = new Date();
                                                    const tDay = today.getDate();
                                                    let targetMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

                                                    if (tDay >= selectedCard.closing_day) {
                                                        targetMonth.setMonth(targetMonth.getMonth() + 1);
                                                    }

                                                    const nextPayment = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), selectedCard.payment_day);
                                                    const nextPaymentStr = formatLocalDate(nextPayment);

                                                    setFormData({ ...formData, credit_card_id: e.target.value, start_date: nextPaymentStr });
                                                } else {
                                                    setFormData({ ...formData, credit_card_id: e.target.value });
                                                }
                                            }}
                                            className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                            required
                                        >
                                            <option value="" disabled>Select card</option>
                                            {creditCards.filter(c => c.enabled || c.id === formData.credit_card_id).map(c => <option key={c.id} value={c.id}>{c.name} {!c.enabled && '(Disabled)'}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Amount</label>
                                    <input
                                        type="number" step="0.01"
                                        value={formData.amount_cents ? formData.amount_cents / 100 : ''}
                                        onChange={e => setFormData({ ...formData, amount_cents: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : 0 })}
                                        className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 font-bold focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Currency</label>
                                    <select
                                        value={formData.currency_code}
                                        onChange={e => setFormData({ ...formData, currency_code: e.target.value })}
                                        className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                    >
                                        {currencies.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="p-4 bg-gray-50 dark:bg-zinc-800/50 rounded-xl space-y-4">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <Calendar className="w-3 h-3" /> Duration & Schedule
                                </h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">Start Date</label>
                                        <input
                                            type="date"
                                            value={formData.start_date || ''}
                                            onChange={e => setFormData({ ...formData, start_date: e.target.value })}
                                            min={getTodayLocalDate()}
                                            className="w-full p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">End Date (Optional)</label>
                                        <input
                                            type="date"
                                            value={formData.end_date || ''}
                                            onChange={e => setFormData({ ...formData, end_date: e.target.value || null })}
                                            className="w-full p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        value={occurrencesHelper}
                                        onChange={e => setOccurrencesHelper(e.target.value)}
                                        placeholder="N times"
                                        className="w-24 p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleCalculateEndDate}
                                        className="text-xs text-emerald-600 font-bold hover:bg-emerald-50 dark:hover:bg-emerald-900/20 px-2 py-1 rounded transition-colors"
                                    >
                                        Calculate End Date
                                    </button>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">Frequency</label>
                                    <select
                                        value={formData.schedule_type}
                                        onChange={e => setFormData({
                                            ...formData,
                                            schedule_type: e.target.value as any,
                                            schedule_config: { n: formData.schedule_config?.n || 1 }
                                        })}
                                        className="w-full p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                                    >
                                        {SCHEDULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                </div>

                                {(formData.schedule_type === 'every_n_days' || formData.schedule_type === 'every_n_months') && (
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">
                                            {formData.schedule_type === 'every_n_days' ? 'Every N Days' : 'Every N Months'}
                                        </label>
                                        <input
                                            type="number"
                                            min="1"
                                            value={formData.schedule_config?.n || 1}
                                            onChange={e => setFormData({
                                                ...formData,
                                                schedule_config: { ...formData.schedule_config, n: parseInt(e.target.value) || 1 }
                                            })}
                                            className="w-full p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-emerald-500 outline-none"
                                            required
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-end gap-3 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setShowForm(false)}
                                    className="px-6 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-8 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-500/20 transition-all"
                                >
                                    Save & Sync
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

function RuleCard({ rule, onEdit, onDelete, creditCards }: { rule: RecurringRule, onEdit: () => void, onDelete: () => void, creditCards: CreditCard[] }) {
    return (
        <div className={cn(
            "bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm relative transition-all",
            (!rule.active || (rule.end_date && rule.end_date < getTodayLocalDate())) && "opacity-60 bg-gray-50 dark:bg-zinc-950"
        )}>
            <div className="flex justify-between items-start mb-3">
                <div className="space-y-1">
                    <h3 className="font-bold text-lg leading-tight">{rule.tag}</h3>
                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{rule.category}</p>
                </div>
                <div className="flex gap-1 ml-2">
                    <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors" title="Edit">
                        <Edit2 className="w-4 h-4" />
                    </button>
                    <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="Delete Rule">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                    <span className={cn(
                        "text-lg font-bold font-mono",
                        rule.direction === 'income' ? "text-sky-600" : "text-red-600"
                    )}>
                        {rule.direction === 'income' ? '+' : '-'}{rule.currency_code} {(rule.amount_cents / 100).toFixed(2)}
                    </span>
                </div>

                {rule.note && (
                    <div className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-zinc-800/50 p-2 rounded-lg italic">
                        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span className="line-clamp-2">{rule.note}</span>
                    </div>
                )}

                <div className="text-[10px] text-gray-400 pt-2 border-t dark:border-zinc-800 flex flex-col gap-1">
                    <div className="flex justify-between">
                        <span>
                            {rule.schedule_type === 'monthly_day' ? 'Monthly' : rule.schedule_type.replace(/_/g, ' ')}
                        </span>
                        <span className="capitalize">
                            {rule.payment_method === 'card'
                                ? (creditCards.find(c => c.id === rule.credit_card_id)?.name || 'Card')
                                : 'Cash'}
                        </span>
                    </div>
                    <div className="flex justify-between italic">
                        <span>Start: {rule.start_date}</span>
                        {rule.end_date && <span>End: {rule.end_date}</span>}
                    </div>
                </div>
            </div>
        </div>
    );
}
