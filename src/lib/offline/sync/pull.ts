import { supabase } from '../../supabase';
import { getDatabaseAsync, getLastSyncTimestamp, setLastSyncTimestamp } from '../database';
import { SYNC_TABLES, tableHasUpdatedAt, type SyncTableName } from '../schema';
import { resolveConflict, type SyncRecord } from './conflict';
import { getPendingChanges } from './queue';

export interface PullResult {
    success: boolean;
    tablesUpdated: number;
    recordsProcessed: number;
    errors: string[];
}

/**
 * Pulls changes from Supabase server to local SQLite.
 * Uses incremental sync based on updated_at timestamps.
 */
export async function pullChanges(): Promise<PullResult> {
    const result: PullResult = {
        success: true,
        tablesUpdated: 0,
        recordsProcessed: 0,
        errors: []
    };

    const lastSync = await getLastSyncTimestamp();
    // Capture the watermark BEFORE issuing any query. The next pull filters on the
    // server's updated_at >= this value, so it must be a lower bound on "when this pull
    // observed the server". Stamping it AFTER the queries (as before) skipped any row
    // written during the pull window: its updated_at landed between a table's query and
    // the post-loop stamp, so it was in neither this result set nor the next pull's
    // filter — a permanent silent divergence.
    const watermark = new Date().toISOString();
    console.log(`[Sync Pull] Starting pull, last sync: ${lastSync || 'never'}`);
    const pendingChanges = await getPendingChanges();
    const pendingByTable = new Map<SyncTableName, Set<string>>(
        SYNC_TABLES.map(table => [table, new Set<string>()])
    );

    for (const change of pendingChanges) {
        pendingByTable.get(change.table_name)?.add(change.record_id);
    }

    for (const table of SYNC_TABLES) {
        try {
            const recordsUpdated = await pullTable(table, lastSync, pendingByTable.get(table) || new Set());
            if (recordsUpdated > 0) {
                result.tablesUpdated++;
                result.recordsProcessed += recordsUpdated;
            }
        } catch (error) {
            const errorMsg = `Failed to pull ${table}: ${error instanceof Error ? error.message : String(error)}`;
            console.error(`[Sync Pull] ${errorMsg}`);
            result.errors.push(errorMsg);
            result.success = false;
        }
    }

    // Update last sync timestamp if successful (using the pre-query watermark).
    if (result.success) {
        await setLastSyncTimestamp(watermark);
    }

    console.log(`[Sync Pull] Complete: ${result.recordsProcessed} records from ${result.tablesUpdated} tables`);
    return result;
}

async function pullTable(
    table: SyncTableName,
    lastSync: string | null,
    pendingRecordIds: Set<string>
): Promise<number> {
    const db = await getDatabaseAsync();

    // Build query
    let query = supabase.from(table).select('*');

    // For tables with updated_at, only fetch changes since last sync
    if (lastSync && tableHasUpdatedAt(table)) {
        query = query.gte('updated_at', lastSync);
    }
    // For other tables with created_at, fetch new records since last sync
    else if (lastSync && table !== 'currencies') {
        query = query.gte('created_at', lastSync);
    }

    // For currencies (reference data), just fetch all if first sync
    if (table === 'currencies' && lastSync) {
        // Skip currencies after first sync (they rarely change)
        return 0;
    }

    const { data, error } = await query;

    if (error) {
        throw new Error(`Supabase query failed: ${error.message}`);
    }

    if (!data || data.length === 0) {
        return 0;
    }

    let processedCount = 0;
    const pkColumn = getPrimaryKeyColumn(table);

    for (const serverRecord of data) {
        try {
            const wasUpdated = await upsertLocalRecord(db, table, serverRecord, pendingRecordIds);
            if (wasUpdated) {
                processedCount++;
            }
        } catch (error) {
            console.error(`[Sync Pull] Failed to upsert ${table}/${serverRecord[pkColumn]}:`, error);
        }
    }

    return processedCount;
}

// Get the primary key column for a table
function getPrimaryKeyColumn(table: SyncTableName): string {
    if (table === 'currencies') return 'code';
    return 'id';
}

