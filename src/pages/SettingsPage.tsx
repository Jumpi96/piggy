import { useState, useEffect } from 'react';
import { fetchCreditCards, insertCreditCard, deleteCreditCard, updateCreditCard, updateCreditCardOrder, fetchCurrencies, fetchLatestRates, insertExchangeRate, fetchParameters, upsertParameter } from '../lib/api';
import { cacheMonthStartDay } from '../lib/dates';
import type { CreditCard, Currency, Parameter } from '../types';
import { Plus, Trash2, CreditCard as CardIcon, RefreshCw, Settings2, PiggyBank, Loader2, Check, AlertCircle, ArrowUp, ArrowDown, GripVertical } from 'lucide-react';
import { cn } from '../lib/utils';
import { resequenceCreditCards, sortCreditCards } from '../lib/creditCards';
import { DEBUG_FLAG_KEY } from '../lib/debug';
import {
    getAllocationConfig,
    saveAllocationConfig,
    testLedgerConnection,
    type AllocationConfig,
    DEFAULT_ALLOCATION_CONFIG,
} from '../lib/ledger';

export function SettingsPage() {
    const [activeTab, setActiveTab] = useState<'cards' | 'rates' | 'general' | 'ledger'>('cards');

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
                            ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
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
                            ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                >
                    <RefreshCw className="w-4 h-4" />
                    Exchange Rates
                </button>
                <button
                    onClick={() => setActiveTab('general')}
                    className={cn(
                        "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
                        activeTab === 'general'
                            ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                >
                    <Settings2 className="w-4 h-4" />
                    General
                </button>
                <button
                    onClick={() => setActiveTab('ledger')}
                    className={cn(
                        "px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
                        activeTab === 'ledger'
                            ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                >
                    <PiggyBank className="w-4 h-4" />
                    Ledger
                </button>
            </div>

            {activeTab === 'cards' && <CardsSettings />}
            {activeTab === 'rates' && <RatesSettings />}
            {activeTab === 'general' && <GeneralSettings />}
            {activeTab === 'ledger' && <LedgerSettings />}
        </div>
    );
}

function GeneralSettings() {
    const [apd, setApd] = useState<string>('');
    const [startDay, setStartDay] = useState<string>('1');
    const [isLoading, setIsLoading] = useState(false);
    const [debugEnabled, setDebugEnabled] = useState(false);
    const [debugError, setDebugError] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            setIsLoading(true);
            try {
                const params: Parameter[] = await fetchParameters();
                const apdParam = params.find(p => p.key === 'amount_per_day');
                if (apdParam) setApd(apdParam.value.toString());
                const startDayParam = params.find(p => p.key === 'month_start_day');
                if (startDayParam) setStartDay(startDayParam.value.toString());
            } catch (err) {
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        }
        load();
    }, []);

    useEffect(() => {
        try {
            setDebugEnabled(localStorage.getItem(DEBUG_FLAG_KEY) === '1');
        } catch (err) {
            setDebugError('Local storage is not available');
        }
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const day = Math.min(28, Math.max(1, Math.round(parseFloat(startDay) || 1)));
            await upsertParameter('amount_per_day', parseFloat(apd));
            await upsertParameter('month_start_day', day);
            // Update the synchronous cache immediately so period math reflects the change.
            cacheMonthStartDay(day);
            setStartDay(String(day));
            alert("Settings saved!");
        } catch (err) {
            console.error(err);
            alert("Failed to save settings");
        }
    };

    const handleToggleDebug = () => {
        try {
            const next = !debugEnabled;
            if (next) {
                localStorage.setItem(DEBUG_FLAG_KEY, '1');
            } else {
                localStorage.removeItem(DEBUG_FLAG_KEY);
            }
            setDebugEnabled(next);
            setDebugError(null);
            window.dispatchEvent(new Event('piggy-debug-change'));
        } catch (err) {
            setDebugError('Failed to update debug setting');
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800">
                <h3 className="text-lg font-bold mb-4">Financial Parameters</h3>
                <form onSubmit={handleSave} className="space-y-4 max-w-sm">
                    <div className="space-y-1">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Amount per Day (USD)
                        </label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                            <input
                                type="number"
                                step="0.01"
                                value={apd}
                                onChange={(e) => setApd(e.target.value)}
                                className="w-full pl-7 p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                                placeholder="35.00"
                                required
                            />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            This base value is used to calculate your expected daily balance.
                        </p>
                    </div>
                    <div className="space-y-1">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Month Start Day
                        </label>
                        <input
                            type="number"
                            min="1"
                            max="28"
                            step="1"
                            value={startDay}
                            onChange={(e) => setStartDay(e.target.value)}
                            className="w-full p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900"
                            placeholder="1"
                            required
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            The day your financial month begins (1–28). Use 1 for a regular calendar month.
                        </p>
                    </div>
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="px-6 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
                    >
                        Save Settings
                    </button>
                </form>
            </div>
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800">
                <h3 className="text-lg font-bold mb-2">Debug</h3>
                <p className="text-xs text-gray-500 mb-3">
                    Enable the in-app debug overlay to inspect offline storage and sync status.
                </p>
                <button
                    type="button"
                    onClick={handleToggleDebug}
                    className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                        debugEnabled
                            ? "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300"
                    )}
                >
                    {debugEnabled ? 'Disable Debug Overlay' : 'Enable Debug Overlay'}
                </button>
                {debugError && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-2">{debugError}</p>
                )}
            </div>
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
            const data = await fetchCreditCards(true);
            setCards(resequenceCreditCards(sortCreditCards(data)));
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

    const handleToggleEnabled = async (c: CreditCard) => {
        // Optimistic update
        setCards(prev => prev.map(card => card.id === c.id ? { ...card, enabled: !card.enabled } : card));

        try {
            await updateCreditCard(c.id, { enabled: !c.enabled });
            // No need to reload, optimistic update is enough unless we want to confirm server state
            // load(); 
        } catch (err: any) {
            console.error(err);
            alert("Failed to update card status: " + err.message);
            // Revert on error
            setCards(prev => prev.map(card => card.id === c.id ? { ...card, enabled: c.enabled } : card));
        }
    };

    const handleMoveCard = async (index: number, direction: -1 | 1) => {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= cards.length) return;

        const previousCards = cards;
        const reordered = [...cards];
        const [card] = reordered.splice(index, 1);
        reordered.splice(targetIndex, 0, card);
        const nextCards = resequenceCreditCards(reordered);

        setCards(nextCards);

        try {
            await updateCreditCardOrder(nextCards);
        } catch (err: unknown) {
            console.error(err);
            const message = err instanceof Error ? err.message : String(err);
            alert("Failed to update card order: " + message);
            setCards(previousCards);
        }
    };

    return (
        <div className="space-y-8">
            {/* List */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800 overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-zinc-800 border-b border-gray-100 dark:border-zinc-700">
                        <tr>
                            <th className="px-6 py-3 font-medium text-gray-500 w-28">Order</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Name</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Closing Day</th>
                            <th className="px-6 py-3 font-medium text-gray-500">Payment Day</th>
                            <th className="px-6 py-3 font-medium text-gray-500 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                        {cards.map((c, index) => (
                            <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                                <td className="px-6 py-3">
                                    <div className="flex items-center gap-1 text-gray-400">
                                        <GripVertical className="w-4 h-4" />
                                        <button
                                            type="button"
                                            onClick={() => handleMoveCard(index, -1)}
                                            disabled={index === 0}
                                            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent"
                                            title="Move card up"
                                        >
                                            <ArrowUp className="w-4 h-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleMoveCard(index, 1)}
                                            disabled={index === cards.length - 1}
                                            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent"
                                            title="Move card down"
                                        >
                                            <ArrowDown className="w-4 h-4" />
                                        </button>
                                    </div>
                                </td>
                                <td className="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">{c.name}</td>
                                <td className="px-6 py-3">
                                    <button
                                        onClick={() => handleToggleEnabled(c)}
                                        className={cn(
                                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2",
                                            c.enabled ? "bg-emerald-500" : "bg-gray-200 dark:bg-zinc-700"
                                        )}
                                        title={c.enabled ? "Disable card" : "Enable card"}
                                    >
                                        <span
                                            className={cn(
                                                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                                                c.enabled ? "translate-x-6" : "translate-x-1"
                                            )}
                                        />
                                    </button>
                                    <span className="ml-2 text-xs text-gray-500 dark:text-zinc-500">
                                        {c.enabled ? 'Active' : 'Disabled'}
                                    </span>
                                </td>
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
                                <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
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
                    <button type="submit" className="w-full md:w-auto px-6 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
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
        const parsed = parseFloat(val);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            alert("Please enter a rate greater than 0.");
            return;
        }
        try {
            await insertExchangeRate(code, parsed);
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
                                        className="text-emerald-600 hover:text-emerald-700 font-medium text-xs uppercase tracking-wide border border-emerald-200 dark:border-emerald-900 px-3 py-1 rounded hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
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

function LedgerSettings() {
    // Connection status
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

    // Allocation config
    const [allocationJson, setAllocationJson] = useState('');
    const [allocationError, setAllocationError] = useState<string | null>(null);
    const [allocationSaved, setAllocationSaved] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoadingConfig, setIsLoadingConfig] = useState(true);

    // Load existing config
    useEffect(() => {
        async function loadConfig() {
            setIsLoadingConfig(true);
            const allocation = await getAllocationConfig();
            setAllocationJson(JSON.stringify(allocation, null, 2));
            setIsLoadingConfig(false);
        }
        loadConfig();
    }, []);

    const handleTestConnection = async () => {
        setIsTesting(true);
        setTestResult(null);

        const result = await testLedgerConnection();
        setTestResult(result);

        setIsTesting(false);
    };

    const handleSaveAllocation = async () => {
        try {
            const parsed = JSON.parse(allocationJson) as AllocationConfig;

            // Basic validation
            if (typeof parsed.expected !== 'number' || !parsed.categories || !parsed.goals) {
                throw new Error('Invalid allocation config structure');
            }

            setIsSaving(true);
            await saveAllocationConfig(parsed);
            setAllocationError(null);
            setAllocationSaved(true);
            setTimeout(() => setAllocationSaved(false), 3000);
        } catch (err) {
            setAllocationError(err instanceof Error ? err.message : 'Invalid JSON');
        } finally {
            setIsSaving(false);
        }
    };

    const handleResetAllocation = () => {
        setAllocationJson(JSON.stringify(DEFAULT_ALLOCATION_CONFIG, null, 2));
        setAllocationError(null);
    };

    return (
        <div className="space-y-6">
            {/* GitHub Connection */}
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800">
                <h3 className="text-lg font-bold mb-4">GitHub Ledger Connection</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                    The ledger connection is configured via server-side environment variables for enhanced security.
                    Click the button below to verify the connection to your private GitHub repository.
                </p>

                <div className="space-y-4 max-w-lg">
                    {/* Test Result */}
                    {testResult && (
                        <div className={cn(
                            "flex items-center gap-2 p-3 rounded-lg text-sm",
                            testResult.success
                                ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
                                : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
                        )}>
                            {testResult.success ? (
                                <>
                                    <Check className="w-4 h-4" />
                                    Successfully connected to the ledger!
                                </>
                            ) : (
                                <>
                                    <AlertCircle className="w-4 h-4" />
                                    {testResult.error}
                                </>
                            )}
                        </div>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={handleTestConnection}
                            disabled={isTesting}
                            className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {isTesting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Testing Connection...
                                </>
                            ) : (
                                'Check Connection Status'
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* Allocation Config */}
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-800">
                <h3 className="text-lg font-bold mb-2">Allocation Configuration</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Configure your investment allocation targets and savings goals. This JSON defines the KPIs shown on the Savings overview.
                </p>

                <div className="space-y-4">
                    {isLoadingConfig ? (
                        <div className="flex items-center justify-center p-8 border border-gray-300 dark:border-zinc-600 rounded-lg">
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                        </div>
                    ) : (
                        <textarea
                            value={allocationJson}
                            onChange={(e) => {
                                setAllocationJson(e.target.value);
                                setAllocationError(null);
                            }}
                            rows={16}
                            className="w-full p-3 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 font-mono text-xs resize-y"
                            spellCheck={false}
                        />
                    )}

                    {allocationError && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
                            <AlertCircle className="w-4 h-4" />
                            {allocationError}
                        </div>
                    )}

                    {allocationSaved && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 text-sm">
                            <Check className="w-4 h-4" />
                            Allocation config saved!
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            onClick={handleSaveAllocation}
                            disabled={isSaving || isLoadingConfig}
                            className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {isSaving ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                'Save Allocation Config'
                            )}
                        </button>
                        <button
                            onClick={handleResetAllocation}
                            disabled={isSaving}
                            className="px-4 py-2 bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                        >
                            Reset to Default
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
