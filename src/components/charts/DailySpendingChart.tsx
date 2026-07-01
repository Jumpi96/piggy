import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { Transaction } from '../../types';
import { parseLocalDate, formatLocalDate } from '../../lib/dates';
import { buildDailySeries } from '../../lib/chartUtils';

interface Props {
    transactions: Transaction[];
    apd: number; // Amount per day in USD (not cents)
    periodStart?: string; // YYYY-MM-DD inclusive
    periodEnd?: string;   // YYYY-MM-DD exclusive
}

const formatUSD = (cents: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
};

const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0].payload;
    return (
        <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg p-3">
            <p className="font-semibold text-sm text-zinc-900 dark:text-white">
                {data.fullLabel}
            </p>
            <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1">
                Spent: <span className="font-mono font-bold">{formatUSD(data.amount)}</span>
            </p>
        </div>
    );
};

/**
 * DailySpendingChart - Shows daily spending excluding:
 * - Recurring rule transactions (even if modified)
 * - Credit card payments
 * - To-be-balanced expenses
 */
export function DailySpendingChart({ transactions, apd, periodStart, periodEnd }: Props) {
    // Filter transactions:
    // 1. Only expenses
    // 2. Exclude recurring rules (recurring_rule_id is set)
    // 3. Exclude credit card payments (payment_method === 'card' or credit_card_id is set)
    // 4. Exclude to-be-balanced transactions
    const filteredTransactions = transactions.filter(t =>
        t.direction === 'expense' &&
        !t.to_be_balanced &&
        !t.recurring_rule_id &&
        t.payment_method !== 'card' &&
        !t.credit_card_id &&
        !t.tag?.startsWith('Ahorro#')
    );

    // Group by the full date. A financial period can start on any day-of-month and thus
    // span two calendar months, so bucketing by day-of-month alone scrambles the timeline.
    const dailyMap = new Map<string, number>();
    filteredTransactions.forEach(t => {
        const amountInBaseCurrency = t.amount_cents / (t.exchange_rate?.rate || 1);
        dailyMap.set(t.date, (dailyMap.get(t.date) || 0) + amountInBaseCurrency);
    });

    if (transactions.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-sm text-zinc-400">
                No spending data available
            </div>
        );
    }

    // Resolve the period window. Prefer the explicit bounds passed in; otherwise fall back
    // to the span of the transactions themselves.
    const sortedDates = transactions.map(t => t.date).sort();
    const startStr = periodStart || sortedDates[0];
    let endExclStr = periodEnd;
    if (!endExclStr) {
        const last = parseLocalDate(sortedDates[sortedDates.length - 1]);
        last.setDate(last.getDate() + 1);
        endExclStr = formatLocalDate(last);
    }

    const chartData = buildDailySeries(dailyMap, startStr, endExclStr);
    const daysInRange = chartData.length;

    // Calculate ApD in cents for the reference line
    const apdCents = apd * 100;

    // If no spending at all after filtering
    if (filteredTransactions.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-sm text-zinc-400 flex-col gap-2">
                <span>No cash spending data</span>
                <span className="text-xs opacity-60 text-center">
                    Excludes: recurring rules, credit cards, to-be-balanced, savings
                </span>
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart
                data={chartData}
                margin={{ top: 10, right: 20, left: 10, bottom: 5 }}
            >
                <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-zinc-200 dark:stroke-zinc-700"
                    vertical={false}
                />
                <XAxis
                    dataKey="dayLabel"
                    style={{ fontSize: '10px' }}
                    stroke="currentColor"
                    tick={{ fill: 'currentColor' }}
                    tickLine={false}
                    interval={Math.ceil(daysInRange / 15)}
                />
                <YAxis
                    tickFormatter={(value) => formatUSD(value)}
                    style={{ fontSize: '10px' }}
                    stroke="currentColor"
                    tick={{ fill: 'currentColor' }}
                    tickLine={false}
                    axisLine={false}
                    width={70}
                />
                <Tooltip content={<CustomTooltip />} />

                {/* Reference line for ApD */}
                {apdCents > 0 && (
                    <ReferenceLine
                        y={apdCents}
                        stroke="#10b981"
                        strokeDasharray="5 5"
                        strokeWidth={2}
                        label={{
                            value: `ApD: ${formatUSD(apdCents)}`,
                            position: 'right',
                            fill: '#10b981',
                            fontSize: 10,
                            fontWeight: 600
                        }}
                    />
                )}

                {/* Line for daily spending */}
                <Line
                    type="monotone"
                    dataKey="amount"
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#f97316' }}
                    activeDot={{ r: 5 }}
                />
            </LineChart>
        </ResponsiveContainer>
    );
}
