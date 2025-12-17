import { useState, useEffect } from 'react';
import { fetchRecurringRules, insertRecurringRule, updateRecurringRule, deleteRecurringRule, ensureRecurringGenerated, fetchCurrencies, fetchCreditCards } from '../lib/api';
import type { RecurringRule, Currency, CreditCard } from '../types';
import { Plus, Trash2, Edit2, Play, Pause, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { CATEGORIES } from '../lib/constants';

// Simplified for v1: only Monthly on Day X
const SCHEDULE_TYPES = [
    { value: 'monthly_day', label: 'Monthly on Date' },
    { value: 'every_n_days', label: 'Every N Days' },
    { value: 'every_n_months', label: 'Every N Months' }
];

export function RecurringRulesPage() {
    const [rules, setRules] = useState<RecurringRule[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [showForm, setShowForm] = useState(false);

    // Form State
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<RecurringRule>>({
        direction: 'expense',
        currency_code: 'USD',
        payment_method: 'cash',
        schedule_type: 'monthly_day',
        schedule_config: { n: 1 },
        active: true,
        start_date: new Date().toISOString().split('T')[0]
    });

    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [cards, setCards] = useState<CreditCard[]>([]);

    const load = async () => {
        setIsLoading(true);
        try {
            const [r, c, cc] = await Promise.all([
                fetchRecurringRules(),
                fetchCurrencies(),
                fetchCreditCards()
            ]);
            setRules(r);
            setCurrencies(c);
            setCards(cc);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleGenerate = async () => {
        setIsGenerating(true);
        try {
            // Generate until 2 months ahead
            const future = new Date();
            future.setMonth(future.getMonth() + 2);
            await ensureRecurringGenerated(future.toISOString().split('T')[0]);
            alert("Generated transactions successfully.");
        } catch (err) {
            console.error(err);
            alert("Failed to generate.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const payload = { ...formData };
            if (!payload.amount_cents) payload.amount_cents = 0; // handle empty string?

            // Amount input is likely in units, convert to cents
            // Wait, let's assuming input is handled as cents or units in form?
            // TransactionForm used units. Let's use units in UI.

            if (editingId) {
                await updateRecurringRule(editingId, payload);
            } else {
                await insertRecurringRule(payload);
            }
            setShowForm(false);
            setEditingId(null);
            setFormData({
                direction: 'expense',
                currency_code: 'USD',
                payment_method: 'cash',
                schedule_type: 'monthly_day',
                schedule_config: { n: 1 },
                active: true,
                start_date: new Date().toISOString().split('T')[0]
            });
            load();
        } catch (err) {
            console.error(err);
            alert("Failed to save rule");
        }
    };

    const handleEdit = (rule: RecurringRule) => {
        setEditingId(rule.id);
        setFormData(rule);
        setShowForm(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure?")) return;
        try {
            await deleteRecurringRule(id);
            load();
        } catch (err) {
            console.error(err);
            alert("Failed to delete");
        }
    };

    const toggleActive = async (rule: RecurringRule) => {
        try {
            await updateRecurringRule(rule.id, { active: !rule.active });
            load();
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Recurring Rules</h1>
                <div className="flex gap-2">
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="p-2 text-gray-500 hover:text-emerald-600 border rounded-lg hover:border-emerald-200"
                        title="Force Generate Now"
                    >
                        <RefreshCw className={cn("w-5 h-5", isGenerating && "animate-spin")} />
                    </button>
                    <button
                        onClick={() => { setShowForm(true); setEditingId(null); }}
                        className="flex items-center gap-2 px-4 py-2 bg-pink-600 text-white rounded-lg font-medium hover:bg-pink-700"
                    >
                        <Plus className="w-4 h-4" /> New Rule
                    </button>
                </div>
            </div>

            {/* List */}
            {isLoading ? (
                <div className="flex justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {rules.map(rule => (
                        <div key={rule.id} className={cn("bg-white dark:bg-zinc-900 p-4 rounded-xl border shadow-sm relative", !rule.active && "opacity-60")}>
                            {/* ... card content ... */}
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="font-bold text-lg">{rule.tag}</h3>
                                <div className="flex gap-1">
                                    <button onClick={() => toggleActive(rule)} className="p-1 text-gray-400 hover:text-blue-500">
                                        {rule.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                    </button>
                                    <button onClick={() => handleEdit(rule)} className="p-1 text-gray-400 hover:text-gray-600">
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleDelete(rule.id)} className="p-1 text-gray-400 hover:text-red-500">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            <div className="text-sm text-gray-500 space-y-1">
                                <p>{rule.category} • <span className={rule.direction === 'income' ? 'text-emerald-600' : 'text-red-600'}>{rule.direction}</span></p>
                                <p className="font-mono">{rule.currency_code} {(rule.amount_cents / 100).toFixed(2)}</p>
                                <p className="text-xs pt-2 border-t mt-2">
                                    {rule.schedule_type === 'monthly_day' ? 'Monthly' : rule.schedule_type}
                                    {rule.total_occurrences ? ` • Limit: ${rule.total_occurrences} times` : ' • Infinite'}
                                </p>
                            </div>
                        </div>
                    ))}
                    {rules.length === 0 && (
                        <div className="md:col-span-3 text-center p-12 text-gray-500 border-2 border-dashed rounded-xl">
                            No recurring rules yet.
                        </div>
                    )}
                </div>
            )}

            {/* Modal/Form Overlay */}
            {showForm && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
                    <div className="bg-white dark:bg-zinc-900 w-full max-w-lg rounded-2xl shadow-xl p-6">
                        <h2 className="text-xl font-bold mb-4">{editingId ? 'Edit Rule' : 'New Recurring Rule'}</h2>
                        <form onSubmit={handleSubmit} className="space-y-4">

                            {/* Basics */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                                    <select
                                        value={formData.direction}
                                        onChange={e => setFormData({ ...formData, direction: e.target.value as any })}
                                        className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
                                    >
                                        <option value="expense">Expense</option>
                                        <option value="income">Income</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                                    <select
                                        value={formData.category}
                                        onChange={e => setFormData({ ...formData, category: e.target.value })}
                                        className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
                                        required
                                    >
                                        <option value="">Select...</option>
                                        {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Tag / Description</label>
                                <input
                                    type="text"
                                    value={formData.tag || ''}
                                    onChange={e => setFormData({ ...formData, tag: e.target.value })}
                                    className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
                                    <input
                                        type="number" step="0.01"
                                        value={formData.amount_cents ? formData.amount_cents / 100 : ''}
                                        onChange={e => setFormData({ ...formData, amount_cents: Math.round(parseFloat(e.target.value) * 100) })}
                                        className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
                                    <select
                                        value={formData.currency_code}
                                        onChange={e => setFormData({ ...formData, currency_code: e.target.value })}
                                        className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
                                    >
                                        {currencies.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Payment Method */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
                                    <select
                                        value={formData.payment_method}
                                        onChange={e => setFormData({ ...formData, payment_method: e.target.value as any })}
                                        className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
                                    >
                                        <option value="cash">Cash</option>
                                        <option value="card">Credit Card</option>
                                    </select>
                                </div>
                                {formData.payment_method === 'card' && (
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">Card</label>
                                        <select
                                            value={formData.credit_card_id || ''}
                                            onChange={e => setFormData({ ...formData, credit_card_id: e.target.value })}
                                            className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
                                            required
                                        >
                                            <option value="">Select Card...</option>
                                            {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <hr className="dark:border-zinc-700" />

                            {/* Schedule */}
                            <div className="space-y-3">
                                <h4 className="font-medium text-sm">Schedule</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
                                        <input
                                            type="date"
                                            value={formData.start_date || ''}
                                            onChange={e => setFormData({ ...formData, start_date: e.target.value })}
                                            className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">Recurrence</label>
                                        <select
                                            value={formData.schedule_type}
                                            onChange={e => setFormData({ ...formData, schedule_type: e.target.value as any })}
                                            className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
                                        >
                                            {SCHEDULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                    </div>
                                </div>

                                {formData.schedule_type !== 'monthly_day' && (
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">Every N {formData.schedule_type === 'every_n_days' ? 'Days' : 'Months'}</label>
                                        <input
                                            type="number" min="1"
                                            value={formData.schedule_config?.n || 1}
                                            onChange={e => setFormData({ ...formData, schedule_config: { n: parseInt(e.target.value) } })}
                                            className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
                                        />
                                    </div>
                                )}

                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Stop After (Occurrences)</label>
                                    <input
                                        type="number" min="1" placeholder="Infinite"
                                        value={formData.total_occurrences || ''}
                                        onChange={e => setFormData({ ...formData, total_occurrences: e.target.value ? parseInt(e.target.value) : null })}
                                        className="w-full p-2 rounded border dark:bg-zinc-800 dark:border-zinc-700"
                                    />
                                    <p className="text-[10px] text-gray-400 mt-1">Leave empty for infinite recurrence.</p>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 mt-6">
                                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800">Cancel</button>
                                <button type="submit" className="px-6 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700">Save Rule</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
