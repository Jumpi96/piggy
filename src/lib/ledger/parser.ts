import {
    Transaction,
    Posting,
    Money,
    Price,
    Decimal,
    type ParsedLedger,
    type ValidationResult,
    type SimplePrice,
} from './types';
import { Parser } from 'grootboek/adapters/git';

interface ParserPosting {
    account: string;
    amount?: {
        quantity: string;
        commodity: string;
        isNegative: boolean;
    };
    comment?: string;
}

interface ParserTransaction {
    type: 'transaction';
    date: string;
    description: string;
    postings: ParserPosting[];
    comment?: string;
}

interface ParserPrice {
    type: 'price';
    date: string;
    baseCommodity: string;
    quoteCommodity: string;
    price: string;
}

function nodeToPosting(node: ParserPosting): Posting {
    if (!node.amount) {
        throw new Error('Posting must have an amount');
    }
    const quantity = new Decimal(node.amount.quantity);
    const finalQuantity = node.amount.isNegative ? quantity.negated() : quantity;
    return new Posting({
        account: node.account,
        amount: new Money({
            quantity: finalQuantity,
            commodity: node.amount.commodity
        }),
        comment: node.comment
    });
}

function nodeToTransaction(node: ParserTransaction): Transaction {
    const date = new Date(node.date.replace(/\//g, '-'));

    // Separate postings with and without amounts
    const postingsWithAmount = node.postings.filter((p) => p.amount);
    const postingsWithoutAmount = node.postings.filter((p) => !p.amount);

    if (postingsWithoutAmount.length > 1) {
        throw new Error('Only one posting may have an elided amount');
    }

    // Convert postings with explicit amounts
    const postings = postingsWithAmount.map((p) => nodeToPosting(p));

    // Calculate implicit amounts for the elided posting (if any)
    if (postingsWithoutAmount.length === 1) {
        const elidedPosting = postingsWithoutAmount[0];
        const commoditySums = new Map<string, Decimal>();

        for (const p of postings) {
            const current = commoditySums.get(p.commodity) ?? new Decimal(0);
            commoditySums.set(p.commodity, current.plus(p.quantity));
        }

        for (const [commodity, sum] of commoditySums) {
            if (!sum.isZero()) {
                postings.push(new Posting({
                    account: elidedPosting.account,
                    amount: new Money({
                        quantity: sum.negated(),
                        commodity
                    }),
                    comment: elidedPosting.comment
                }));
            }
        }
    }

    return new Transaction({
        date,
        description: node.description,
        postings,
        comment: node.comment,
        skipValidation: true
    });
}

// Parse the entire ledger content using grootboek Parser
export function parseLedger(content: string): ParsedLedger {
    const parser = new Parser();
    const { entries } = parser.parse(content);

    const transactions: Transaction[] = [];
    const prices: Price[] = [];
    const simplePrices: SimplePrice[] = [];
    const accounts = new Set<string>();
    const commodities = new Set<string>();

    for (const entry of entries) {
        if (entry.type === 'transaction') {
            try {
                const tx = nodeToTransaction(entry as ParserTransaction);
                transactions.push(tx);
                for (const account of tx.accounts) accounts.add(account);
                for (const commodity of tx.commodities) commodities.add(commodity);
            } catch (err) {
                console.warn(`Skipping invalid transaction: ${err}`);
            }
        } else if (entry.type === 'price') {
            try {
                const p = entry as ParserPrice;
                const price = new Price({
                    date: new Date(p.date.replace(/\//g, '-')),
                    baseCommodity: p.baseCommodity,
                    quoteCommodity: p.quoteCommodity,
                    price: new Decimal(p.price)
                });

                prices.push(price);

                // Also store as SimplePrice for reliable access
                simplePrices.push({
                    date: new Date(p.date.replace(/\//g, '-')),
                    commodity: p.baseCommodity,
                    priceUSD: new Decimal(p.price),
                });

                commodities.add(p.baseCommodity);
                commodities.add(p.quoteCommodity);
            } catch (err) {
                console.warn('Failed to parse price:', err);
            }
        }
    }

    return { transactions, prices, simplePrices, accounts, commodities };
}

// Validate ledger using grootboek's internal validation
export function validateLedger(parsed: ParsedLedger): ValidationResult {
    const errors: { lineNumber: number; message: string }[] = [];

    for (const tx of parsed.transactions) {
        if (!tx.isBalanced()) {
            errors.push({
                lineNumber: 0,
                message: `Transaction is not balanced: ${tx.description}`
            });
        }
    }

    return {
        isValid: errors.length === 0,
        errors: errors.map(e => ({ ...e, lineNumber: 0 }))
    };
}

// Format a transaction for appending to the ledger using JournalWriter
export interface FormPosting {
    account: string;
    amount?: {
        quantity: number | string;
        commodity: string;
    };
}

export function formatTransaction(
    date: string,
    description: string,
    postings: FormPosting[]
): string {
    // Format date as YYYY/MM/DD
    const formattedDate = date.replace(/-/g, '/');

    // Build transaction header
    let result = `${formattedDate} ${description}\n`;

    // Separate postings: elided first, then with amounts
    const withoutAmount = postings.filter(p => !p.amount);
    const withAmount = postings.filter(p => p.amount);

    // Find longest account name (only among postings with amounts, for alignment)
    const maxAccountLen = Math.max(...withAmount.map(p => p.account.length));
    const alignColumn = maxAccountLen + 4; // 4 spaces after longest account

    // Write elided postings first (no amount)
    for (const p of withoutAmount) {
        result += `  ${p.account}\n`;
    }

    // Write postings with amounts, aligned
    for (const p of withAmount) {
        const amount = p.amount!;
        const q = new Decimal(amount.quantity);
        let amountStr: string;

        if (amount.commodity === '$' || amount.commodity === 'USD') {
            // Format as $123.45 or -$123.45
            const sign = q.isNegative() ? '-' : '';
            amountStr = `${sign}$${q.abs().toFixed(2)}`;
        } else {
            // Format as COMMODITY QUANTITY (e.g., EUR 100.00)
            amountStr = `${amount.commodity} ${q.toString()}`;
        }

        const paddedAccount = p.account.padEnd(alignColumn);
        result += `  ${paddedAccount}${amountStr}\n`;
    }

    return result;
}

// Helper to format an amount for display
export function formatAmount(amount: { quantity: Decimal | number | string; commodity: string }): string {
    const quantity = new Decimal(amount.quantity);
    const commodity = amount.commodity;

    if (commodity === '$' || commodity === 'USD') {
        const sign = quantity.isNegative() ? '-' : '';
        return `${sign}$${quantity.abs().toFixed(2)}`;
    }

    return `${quantity.toString()} ${commodity}`;
}

// Get today's date in YYYY-MM-DD format
export function getTodayDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
