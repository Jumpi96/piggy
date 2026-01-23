import {
    Decimal,
    BalanceCalculator,
    type ParsedLedger,
    type AccountBalance,
    type BalanceNode,
    type AllocationConfig,
    type SimplePrice,
} from './types';

// Convert a quantity to USD by finding the nearest price
export function toUSD(
    quantity: Decimal,
    commodity: string,
    prices: SimplePrice[],
    asOfDate?: string
): Decimal {
    // USD and $ are already in USD
    if (commodity === '$' || commodity === 'USD') {
        return quantity;
    }

    // Get all prices for this commodity
    const commodityPrices = prices.filter(p => p.commodity === commodity);

    if (commodityPrices.length === 0) {
        // No price found for this commodity at all
        return new Decimal(0);
    }

    const asOf = asOfDate ? new Date(asOfDate.replace(/\//g, '-')) : new Date();

    // Try to find price on or before asOfDate
    const pricesBefore = commodityPrices
        .filter(p => p.date <= asOf)
        .sort((a, b) => b.date.getTime() - a.date.getTime());

    if (pricesBefore.length > 0) {
        return quantity.times(pricesBefore[0].priceUSD);
    }

    // No price before asOfDate - use the earliest available price (forward fill)
    const sortedPrices = [...commodityPrices].sort((a, b) => a.date.getTime() - b.date.getTime());
    return quantity.times(sortedPrices[0].priceUSD);
}

// Compute account balances from parsed ledger using grootboek
export function computeBalances(
    parsed: ParsedLedger,
    prices: SimplePrice[],
    asOfDate?: string
): AccountBalance[] {
    const calc = new BalanceCalculator();

    // Pass asOfDate if provided (grootboek expects string YYYY-MM-DD or similar)
    const options = asOfDate ? { asOfDate: new Date(asOfDate) } : {};

    const balances = calc.calculateBalances(parsed.transactions, options);

    // Convert to our AccountBalance format and compute USD values
    return balances.map(b => {
        let usdValue = new Decimal(0);
        for (const [commodity, quantity] of b.positions) {
            usdValue = usdValue.plus(toUSD(quantity, commodity, prices, asOfDate));
        }

        return {
            account: b.account,
            balances: b.positions,
            usdValue
        };
    });
}

// Build a tree structure from account balances (Remains largely the same)
export function buildBalanceTree(balances: AccountBalance[]): BalanceNode {
    const root: BalanceNode = {
        name: '',
        fullPath: '',
        balances: new Map(),
        usdValue: new Decimal(0),
        children: new Map(),
    };

    for (const balance of balances) {
        const parts = balance.account.split(':');
        let current = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const fullPath = parts.slice(0, i + 1).join(':');

            if (!current.children.has(part)) {
                current.children.set(part, {
                    name: part,
                    fullPath,
                    balances: new Map(),
                    usdValue: new Decimal(0),
                    children: new Map(),
                });
            }

            current = current.children.get(part)!;
        }

        current.balances = new Map(balance.balances);
        current.usdValue = balance.usdValue;
    }

    function rollUp(node: BalanceNode): Decimal {
        let total = node.usdValue;
        for (const child of node.children.values()) {
            total = total.plus(rollUp(child));
        }
        node.usdValue = total;
        return total;
    }

    rollUp(root);
    return root;
}

// Match an account against a regex pattern
export function matchesPattern(account: string, pattern: string): boolean {
    try {
        const regex = new RegExp(`^${pattern}$`);
        return regex.test(account);
    } catch {
        return account.startsWith(pattern.replace('.*', ''));
    }
}

// Sum USD values for accounts matching any of the patterns
export function sumByPatterns(
    balances: AccountBalance[],
    patterns: string[]
): Decimal {
    let sum = new Decimal(0);

    for (const balance of balances) {
        for (const pattern of patterns) {
            if (matchesPattern(balance.account, pattern)) {
                sum = sum.plus(balance.usdValue);
                break;
            }
        }
    }

    return sum;
}

// Compute KPIs based on allocation config
export interface SavingsKPIs {
    totalAssets: Decimal;
    retirementAssets: Decimal;
    liabilities: Decimal;
    netWorth: Decimal;
    goals: Map<string, { current: Decimal; target: number; progress: number }>;
    allocations: Map<string, {
        current: Decimal;
        percentage: number;
        expected: number;
        splits?: Map<string, { current: Decimal; percentage: number; expected: number }>;
    }>;
    totalStocksPercentage: number;
    stocksExpected: number;
}

export function computeKPIs(
    balances: AccountBalance[],
    config: AllocationConfig
): SavingsKPIs {
    const totalAssets = balances
        .filter(b => b.account.startsWith('Assets:'))
        .reduce((sum, b) => sum.plus(b.usdValue), new Decimal(0));

    const retirementAssets = balances
        .filter(b => b.account.startsWith('Assets:3_Retirement:'))
        .reduce((sum, b) => sum.plus(b.usdValue), new Decimal(0));


    const liabilities = balances
        .filter(b => matchesPattern(b.account, config.liabilities_pattern) ||
            b.account.startsWith(config.liabilities_pattern))
        .reduce((sum, b) => sum.plus(b.usdValue.abs()), new Decimal(0));

    const netWorth = totalAssets.minus(liabilities);

    const goals = new Map<string, { current: Decimal; target: number; progress: number }>();
    for (const [name, goal] of Object.entries(config.goals)) {
        const current = balances
            .filter(b => matchesPattern(b.account, goal.pattern) ||
                b.account.startsWith(goal.pattern.replace('.*', '')))
            .reduce((sum, b) => sum.plus(b.usdValue), new Decimal(0));

        goals.set(name, {
            current,
            target: goal.target,
            progress: current.isZero() ? 0 : current.div(goal.target).times(100).toNumber(),
        });
    }

    const allocations = new Map<string, {
        current: Decimal;
        percentage: number;
        expected: number;
        splits?: Map<string, { current: Decimal; percentage: number; expected: number }>;
    }>();

    let totalStocksValue = new Decimal(0);

    for (const [name, category] of Object.entries(config.categories)) {
        const current = sumByPatterns(balances, category.patterns);
        const percentage = retirementAssets.isZero() ? 0 : current.div(retirementAssets).times(100).toNumber();

        if (name === 'main_stocks' || name === 'emergent_stocks' || name === 'crypto') {
            totalStocksValue = totalStocksValue.plus(current);
        }

        let splits: Map<string, { current: Decimal; percentage: number; expected: number }> | undefined;
        if (category.splits && category.splits.length > 0) {
            splits = new Map();
            for (const split of category.splits) {
                const splitCurrent = sumByPatterns(balances, [split.pattern]);
                const splitPercentage = current.isZero() ? 0 : splitCurrent.div(current).times(100).toNumber();
                splits.set(split.name, {
                    current: splitCurrent,
                    percentage: splitPercentage,
                    expected: split.expected_ratio * 100,
                });
            }
        }

        allocations.set(name, {
            current,
            percentage,
            expected: category.expected * 100,
            splits,
        });
    }

    const totalStocksPercentage = retirementAssets.isZero()
        ? 0
        : totalStocksValue.div(retirementAssets).times(100).toNumber();

    return {
        totalAssets,
        retirementAssets,
        liabilities,
        netWorth,
        goals,
        allocations,
        totalStocksPercentage,
        stocksExpected: config.expected * 100,
    };
}
