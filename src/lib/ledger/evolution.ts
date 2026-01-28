import {
    Decimal,
    type ParsedLedger,
    type EvolutionData,
    type SimplePrice,
} from './types';
import { toUSD, computeBalances } from './balances';

// Generate a list of dates between start and end (inclusive)
function generateDateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const start = new Date(startDate.replace(/\//g, '-'));
    const end = new Date(endDate.replace(/\//g, '-'));

    const current = new Date(start);
    while (current <= end) {
        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');
        const day = String(current.getDate()).padStart(2, '0');
        dates.push(`${year}/${month}/${day}`);
        current.setDate(current.getDate() + 1);
    }

    return dates;
}

// Normalize date to YYYY/MM/DD format
function normalizeDate(date: string): string {
    return date.replace(/-/g, '/');
}

// Get top-level account (e.g., "Assets" from "Assets:Bank:Checking")
function getTopLevelAccount(account: string): string {
    return account.split(':')[0];
}

// Get second-level account (e.g., "Assets:Bank" from "Assets:Bank:Checking")
function getSecondLevelAccount(account: string): string {
    const parts = account.split(':');
    return parts.slice(0, Math.min(2, parts.length)).join(':');
}

// Get full account name, cleaned (remove "Assets:" and numeric prefixes)
function getFullAccount(account: string): string {
    return account
        .replace('Assets:', '')
        .replace(/^\d+_/, '');
}

// Check if account matches a filter prefix (wildcard matching)
function matchesAccountFilter(account: string, filter: string | null): boolean {
    if (!filter) return true;
    return account.startsWith(filter);
}

// Compute daily balances over a date range using computeBalances
export function computeEvolution(
    parsed: ParsedLedger,
    prices: SimplePrice[],
    startDate: string,
    endDate: string,
    groupByLevel: 'top' | 'second' | 'full' = 'full',
    accountFilter: string | null = null
): EvolutionData {
    const dates = generateDateRange(normalizeDate(startDate), normalizeDate(endDate));

    // Group accounts for display
    const getGroupKey = groupByLevel === 'top'
        ? getTopLevelAccount
        : groupByLevel === 'second'
            ? getSecondLevelAccount
            : getFullAccount;

    const allGroups = new Set<string>();
    const dailyValues = new Map<string, Map<string, Decimal>>();
    const dailyTotals = new Map<string, Decimal>();

    // Sample every 7 days to improve performance, interpolate between
    const sampleInterval = 7;

    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const dateStr = date.replace(/\//g, '-');

        // Only compute every 7 days, or first/last
        if (i % sampleInterval !== 0 && i !== dates.length - 1) {
            continue;
        }

        // Use the same computeBalances function that works for Overview
        const balances = computeBalances(parsed, prices, dateStr);

        const groupedValues = new Map<string, Decimal>();
        let total = new Decimal(0);

        for (const balance of balances) {
            if (!balance.account.startsWith('Assets:')) continue;
            if (!matchesAccountFilter(balance.account, accountFilter)) continue;

            const groupKey = getGroupKey(balance.account);
            const usdValue = balance.usdValue;

            const current = groupedValues.get(groupKey) ?? new Decimal(0);
            groupedValues.set(groupKey, current.plus(usdValue));
            total = total.plus(usdValue);
            allGroups.add(groupKey);
        }

        dailyValues.set(date, groupedValues);
        dailyTotals.set(date, total);
    }

    // Fill in skipped dates with previous values (step interpolation)
    let lastValues: Map<string, Decimal> | null = null;
    let lastTotal = new Decimal(0);
    for (const date of dates) {
        if (dailyValues.has(date)) {
            lastValues = dailyValues.get(date)!;
            lastTotal = dailyTotals.get(date)!;
        } else if (lastValues) {
            dailyValues.set(date, new Map(lastValues));
            dailyTotals.set(date, lastTotal);
        }
    }

    const series = new Map<string, Decimal[]>();
    for (const group of allGroups) {
        series.set(group, []);
    }

    const totals: Decimal[] = [];

    for (const date of dates) {
        const groupedValues = dailyValues.get(date)!;
        const total = dailyTotals.get(date)!;

        for (const group of allGroups) {
            const value = groupedValues.get(group) ?? new Decimal(0);
            series.get(group)!.push(value);
        }

        totals.push(total);
    }

    return { dates, series, totals };
}

// Compute growth breakdown: deposits vs appreciation
export interface GrowthBreakdown {
    dates: string[];
    deposits: Decimal[];
    appreciation: Decimal[];
    total: Decimal[];
}

export function computeGrowthBreakdown(
    parsed: ParsedLedger,
    prices: SimplePrice[],
    startDate: string,
    endDate: string,
    evolutionTotals?: Decimal[],  // Reuse totals from computeEvolution if provided
    accountFilter: string | null = null
): GrowthBreakdown {
    const dates = generateDateRange(normalizeDate(startDate), normalizeDate(endDate));

    // Track native balances per account per commodity
    // account -> commodity -> quantity
    const balances = new Map<string, Map<string, Decimal>>();

    // Sort transactions chronologically
    const sortedTxns = [...parsed.transactions].sort((a, b) => a.date.getTime() - b.date.getTime());

    // Track cumulative deposits (valued at deposit time) and appreciation
    let cumulativeDeposits = new Decimal(0);
    let cumulativeAppreciation = new Decimal(0);
    let prevTotalUSD = new Decimal(0);

    const depositsArr: Decimal[] = [];
    const appreciationArr: Decimal[] = [];
    const totalArr: Decimal[] = evolutionTotals ?? [];

    let txIndex = 0;

    for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const asOf = new Date(date.replace(/\//g, '-'));

        // Track day's deposits (changes in native balance * rate at deposit time)
        let dayDepositsUSD = new Decimal(0);

        // Process transactions up to this date
        while (txIndex < sortedTxns.length && sortedTxns[txIndex].date <= asOf) {
            const tx = sortedTxns[txIndex];
            const txDateStr = `${tx.date.getFullYear()}/${String(tx.date.getMonth() + 1).padStart(2, '0')}/${String(tx.date.getDate()).padStart(2, '0')}`;

            for (const p of tx.postings) {
                const account = typeof p.account === 'string' ? p.account : p.account.name;

                // Only track Assets accounts
                if (!account.startsWith('Assets:')) continue;
                if (!matchesAccountFilter(account, accountFilter)) continue;

                const commodity = p.amount?.commodity ?? '$';
                const rawQuantity = p.amount?.quantity;
                const quantity = rawQuantity instanceof Decimal
                    ? rawQuantity
                    : new Decimal(rawQuantity ?? 0);

                // Update native balance
                if (!balances.has(account)) {
                    balances.set(account, new Map());
                }
                const accountBalances = balances.get(account)!;
                const current = accountBalances.get(commodity) ?? new Decimal(0);
                accountBalances.set(commodity, current.plus(quantity));

                // Record deposit/withdrawal valued at transaction date
                const depositUSD = toUSD(quantity, commodity, prices, txDateStr);
                dayDepositsUSD = dayDepositsUSD.plus(depositUSD);
            }
            txIndex++;
        }

        cumulativeDeposits = cumulativeDeposits.plus(dayDepositsUSD);

        // Get current total USD value (from evolution totals for consistency)
        const currentTotalUSD = totalArr[i] ?? new Decimal(0);

        // Day's appreciation = change in total value - deposits
        const dayAppreciation = currentTotalUSD.minus(prevTotalUSD).minus(dayDepositsUSD);
        cumulativeAppreciation = cumulativeAppreciation.plus(dayAppreciation);

        depositsArr.push(cumulativeDeposits);
        appreciationArr.push(cumulativeAppreciation);

        prevTotalUSD = currentTotalUSD;
    }

    return {
        dates,
        deposits: depositsArr,
        appreciation: appreciationArr,
        total: totalArr,
    };
}

// Helper to convert evolution data to chart-friendly format
export function evolutionToChartData(evolution: EvolutionData): {
    labels: string[];
    datasets: { label: string; data: number[] }[];
} {
    // Include year to make labels unique (format: YY/MM/DD)
    const labels = evolution.dates.map(d => {
        const parts = d.split('/');
        return `${parts[0].slice(2)}/${parts[1]}/${parts[2]}`;
    });

    const datasets: { label: string; data: number[] }[] = [];
    const sortedSeries = [...evolution.series.entries()].sort((a, b) =>
        a[0].localeCompare(b[0])
    );

    for (const [name, values] of sortedSeries) {
        datasets.push({
            label: name,
            data: values.map(v => v.toNumber()),
        });
    }

    return { labels, datasets };
}

export function growthToChartData(growth: GrowthBreakdown): {
    labels: string[];
    datasets: { label: string; data: number[] }[];
} {
    // Include year to make labels unique (format: YY/MM/DD)
    const labels = growth.dates.map(d => {
        const parts = d.split('/');
        return `${parts[0].slice(2)}/${parts[1]}/${parts[2]}`;
    });

    return {
        labels,
        datasets: [
            {
                label: 'Deposits',
                data: growth.deposits.map(v => v.toNumber()),
            },
            {
                label: 'Appreciation',
                data: growth.appreciation.map(v => v.toNumber()),
            },
        ],
    };
}
