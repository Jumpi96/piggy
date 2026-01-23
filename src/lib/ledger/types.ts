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

export interface AllocationConfig {
    expected: number;
    categories: Record<string, AllocationCategory>;
    goals: Record<string, AllocationGoal>;
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
        }
    },
    goals: {
        security: { target: 12000, pattern: "Assets:1_Security" },
        discretionary: { target: 8000, pattern: "Assets:0_Discretionary" }
    },
    liabilities_pattern: "Liabilities"
};

// localStorage keys
export const ALLOCATION_CONFIG_KEY = 'piggy_savings_allocation';