async function upsertLocalRecord(
    db: Awaited<ReturnType<typeof getDatabaseAsync>>,
    table: SyncTableName,
    serverRecord: Record<string, unknown>,
    pendingRecordIds?: Set<string>
): Promise<boolean> {
    const pkColumn = getPrimaryKeyColumn(table);
    const pkValue = serverRecord[pkColumn] as string;

    if (pendingRecordIds?.has(pkValue)) {
        console.log(`[Sync Pull] Skipping ${table}/${pkValue} due to pending local changes`);
        return false;
    }

    // Check if local record exists
    const existing = await db.query<SyncRecord>(`
        SELECT * FROM ${table} WHERE ${pkColumn} = $1
    `, [pkValue]);

    const localRecord = existing.rows[0] || null;

    // If local record exists, resolve conflict (skip for reference tables like currencies)
    if (localRecord && table !== 'currencies') {
        const { resolution } = resolveConflict(
            localRecord,
            serverRecord as SyncRecord,
            table
        );

        if (resolution === 'local') {
            // Local wins - don't update
            return false;
        }
    }

    // Prepare record for local storage
    const preparedRecord = prepareRecordForLocal(table, serverRecord);

    // Build upsert query dynamically
    const columns = Object.keys(preparedRecord);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const updateClauses = columns
        .filter(c => c !== pkColumn)
        .map(c => `${c} = EXCLUDED.${c}`)
        .join(', ');

    const values = columns.map(c => preparedRecord[c]);

    // Handle case where there are no columns to update (e.g., currencies with only code and name)
    const conflictClause = updateClauses
        ? `ON CONFLICT (${pkColumn}) DO UPDATE SET ${updateClauses}`
        : `ON CONFLICT (${pkColumn}) DO NOTHING`;

    await db.query(`
        INSERT INTO ${table} (${columns.join(', ')})
        VALUES (${placeholders})
        ${conflictClause}
    `, values);

    return true;
}

function prepareRecordForLocal(
    _table: SyncTableName,
    record: Record<string, unknown>
): Record<string, unknown> {
    const prepared: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
        // Convert JSONB fields to string
        if (key === 'schedule_config' || key === 'value') {
            prepared[key] = typeof value === 'object' ? JSON.stringify(value) : value;
        }
        // Keep everything else as-is
        else {
            prepared[key] = value;
        }
    }

    return prepared;
}

/**
 * Performs initial hydration - downloads all user data on first sync.
 */
export async function initialHydration(
    onProgress?: (table: string, current: number, total: number) => void
): Promise<void> {
    const lastSync = await getLastSyncTimestamp();

    if (lastSync) {
        console.log('[Sync] Already hydrated, skipping initial hydration');
        return;
    }

    console.log('[Sync] Starting initial hydration...');
    // Capture the watermark before downloading so any row written during the (possibly
    // long) hydration is picked up by the first incremental pull rather than skipped.
    const watermark = new Date().toISOString();
    const db = await getDatabaseAsync();

    for (let i = 0; i < SYNC_TABLES.length; i++) {
        const table = SYNC_TABLES[i];
        onProgress?.(table, i + 1, SYNC_TABLES.length);

        try {
            // For large tables, use pagination
            if (table === 'transactions') {
                await hydrateTablePaginated(db, table);
            } else {
                await hydrateTable(db, table);
            }
        } catch (error) {
            console.error(`[Sync] Failed to hydrate ${table}:`, error);
            throw error;
        }
    }

    await setLastSyncTimestamp(watermark);
    console.log('[Sync] Initial hydration complete');
}

async function hydrateTable(
    db: Awaited<ReturnType<typeof getDatabaseAsync>>,
    table: SyncTableName,
    pendingRecordIds?: Set<string>
): Promise<void> {
    const { data, error } = await supabase
        .from(table)
        .select('*');

    if (error) throw error;
    if (!data || data.length === 0) return;

    for (const record of data) {
        await upsertLocalRecord(db, table, record, pendingRecordIds);
    }

    console.log(`[Sync] Hydrated ${table}: ${data.length} records`);
}

