import { useState, useEffect } from 'react';
import { fetchTransactionsRange, fetchParameters, fetchLatestRates } from '../lib/api';
import type { Transaction, Parameter, ExchangeRate } from '../types';
import { Loader2, Calendar, Wallet } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatLocalDate, formatLocalMonth, parseLocalDate } from '../lib/dates';

export function Balance() {
    // Default range: next month to +12 months
    const getInitialRange = () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 12, 1);
        const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0);

        return {
            from: formatLocalDate(start),
            to: formatLocalDate(lastDay)
        };
    };

    const [range, setRange] = useState(getInitialRange());
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const [apd, setApd] = useState<number>(0);
    const [latestRates, setLatestRates] = useState<ExchangeRate[]>([]);

    useEffect(() => {
        async function load() {
            setIsLoading(true);
            try {
                const [txs, params, rates] = await Promise.all([
                    fetchTransactionsRange(range.from, range.to),
                    fetchParameters() as Promise<Parameter[]>,
                    fetchLatestRates()
                ]);

                setTransactions(txs);
                setLatestRates(rates as ExchangeRate[]);
                const apdParam = params.find(p => p.key === 'amount_per_day');
                setApd(apdParam ? parseFloat(apdParam.value) : 0);
            } catch (err) {
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        }
        load();
    }, [range]);

    const formatUSD = (cents: number, isCents = true) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((isCents ? cents / 100 : cents));
    };

    // Monthly breakdown logic
    const monthlyData: Record<string, number> = {};
    let totalBalanceCents = 0;

    transactions.forEach(t => {
        const monthKey = t.date.substring(0, 7); // YYYY-MM (DB dates are strings)
        const rate = t.exchange_rate?.rate || 1;
        const amountCents = t.amount_cents / rate;
        const value = t.direction === 'income' ? amountCents : -amountCents;

        monthlyData[monthKey] = (monthlyData[monthKey] || 0) + value;
        totalBalanceCents += value;
    });

    const breakdown: { month: string; value: number }[] = [];
    const start = parseLocalDate(range.from);
    const end = parseLocalDate(range.to);

    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);

    while (current <= last) {
        const key = formatLocalMonth(current);

        // Calculate days in this month within the range
        const mStart = new Date(current.getFullYear(), current.getMonth(), 1);
        const mEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);

        const rStart = parseLocalDate(range.from);
        const rEnd = parseLocalDate(range.to);

        const actualStart = mStart > rStart ? mStart : rStart;
        const actualEnd = mEnd < rEnd ? mEnd : rEnd;

        // Reset to midnight for day calculation
        actualStart.setHours(0, 0, 0, 0);
        actualEnd.setHours(0, 0, 0, 0);

        const diffTime = Math.max(0, actualEnd.getTime() - actualStart.getTime());
        const daysInRange = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;

        const rawSum = monthlyData[key] || 0;
        const adjustedValue = rawSum - (apd * daysInRange * 100);

        breakdown.push({
            month: key,
            value: adjustedValue
        });
        current.setMonth(current.getMonth() + 1);
    }

    // Total days in range
    const totalDiffTime = Math.max(0, end.getTime() - start.getTime());
    const totalDaysInRange = Math.ceil(totalDiffTime / (1000 * 60 * 60 * 24)) + 1;
    const expectedDiff = totalBalanceCents - (apd * totalDaysInRange * 100);

    return (
        <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">Balance Report</h1>
                    <p className="text-sm text-gray-500 font-mono">
                        🐷 PERIOD: {range.from} to {range.to}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-zinc-800 p-3 rounded-xl shadow-sm border border-gray-100 dark:border-zinc-700">
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-gray-400 uppercase">From</label>
                        <input
                            type="month"
                            value={range.from.substring(0, 7)}
                            onChange={(e) => setRange(prev => ({ ...prev, from: `${e.target.value}-01` }))}
                            className="bg-transparent border-none p-0 text-sm font-bold focus:ring-0"
                        />
                    </div>
                    <div className="w-px h-4 bg-gray-200 dark:bg-zinc-700 hidden md:block" />
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-gray-400 uppercase">To</label>
                        <input
                            type="month"
                            value={range.to.substring(0, 7)}
                            onChange={(e) => {
                                const [y, m] = e.target.value.split('-');
                                const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
                                setRange(prev => ({ ...prev, to: `${e.target.value}-${lastDay}` }));
                            }}
                            className="bg-transparent border-none p-0 text-sm font-bold focus:ring-0"
                        />
                    </div>
                </div>
            </div>

            <div className="bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-wrap gap-x-8 gap-y-4 text-xs font-mono">
                <div className="flex items-center gap-2">
                    <span className="opacity-60">💳 Base: $; ApD:</span>
                    <span className="font-bold">{formatUSD(apd, false)}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="opacity-60">🔁 Rates:</span>
                    <span className="font-bold flex gap-3">
                        {latestRates.filter(r => r.currency_code !== 'USD').map(r => (
                            <span key={r.currency_code}>1 USD per {r.rate} {r.currency_code}</span>
                        ))}
                    </span>
                </div>
            </div>

            {isLoading ? (
                <div className="flex justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                </div>
            ) : (
                <>
                    <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-700 flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-zinc-400" />
                            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Monthly Breakdown</h3>
                        </div>
                        <div className="divide-y divide-gray-50 dark:divide-zinc-700/50">
                            {breakdown.map((item) => (
                                <div key={item.month} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-zinc-700/30 transition-colors">
                                    <span className="font-mono text-sm font-medium">{item.month}</span>
                                    <div className="flex items-center gap-4">
                                        <div className="w-32 h-1.5 bg-gray-100 dark:bg-zinc-700 rounded-full overflow-hidden hidden sm:block">
                                            <div
                                                className={cn("h-full rounded-full", item.value >= 0 ? "bg-sky-500" : "bg-red-500")}
                                                style={{ width: `${Math.min(100, (Math.abs(item.value) / 500000) * 100)}%` }} // Arbitrary 5k scale for visual
                                            />
                                        </div>
                                        <span className={cn("font-bold text-sm min-w-[100px] text-right", item.value >= 0 ? "text-sky-600" : "text-red-600")}>
                                            {formatUSD(item.value)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-white dark:bg-zinc-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 space-y-4">
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 text-zinc-500">
                                    <Wallet className="w-4 h-4" />
                                    <h3 className="text-xs font-bold uppercase tracking-wider">Your Current Situation</h3>
                                </div>
                                <p className={cn("text-3xl font-black", totalBalanceCents >= 0 ? "text-zinc-900 dark:text-white" : "text-red-600")}>
                                    {formatUSD(totalBalanceCents)}
                                </p>
                            </div>
                        </div>

                        <div className="bg-emerald-50/50 dark:bg-emerald-900/10 p-6 rounded-2xl border border-emerald-100 dark:border-emerald-900/30 flex flex-col justify-center items-center text-center space-y-2">
                            <h3 className="text-sm font-medium text-emerald-900 dark:text-emerald-300">
                                Comparing with what you expected to have:
                            </h3>
                            <p className={cn("text-4xl font-black", expectedDiff >= 0 ? "text-sky-600" : "text-red-600")}>
                                {formatUSD(expectedDiff)}
                            </p>
                            <p className="text-xs text-emerald-700/60 dark:text-emerald-400/60 max-w-[200px]">
                                (Total balance - (ApD * Total Days))
                            </p>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
