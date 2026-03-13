import { supabase } from '../../supabase';
import { SYNC_TABLES, type SyncTableName } from '../schema';
import {
    getPendingChanges,
    markChangeAsSynced,
    recordSyncError,
    clearSyncedChanges,
    type PendingChange
} from './queue';

export interface PushResult {
    success: boolean;
    changesPushed: number;
    changesFailed: number;
    errors: string[];
}

const MAX_RETRIES = 5;

/**
 * Pushes pending local changes to Supabase server.
 * Processes changes in FIFO order, continues on individual failures.
 */
export async function pushChanges(): Promise<PushResult> {
    const result: PushResult = {
        success: true,
        changesPushed: 0,
        changesFailed: 0,
        errors: []
    };

    const pending = await getPendingChanges();

    if (pending.length === 0) {
        console.log('[Sync Push] No pending changes');
        return result;
    }

    console.log(`[Sync Push] Processing ${pending.length} pending changes`);

    // Group changes by table for better batching in future
    for (const change of pending) {
        // Skip changes that have failed too many times
        if (change.retry_count >= MAX_RETRIES) {
            console.warn(`[Sync Push] Skipping change ${change.id} - max retries exceeded`);
            continue;
        }

        try {
            await pushSingleChange(change);
            await markChangeAsSynced(change.id);
            result.changesPushed++;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[Sync Push] Failed to push change ${change.id}:`, errorMsg);

            await recordSyncError(change.id, errorMsg);
            result.changesFailed++;
            result.errors.push(`${change.table_name}/${change.record_id}: ${errorMsg}`);
            result.success = false;
        }
    }

    // Clean up old synced changes
    await clearSyncedChanges();

    console.log(`[Sync Push] Complete: ${result.changesPushed} pushed, ${result.changesFailed} failed`);
    return result;
}

async function pushSingleChange(change: PendingChange): Promise<void> {
    const payload = JSON.parse(change.payload);
    const table = change.table_name;

    // Validate table name
    if (!SYNC_TABLES.includes(table)) {
        throw new Error(`Invalid table: ${table}`);
    }

    // Prepare payload for Supabase (convert JSONB back from string)
    const preparedPayload = preparePayloadForServer(table, payload);

    switch (change.operation) {
        case 'INSERT':
            await pushInsert(table, preparedPayload);
            break;
        case 'UPDATE':
            await pushUpdate(table, change.record_id, preparedPayload);
            break;
        case 'DELETE':
            await pushDelete(table, change.record_id, preparedPayload);
            break;
        default:
            throw new Error(`Unknown operation: ${change.operation}`);
    }
}

async function pushInsert(
    table: SyncTableName,
    payload: Record<string, unknown>
): Promise<void> {
    // Remove user_id - Supabase will set it via RLS default
    const { user_id, ...insertPayload } = payload;

    // For transaction overrides, use upsert on the (recurring_rule_id, original_date) constraint
    // This handles the case where user edits the same occurrence multiple times
    if (table === 'transactions' && payload.recurring_rule_id && payload.original_date) {
        const { error } = await supabase
            .from(table)
            .upsert(insertPayload, {
                onConflict: 'recurring_rule_id,original_date',
                ignoreDuplicates: false
            });

        if (error) {
            // If upsert fails due to primary key conflict, the record already exists with same ID
            if (error.code === '23505') {
                console.log(`[Sync Push] Record already exists, treating as success: ${table}/${payload.id}`);
                return;
            }
            throw new Error(error.message);
        }
        return;
    }

    const { error } = await supabase
        .from(table)
        .insert(insertPayload);

    if (error) {
        // Handle duplicate key errors gracefully (record may have been synced via pull)
        if (error.code === '23505') {
            console.log(`[Sync Push] Record already exists, treating as success: ${table}/${payload.id}`);
            return;
        }
        throw new Error(error.message);
    }
}

async function pushUpdate(
    table: SyncTableName,
    recordId: string,
    payload: Record<string, unknown>
): Promise<void> {
    // Remove system fields that shouldn't be updated
    const { id, user_id, created_at, ...updatePayload } = payload;

    const { error } = await supabase
        .from(table)
        .update(updatePayload)
        .eq('id', recordId);

    if (error) {
        throw new Error(error.message);
    }
}

async function pushDelete(
    table: SyncTableName,
    recordId: string,
    payload: Record<string, unknown>
): Promise<void> {
    // Soft delete - update deleted_at timestamp
    const { error } = await supabase
        .from(table)
        .update({ deleted_at: payload.deleted_at })
        .eq('id', recordId);

    if (error) {
        throw new Error(error.message);
    }
}

function preparePayloadForServer(
    table: SyncTableName,
    payload: Record<string, unknown>
): Record<string, unknown> {
    const prepared: Record<string, unknown> = { ...payload };

    // Convert stringified JSON back to objects for JSONB columns
    if (table === 'recurring_rules' && typeof prepared.schedule_config === 'string') {
        try {
            prepared.schedule_config = JSON.parse(prepared.schedule_config as string);
        } catch {
            // Keep as string if parsing fails
        }
    }

    if (table === 'parameters' && typeof prepared.value === 'string') {
        try {
            prepared.value = JSON.parse(prepared.value as string);
        } catch {
            // Keep as string if parsing fails
        }
    }

    return prepared;
}

/**
 * Attempts to push a specific change immediately.
 * Used for eager sync when online.
 */
export async function pushChangeImmediately(change: PendingChange): Promise<boolean> {
    try {
        await pushSingleChange(change);
        await markChangeAsSynced(change.id);
        return true;
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await recordSyncError(change.id, errorMsg);
        return false;
    }
}
