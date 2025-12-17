import { useState, useEffect } from 'react';
import { fetchRecurringRules, insertRecurringRule, updateRecurringRule, deleteRecurringRule, ensureRecurringGenerated, fetchCurrencies, fetchCreditCards } from '../lib/api';
import { calculateEndDate } from '../lib/recurrence';
import type { RecurringRule, Currency, CreditCard, ScheduleType } from '../types';
import { Plus, Trash2, Edit2, StopCircle, RefreshCw, Loader2, Info, Calendar } from 'lucide-react';
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
        start_date: new Date().toISOString().split('T')[0],
        end_date: null
    });

    const [occurrencesHelper, setOccurrencesHelper] = useState<string>('');

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
            future.setMonth(future.getMonth() + 24); // Generator for 24 months
            await ensureRecurringGenerated(future.toISOString().split('T')[0]);
            alert("Generated transactions for the next 24 months.");
            load();
        } catch (err) {
            console.error(err);
            alert("Failed to generate.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCalculateEndDate = () => {
        const count = parseInt(occurrencesHelper);
        if (isNaN(count) || count <= 0) return;

        const startStr = formData.start_date || new Date().toISOString().split('T')[0];
        const type = formData.schedule_type as ScheduleType;
        const n = formData.schedule_config?.n || 1;

        const endStr = calculateEndDate(startStr, count, type, n);

        setFormData({ ...formData, end_date: endStr });
        setOccurrencesHelper('');
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

            // Auto run generation to sync changes
            const future = new Date();
            future.setMonth(future.getMonth() + 24);
            await ensureRecurringGenerated(future.toISOString().split('T')[0]);
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
            start_date: new Date().toISOString().split('T')[0],
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
        if (!confirm("Removing the rule will stop future generations, but existing future transactions will NOT be deleted automatically. \n\nContinue?")) return;
        try {
            await deleteRecurringRule(id);
            load();
        } catch (err) {
            console.error(err);
            alert("Failed to delete");
        }
    };

    const handleStop = async (rule: RecurringRule) => {
        if (!confirm("This will stop the rule immediately. Future transactions beyond today will be removed. \n\nContinue?")) return;
        try {
            const today = new Date().toISOString().split('T')[0];
            await updateRecurringRule(rule.id, { active: false, end_date: today });

            // Sync with RPC cleanup
            const future = new Date();
            future.setMonth(future.getMonth() + 24);
            await ensureRecurringGenerated(future.toISOString().split('T')[0]);

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
                    <p className="text-sm text-gray-500">Automate your finances (24-month horizon)</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="p-2 text-gray-500 hover:text-emerald-600 border dark:border-zinc-700 rounded-lg hover:border-emerald-200 transition-colors"
                        title="Sync / Generate (24 Months)"
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
                            (!rule.active || (rule.end_date && rule.end_date < new Date().toISOString().split('T')[0])) && "opacity-60 bg-gray-50 dark:bg-zinc-950"
                        )}>
                            <div className="flex justify-between items-start mb-3">
                                <div className="space-y-1">
                                    <h3 className="font-bold text-lg leading-tight">{rule.tag}</h3>
                                    <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{rule.category}</p>
                                </div>
                                <div className="flex gap-1 ml-2">
                                    {rule.active && (
                                        <button onClick={() => handleStop(rule)} className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors" title="Stop Now">
                                            <StopCircle className="w-4 h-4" />
                                        </button>
                                    )}
                                    <button onClick={() => handleEdit(rule)} className="p-1.5 text-gray-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors" title="Edit">
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleDelete(rule.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="Delete Rule">
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

                                <div className="text-[10px] text-gray-400 pt-2 border-t dark:border-zinc-800 flex flex-col gap-1">
                                    <div className="flex justify-between">
                                        <span>
                                            {rule.schedule_type === 'monthly_day' ? 'Monthly' : rule.schedule_type.replace(/_/g, ' ')}
                                        </span>
                                        <span className="capitalize">{rule.payment_method}</span>
                                    </div>
                                    <div className="flex justify-between italic">
                                        <span>Start: {rule.start_date}</span>
                                        {rule.end_date && <span>End: {rule.end_date}</span>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {rules.length === 0 && (
                        <div className="md:col-span-3 text-center p-12 text-gray-500 border-2 border-dashed border-gray-100 dark:border-zinc-800 rounded-xl">
                            <Plus className="w-8 h-8 mx-auto mb-3 text-gray-300" />
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
                            <h2 className="text-xl font-bold">{editingId ? 'Edit Rule' : 'New Recurring Rule'}</h2>
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
                                    placeholder="e.g. Rent, Salary..."
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
                                        className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-800 font-bold focus:ring-2 focus:ring-pink-500 outline-none transition-all"
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
                                            className="w-full p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-pink-500 outline-none"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">End Date (Optional)</label>
                                        <input
                                            type="date"
                                            value={formData.end_date || ''}
                                            onChange={e => setFormData({ ...formData, end_date: e.target.value || null })}
                                            className="w-full p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-pink-500 outline-none"
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        value={occurrencesHelper}
                                        onChange={e => setOccurrencesHelper(e.target.value)}
                                        placeholder="N times"
                                        className="w-24 p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-pink-500 outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleCalculateEndDate}
                                        className="text-xs text-pink-600 font-bold hover:bg-pink-50 dark:hover:bg-pink-900/20 px-2 py-1 rounded transition-colors"
                                    >
                                        Calculate End Date
                                    </button>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 mb-1 uppercase">Frequency</label>
                                    <select
                                        value={formData.schedule_type}
                                        onChange={e => setFormData({ ...formData, schedule_type: e.target.value as any })}
                                        className="w-full p-2 text-sm rounded-lg border border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 focus:ring-2 focus:ring-pink-500 outline-none"
                                    >
                                        {SCHEDULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
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
                                    className="px-8 py-2.5 bg-pink-600 text-white rounded-xl font-bold hover:bg-pink-700 shadow-lg shadow-pink-500/20 transition-all"
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
