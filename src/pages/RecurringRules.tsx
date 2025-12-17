import { useState, useEffect } from 'react';
import { fetchRecurringRules, insertRecurringRule, updateRecurringRule, deleteRecurringRule, ensureRecurringGenerated, fetchCurrencies, fetchCreditCards } from '../lib/api';
import type { RecurringRule, Currency, CreditCard } from '../types';
import { Plus, Trash2, Edit2, Play, Pause, RefreshCw, Loader2, Info } from 'lucide-react';
import { cn } from '../lib/utils';
import { CATEGORIES } from '../lib/constants';

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
        note: '',
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
            const future = new Date();
            future.setMonth(future.getMonth() + 2);
            await ensureRecurringGenerated(future.toISOString().split('T')[0]);
            alert("Generated transactions successfully.");
            load();
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
            if (editingId) {
                await updateRecurringRule(editingId, payload);
            } else {
                await insertRecurringRule(payload);
            }
            setShowForm(false);
            resetForm();
            load();
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
            start_date: new Date().toISOString().split('T')[0]
        });
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
                <div>
                    <h1 className="text-2xl font-bold">Recurring Rules</h1>
                    <p className="text-sm text-gray-500">Automate your regular transactions</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="p-2 text-gray-500 hover:text-emerald-600 border dark:border-zinc-700 rounded-lg hover:border-emerald-200 transition-colors"
                        title="Force Generate Now"
                    >
                        <RefreshCw className={cn("w-5 h-5", isGenerating && "animate-spin")} />
                    </button>
                    <button
                        onClick={() => { resetForm(); setShowForm(true); }}
                        className="flex items-center gap-2 px-4 py-2 bg-pink-600 text-white rounded-lg font-medium hover:bg-pink-700 transition-colors"
                    >
                        <Plus className="w-4 h-4" /> New Rule
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="flex justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-pink-500" />
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {rules.map(rule => (
                        <div key={rule.id} className={cn(
                            "bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm relative transition-all",
                            !rule.active && "opacity-60 bg-gray-50 dark:bg-zinc-950"
                        )}>
                            <div className="flex justify-between items-start mb-3">
                                <div className="space-y-1">
                                    <h3 className="font-bold text-lg leading-tight">{rule.tag}</h3>
                                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{rule.category}</p>
                                </div>
                                <div className="flex gap-1 ml-2">
                                    <button onClick={() => toggleActive(rule)} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title={rule.active ? "Pause" : "Resume"}>
                                        {rule.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                                    </button>
                                    <button onClick={() => handleEdit(rule)} className="p-1.5 text-gray-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleDelete(rule.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-baseline gap-2">
                                    <span className={cn(
                                        "text-lg font-bold font-mono",
                                        rule.direction === 'income' ? 'text-teal-600' : 'text-pink-600'
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

                                <div className="text-[10px] text-gray-400 pt-2 border-t dark:border-zinc-800 flex justify-between items-center">
                                    <span>
                                        {rule.schedule_type === 'monthly_day' ? 'Monthly' : rule.schedule_type.replace(/_/g, ' ')}
                                        {rule.total_occurrences ? ` • ${rule.total_occurrences} times` : ' • Infinite'}
                                    </span>
                                    <span className="capitalize">{rule.payment_method}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                    {rules.length === 0 && (
                        <div className="md:col-span-3 text-center p-12 text-gray-500 border-2 border-dashed border-gray-100 dark:border-zinc-800 rounded-xl">
                            <RefreshCw className="w-8 h-8 mx-auto mb-3 text-gray-300" />
                            <p>No recurring rules yet.</p>
                            <button onClick={() => setShowForm(true)} className="mt-4 text-pink-600 font-medium hover:underline text-sm">Create your first rule</button>
                        </div>
                    )}
                </div>
            )}

            {showForm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-zinc-900 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-gray-100 dark:border-zinc-800 animate-in fade-in zoom-in duration-200">
                        <div className="p-6 border-b border-gray-50 dark:border-zinc-800 flex items-center justify-between">
                            <h2 className="text-xl font-bold">{editingId ? 'Edit Recurring Rule' : 'New Recurring Rule'}</h2>
                            <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                                <Plus className="w-6 h-6 text-gray-400 rotate-45" />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Type</label>
                                    <select
                                        value={formData.direction}
                                        onChange={e => setFormData({ ...formData, direction: e.target.value as any })}
                                        className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
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
                                        className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                                        required
                                    >
                                        <option value="">Select category...</option>
                                        {CATEGORIES.filter(c => c.direction === formData.direction).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Tag (Title)</label>
                                <input
                                    type="text"
                                    value={formData.tag || ''}
                                    onChange={e => setFormData({ ...formData, tag: e.target.value })}
                                    placeholder="e.g. Rent, Salary, Netflix..."
                                    className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Amount</label>
                                    <input
                                        type="number" step="0.01"
                                        value={formData.amount_cents ? formData.amount_cents / 100 : ''}
                                        onChange={e => setFormData({ ...formData, amount_cents: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : 0 })}
                                        placeholder="0.00"
                                        className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 text-lg font-bold font-mono focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Currency</label>
                                    <select
                                        value={formData.currency_code}
                                        onChange={e => setFormData({ ...formData, currency_code: e.target.value })}
                                        className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                                    >
                                        {currencies.map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Note (Optional)</label>
                                <textarea
                                    value={formData.note || ''}
                                    onChange={e => setFormData({ ...formData, note: e.target.value })}
                                    placeholder="Additional context for this rule..."
                                    rows={2}
                                    className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-pink-500 outline-none transition-all resize-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Method</label>
                                    <select
                                        value={formData.payment_method}
                                        onChange={e => setFormData({ ...formData, payment_method: e.target.value as any })}
                                        className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                                    >
                                        <option value="cash">Cash</option>
                                        <option value="card">Credit Card</option>
                                    </select>
                                </div>
                                {formData.payment_method === 'card' && (
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">Card</label>
                                        <select
                                            value={formData.credit_card_id || ''}
                                            onChange={e => setFormData({ ...formData, credit_card_id: e.target.value })}
                                            className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                                            required
                                        >
                                            <option value="">Select card...</option>
                                            {cards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="p-4 bg-gray-50 dark:bg-zinc-800/50 rounded-xl space-y-4">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <RefreshCw className="w-3 h-3" /> Schedule
                                </h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">Start Date</label>
                                        <input
                                            type="date"
                                            value={formData.start_date || ''}
                                            onChange={e => setFormData({ ...formData, start_date: e.target.value })}
                                            className="w-full p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">Repeat</label>
                                        <select
                                            value={formData.schedule_type}
                                            onChange={e => setFormData({ ...formData, schedule_type: e.target.value as any })}
                                            className="w-full p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                                        >
                                            {SCHEDULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                    </div>
                                </div>

                                {formData.schedule_type !== 'monthly_day' && (
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">
                                            Every N {formData.schedule_type === 'every_n_days' ? 'Days' : 'Months'}
                                        </label>
                                        <input
                                            type="number" min="1"
                                            value={formData.schedule_config?.n || 1}
                                            onChange={e => setFormData({ ...formData, schedule_config: { n: parseInt(e.target.value) } })}
                                            className="w-full p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                                        />
                                    </div>
                                )}

                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">Stop After</label>
                                    <div className="flex gap-2 items-center">
                                        <input
                                            type="number" min="1" placeholder="Infinite"
                                            value={formData.total_occurrences || ''}
                                            onChange={e => setFormData({ ...formData, total_occurrences: e.target.value ? parseInt(e.target.value) : null })}
                                            className="w-24 p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-pink-500 outline-none transition-all"
                                        />
                                        <span className="text-[10px] text-gray-400 font-medium">occurrences</span>
                                    </div>
                                </div>
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
                                    className="px-8 py-2.5 bg-pink-600 text-white rounded-xl font-bold hover:bg-pink-700 shadow-lg shadow-pink-500/20 active:scale-95 transition-all"
                                >
                                    Save Rule
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
