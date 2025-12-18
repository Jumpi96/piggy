import { useState, useEffect } from 'react';
import { fetchCreditCards, insertCreditCard, deleteCreditCard, fetchCurrencies, fetchLatestRates, insertExchangeRate } from '../lib/api';
import type { CreditCard, Currency } from '../types';
import { Plus, Trash2, CreditCard as CardIcon, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';

export function SettingsPage() {
    const [activeTab, setActiveTab] = useState<'cards' | 'rates'>('cards');

    return (
        <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold">Settings</h1>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 dark:border-zinc-700">
                <button
                    onClick={() => setActiveTab('cards')}
                    className={cn(
                        "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
                        activeTab === 'cards'
                            ? "border-pink-500 text-pink-600 dark:text-pink-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                >
                    <CardIcon className="w-4 h-4" />
                    Credit Cards
                </button>
                <button
                    onClick={() => setActiveTab('rates')}
                    className={cn(
                        "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
                        activeTab === 'rates'
                            ? "border-pink-500 text-pink-600 dark:text-pink-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                >
                    <RefreshCw className="w-4 h-4" />
                    Exchange Rates
                </button>
            </div>

            {activeTab === 'cards' ? <CardsSettings /> : <RatesSettings />}
        </div>
    );
}

function CardsSettings() {
    const [cards, setCards] = useState<CreditCard[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [newName, setNewName] = useState('');
    const [closingDay, setClosingDay] = useState('');
    const [paymentDay, setPaymentDay] = useState('');

    const load = async () => {
        setIsLoading(true);
        try {
            const data = await fetchCreditCards();
            setCards(data);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newName || !closingDay || !paymentDay) return;
        try {
            await insertCreditCard(newName, parseInt(closingDay), parseInt(paymentDay));
            setNewName('');
            setClosingDay('');
            setPaymentDay('');
            load();
        } catch (err) {
            console.error(err);
            alert("Failed to add card");
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure?")) return;
        try {
            await deleteCreditCard(id);
            load();
        } catch (err) {
            console.error(err);
            alert("Failed to delete card");
        }
    };

    return (
        <div className="space-y-8">
            {/* List */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-zinc-800 border-b border-gray-100 dark:border-zinc-700">
                        <tr>
                            <th className="px-6 py-3 font-medium text-gray-500">Name</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Closing Day</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Payment Day</th>
                            <th className="px-6 py-3 font-medium text-gray-500 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                        {cards.map(c => (
                            <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                                <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{c.name}</td>
                                <td className="px-6 py-3 text-gray-500">{c.closing_day}</td>
                                <td className="px-6 py-3 text-gray-500">{c.payment_day}</td>
                                <td className="px-6 py-3 text-right">
                                    <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:text-red-700 p-1">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {cards.length === 0 && !isLoading && (
                            <tr>
                                <td colSpan={4} className="px-6 py-8 text-center text-gray-400">
                                    No credit cards added.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Add Form */}
            <div className="bg-gray-50 dark:bg-zinc-800/50 p-6 rounded-xl border border-gray-200 dark:border-zinc-700">
                <h3 className="text-lg font-bold mb-4">Add New Card</h3>
                <form onSubmit={handleAdd} className="flex flex-col md:flex-row gap-4 items-end">
                    <div className="flex-1 space-y-1 w-full">
                        <label className="text-xs font-medium text-gray-500">Card Name</label>
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="e.g. Visa Gold"
                            className="w-full p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                            required
                        />
                    </div>
                    <div className="w-full md:w-32 space-y-1">
                        <label className="text-xs font-medium text-gray-500">Closing Day</label>
                        <input
                            type="number"
                            min="1" max="31"
                            value={closingDay}
                            onChange={(e) => setClosingDay(e.target.value)}
                            placeholder="DD"
                            className="w-full p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                            required
                        />
                    </div>
                    <div className="w-full md:w-32 space-y-1">
                        <label className="text-xs font-medium text-gray-500">Payment Day</label>
                        <input
                            type="number"
                            min="1" max="31"
                            value={paymentDay}
                            onChange={(e) => setPaymentDay(e.target.value)}
                            placeholder="DD"
                            className="w-full p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                            required
                        />
                    </div>
                    <button type="submit" className="w-full md:w-auto px-6 py-2 bg-pink-600 text-white rounded-lg font-medium hover:bg-pink-700 transition-colors flex items-center justify-center gap-2">
                        <Plus className="w-4 h-4" /> Add
                    </button>
                </form>
            </div>
        </div>
    );
}

function RatesSettings() {
    const [currencies, setCurrencies] = useState<Currency[]>([]);
    const [inputs, setInputs] = useState<Record<string, string>>({}); // currency_code -> rate string
    const [isLoading, setIsLoading] = useState(false);

    const load = async () => {
        setIsLoading(true);
        try {
            const [curData, rateData] = await Promise.all([
                fetchCurrencies(),
                fetchLatestRates()
            ]);

            setCurrencies(curData.sort((a, b) => a.code.localeCompare(b.code)));
            const initialInputs: Record<string, string> = {};
            curData.forEach((c: Currency) => {
                const r = (rateData as any[]).find((rd: any) => rd.currency_code === c.code);
                if (r) initialInputs[c.code] = r.rate.toString();
            });
            setInputs(initialInputs);

        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleSave = async (code: string) => {
        const val = inputs[code];
        if (!val) return;
        try {
            await insertExchangeRate(code, parseFloat(val));
            alert(`Rate for ${code} updated! Transactions from this month onwards will now use this rate.`);
            load();
        } catch (err) {
            console.error(err);
            alert("Failed to save rate");
        }
    };

    // Filter out USD if base is USD
    const foreignCurrencies = currencies.filter(c => c.code !== 'USD');

    return (
        <div className="space-y-8">
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-zinc-800 border-b border-gray-100 dark:border-zinc-700">
                        <tr>
                            <th className="px-6 py-3 font-medium text-gray-500">Currency</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Current Rate (to USD)</th>
                            <th className="px-6 py-3 font-medium text-gray-500 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                        {foreignCurrencies.map(c => (
                            <tr key={c.code} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                                <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">
                                    {c.name} ({c.code})
                                </td>
                                <td className="px-6 py-3">
                                    <input
                                        type="number"
                                        step="0.0001"
                                        value={inputs[c.code] || ''}
                                        onChange={(e) => setInputs(prev => ({ ...prev, [c.code]: e.target.value }))}
                                        placeholder="e.g. 1.0"
                                        className="w-32 p-2 rounded border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-right font-mono"
                                    />
                                </td>
                                <td className="px-6 py-3 text-right">
                                    <button
                                        onClick={() => handleSave(c.code)}
                                        className="text-pink-600 hover:text-pink-700 font-medium text-xs uppercase tracking-wide border border-pink-200 dark:border-pink-900 px-3 py-1 rounded hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-colors"
                                    >
                                        Update
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {foreignCurrencies.length === 0 && !isLoading && (
                            <tr>
                                <td colSpan={3} className="px-6 py-8 text-center text-gray-400">
                                    No foreign currencies found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="bg-gray-50 dark:bg-zinc-800/50 p-6 rounded-xl border border-gray-200 dark:border-zinc-700">
                <h4 className="font-bold mb-2">How it works</h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Rates are defined as "Units of Local Currency per 1 USD" (e.g., ARS = 1000).
                    <br /><br />
                    When you update a rate, it is saved with the current timestamp.
                    <strong> All transactions from the start of the current month </strong>
                    onwards will be updated to use this new rate in your Overview and reports.
                </p>
            </div>
        </div>
    );
}
