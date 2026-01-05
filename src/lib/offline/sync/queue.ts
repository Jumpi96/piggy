import { getDatabaseAsync } from '../database';
import type { SyncTableName } from '../schema';

export type OperationType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface PendingChange {
    id: number;
    table_name: SyncTableName;
    record_id: string;
    operation: OperationType;
    payload: string; // JSON string
    created_at: string;
    synced_at: string | null;
    retry_count: number;
    error: string | null;
}

export async function trackChange(
    tableName: SyncTableName,
    recordId: string,
    operation: OperationType,
    payload: object
): Promise<void> {
    const db = await getDatabaseAsync();
    const now = new Date().toISOString();

    await db.query(`
        INSERT INTO _pending_changes (table_name, record_id, operation, payload, created_at)
        VALUES ($1, $2, $3, $4, $5)
    `, [tableName, recordId, operation, JSON.stringify(payload), now]);
}

export async function getPendingChanges(): Promise<PendingChange[]> {
    const db = await getDatabaseAsync();
    const result = await db.query<PendingChange>(`
        SELECT * FROM _pending_changes
        WHERE synced_at IS NULL
        ORDER BY created_at ASC
    `);
    return result.rows;
}

export async function getPendingChangesCount(): Promise<number> {
    const db = await getDatabaseAsync();
    const result = await db.query<{ count: string }>(`
        SELECT COUNT(*) as count FROM _pending_changes
        WHERE synced_at IS NULL
    `);
    return parseInt(result.rows[0]?.count || '0', 10);
}

export async function markChangeAsSynced(changeId: number): Promise<void> {
    const db = await getDatabaseAsync();
    const now = new Date().toISOString();

    await db.query(`
        UPDATE _pending_changes
        SET synced_at = $1
        WHERE id = $2
    `, [now, changeId]);
}

export async function recordSyncError(changeId: number, error: string): Promise<void> {
    const db = await getDatabaseAsync();

    await db.query(`
        UPDATE _pending_changes
        SET error = $1, retry_count = retry_count + 1
        WHERE id = $2
    `, [error, changeId]);
}

export async function clearSyncedChanges(): Promise<void> {
    const db = await getDatabaseAsync();

    // Keep last 1000 synced changes for debugging, delete older ones
    await db.query(`
        DELETE FROM _pending_changes
        WHERE synced_at IS NOT NULL
        AND id NOT IN (
            SELECT id FROM _pending_changes
            WHERE synced_at IS NOT NULL
            ORDER BY synced_at DESC
            LIMIT 1000
        )
    `);
}

export async function getFailedChanges(maxRetries: number = 5): Promise<PendingChange[]> {
    const db = await getDatabaseAsync();
    const result = await db.query<PendingChange>(`
        SELECT * FROM _pending_changes
        WHERE synced_at IS NULL
        AND retry_count >= $1
        ORDER BY created_at ASC
    `, [maxRetries]);
    return result.rows;
}

export async function resetFailedChange(changeId: number): Promise<void> {
    const db = await getDatabaseAsync();

    await db.query(`
        UPDATE _pending_changes
        SET retry_count = 0, error = NULL
        WHERE id = $1
    `, [changeId]);
}
