import { useState, useEffect, useMemo } from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from 'recharts';
import { Loader2, Calendar, Search, Filter } from 'lucide-react';
import {
    type ParsedLedger,
    type SimplePrice,
    computeEvolution,
    computeGrowthBreakdown,
    evolutionToChartData,
    growthToChartData,
} from '../../lib/ledger';

interface Props {
    parsed: ParsedLedger;
    prices: SimplePrice[];
}

const COLORS = [
    '#10B981', // emerald
    '#3B82F6', // blue
    '#F59E0B', // amber
    '#EF4444', // red
    '#8B5CF6', // purple
    '#EC4899', // pink
    '#06B6D4', // cyan
    '#84CC16', // lime
];

const formatUSD = (value: number) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
};

// Get default date range (from 2018-01-01 to today)
function getDefaultDateRange(): { start: string; end: string } {
    const end = new Date();
    const year = end.getFullYear();
    const month = String(end.getMonth() + 1).padStart(2, '0');
    const day = String(end.getDate()).padStart(2, '0');

    return {
        start: '2018-01-01',
        end: `${year}-${month}-${day}`,
    };
}

// Extract unique account prefixes for filtering (Assets accounts only, up to 2 levels)
function getAccountPrefixes(accounts: Set<string>): string[] {
    const prefixes = new Set<string>();

    for (const account of accounts) {
        if (!account.startsWith('Assets:')) continue;

        const parts = account.split(':');
        // Add progressively deeper prefixes: Assets:X, Assets:X:Y, etc.
        for (let i = 2; i <= parts.length; i++) {
            prefixes.add(parts.slice(0, i).join(':'));
        }
    }

    return Array.from(prefixes).sort();
}

