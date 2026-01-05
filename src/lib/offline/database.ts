import { PGlite } from '@electric-sql/pglite';
import { IdbFs } from '@electric-sql/pglite';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

const DB_NAME = 'piggy-offline-db';

let db: PGlite | null = null;
let initPromise: Promise<PGlite> | null = null;

export async function initDatabase(): Promise<PGlite> {
    // Return existing promise if already initializing
    if (initPromise) {
        return initPromise;
    }

    // Return existing db if already initialized
    if (db) {
        return db;
    }

    initPromise = (async () => {
        try {
            console.log('[Offline DB] Initializing with IndexedDB persistence...');

            // Use explicit IdbFs for better control
            db = new PGlite({
                fs: new IdbFs(DB_NAME),
                // Return query results immediately, flush to IDB asynchronously
                relaxedDurability: true,
            });

            // Wait for the database to be ready
            await db.waitReady;

            // Run migrations
            await runMigrations(db);

            usingPersistence = true;
            console.log('[Offline DB] Database ready (IndexedDB persistence)');
            return db;
        } catch (error) {
            console.error('[Offline DB] IndexedDB initialization failed, falling back to in-memory:', error);

            // Fallback to in-memory if IndexedDB fails
            db = new PGlite();
            await db.waitReady;
            await runMigrations(db);

            console.log('[Offline DB] Database ready (in-memory fallback)');
            return db;
        }
    })();

    return initPromise;
}

export function getDatabase(): PGlite {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

export async function getDatabaseAsync(): Promise<PGlite> {
    if (db) return db;
    return initDatabase();
}

async function runMigrations(database: PGlite): Promise<void> {
    // Check current schema version
    const versionResult = await database.query<{ value: string }>(`
        SELECT value FROM _sync_meta WHERE key = 'schema_version'
    `).catch(() => ({ rows: [] }));

    const currentVersion = versionResult.rows.length > 0
        ? parseInt(versionResult.rows[0].value, 10)
        : 0;

    if (currentVersion < SCHEMA_VERSION) {
        console.log(`[Offline DB] Migrating from version ${currentVersion} to ${SCHEMA_VERSION}`);

        // For fresh install or major version change, recreate schema
        if (currentVersion === 0) {
            await database.exec(SCHEMA_SQL);
        }

        // Update schema version
        await database.query(`
            INSERT INTO _sync_meta (key, value)
            VALUES ('schema_version', $1)
            ON CONFLICT (key) DO UPDATE SET value = $1
        `, [SCHEMA_VERSION.toString()]);

        console.log('[Offline DB] Migration complete');
    }
}

export async function clearDatabase(): Promise<void> {
    const database = getDatabase();

    // Clear all user data tables (preserve schema)
    const tables = [
        'transactions',
        'recurring_rules',
        'credit_cards',
        'exchange_rates',
        'parameters',
        '_pending_changes'
    ];

    for (const table of tables) {
        await database.query(`DELETE FROM ${table}`);
    }

    // Reset sync metadata (but keep schema version)
    await database.query(`
        DELETE FROM _sync_meta WHERE key != 'schema_version'
    `);

    console.log('[Offline DB] Database cleared');
}

export async function getSyncMeta(key: string): Promise<string | null> {
    const database = await getDatabaseAsync();
    const result = await database.query<{ value: string }>(`
        SELECT value FROM _sync_meta WHERE key = $1
    `, [key]);

    return result.rows.length > 0 ? result.rows[0].value : null;
}

export async function setSyncMeta(key: string, value: string): Promise<void> {
    const database = await getDatabaseAsync();
    await database.query(`
        INSERT INTO _sync_meta (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = $2
    `, [key, value]);
}

export async function getLastSyncTimestamp(): Promise<string | null> {
    return getSyncMeta('last_sync_at');
}

export async function setLastSyncTimestamp(timestamp: string): Promise<void> {
    return setSyncMeta('last_sync_at', timestamp);
}

export async function getCurrentUserId(): Promise<string | null> {
    return getSyncMeta('user_id');
}

export async function setCurrentUserId(userId: string): Promise<void> {
    return setSyncMeta('user_id', userId);
}

// Track if we're using persistent storage
let usingPersistence = false;

export function isUsingPersistence(): boolean {
    return usingPersistence;
}

// Called internally when we successfully init with IndexedDB
export function _setPersistenceStatus(isPersistent: boolean): void {
    usingPersistence = isPersistent;
}
