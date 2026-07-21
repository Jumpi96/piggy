import { supabase } from '../supabase';
import { fetchParameters, upsertParameter } from '../api';
import {
    type AllocationConfig,
    DEFAULT_ALLOCATION_CONFIG,
} from './types';

const ALLOCATION_CONFIG_KEY = 'savings_allocation_config';

// Allocation config storage using parameters API
export async function getAllocationConfig(): Promise<AllocationConfig> {
    try {
        const params = await fetchParameters();
        const param = params.find(p => p.key === ALLOCATION_CONFIG_KEY);
        if (!param) return DEFAULT_ALLOCATION_CONFIG;
        return param.value as AllocationConfig;
    } catch {
        return DEFAULT_ALLOCATION_CONFIG;
    }
}

export async function saveAllocationConfig(config: AllocationConfig): Promise<void> {
    await upsertParameter(ALLOCATION_CONFIG_KEY, config);
}

// Edge function calls
export async function readLedger(): Promise<string> {
    const { data, error } = await supabase.functions.invoke('read-ledger', {
        body: {}, // No longer needs config in body
    });

    if (error) {
        throw new Error(`Failed to read ledger: ${error.message}`);
    }

    if (!data?.content) {
        throw new Error('No content returned from ledger');
    }

    return data.content;
}

export async function commitLedger(content: string, message: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke('commit-ledger', {
        body: {
            content,
            message,
        },
    });

    if (error) {
        throw new Error(`Failed to commit ledger: ${error.message}`);
    }

    if (!data?.success) {
        throw new Error('Commit operation did not return success');
    }
}

// Append a transaction to the ledger
export async function appendTransaction(
    currentContent: string,
    newTransaction: string,
    description: string
): Promise<string> {
    // Ensure content ends with newline before appending
    const normalizedContent = currentContent.endsWith('\n')
        ? currentContent
        : currentContent + '\n';

    const updatedContent = normalizedContent + '\n' + newTransaction;

    const commitMessage = `Add transaction: ${description}`;
    await commitLedger(updatedContent, commitMessage);

    return updatedContent;
}

// Normalize string for comparison (trim, collapse whitespace)
function normalizeForComparison(str: string): string {
    return str.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Find transaction boundaries in raw content
// Returns the start/end character indices and original text
export function findTransactionInContent(
    content: string,
    targetDate: string,  // YYYY/MM/DD format
    targetDescription: string
): { startIndex: number; endIndex: number; originalText: string } | null {
    const lines = content.split('\n');
    let charIndex = 0;

    const normalizedTargetDesc = normalizeForComparison(targetDescription);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineStart = charIndex;

        // Match transaction header: "YYYY/MM/DD Description" (possibly with comment)
        const headerMatch = line.match(/^(\d{4}\/\d{2}\/\d{2})\s+(.+?)(?:\s*;.*)?$/);
        if (headerMatch) {
            const [, dateStr, desc] = headerMatch;
            const normalizedDesc = normalizeForComparison(desc);

            // Compare dates and normalized descriptions
            if (dateStr === targetDate && normalizedDesc === normalizedTargetDesc) {
                // Found the transaction, now find where it ends
                let endLine = i + 1;

                // Collect posting lines (indented with spaces) and blank lines within
                while (endLine < lines.length) {
                    const nextLine = lines[endLine];
                    // Stop at next transaction header or non-posting content
                    if (nextLine.match(/^\d{4}\/\d{2}\/\d{2}\s/) || // next transaction
                        nextLine.match(/^P\s+\d{4}/) || // price directive
                        (nextLine.trim() !== '' && !nextLine.startsWith('  '))) { // other content
                        break;
                    }
                    endLine++;
                }

                // Calculate end character index
                let endIndex = lineStart;
                for (let j = i; j < endLine; j++) {
                    endIndex += lines[j].length + 1; // +1 for newline
                }

                const originalText = lines.slice(i, endLine).join('\n');
                return { startIndex: lineStart, endIndex, originalText };
            }
        }

        charIndex += line.length + 1; // +1 for newline
    }

    // Debug: if not found, log what we were looking for and show found transactions
    console.warn(`Transaction not found: "${targetDate}" "${targetDescription}"`);
    console.warn('Looking for normalized:', normalizedTargetDesc);

    // Log all transaction headers found for debugging
    const foundHeaders: string[] = [];
    for (const line of lines) {
        const match = line.match(/^(\d{4}\/\d{2}\/\d{2})\s+(.+?)(?:\s*;.*)?$/);
        if (match) {
            foundHeaders.push(`${match[1]} | "${match[2]}" | normalized: "${normalizeForComparison(match[2])}"`);
        }
    }
    console.warn('Last 20 transaction headers:', foundHeaders.slice(-20)); // Show last 20 (newest)

    // Also search for any line containing the target date
    const matchingDateLines = lines.filter(l => l.includes(targetDate));
    console.warn(`Lines containing "${targetDate}":`, matchingDateLines);

    return null;
}

