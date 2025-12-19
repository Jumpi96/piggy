import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { MonthlyExpenseData } from '../../lib/annualReportUtils';

interface Props {
  data: MonthlyExpenseData[];
}

const formatUSD = (cents: number) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
};

const formatMonth = (monthStr: string) => {
  // Convert YYYY-MM to short month name
  const [, month] = monthStr.split('-');
  const date = new Date(2024, parseInt(month, 10) - 1);
  return date.toLocaleDateString('en-US', { month: 'short' });
};

// Colors for each expense category
const categoryColors: Record<string, string> = {
  'Debts': '#dc2626',       // red-600
  'Investments': '#f59e0b', // amber-500
  'Living': '#ef4444',      // red-500
  'Recreation': '#f97316',  // orange-500
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg p-3">
      <p className="font-semibold text-sm text-zinc-900 dark:text-white mb-2">
        {formatMonth(label)}
      </p>
      {payload.map((entry: any, index: number) => (
        <p key={index} className="text-xs text-zinc-600 dark:text-zinc-300">
          <span className="font-medium" style={{ color: entry.color }}>
            {entry.name}:
          </span>{' '}
          <span className="font-mono font-bold">{formatUSD(entry.value)}</span>
        </p>
      ))}
    </div>
  );
};

export function MonthlyTrendsLineChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-zinc-400">
        No expense data available
      </div>
    );
  }

  // Transform data for Recharts format
  // From: [{month, categories: {Debts, Investments, ...}}]
  // To: [{month, Debts, Investments, Living, Recreation}]
  const chartData = data.map(item => ({
    month: item.month,
    Debts: item.categories.Debts || 0,
    Investments: item.categories.Investments || 0,
    Living: item.categories.Living || 0,
    Recreation: item.categories.Recreation || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={chartData}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-zinc-200 dark:stroke-zinc-700"
        />
        <XAxis
          dataKey="month"
          tickFormatter={formatMonth}
          style={{ fontSize: '12px' }}
          stroke="currentColor"
          tick={{ fill: 'currentColor' }}
        />
        <YAxis
          tickFormatter={(value) => formatUSD(value)}
          style={{ fontSize: '12px' }}
          stroke="currentColor"
          tick={{ fill: 'currentColor' }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: '12px' }}
          iconType="line"
        />
        <Line
          type="monotone"
          dataKey="Debts"
          stroke={categoryColors.Debts}
          strokeWidth={2}
          dot={{ r: 4 }}
          activeDot={{ r: 6 }}
        />
        <Line
          type="monotone"
          dataKey="Investments"
          stroke={categoryColors.Investments}
          strokeWidth={2}
          dot={{ r: 4 }}
          activeDot={{ r: 6 }}
        />
        <Line
          type="monotone"
          dataKey="Living"
          stroke={categoryColors.Living}
          strokeWidth={2}
          dot={{ r: 4 }}
          activeDot={{ r: 6 }}
        />
        <Line
          type="monotone"
          dataKey="Recreation"
          stroke={categoryColors.Recreation}
          strokeWidth={2}
          dot={{ r: 4 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