function AssetsEvolutionTab({ parsed, prices }: Props) {
    const defaults = getDefaultDateRange();
    const [startDate, setStartDate] = useState(defaults.start);
    const [endDate, setEndDate] = useState(defaults.end);
    const [accountFilter, setAccountFilter] = useState<string | null>(null);
    const [isComputing, setIsComputing] = useState(false);
    const [chartData, setChartData] = useState<any[] | null>(null);
    const [growthData, setGrowthData] = useState<any[] | null>(null);
    const [seriesNames, setSeriesNames] = useState<string[]>([]);

    // Memoize account prefixes for filter dropdown
    const accountPrefixes = useMemo(() => getAccountPrefixes(parsed.accounts), [parsed.accounts]);

    // Compute evolution data
    const compute = async () => {
        setIsComputing(true);

        // Use setTimeout to avoid blocking UI
        await new Promise(resolve => setTimeout(resolve, 0));

        try {
            const evolution = computeEvolution(parsed, prices, startDate, endDate, 'full', accountFilter);
            const { labels, datasets } = evolutionToChartData(evolution);

            // Transform to recharts format
            const data = labels.map((label, i) => {
                const point: Record<string, any> = { date: label };
                for (const ds of datasets) {
                    point[ds.label] = ds.data[i];
                }
                return point;
            });

            setChartData(data);
            setSeriesNames(datasets.map(d => d.label));

            // Compute growth breakdown, passing totals from evolution to ensure consistency
            const growth = computeGrowthBreakdown(parsed, prices, startDate, endDate, evolution.totals, accountFilter);
            const growthChart = growthToChartData(growth);

            const growthDataFormatted = growthChart.labels.map((label, i) => ({
                date: label,
                Deposits: growthChart.datasets[0].data[i],
                Appreciation: growthChart.datasets[1].data[i],
            }));

            setGrowthData(growthDataFormatted);

        } catch (err) {
            console.error('Failed to compute evolution:', err);
        } finally {
            setIsComputing(false);
        }
    };

    // Initial compute and whenever parsed/prices change
    useEffect(() => {
        compute();
    }, [parsed, prices]);

    // Find data point by date label
    const getDataPointByLabel = (label: string) => {
        return chartData?.find(d => d.date === label);
    };

    const CustomTooltip = ({ active, label }: any) => {
        if (!active || !label || !chartData) return null;

        // Find the data point directly from chartData by matching the date label
        const dataPoint = getDataPointByLabel(label);
        if (!dataPoint) return null;

        // Extract all account values directly from the data point (exclude 'date')
        const entries: { name: string; value: number; color: string }[] = [];
        let colorIndex = 0;
        for (const [key, value] of Object.entries(dataPoint)) {
            if (key === 'date') continue;
            if (typeof value === 'number' && value > 0) {
                entries.push({
                    name: key,
                    value,
                    color: COLORS[colorIndex % COLORS.length],
                });
            }
            colorIndex++;
        }

        // Sort by value descending, show top 15
        const sortedEntries = entries.sort((a, b) => b.value - a.value).slice(0, 15);
        if (sortedEntries.length === 0) return null;

        const total = entries.reduce((sum, e) => sum + e.value, 0);

        return (
            <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg p-3 text-sm max-h-96 overflow-y-auto">
                <p className="font-medium mb-1">{label}</p>
                <p className="text-xs text-gray-500 mb-2">Total: {formatUSD(total)}</p>
                {sortedEntries.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <span
                            className="w-3 h-3 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-gray-600 dark:text-gray-300 truncate max-w-32">{entry.name}:</span>
                        <span className="font-mono font-medium">{formatUSD(entry.value)}</span>
                    </div>
                ))}
                {entries.length > 15 && (
                    <p className="text-xs text-gray-400 mt-2">+{entries.length - 15} more</p>
                )}
            </div>
        );
    };

    // Tooltip for Growth Breakdown chart - shows deposits and appreciation with percentages
    const GrowthTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload || payload.length === 0) return null;

        const dataPoint = payload[0]?.payload;
        if (!dataPoint) return null;

        const deposits = dataPoint.Deposits ?? 0;
        const appreciation = dataPoint.Appreciation ?? 0;
        const total = deposits + appreciation;

        const depositsPercent = total > 0 ? (deposits / total) * 100 : 0;
        const appreciationPercent = total > 0 ? (appreciation / total) * 100 : 0;

        return (
            <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg p-3 text-sm">
                <p className="font-medium mb-1">{label}</p>
                <p className="text-xs text-gray-500 mb-2">Total: {formatUSD(total)}</p>
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: '#3B82F6' }} />
                        <span className="text-gray-600 dark:text-gray-300">Deposits:</span>
                        <span className="font-mono font-medium">{formatUSD(deposits)}</span>
                        <span className="text-gray-400">({depositsPercent.toFixed(1)}%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: '#10B981' }} />
                        <span className="text-gray-600 dark:text-gray-300">Appreciation:</span>
                        <span className="font-mono font-medium">{formatUSD(appreciation)}</span>
                        <span className="text-gray-400">({appreciationPercent.toFixed(1)}%)</span>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="bg-gray-50 dark:bg-zinc-800/50 p-4 rounded-lg space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {/* From Date */}
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" />
                            From
                        </label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm"
                        />
                    </div>

                    {/* To Date */}
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" />
                            To
                        </label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm"
                        />
                    </div>

                    {/* Account Filter */}
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                            <Filter className="w-3.5 h-3.5" />
                            Account
                        </label>
                        <select
                            value={accountFilter ?? ''}
                            onChange={(e) => setAccountFilter(e.target.value || null)}
                            className="w-full p-2 rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-sm"
                        >
                            <option value="">All Accounts</option>
                            {accountPrefixes.map((prefix) => (
                                <option key={prefix} value={prefix}>
                                    {prefix.replace('Assets:', '')}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Update Button */}
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-transparent select-none">Action</label>
                        <button
                            onClick={compute}
                            disabled={isComputing}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 text-sm font-medium"
                        >
                            {isComputing ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Search className="w-4 h-4" />
                            )}
                            {isComputing ? 'Computing...' : 'Update'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Loading */}
            {isComputing && (
                <div className="flex items-center justify-center p-12 bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                    <span className="ml-3 text-gray-500">Computing evolution...</span>
                </div>
            )}

            {/* Asset Evolution Chart */}
            {!isComputing && chartData && chartData.length > 0 && (
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-6">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-4">
                        Asset Evolution by Account
                    </h3>
                    <div className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-zinc-700" />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 10 }}
                                    interval="preserveStartEnd"
                                    className="text-gray-500"
                                />
                                <YAxis
                                    tickFormatter={(v) => formatUSD(v)}
                                    tick={{ fontSize: 10 }}
                                    className="text-gray-500"
                                />
                                <Tooltip content={<CustomTooltip />} />
                                {seriesNames.map((name, i) => (
                                    <Area
                                        key={name}
                                        type="monotone"
                                        dataKey={name}
                                        stackId="1"
                                        stroke={COLORS[i % COLORS.length]}
                                        fill={COLORS[i % COLORS.length]}
                                        fillOpacity={0.6}
                                    />
                                ))}
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Growth Breakdown Chart */}
            {!isComputing && growthData && growthData.length > 0 && (
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-6">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-4">
                        Growth Breakdown: Deposits vs Appreciation
                    </h3>
                    <div className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={growthData}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-zinc-700" />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 10 }}
                                    interval="preserveStartEnd"
                                    className="text-gray-500"
                                />
                                <YAxis
                                    tickFormatter={(v) => formatUSD(v)}
                                    tick={{ fontSize: 10 }}
                                    className="text-gray-500"
                                />
                                <Tooltip content={<GrowthTooltip />} />
                                <Legend />
                                <Area
                                    type="monotone"
                                    dataKey="Deposits"
                                    stackId="1"
                                    stroke="#3B82F6"
                                    fill="#3B82F6"
                                    fillOpacity={0.6}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="Appreciation"
                                    stackId="1"
                                    stroke="#10B981"
                                    fill="#10B981"
                                    fillOpacity={0.6}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Empty state */}
            {!isComputing && (!chartData || chartData.length === 0) && (
                <div className="text-center p-12 text-gray-500 bg-gray-50 dark:bg-zinc-900/50 rounded-2xl border-2 border-dashed border-gray-200 dark:border-zinc-800">
                    No evolution data available for the selected date range.
                </div>
            )}
        </div>
    );
}

export default AssetsEvolutionTab;
