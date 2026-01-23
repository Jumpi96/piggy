import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { TrendingUp, Target, Wallet, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { SavingsKPIs, AccountBalance } from '../../lib/ledger';

interface Props {
    kpis: SavingsKPIs;
    balances: AccountBalance[];
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

const formatUSD = (value: number | { toNumber: () => number }) => {
    const num = typeof value === 'number' ? value : value.toNumber();
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
};

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

interface ChartData {
    name: string;
    value: number;
    color: string;
    [key: string]: string | number;
}

export function OverviewTab({ kpis, balances }: Props) {
    // Prepare asset breakdown chart data - by individual account
    const assetBreakdown = useMemo(() => {
        const data: ChartData[] = [];

        for (const balance of balances) {
            if (!balance.account.startsWith('Assets:')) continue;
            const value = balance.usdValue.toNumber();
            if (value <= 0) continue;

            // Remove "Assets:" prefix and any numeric prefix like "0_", "1_", "3_"
            const name = balance.account
                .replace('Assets:', '')
                .replace(/^\d+_/, '');

            data.push({
                name,
                value,
                color: COLORS[data.length % COLORS.length],
            });
        }

        return data.sort((a, b) => b.value - a.value);
    }, [balances]);

    // Prepare retirement breakdown chart data
    const retirementBreakdown = useMemo(() => {
        const data: ChartData[] = [];
        let colorIndex = 0;

        for (const [name, alloc] of kpis.allocations) {
            if (alloc.current.toNumber() > 0) {
                data.push({
                    name: name.replace(/_/g, ' '),
                    value: alloc.current.toNumber(),
                    color: COLORS[colorIndex % COLORS.length],
                });
                colorIndex++;
            }
        }

        return data.sort((a, b) => b.value - a.value);
    }, [kpis.allocations]);

    const CustomTooltip = ({ active, payload }: any) => {
        if (!active || !payload || !payload.length) return null;
        const data = payload[0].payload;
        return (
            <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg p-3">
                <p className="font-semibold text-sm">{data.name}</p>
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                    {formatUSD(data.value)}
                </p>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* Hero KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Total Assets */}
                <div className="bg-emerald-50 dark:bg-emerald-900/20 p-4 rounded-xl border border-emerald-200 dark:border-emerald-800">
                    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 mb-1">
                        <Wallet className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Total Assets</span>
                    </div>
                    <p className="text-xl md:text-2xl font-bold text-emerald-900 dark:text-emerald-100">
                        {formatUSD(kpis.totalAssets)}
                    </p>
                </div>

                {/* Retirement */}
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 mb-1">
                        <TrendingUp className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Retirement</span>
                    </div>
                    <p className="text-xl md:text-2xl font-bold text-blue-900 dark:text-blue-100">
                        {formatUSD(kpis.retirementAssets)}
                    </p>
                </div>

                {/* Liabilities */}
                <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-xl border border-red-200 dark:border-red-800">
                    <div className="flex items-center gap-2 text-red-700 dark:text-red-300 mb-1">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Liabilities</span>
                    </div>
                    <p className="text-xl md:text-2xl font-bold text-red-900 dark:text-red-100">
                        {formatUSD(kpis.liabilities)}
                    </p>
                </div>

                {/* Net Worth */}
                <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-xl border border-purple-200 dark:border-purple-800">
                    <div className="flex items-center gap-2 text-purple-700 dark:text-purple-300 mb-1">
                        <Target className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">Net Worth</span>
                    </div>
                    <p className="text-xl md:text-2xl font-bold text-purple-900 dark:text-purple-100">
                        {formatUSD(kpis.netWorth)}
                    </p>
                </div>
            </div>

            {/* Goals Progress */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-6 space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Savings Goals
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Array.from(kpis.goals.entries()).map(([name, goal]) => (
                        <div key={name} className="space-y-2">
                            <div className="flex justify-between items-baseline">
                                <span className="text-sm font-medium capitalize">{name} Fund</span>
                                <span className="text-xs text-gray-500">
                                    {formatUSD(goal.current)} / {formatUSD(goal.target)}
                                </span>
                            </div>
                            <div className="h-3 bg-gray-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                                <div
                                    className={cn(
                                        "h-full rounded-full transition-all",
                                        goal.progress >= 100
                                            ? "bg-emerald-500"
                                            : goal.progress >= 75
                                                ? "bg-blue-500"
                                                : goal.progress >= 50
                                                    ? "bg-amber-500"
                                                    : "bg-red-500"
                                    )}
                                    style={{ width: `${Math.min(goal.progress, 100)}%` }}
                                />
                            </div>
                            <p className="text-xs text-gray-500 text-right">
                                {formatPercent(Math.min(goal.progress, 100))} complete
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Allocation Metrics */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-6 space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Retirement Allocation
                </h3>

                {/* Overall stocks allocation */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-zinc-800 rounded-lg">
                    <span className="font-medium">Total Stocks</span>
                    <div className="flex items-center gap-3">
                        <span className={cn(
                            "font-mono font-bold",
                            (() => {
                                const ratio = kpis.stocksExpected > 0 ? kpis.totalStocksPercentage / kpis.stocksExpected : 0;
                                if (ratio < 0.5) return "text-red-600";
                                if (ratio < 0.8) return "text-amber-600";
                                return "text-emerald-600";
                            })()
                        )}>
                            {formatPercent(kpis.totalStocksPercentage)}
                        </span>
                        <span className="text-xs text-gray-500">
                            (expected: {formatPercent(kpis.stocksExpected)})
                        </span>
                    </div>
                </div>

                {/* Category allocations */}
                <div className="space-y-3">
                    {Array.from(kpis.allocations.entries()).map(([name, alloc]) => (
                        <div key={name} className="space-y-1">
                            <div className="flex items-center justify-between">
                                <span className="text-sm capitalize">{name.replace(/_/g, ' ')}</span>
                                <div className="flex items-center gap-2">
                                    <span className={cn(
                                        "font-mono text-sm",
                                        (() => {
                                            const ratio = alloc.expected > 0 ? alloc.percentage / alloc.expected : 0;
                                            if (ratio < 0.5) return "text-red-600";
                                            if (ratio < 0.8) return "text-amber-600";
                                            return "text-emerald-600";
                                        })()
                                    )}>
                                        {formatPercent(alloc.percentage)}
                                    </span>
                                    <span className="text-xs text-gray-400">
                                        / {formatPercent(alloc.expected)}
                                    </span>
                                </div>
                            </div>
                            {/* Splits */}
                            {alloc.splits && (
                                <div className="ml-4 space-y-1">
                                    {Array.from(alloc.splits.entries()).map(([splitName, split]) => (
                                        <div key={splitName} className="flex items-center justify-between text-xs text-gray-500">
                                            <span>{splitName}</span>
                                            <span>
                                                {formatPercent(split.percentage)} / {formatPercent(split.expected)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Asset Breakdown */}
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-6">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-4">
                        Assets Breakdown
                    </h3>
                    {assetBreakdown.length > 0 ? (
                        <div className="flex items-start gap-4">
                            <div className="w-[180px] h-[180px] flex-shrink-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={assetBreakdown}
                                            cx="50%"
                                            cy="50%"
                                            outerRadius={80}
                                            dataKey="value"
                                        >
                                            {assetBreakdown.map((entry) => (
                                                <Cell key={entry.name} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<CustomTooltip />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex-1 text-xs space-y-1 max-h-[200px] overflow-y-auto">
                                <p className="text-gray-500 font-medium mb-2">Group</p>
                                {assetBreakdown.map((entry) => (
                                    <div key={entry.name} className="flex items-center gap-2">
                                        <span
                                            className="w-3 h-3 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: entry.color }}
                                        />
                                        <span className="text-gray-700 dark:text-gray-300 truncate">
                                            {entry.name}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="h-[180px] flex items-center justify-center text-gray-400">
                            No asset data
                        </div>
                    )}
                </div>

                {/* Retirement Breakdown */}
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 p-6">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-4">
                        Retirement Assets Breakdown
                    </h3>
                    {retirementBreakdown.length > 0 ? (
                        <div className="flex items-start gap-4">
                            <div className="w-[180px] h-[180px] flex-shrink-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={retirementBreakdown}
                                            cx="50%"
                                            cy="50%"
                                            outerRadius={80}
                                            dataKey="value"
                                        >
                                            {retirementBreakdown.map((entry) => (
                                                <Cell key={entry.name} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip content={<CustomTooltip />} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex-1 text-xs space-y-1 max-h-[200px] overflow-y-auto">
                                <p className="text-gray-500 font-medium mb-2">Group</p>
                                {retirementBreakdown.map((entry) => (
                                    <div key={entry.name} className="flex items-center gap-2">
                                        <span
                                            className="w-3 h-3 rounded-full flex-shrink-0"
                                            style={{ backgroundColor: entry.color }}
                                        />
                                        <span className="text-gray-700 dark:text-gray-300 truncate">
                                            {entry.name}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="h-[180px] flex items-center justify-center text-gray-400">
                            No retirement data
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
