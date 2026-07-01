import { useState, useEffect } from 'react';
import { fetchTransactionsRange, fetchParameters, fetchLatestRates } from '../lib/api';
import type { Transaction, Parameter, ExchangeRate } from '../types';
import { Loader2, Calendar, Wallet, PiggyBank } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatLocalDate, formatLocalMonth, parseLocalDate, getCurrentPeriodAnchor, getPeriodRange, getPeriodForDate, getPeriodLabel, getPeriodLabelMonth, anchorFromPeriodLabelMonth } from '../lib/dates';

import { useSyncData } from '../hooks/useSyncData';

// Distinct Tailwind color classes per Ahorro# tag, listed literally so Tailwind's JIT picks them up.
const AHORRO_TAG_COLORS = [
    { bar: 'bg-sky-500', dot: 'bg-sky-500' },
    { bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
    { bar: 'bg-violet-500', dot: 'bg-violet-500' },
    { bar: 'bg-amber-500', dot: 'bg-amber-500' },
    { bar: 'bg-rose-500', dot: 'bg-rose-500' },
    { bar: 'bg-fuchsia-500', dot: 'bg-fuchsia-500' },
    { bar: 'bg-lime-500', dot: 'bg-lime-500' },
    { bar: 'bg-indigo-500', dot: 'bg-indigo-500' },
];

export function Balance() {
    // Default range: next financial period through +12 periods
    const getInitialRange = () => {
        const base = getCurrentPeriodAnchor(); // 1st of the current period's anchor month
        const fromAnchor = formatLocalMonth(new Date(base.getFullYear(), base.getMonth() + 1, 1));
        const toAnchor = formatLocalMonth(new Date(base.getFullYear(), base.getMonth() + 12, 1));
        const { start } = getPeriodRange(fromAnchor);
        const { end } = getPeriodRange(toAnchor);
        const lastDay = parseLocalDate(end);
        lastDay.setDate(lastDay.getDate() - 1); // inclusive last day of the last period

        return {
            from: start,
            to: formatLocalDate(lastDay)
        };
    };

    const [range, setRange] = useState(getInitialRange());
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const [apd, setApd] = useState<number>(0);
    const [latestRates, setLatestRates] = useState<ExchangeRate[]>([]);

    // Subscribe to sync data
    const lastDataUpdate = useSyncData();

    useEffect(() => {
        async function load() {
            setIsLoading(true);
            try {
                // To ensure range.to inclusive for physical txs, we need to fetch until next day (exclusive)
                const end = parseLocalDate(range.to);
                const nextDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
                const rangeEndStr = formatLocalDate(nextDay);

                const [txs, params, rates] = await Promise.all([
                    fetchTransactionsRange(range.from, rangeEndStr),
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
    }, [range, lastDataUpdate]);

    const formatUSD = (cents: number, isCents = true) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((isCents ? cents / 100 : cents));
    };

    // Breakdown logic (grouped by financial period, keyed on the period anchor)
    const monthlyData: Record<string, number> = {};
    let totalBalanceCents = 0;

    transactions.forEach(t => {
        const monthKey = getPeriodForDate(t.date); // period anchor (YYYY-MM)
        const rate = t.exchange_rate?.rate || 1;
        const amountCents = t.amount_cents / rate;
        const value = t.direction === 'income' ? amountCents : -amountCents;

        monthlyData[monthKey] = (monthlyData[monthKey] || 0) + value;
        totalBalanceCents += value;
    });

    const breakdown: { month: string; label: string; actual: number; budget: number; value: number }[] = [];
    const rStart = parseLocalDate(range.from);
    const rEnd = parseLocalDate(range.to);

    // Iterate every financial period whose anchor falls within the selected range.
    const startAnchor = getPeriodForDate(range.from);
    const endAnchor = getPeriodForDate(range.to);
    let [cy, cm] = startAnchor.split('-').map(Number);
    const [ey, em] = endAnchor.split('-').map(Number);

    while (cy < ey || (cy === ey && cm <= em)) {
        const anchor = `${cy}-${String(cm).padStart(2, '0')}`;

        // Days of this period that fall inside the selected range.
        const { start: pStartStr, end: pEndExclStr } = getPeriodRange(anchor);
        const pStart = parseLocalDate(pStartStr);
        const pEnd = parseLocalDate(pEndExclStr);
        pEnd.setDate(pEnd.getDate() - 1); // inclusive last day

        const actualStart = pStart > rStart ? pStart : rStart;
        const actualEnd = pEnd < rEnd ? pEnd : rEnd;
        actualStart.setHours(0, 0, 0, 0);
        actualEnd.setHours(0, 0, 0, 0);

        const diffTime = Math.max(0, actualEnd.getTime() - actualStart.getTime());
        const daysInRange = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;

        const rawSum = monthlyData[anchor] || 0;
        const budgetCents = apd * daysInRange * 100;
        const adjustedValue = rawSum - budgetCents;

        breakdown.push({
            month: anchor,
            label: getPeriodLabel(anchor),
            actual: rawSum,
            budget: budgetCents,
            value: adjustedValue
        });

        cm += 1;
        if (cm > 12) { cm = 1; cy += 1; }
    }

    // Ahorro# breakdown: per-month + per-tag, signed so allocations (expenses) read positive.
    const ahorroByMonth: Record<string, Record<string, number>> = {};
    const ahorroTagSet = new Set<string>();
    for (const t of transactions) {
        if (!t.tag?.startsWith('Ahorro#')) continue;
        const monthKey = getPeriodForDate(t.date);
        const rate = t.exchange_rate?.rate || 1;
        const cents = t.amount_cents / rate;
        const value = t.direction === 'expense' ? cents : -cents;
        ahorroByMonth[monthKey] = ahorroByMonth[monthKey] || {};
        ahorroByMonth[monthKey][t.tag] = (ahorroByMonth[monthKey][t.tag] || 0) + value;
        ahorroTagSet.add(t.tag);
    }
    const ahorroTags = Array.from(ahorroTagSet).sort();
    const ahorroRows = breakdown.map(b => {
        const segments = ahorroTags.map(tag => ({ tag, value: ahorroByMonth[b.month]?.[tag] || 0 }));
        const total = segments.reduce((s, x) => s + x.value, 0);
        return { month: b.month, segments, total };
    });
    const ahorroTagTotals = ahorroTags.map(tag => ({
        tag,
        value: ahorroRows.reduce((s, r) => s + (r.segments.find(seg => seg.tag === tag)?.value || 0), 0),
    }));
    const ahorroGrandTotal = ahorroTagTotals.reduce((s, t) => s + t.value, 0);
    const ahorroMaxRowTotal = Math.max(0, ...ahorroRows.map(r => Math.abs(r.total)));

    // Total days in range
    const totalDiffTime = Math.max(0, rEnd.getTime() - rStart.getTime());
    const totalDaysInRange = Math.ceil(totalDiffTime / (1000 * 60 * 60 * 24)) + 1;
    const totalActual = totalBalanceCents;
    const totalBudget = apd * totalDaysInRange * 100;
    const expectedDiff = totalActual - totalBudget;

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
                            value={getPeriodLabelMonth(getPeriodForDate(range.from))}
                            onChange={(e) => {
                                if (!e.target.value) return;
                                const { start } = getPeriodRange(anchorFromPeriodLabelMonth(e.target.value));
                                setRange(prev => ({ ...prev, from: start }));
                            }}
                            className="bg-transparent border-none p-0 text-sm font-bold focus:ring-0"
                        />
                    </div>
                    <div className="w-px h-4 bg-gray-200 dark:bg-zinc-700 hidden md:block" />
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-gray-400 uppercase">To</label>
                        <input
                            type="month"
                            value={getPeriodLabelMonth(getPeriodForDate(range.to))}
                            onChange={(e) => {
                                if (!e.target.value) return;
                                const { end } = getPeriodRange(anchorFromPeriodLabelMonth(e.target.value));
                                const lastDay = parseLocalDate(end);
                                lastDay.setDate(lastDay.getDate() - 1); // inclusive last day of the period
                                setRange(prev => ({ ...prev, to: formatLocalDate(lastDay) }));
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
                                <div key={item.month} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-gray-50 dark:hover:bg-zinc-700/30 transition-colors gap-4">
                                    <div className="flex flex-col">
                                        <span className="font-mono text-sm font-bold">{item.label}</span>
                                        <div className="flex gap-3 text-[10px] whitespace-nowrap opacity-60 font-mono">
                                            <span>Actual: {formatUSD(item.actual)}</span>
                                            <span>Budget: -{formatUSD(item.budget)}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="w-32 h-1.5 bg-gray-100 dark:bg-zinc-700 rounded-full overflow-hidden hidden md:block">
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
                                    <h3 className="text-xs font-bold uppercase tracking-wider">Projected Cashflow Total</h3>
                                </div>
                                <p className={cn("text-3xl font-black", totalBalanceCents >= 0 ? "text-zinc-900 dark:text-white" : "text-red-600")}>
                                    {formatUSD(totalBalanceCents)}
                                </p>
                                <p className="text-[10px] text-zinc-400 font-mono">Sum of all incomes and expenses in this period</p>
                            </div>
                        </div>

                        <div className="bg-emerald-50/50 dark:bg-emerald-900/10 p-6 rounded-2xl border border-emerald-100 dark:border-emerald-900/30 flex flex-col justify-center items-center text-center space-y-2">
                            <h3 className="text-sm font-medium text-emerald-900 dark:text-emerald-300">
                                Adjusted vs. Your Expected Spend:
                            </h3>
                            <p className={cn("text-4xl font-black", expectedDiff >= 0 ? "text-sky-600" : "text-red-600")}>
                                {formatUSD(expectedDiff)}
                            </p>
                            <p className="text-xs text-emerald-700/60 dark:text-emerald-400/60 max-w-[200px]">
                                (Cashflow - (Daily Budget * Total Days))
                            </p>
                        </div>
                    </div>

                    {ahorroTags.length > 0 && (
                        <div className="bg-white dark:bg-zinc-800 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-700 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <PiggyBank className="w-4 h-4 text-zinc-400" />
                                    <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500">Savings Allocation</h3>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    {ahorroTags.map((tag, i) => (
                                        <div key={tag} className="flex items-center gap-1.5">
                                            <span className={cn("w-2 h-2 rounded-full", AHORRO_TAG_COLORS[i % AHORRO_TAG_COLORS.length].dot)} />
                                            <span className="text-[10px] font-mono opacity-70">{tag}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="divide-y divide-gray-50 dark:divide-zinc-700/50">
                                {ahorroRows.map(row => {
                                    const outerWidthPct = ahorroMaxRowTotal > 0
                                        ? Math.min(100, (Math.abs(row.total) / ahorroMaxRowTotal) * 100)
                                        : 0;
                                    const denom = row.segments.reduce((s, x) => s + Math.abs(x.value), 0);
                                    return (
                                        <div key={row.month} className="px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                            <span className="font-mono text-sm font-bold w-32 shrink-0">{getPeriodLabel(row.month)}</span>
                                            <div className="flex-1 flex items-center gap-3">
                                                <div className="flex-1 h-2 bg-gray-100 dark:bg-zinc-700 rounded-full overflow-hidden hidden md:block">
                                                    <div className="h-full flex" style={{ width: `${outerWidthPct}%` }}>
                                                        {row.segments.map((seg) => {
                                                            const segPct = denom > 0 ? (Math.abs(seg.value) / denom) * 100 : 0;
                                                            if (segPct === 0) return null;
                                                            const colorIdx = ahorroTags.indexOf(seg.tag) % AHORRO_TAG_COLORS.length;
                                                            return (
                                                                <div
                                                                    key={seg.tag}
                                                                    className={cn("h-full", AHORRO_TAG_COLORS[colorIdx].bar)}
                                                                    style={{ width: `${segPct}%` }}
                                                                    title={`${seg.tag}: ${formatUSD(seg.value)}`}
                                                                />
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                <span className={cn(
                                                    "font-bold text-sm min-w-[100px] text-right",
                                                    row.total >= 0 ? "text-zinc-900 dark:text-white" : "text-red-600"
                                                )}>
                                                    {formatUSD(row.total)}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="px-6 py-3 bg-zinc-50 dark:bg-zinc-900/30 border-t border-gray-100 dark:border-zinc-700 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono">
                                    {ahorroTagTotals.map((tt, i) => (
                                        <div key={tt.tag} className="flex items-center gap-1.5">
                                            <span className={cn("w-1.5 h-1.5 rounded-full", AHORRO_TAG_COLORS[i % AHORRO_TAG_COLORS.length].dot)} />
                                            <span className="opacity-60">{tt.tag}:</span>
                                            <span className="font-bold">{formatUSD(tt.value)}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="text-sm">
                                    <span className="opacity-60 font-mono text-xs mr-1">TOTAL</span>
                                    <span className={cn("font-bold", ahorroGrandTotal >= 0 ? "text-emerald-600" : "text-red-600")}>
                                        {formatUSD(ahorroGrandTotal)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
