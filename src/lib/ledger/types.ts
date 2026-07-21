import {
    Transaction,
    Posting,
    Money,
    Price,
    Decimal,
    BalanceCalculator
} from 'grootboek/core';

// Configure Decimal.js for financial precision
Decimal.set({
    precision: 20,
    rounding: Decimal.ROUND_HALF_UP,
});

export {
    Decimal,
    Transaction,
    Posting,
    Money,
    Price,
    BalanceCalculator
};

// Backward compatibility aliases
export type LedgerTransaction = Transaction;
export type Amount = Money;

// Simple price type for our own use (don't rely on grootboek Price internals)
export interface SimplePrice {
    date: Date;
    commodity: string;
    priceUSD: Decimal;
}

// Keep for backward compat but prefer SimplePrice
export type PriceDirective = Price;

// Allocation config for investment tracking
export interface AllocationSplit {
    name: string;
    pattern: string;
    expected_ratio: number;
}

export interface AllocationCategory {
    expected: number;
    patterns: string[];
    splits?: AllocationSplit[];
}

export interface AllocationGoal {
    target: number;
    pattern: string;
}

// A shorter-horizon fund (e.g. Ahorro #2, Ahorro #IIGG) with a target distribution
// across instruments. Actual holdings are matched by `pattern` and compared to
// `expected_ratio` to show how much of the target distribution is accomplished.
export interface FundSplit {
    name: string;           // instrument display name
    ticker: string;         // commodity/ticker symbol
    pattern: string;        // account pattern to match holdings
    expected_ratio: number; // 0..1 target share of the fund
    description?: string;   // optional asset-class note
}

export interface FundAllocation {
    label: string;
    subtitle: string;
    note: string;
    pattern: string;        // account prefix for the whole fund (used for its total)
    splits: FundSplit[];
}

export interface AllocationConfig {
    expected: number;
    categories: Record<string, AllocationCategory>;
    goals: Record<string, AllocationGoal>;
    funds?: Record<string, FundAllocation>;
    liabilities_pattern: string;
}

// Parsed ledger result from grootboek parser
export interface ParsedLedger {
    transactions: Transaction[];
    prices: Price[];
    simplePrices: SimplePrice[];
    accounts: Set<string>;
    commodities: Set<string>;
}

// Balance types
export interface AccountBalance {
    account: string;
    balances: Map<string, Decimal>; // commodity -> quantity
    usdValue: Decimal;
}

export interface BalanceNode {
    name: string;
    fullPath: string;
    balances: Map<string, Decimal>;
    usdValue: Decimal;
    children: Map<string, BalanceNode>;
}

// Evolution types for time series
export interface DailyBalance {
    date: string;
    balances: Map<string, Decimal>; // account -> USD value
    total: Decimal;
}

export interface EvolutionData {
    dates: string[];
    series: Map<string, Decimal[]>; // account -> daily values
    totals: Decimal[];
}

// Validation result
export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
}

export interface ValidationError {
    lineNumber: number;
    message: string;
    commodity?: string;
    imbalance?: Decimal;
}

// Default allocation config
export const DEFAULT_ALLOCATION_CONFIG: AllocationConfig = {
    expected: 0.89,
    categories: {
        main_stocks: {
            expected: 0.73,
            patterns: ["Assets:3_Retirement:.*:SPY", "Assets:3_Retirement:.*:VEA"],
            splits: [
                { name: "US main stocks", pattern: "Assets:3_Retirement:.*:SPY", expected_ratio: 0.7 },
                { name: "Ex-US main stocks", pattern: "Assets:3_Retirement:.*:VEA", expected_ratio: 0.3 }
            ]
        },
        emergent_stocks: {
            expected: 0.1,
            patterns: ["Assets:3_Retirement:.*:EEM"]
        },
        crypto: {
            expected: 0.05,
            patterns: ["Assets:3_Retirement:.*:BTC", "Assets:3_Retirement:.*:ETH"]
        },
        bonds: {
            expected: 0.12,
            patterns: [
                "Assets:3_Retirement:.*:PRGLBDB",
                "Assets:3_Retirement:.*:PRMCAPB"
            ],
            splits: [
                { name: "Global bonds", pattern: "Assets:3_Retirement:.*:PRGLBDB", expected_ratio: 0.6363636364 },
                { name: "ARG bonds", pattern: "Assets:3_Retirement:.*:PRMCAPB", expected_ratio: 0.3636363636 }
            ]
        },
        cash: {
            expected: 0.0,
            patterns: [
                "Assets:3_Retirement:ING:Savings",
                "Assets:3_Retirement:ING:CreditCard",
                "Assets:3_Retirement:MamaPapa",
                "Assets:3_Retirement:Santander:Checking",
                "Assets:3_Retirement:IOL:ARS",
                "Assets:3_Retirement:IOL:USD",
                "Assets:3_Retirement:Mattress"
            ]
        },
        real_estate: {
            expected: 0.0,
            patterns: [
                "Assets:3_Retirement:NonLiquid:LoteSantoDomingo"
            ]
        }
    },
    goals: {
        security: { target: 12000, pattern: "Assets:1_Security" },
        discretionary: { target: 9000, pattern: "Assets:0_Discretionary" }
    },
    funds: {
        ahorro_2: {
            label: "Ahorro #2",
            subtitle: "Short & medium term",
            note: "Distribution isn't critical, but aim for:",
            pattern: "Assets:2_BigItems",
            splits: [
                {
                    name: "IOL Dólar Ahorro Plus",
                    ticker: "IOLDOLD",
                    pattern: "Assets:2_BigItems:(.*:)?IOLDOLD",
                    expected_ratio: 0.7,
                    description: "USD / short-term USD fixed-income fund"
                },
                {
                    name: "Premier Renta Fija Ahorro",
                    ticker: "PRFAHOB",
                    pattern: "Assets:2_BigItems:(.*:)?PRFAHOB",
                    expected_ratio: 0.3,
                    description: "Inflation-linked pesos (CER/UVA)"
                }
            ]
        },
        ahorro_iigg: {
            label: "Ahorro #IIGG",
            subtitle: "IIGG fund",
            note: "Maintain:",
            pattern: "Assets:0_IIGG",
            splits: [
                {
                    name: "BONCER TZX27",
                    ticker: "TZX27",
                    pattern: "Assets:0_IIGG:(.*:)?TZX27",
                    expected_ratio: 0.8,
                    description: "Inflation-linked sovereign bond (CER, 2027)"
                },
                {
                    name: "IOL Cash Management",
                    ticker: "IOLCAMA",
                    pattern: "Assets:0_IIGG:(.*:)?IOLCAMA",
                    expected_ratio: 0.2,
                    description: "Money-market fund for immediate liquidity"
                }
            ]
        }
    },
    liabilities_pattern: "Liabilities"
};

// localStorage keys
export const ALLOCATION_CONFIG_KEY = 'piggy_savings_allocation';
