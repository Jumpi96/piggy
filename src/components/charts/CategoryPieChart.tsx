import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import type { CategoryData } from '../../lib/chartUtils';
import { cn } from '../../lib/utils';

interface Props {
  data: CategoryData[];
  onSliceClick?: (category: string) => void;
  selectedCategory?: string | null;
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

const CustomLegend = ({ payload }: any) => {
  return (
    <div className="flex flex-wrap justify-center gap-3 mt-4">
      {payload.map((entry: any, index: number) => (
        <div key={`legend-${index}`} className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-xs text-zinc-600 dark:text-zinc-300 font-medium">
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export function CategoryPieChart({ data, onSliceClick, selectedCategory }: Props) {
  if (data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-zinc-400">
        No category data available
      </div>
    );
  }

  const handleClick = (data: CategoryData) => {
    if (onSliceClick) {
      // Toggle selection: if clicking the same category, deselect it
      if (selectedCategory === data.name) {
        onSliceClick(null as any);
      } else {
        onSliceClick(data.name);
      }
    }
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="45%"
          labelLine={false}
          label={({ name, percent }) => `${name} ${percent ? (percent * 100).toFixed(0) : 0}%`}
          outerRadius={80}
          dataKey="value"
          onClick={handleClick}
          className="cursor-pointer outline-none"
        >
          {data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.color}
              opacity={selectedCategory && selectedCategory !== entry.name ? 0.3 : 1}
              stroke={selectedCategory === entry.name ? '#000' : 'none'}
              strokeWidth={selectedCategory === entry.name ? 2 : 0}
              className={cn(
                "transition-opacity duration-200",
                selectedCategory && selectedCategory !== entry.name && "opacity-30"
              )}
            />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend content={<CustomLegend />} />
      </PieChart>
    </ResponsiveContainer>
  );
}
