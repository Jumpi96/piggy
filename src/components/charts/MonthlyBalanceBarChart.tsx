import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { MonthlySummary } from '../../lib/annualReportUtils';

interface Props {
  data: MonthlySummary[];
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

export function MonthlyBalanceBarChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-zinc-400">
        No monthly data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={data}
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
        />
        <Bar
          dataKey="income"
          name="Income"
          fill="#0ea5e9"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="expense"
          name="Expenses"
          fill="#ef4444"
          radius={[4, 4, 0, 0]}
        />
        <Line
          type="monotone"
          dataKey="balance"
          name="Net Balance"
          stroke="#10b981"
          strokeWidth={3}
          dot={{ r: 5, fill: '#10b981' }}
          activeDot={{ r: 7 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
