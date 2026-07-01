import { supabase } from '../../supabase';
import { getDatabaseAsync } from '../database';
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

    // For transaction overrides, an occurrence is uniquely identified by
    // (recurring_rule_id, original_date). We must NOT use supabase upsert on that
    // constraint: on conflict it runs DO UPDATE SET id = EXCLUDED.id, renaming the
    // existing server row's primary key to this device's freshly-minted UUID. That
    // orphans the other device's copy of the same occurrence, which then re-pulls
    // under a new id and either duplicates it or (with the local UNIQUE constraint)
    // silently disappears. Instead: try a plain INSERT, and on any unique-constraint
    // conflict UPDATE the existing row BY NATURAL KEY, leaving its id untouched.
    if (table === 'transactions' && payload.recurring_rule_id && payload.original_date) {
        const { error } = await supabase
            .from(table)
            .insert(insertPayload);

        if (!error) return;
        if (error.code !== '23505') throw new Error(error.message);

        // An override for this occurrence already exists on the server (same id
        // re-synced, or a different id created on another device). Update its content
        // by natural key, preserving whatever id the server already holds.
        const { id: _omitId, created_at: _omitCreatedAt, ...updateFields } = insertPayload;
        const { error: updateError } = await supabase
            .from(table)
            .update(updateFields)
            .eq('recurring_rule_id', payload.recurring_rule_id)
            .eq('original_date', payload.original_date);

        if (updateError) throw new Error(updateError.message);

        // If another device created this occurrence first, the server row keeps ITS id,
        // not ours. Converge the local row (and any queued changes) onto the server id,
        // otherwise our later edits/deletes would be keyed by our stale local id, match
        // zero server rows, and retry forever — and pull can't repair it because the
        // local table already holds this natural key under a different id.
        await adoptServerOverrideId(
            table,
            String(payload.id),
            String(payload.recurring_rule_id),
            String(payload.original_date)
        );
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

/**
 * After a natural-key override conflict, point the local row and any still-pending
 * changes at the id the server actually holds, so later local edits/deletes (matched by
 * id) target the right row. Best-effort: the server content is already correct, so a
 * failure here must not fail the push (it would just leave the id divergence for a
 * future pull/push to resolve).
 */
async function adoptServerOverrideId(
    table: SyncTableName,
    localId: string,
    recurringRuleId: string,
    originalDate: string
): Promise<void> {
    try {
        const { data, error } = await supabase
            .from(table)
            .select('id')
            .eq('recurring_rule_id', recurringRuleId)
            .eq('original_date', originalDate)
            .maybeSingle();

        const serverId = data?.id as string | undefined;
        if (error || !serverId || serverId === localId) return;

        const db = await getDatabaseAsync();
        await db.query(`UPDATE ${table} SET id = $1 WHERE id = $2`, [serverId, localId]);
        await db.query(
            `UPDATE _pending_changes SET record_id = $1
             WHERE table_name = $2 AND record_id = $3 AND synced_at IS NULL`,
            [serverId, table, localId]
        );
        console.log(`[Sync Push] Adopted server id for ${table} override: ${localId} -> ${serverId}`);
    } catch (err) {
        console.warn('[Sync Push] Failed to adopt server override id (will retry later):', err);
    }
}

async function pushUpdate(
    table: SyncTableName,
    recordId: string,
    payload: Record<string, unknown>
): Promise<void> {
    // Remove system fields that shouldn't be updated
    const { id, user_id, created_at, ...updatePayload } = payload;

    const { data, error } = await supabase
        .from(table)
        .update(updatePayload)
        .eq('id', recordId)
        .select('id');

    if (error) {
        throw new Error(error.message);
    }
    // A Supabase update that matches no row returns success with an empty set. That
    // happens when the target row's INSERT hasn't reached the server yet. Treat it as
    // a retryable failure instead of marking it synced, otherwise the update is lost.
    if (!data || data.length === 0) {
        throw new Error(`No server row matched update for ${table}/${recordId} (insert not yet synced?)`);
    }
}

async function pushDelete(
    table: SyncTableName,
    recordId: string,
    payload: Record<string, unknown>
): Promise<void> {
    // Soft delete - update deleted_at timestamp
    const { data, error } = await supabase
        .from(table)
        .update({ deleted_at: payload.deleted_at })
        .eq('id', recordId)
        .select('id');

    if (error) {
        throw new Error(error.message);
    }
    // Same guard as pushUpdate: a delete matching zero rows means the row's INSERT
    // hasn't been pushed yet. Retrying (rather than succeeding) prevents the classic
    // resurrection where the delete is dropped and the later insert brings the row back.
    if (!data || data.length === 0) {
        throw new Error(`No server row matched delete for ${table}/${recordId} (insert not yet synced?)`);
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
