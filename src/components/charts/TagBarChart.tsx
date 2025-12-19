import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { TagData } from '../../lib/chartUtils';

interface Props {
  data: TagData[];
  direction: 'income' | 'expense';
}

const formatUSD = (cents: number) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload.length) return null;

  const data = payload[0].payload;
  return (
    <div className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg p-3">
      <p className="font-semibold text-sm text-zinc-900 dark:text-white">{data.name}</p>
      <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1">
        Amount: <span className="font-mono font-bold">{formatUSD(data.value)}</span>
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {data.count} transaction{data.count !== 1 ? 's' : ''}
      </p>
    </div>
  );
};

export function TagBarChart({ data, direction }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-zinc-400">
        No tag data available
      </div>
    );
  }

  // Determine bar color based on direction
  const getBarColor = () => {
    if (direction === 'income') return '#0ea5e9'; // sky-500
    if (direction === 'expense') return '#ef4444'; // red-500
    return '#10b981'; // emerald-500
  };

  // Custom tick component to handle text wrapping/truncation
  const CustomYAxisTick = ({ x, y, payload }: any) => {
    const maxLength = 15;
    const text = payload.value;
    const displayText = text.length > maxLength ? text.substring(0, maxLength) + '...' : text;

    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={0}
          dy={4}
          textAnchor="end"
          fill="currentColor"
          fontSize={11}
          className="fill-zinc-600 dark:fill-zinc-300"
        >
          {displayText}
        </text>
      </g>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          className="stroke-zinc-200 dark:stroke-zinc-700"
        />
        <XAxis
          type="number"
          tickFormatter={(value) => formatUSD(value)}
          style={{ fontSize: '11px' }}
          stroke="currentColor"
          tick={{ fill: 'currentColor' }}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          interval={0}
          stroke="currentColor"
          tick={<CustomYAxisTick />}
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar
          dataKey="value"
          fill={getBarColor()}
          radius={[0, 4, 4, 0]}
          maxBarSize={30}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