// Edit a transaction in the ledger
export async function editTransaction(
    currentContent: string,
    oldDate: string,
    oldDescription: string,
    newTxStr: string,
    commitMessage: string
): Promise<string> {
    const found = findTransactionInContent(currentContent, oldDate, oldDescription);

    if (!found) {
        throw new Error(`Transaction not found: ${oldDate} ${oldDescription}`);
    }

    // Replace the old transaction with the new one
    const before = currentContent.slice(0, found.startIndex);
    const after = currentContent.slice(found.endIndex);

    // Ensure proper spacing
    const updatedContent = before + newTxStr + (newTxStr.endsWith('\n') ? '' : '\n') + after;

    await commitLedger(updatedContent, commitMessage);
    return updatedContent;
}

// Delete a transaction from the ledger
export async function deleteTransaction(
    currentContent: string,
    targetDate: string,
    targetDescription: string,
    commitMessage: string
): Promise<string> {
    const found = findTransactionInContent(currentContent, targetDate, targetDescription);

    if (!found) {
        throw new Error(`Transaction not found: ${targetDate} ${targetDescription}`);
    }

    // Remove the transaction
    const before = currentContent.slice(0, found.startIndex);
    const after = currentContent.slice(found.endIndex);

    // Clean up extra blank lines
    const updatedContent = (before + after).replace(/\n{3,}/g, '\n\n');

    await commitLedger(updatedContent, commitMessage);
    return updatedContent;
}

// Editable transaction format for the UI
export interface EditableTransaction {
    index: number;
    date: string;        // YYYY/MM/DD format for lookup
    dateInput: string;   // YYYY-MM-DD format for input fields
    description: string;
    postings: Array<{ account: string; amountStr: string }>;
}

// Minimal posting shape needed for editing. Structurally satisfied by grootboek's
// Posting (account: Account has `.name`; amount: Money has `.commodity`/`.quantity`).
interface EditingPosting {
    account: string | { name: string };
    amount?: {
        commodity?: string;
        quantity?: { toString(): string };
    };
}

