import type { SyncTableName } from '../schema';

export interface SyncRecord {
    id: string;
    updated_at?: string;
    created_at?: string;
    deleted_at?: string | null;
    [key: string]: unknown;
}

export type ConflictResolution = 'local' | 'server' | 'merge';

export interface ConflictResult {
    resolution: ConflictResolution;
    record: SyncRecord;
}

/**
 * Resolves conflicts between local and server records using last-write-wins strategy.
 *
 * @param local - The local record
 * @param server - The server record
 * @param tableName - The table name (for logging)
 * @returns The winning record and resolution type
 */
export function resolveConflict(
    local: SyncRecord,
    server: SyncRecord,
    tableName: SyncTableName
): ConflictResult {
    // Get timestamps for comparison
    const localTime = getRecordTimestamp(local);
    const serverTime = getRecordTimestamp(server);

    // Last-write-wins: compare timestamps
    if (serverTime > localTime) {
        console.log(`[Sync Conflict] ${tableName}/${local.id}: Server wins (${serverTime} > ${localTime})`);
        return { resolution: 'server', record: server };
    }

    if (localTime > serverTime) {
        console.log(`[Sync Conflict] ${tableName}/${local.id}: Local wins (${localTime} > ${serverTime})`);
        return { resolution: 'local', record: local };
    }

    // Same timestamp - prefer server to be safe
    console.log(`[Sync Conflict] ${tableName}/${local.id}: Same timestamp, defaulting to server`);
    return { resolution: 'server', record: server };
}

/**
 * Gets the most relevant timestamp from a record for conflict resolution.
 * Prefers updated_at, falls back to created_at.
 */
function getRecordTimestamp(record: SyncRecord): number {
    const timestamp = record.updated_at || record.created_at;
    if (!timestamp) return 0;

    const parsed = new Date(timestamp).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Checks if a server record should be applied locally.
 * Returns true if server is newer or local doesn't exist.
 */
export function shouldApplyServerRecord(
    localRecord: SyncRecord | null,
    serverRecord: SyncRecord
): boolean {
    // No local record - always apply
    if (!localRecord) {
        return true;
    }

    // Resolve conflict
    const result = resolveConflict(localRecord, serverRecord, 'transactions');
    return result.resolution === 'server';
}

/**
 * Checks if a local record has pending changes that should be pushed.
 * A record should be pushed if it's newer than what we last synced.
 */
export function shouldPushLocalRecord(
    localRecord: SyncRecord,
    lastSyncTimestamp: string | null
): boolean {
    if (!lastSyncTimestamp) {
        // First sync - push everything
        return true;
    }

    const recordTime = getRecordTimestamp(localRecord);
    const syncTime = new Date(lastSyncTimestamp).getTime();

    return recordTime > syncTime;
}