async function hydrateTablePaginated(
    db: Awaited<ReturnType<typeof getDatabaseAsync>>,
    table: SyncTableName,
    pageSize: number = 1000,
    pendingRecordIds?: Set<string>
): Promise<void> {
    let offset = 0;
    let hasMore = true;
    let totalRecords = 0;
    const pkColumn = getPrimaryKeyColumn(table);


    while (hasMore) {
        const { data, error } = await supabase
            .from(table)
            .select('*')
            .range(offset, offset + pageSize - 1)
            .order('created_at', { ascending: true })
            .order(pkColumn, { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            hasMore = false;
            break;
        }


        for (const record of data) {
            await upsertLocalRecord(db, table, record, pendingRecordIds);
        }

        totalRecords += data.length;
        offset += pageSize;
        hasMore = data.length === pageSize;
    }

    console.log(`[Sync] Hydrated ${table}: ${totalRecords} records (paginated)`);
}

// FK dependencies: table -> tables it depends on (in order they should be hydrated)
const FK_DEPENDENCIES: Partial<Record<SyncTableName, SyncTableName[]>> = {
    'exchange_rates': ['currencies'],
    'recurring_rules': ['currencies', 'credit_cards'],
    'transactions': ['currencies', 'exchange_rates', 'credit_cards', 'recurring_rules'],
};

/**
 * Ensures all FK dependency tables are populated before resyncing a table.
 */
async function ensureDependenciesPopulated(
    db: Awaited<ReturnType<typeof getDatabaseAsync>>,
    table: SyncTableName
): Promise<void> {
    const dependencies = FK_DEPENDENCIES[table];
    if (!dependencies) return;

    for (const depTable of dependencies) {
        const countResult = await db.query<{ count: number }>(
            `SELECT COUNT(*)::int as count FROM ${depTable}`
        );
        if ((countResult.rows[0]?.count ?? 0) === 0) {
            console.log(`[Sync] Dependency ${depTable} empty, hydrating before ${table} resync...`);
            if (depTable === 'transactions') {
                await hydrateTablePaginated(db, depTable);
            } else {
                await hydrateTable(db, depTable);
            }
        }
    }
}

/**
 * Performs a full resync of a single table.
 * Clears local data and re-downloads everything from server.
 * Used when reconciliation detects a count mismatch.
 */
export async function fullTableResync(table: SyncTableName): Promise<number> {
    console.log(`[Sync] Starting full resync for ${table}...`);
    const db = await getDatabaseAsync();

    // Ensure FK dependencies are populated before clearing and resyncing
    await ensureDependenciesPopulated(db, table);

    // Preserve rows that still have unsynced local changes: a blind DELETE +
    // re-hydrate would revert a pending soft-delete (row comes back) or drop a
    // locally-created row whose insert hasn't reached the server yet. Keep those
    // rows and skip their server copies during re-hydrate so local stays authoritative
    // until the pending change is pushed.
    const pending = await getPendingChanges();
    const pkColumn = getPrimaryKeyColumn(table);
    const pendingIds = new Set(
        pending.filter(c => c.table_name === table).map(c => c.record_id)
    );

    // Clear local table data (except rows with pending local changes)
    if (pendingIds.size > 0) {
        await db.query(`DELETE FROM ${table} WHERE NOT (${pkColumn} = ANY($1))`, [[...pendingIds]]);
    } else {
        await db.query(`DELETE FROM ${table}`);
    }
    console.log(`[Sync] Cleared local ${table} table (${pendingIds.size} pending rows preserved)`);

    // Re-hydrate from server
    if (table === 'transactions') {
        await hydrateTablePaginated(db, table, 1000, pendingIds);
    } else {
        await hydrateTable(db, table, pendingIds);
    }

    // Get new count
    const countResult = await db.query<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM ${table}`
    );
    const newCount = countResult.rows[0]?.count ?? 0;

    console.log(`[Sync] Full resync completed for ${table}: ${newCount} records`);
    return newCount;
}
