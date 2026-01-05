import { useState, useEffect, useMemo } from 'react';
import { fetchParameters, fetchLatestRates, fetchTransactions, upsertParameter, fetchCurrencies } from '../lib/api';
import type { ExchangeRate } from '../types';
import { Loader2, Plus, Trash2, Wallet, ArrowRightLeft, Settings2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatLocalDate } from '../lib/dates';

export function MoneyChecker() {
    const [accounts, setAccounts] = useState<Record<string, string>>({});
    const [accountValues, setAccountValues] = useState<Record<string, string>>({});
    const [latestRates, setLatestRates] = useState<ExchangeRate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expectedCash, setExpectedCash] = useState(0);
    const [availableCurrencies, setAvailableCurrencies] = useState<string[]>([]);

    // Management mode
    const [isManaging, setIsManaging] = useState(false);
    const [newAccountName, setNewAccountName] = useState('');
    const [newAccountCurrency, setNewAccountCurrency] = useState('ARS');

    useEffect(() => {
        async function load() {
            try {
                const [params, rates, currenciesData] = await Promise.all([
                    fetchParameters(),
                    fetchLatestRates(),
                    fetchCurrencies()
                ]);

                const accountsParam = params.find(p => p.key === 'money_accounts');
                if (accountsParam && typeof accountsParam.value === 'object') {
                    setAccounts(accountsParam.value);
                }

                setLatestRates(rates as ExchangeRate[]);
                setAvailableCurrencies(currenciesData.map(c => c.code));

                // Expected cash (same as Overview for current month until today)
                const today = new Date();
                const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
                const txs = await fetchTransactions(monthStr);
                const todayStr = formatLocalDate(today);

                const cashUntilToday = txs
                    .filter(t => t.date <= todayStr)
                    .reduce((acc, t) => {
                        const amount = t.amount_cents / (t.exchange_rate?.rate || 1);
                        return acc + (t.direction === 'income' ? amount : -amount);
                    }, 0);

                setExpectedCash(cashUntilToday / 100);
            } catch (err) {
                console.error("Failed to load Money Checker data", err);
            } finally {
                setIsLoading(false);
            }
        }
        load();
    }, []);

    const convertToUSD = (amount: number, currency: string) => {
        if (currency === 'USD') return amount;
        const rate = latestRates.find(r => r.currency_code === currency)?.rate || 1;
        return amount / rate;
    };

    const totalCountedUSD = useMemo(() => {
        return Object.entries(accountValues).reduce((acc, [name, val]) => {
            const amount = parseFloat(val) || 0;
            const currency = accounts[name] || 'ARS';
            return acc + convertToUSD(amount, currency);
        }, 0);
    }, [accountValues, accounts, latestRates]);

    const difference = totalCountedUSD - expectedCash;

    const handleAddAccount = async () => {
        if (!newAccountName) return;
        const updatedAccounts = { ...accounts, [newAccountName]: newAccountCurrency };
        try {
            await upsertParameter('money_accounts', updatedAccounts);
            setAccounts(updatedAccounts);
            setNewAccountName('');
        } catch (err) {
            console.error(err);
        }
    };

    const handleRemoveAccount = async (name: string) => {
        const { [name]: removed, ...rest } = accounts;
        try {
            await upsertParameter('money_accounts', rest);
            setAccounts(rest);
            // Also cleanup value if present
            const { [name]: valRemoved, ...restVals } = accountValues;
            setAccountValues(restVals);
        } catch (err) {
            console.error(err);
        }
    };

    const formatUSD = (val: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    };

    if (isLoading) {
        return (
            <div className="flex justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6 pb-24">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Wallet className="w-6 h-6 text-emerald-600" />
                        Money Checker
                    </h1>
                    <p className="text-sm text-gray-500">Reconcile your physical cash with the app</p>
                </div>
                <button
                    onClick={() => setIsManaging(!isManaging)}
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        isManaging ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    )}
                >
                    <Settings2 className="w-5 h-5" />
                </button>
            </div>

            {isManaging && (
                <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border-2 border-dashed border-emerald-200 dark:border-emerald-900/30 space-y-4 animate-in fade-in slide-in-from-top-2">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-600">Manage Accounts</h3>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Account Name (e.g. Santander)"
                            value={newAccountName}
                            onChange={e => setNewAccountName(e.target.value)}
                            className="flex-1 px-3 py-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm"
                        />
                        <select
                            value={newAccountCurrency}
                            onChange={e => setNewAccountCurrency(e.target.value)}
                            className="w-24 px-2 py-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg text-sm"
                        >
                            {availableCurrencies.map((c: string) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button
                            onClick={handleAddAccount}
                            className="p-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                        >
                            <Plus className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="space-y-2 max-h-48 overflow-y-auto">
                        {Object.entries(accounts).map(([name, currency]) => (
                            <div key={name} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-zinc-800/50 rounded-lg group">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">{name}</span>
                                    <span className="text-[10px] font-bold bg-gray-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-400">{currency}</span>
                                </div>
                                <button
                                    onClick={() => handleRemoveAccount(name)}
                                    className="p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-800 overflow-hidden">
                <div className="p-6 space-y-4">
                    {Object.entries(accounts).length === 0 ? (
                        <div className="text-center py-8 text-gray-400 italic">
                            No accounts defined. Click the settings icon to add some.
                        </div>
                    ) : (
                        Object.entries(accounts).map(([name, currency]) => (
                            <div key={name} className="flex items-center justify-between gap-4">
                                <div className="flex-1">
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">
                                        {name} ({currency})
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            placeholder="0.00"
                                            value={accountValues[name] || ''}
                                            onChange={e => setAccountValues({ ...accountValues, [name]: e.target.value })}
                                            className="w-full px-4 py-3 bg-gray-50 dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:outline-none transition-all font-mono"
                                        />
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">
                                            {formatUSD(convertToUSD(parseFloat(accountValues[name] || '0'), currency))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="bg-emerald-600 dark:bg-emerald-700 p-6 text-white space-y-4 border-t border-white/10">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-bold uppercase tracking-widest opacity-80">Total Counted Money</span>
                        <p className="text-3xl font-black">{formatUSD(totalCountedUSD)}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/20">
                        <div className="space-y-1">
                            <span className="text-[10px] font-black uppercase opacity-70 tracking-widest">Expected (Overview)</span>
                            <p className="text-xl font-bold">{formatUSD(expectedCash)}</p>
                        </div>
                        <div className="space-y-1 text-right">
                            <span className="text-[10px] font-black uppercase opacity-70 tracking-widest">Difference</span>
                            <div className="flex items-center justify-end gap-2">
                                <p className={cn(
                                    "text-xl font-bold",
                                    Math.abs(difference) < 0.1 ? "text-white" : difference > 0 ? "text-sky-200" : "text-amber-200"
                                )}>
                                    {difference > 0 ? '+' : ''}{formatUSD(difference)}
                                </p>
                                {Math.abs(difference) < 0.1 ? (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                                ) : (
                                    <AlertCircle className="w-4 h-4" />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
                <ArrowRightLeft className="w-5 h-5 text-emerald-600 shrink-0" />
                <p className="text-xs text-emerald-800 dark:text-emerald-400 italic">
                    All amounts are automatically converted to USD based on your latest exchange rates:
                    {latestRates.filter(r => r.currency_code !== 'USD').map(r => (
                        <span key={r.currency_code} className="ml-2 font-bold not-italic">1 USD = {r.rate} {r.currency_code}</span>
                    ))}
                </p>
            </div>
        </div>
    );
}
