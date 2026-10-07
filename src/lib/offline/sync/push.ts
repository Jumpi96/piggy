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

    // Records whose earlier change didn't go through this run. Their later changes are
    // held back (not attempted, not counted as a failure) so an UPDATE is never sent
    // before its INSERT, and one stuck change doesn't burn retries for the ones behind it.
    const blockedRecords = new Set<string>();
    // Local id -> server id adopted mid-run (override natural-key merge). The queue rows
    // are already rewritten, but `pending` was read before that.
    const adoptedIds = new Map<string, string>();

    for (const queued of pending) {
        const localKey = `${queued.table_name}:${queued.record_id}`;
        const adoptedId = adoptedIds.get(localKey);
        const change = adoptedId ? { ...queued, record_id: adoptedId } : queued;
        const recordKey = `${change.table_name}:${change.record_id}`;

        if (blockedRecords.has(recordKey)) {
            continue;
        }

        // Skip changes that have failed too many times (Settings → Failed changes lets
        // the user retry or discard them)
        if (change.retry_count >= MAX_RETRIES) {
            console.warn(`[Sync Push] Skipping change ${change.id} - max retries exceeded`);
            blockedRecords.add(recordKey);
            result.changesFailed++;
            result.success = false;
            continue;
        }

        try {
            const serverId = await pushSingleChange(change);
            if (serverId) {
                adoptedIds.set(recordKey, serverId);
            }
            await markChangeAsSynced(change.id);
            result.changesPushed++;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const transient = isTransientError(errorMsg);
            console.error(`[Sync Push] Failed to push change ${change.id}${transient ? ' (transient)' : ''}:`, errorMsg);

            // Connectivity/auth hiccups say nothing about the change itself, so they must
            // not count toward MAX_RETRIES — on a flaky connection that permanently
            // abandoned perfectly valid changes.
            await recordSyncError(change.id, errorMsg, { countAttempt: !transient });
            result.changesFailed++;
            result.errors.push(`${change.table_name}/${change.record_id}: ${errorMsg}`);
            result.success = false;

            if (transient) {
                // The network is the problem; the rest of the queue would fail the same way.
                break;
            }
            blockedRecords.add(recordKey);
        }
    }

    // Clean up old synced changes
    await clearSyncedChanges();

    console.log(`[Sync Push] Complete: ${result.changesPushed} pushed, ${result.changesFailed} failed`);
    return result;
}

const TRANSIENT_ERROR_PATTERN = /failed to fetch|load failed|networkerror|network error|network request failed|aborterror|timed? ?out|jwt expired|pgrst301|fetcherror/i;

/** Errors caused by connectivity or an expiring session rather than by the change. */
export function isTransientError(message: string): boolean {
    return TRANSIENT_ERROR_PATTERN.test(message);
}

/**
 * Pushes one queued change. Returns the server's id when the server already held this
 * record's natural key under a different id and the local row was moved onto it.
 */
async function pushSingleChange(change: PendingChange): Promise<string | null> {
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
            return pushInsert(table, preparedPayload);
        case 'UPDATE':
            await pushUpdate(table, change.record_id, preparedPayload);
            break;
        case 'DELETE':
            await pushDelete(table, change.record_id, preparedPayload);
            break;
        default:
            throw new Error(`Unknown operation: ${change.operation}`);
    }
    return null;
}

async function pushInsert(
    table: SyncTableName,
    payload: Record<string, unknown>
): Promise<string | null> {
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

        if (!error) return null;
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
        return adoptServerId(table, String(payload.id), {
            recurring_rule_id: payload.recurring_rule_id,
            original_date: payload.original_date,
        });
    }

    // Parameters are unique per (user_id, key). Two devices that each created the same
    // key offline hold different ids; the second insert hits 23505, and treating that as
    // success left this device on an id the server doesn't know — every later update
    // matched zero rows and retried until abandoned. Same treatment as overrides: write
    // by natural key, then move the local row onto the server's id.
    if (table === 'parameters') {
        const { error } = await supabase
            .from(table)
            .insert(insertPayload);

        if (!error) return null;
        if (error.code !== '23505') throw new Error(error.message);

        const updateFields = { ...insertPayload };
        delete updateFields.id;
        const { error: updateError } = await supabase
            .from(table)
            .update(updateFields)
            .eq('key', payload.key);

        if (updateError) throw new Error(updateError.message);

        return adoptServerId(table, String(payload.id), { key: payload.key });
    }

    const { error } = await supabase
        .from(table)
        .insert(insertPayload);

    if (error) {
        // Handle duplicate key errors gracefully (record may have been synced via pull)
        if (error.code === '23505') {
            console.log(`[Sync Push] Record already exists, treating as success: ${table}/${payload.id}`);
            return null;
        }
        throw new Error(error.message);
    }
    return null;
}

/**
 * After a natural-key conflict, point the local row and any still-pending changes at the
 * id the server actually holds, so later local edits/deletes (matched by id) target the
 * right row. Returns the adopted server id, or null if nothing changed. Best-effort: the
 * server content is already correct, so a failure here must not fail the push (pull
 * repairs the local copy later; see findNaturalKeyConflict in pull.ts).
 */
async function adoptServerId(
    table: SyncTableName,
    localId: string,
    naturalKey: Record<string, unknown>
): Promise<string | null> {
    try {
        let query = supabase.from(table).select('id');
        for (const [column, value] of Object.entries(naturalKey)) {
            query = query.eq(column, value);
        }
        const { data, error } = await query.maybeSingle();

        const serverId = data?.id as string | undefined;
        if (error || !serverId || serverId === localId) return null;

        const db = await getDatabaseAsync();
        await db.query(`UPDATE ${table} SET id = $1 WHERE id = $2`, [serverId, localId]);
        await db.query(
            `UPDATE _pending_changes SET record_id = $1
             WHERE table_name = $2 AND record_id = $3 AND synced_at IS NULL`,
            [serverId, table, localId]
        );
        console.log(`[Sync Push] Adopted server id for ${table}: ${localId} -> ${serverId}`);
        return serverId;
    } catch (err) {
        console.warn('[Sync Push] Failed to adopt server id (will retry later):', err);
        return null;
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
