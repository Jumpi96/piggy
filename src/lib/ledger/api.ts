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