// Get transactions sorted by date (newest first) for editing
export function getTransactionsForEditing(
    transactions: Array<{ date: Date; description: string; postings: readonly EditingPosting[] }>
): EditableTransaction[] {
    // Sort by date descending (newest first)
    const sorted = [...transactions].sort((a, b) => b.date.getTime() - a.date.getTime());

    return sorted.map((tx, index) => {
        // Use UTC to avoid timezone issues (dates are stored as midnight UTC)
        const year = tx.date.getUTCFullYear();
        const month = String(tx.date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(tx.date.getUTCDate()).padStart(2, '0');

        return {
            index,
            date: `${year}/${month}/${day}`,
            dateInput: `${year}-${month}-${day}`,
            description: tx.description,
            postings: tx.postings.map(p => {
                const account = typeof p.account === 'string' ? p.account : p.account.name;
                let amountStr = '';

                if (p.amount) {
                    const commodity = p.amount.commodity ?? '$';
                    const quantity = p.amount.quantity?.toString() ?? '0';

                    if (commodity === '$') {
                        // Format as $XXX.XX
                        const num = parseFloat(quantity);
                        if (num < 0) {
                            amountStr = `-$${Math.abs(num).toFixed(2)}`;
                        } else {
                            amountStr = `$${num.toFixed(2)}`;
                        }
                    } else {
                        // Format as "quantity commodity"
                        amountStr = `${quantity} ${commodity}`;
                    }
                }

                return { account, amountStr };
            }),
        };
    });
}

// ===== Price directives =====

// Matches a price line: "P YYYY/MM/DD COMMODITY $ PRICE" (the "$" and its spacing
// are optional so hand-edited lines still parse).
const PRICE_LINE_RE = /^P\s+(\d{4})\/(\d{2})\/(\d{2})\s+(\S+)\s+\$?\s*(-?[\d.]+)\s*$/;

// Editable price format for the UI. `originalLine` is the exact raw line, used to
// locate the directive unambiguously for edit/delete (avoids substring collisions).
export interface EditablePrice {
    index: number;
    date: string;         // YYYY/MM/DD
    dateInput: string;    // YYYY-MM-DD for <input type="date">
    commodity: string;
    price: string;        // numeric string
    originalLine: string;
}

// Format a single price directive line for the ledger.
export function formatPriceLine(dateInput: string, commodity: string, price: string): string {
    const formattedDate = dateInput.replace(/-/g, '/');
    return `P ${formattedDate} ${commodity.trim()} $ ${price.trim()}`;
}

// Insert price directives into the ledger keeping it in chronological order.
// Ledger processing expects entries ordered by date; appending a (possibly
// back-dated) price at the end breaks that ordering, so place the block right
// before the first entry dated strictly after `dateInput` (append if none).
export function insertPricesInOrder(
    content: string,
    dateInput: string,
    priceLines: string[]
): string {
    const block = priceLines.filter(l => l.trim());
    if (block.length === 0) return content;

    const targetDate = dateInput.replace(/-/g, '/');
    const lines = content.split('\n');

    // First entry (transaction header or price directive) dated after the target.
    // Posting lines are indented, so they never match this start-anchored regex.
    let insertAt = lines.length;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(?:P\s+)?(\d{4}\/\d{2}\/\d{2})(?:\s|$)/);
        if (m && m[1] > targetDate) {
            insertAt = i;
            break;
        }
    }

    const before = lines.slice(0, insertAt);
    const after = lines.slice(insertAt);

    const result = [...before];
    // Blank line before the block unless we're already at a blank boundary / start.
    if (result.length > 0 && result[result.length - 1].trim() !== '') {
        result.push('');
    }
    result.push(...block);
    // Blank line after the block when more content follows.
    if (after.length > 0 && after[0].trim() !== '') {
        result.push('');
    }
    result.push(...after);

    let out = result.join('\n').replace(/\n{3,}/g, '\n\n');
    if (!out.endsWith('\n')) out += '\n';
    return out;
}

// Parse all price directives from raw content, newest first (then by commodity).
export function getPricesForEditing(content: string): EditablePrice[] {
    const lines = content.split('\n');
    const prices: Omit<EditablePrice, 'index'>[] = [];

    for (const line of lines) {
        const m = line.match(PRICE_LINE_RE);
        if (!m) continue;
        const [, y, mo, d, commodity, price] = m;
        prices.push({
            date: `${y}/${mo}/${d}`,
            dateInput: `${y}-${mo}-${d}`,
            commodity,
            price,
            originalLine: line,
        });
    }

    prices.sort((a, b) =>
        a.date === b.date ? a.commodity.localeCompare(b.commodity) : b.date.localeCompare(a.date)
    );

    return prices.map((p, index) => ({ ...p, index }));
}

// Edit a price directive: replace the exact original line with a new one.
export async function editPrice(
    currentContent: string,
    originalLine: string,
    newLine: string,
    commitMessage: string
): Promise<string> {
    const lines = currentContent.split('\n');
    const i = lines.findIndex(l => l === originalLine);
    if (i === -1) {
        throw new Error(`Price not found: ${originalLine}`);
    }

    lines[i] = newLine;
    const updatedContent = lines.join('\n');

    await commitLedger(updatedContent, commitMessage);
    return updatedContent;
}

// Delete a price directive by its exact original line.
export async function deletePrice(
    currentContent: string,
    originalLine: string,
    commitMessage: string
): Promise<string> {
    const lines = currentContent.split('\n');
    const i = lines.findIndex(l => l === originalLine);
    if (i === -1) {
        throw new Error(`Price not found: ${originalLine}`);
    }

    lines.splice(i, 1);
    const updatedContent = lines.join('\n').replace(/\n{3,}/g, '\n\n');

    await commitLedger(updatedContent, commitMessage);
    return updatedContent;
}

// Test connection to GitHub repo
export async function testLedgerConnection(): Promise<{ success: boolean; error?: string }> {
    try {
        const { data, error } = await supabase.functions.invoke('read-ledger', {
            body: {},
        });

        if (error) {
            return { success: false, error: error.message };
        }

        if (!data?.content) {
            return { success: false, error: 'No content returned' };
        }

        return { success: true };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}
