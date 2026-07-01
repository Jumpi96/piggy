import { supabase } from '../../supabase';
import { getDatabaseAsync } from '../database';
import { SYNC_TABLES, tableHasSoftDelete, type SyncTableName } from '../schema';
import { getPendingChanges } from './queue';

export interface ReconcileResult {
    checked: boolean;
    mismatches: SyncTableName[];
    error?: string;
}

interface SyncCountRow {
    table_name: string;
    record_count: number;
}

/**
 * Compares local vs server record counts for each table.
 * Returns list of tables with mismatches that need full resync.
 */
export async function checkReconciliation(): Promise<ReconcileResult> {
    const result: ReconcileResult = { checked: false, mismatches: [] };

    try {
        // Get server counts via RPC
        const { data: serverData, error } = await supabase.rpc('get_sync_counts');
        if (error) {
            console.error('[Reconcile] Failed to get server counts:', error.message);
            throw error;
        }

        const serverCounts = new Map<string, number>(
            (serverData as SyncCountRow[]).map(r => [r.table_name, Number(r.record_count)])
        );

        // Tables with unsynced local changes will legitimately differ in count from the
        // server (a not-yet-pushed insert/delete). Flagging those as mismatches triggers
        // a destructive full resync that reverts the pending local change, so skip them —
        // the normal push will reconcile the counts.
        const pending = await getPendingChanges();
        const tablesWithPending = new Set(pending.map(c => c.table_name));

        // Get local counts
        const db = await getDatabaseAsync();
        for (const table of SYNC_TABLES) {
            // Skip currencies - reference data, not user-specific
            if (table === 'currencies') continue;

            if (tablesWithPending.has(table)) {
                console.log(`[Reconcile] ${table} skipped: has pending local changes`);
                continue;
            }

            const whereClause = tableHasSoftDelete(table) ? 'WHERE deleted_at IS NULL' : '';
            const localResult = await db.query<{ count: number }>(
                `SELECT COUNT(*)::int as count FROM ${table} ${whereClause}`
            );
            const localCount = localResult.rows[0]?.count ?? 0;
            const serverCount = serverCounts.get(table) ?? 0;

            if (localCount !== serverCount) {
                console.warn(
                    `[Reconcile] Mismatch in ${table}: local=${localCount}, server=${serverCount}`
                );
                result.mismatches.push(table);
            } else {
                console.log(`[Reconcile] ${table} OK: ${localCount} records`);
            }
        }

        result.checked = true;
        if (result.mismatches.length === 0) {
            console.log('[Reconcile] All tables in sync');
        }
    } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
        console.error('[Reconcile] Error:', result.error);
    }

    return result;
}
