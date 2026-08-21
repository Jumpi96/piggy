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

        // For fresh install
        if (currentVersion === 0) {
            await database.exec(SCHEMA_SQL);
        } else {
            // Incremental migrations
            if (currentVersion < 2) {
                console.log('[Offline DB] Applying version 2 migration (Virtualized Recurring Transactions)');

                // 1. Add exception_dates to recurring_rules
                await database.exec(`ALTER TABLE recurring_rules ADD COLUMN IF NOT EXISTS exception_dates TEXT;`);

                // 2. Add original_date to transactions
                await database.exec(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS original_date TEXT;`);

                // 3. Add updated_at to currencies (missing in v1 offline schema)
                await database.exec(`ALTER TABLE currencies ADD COLUMN IF NOT EXISTS updated_at TEXT;`);

                // 3. Update the unique constraint on transactions
                // Note: Constraints might have auto-generated names. 
                // We try to drop the common one for (recurring_rule_id, date)
                try {
                    await database.exec(`ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_recurring_rule_id_date_key;`);
                } catch (e) {
                    console.warn('[Offline DB] Could not drop old constraint:', e);
                }

                try {
                    await database.exec(`ALTER TABLE transactions ADD CONSTRAINT transactions_recurring_rule_id_original_date_key UNIQUE (recurring_rule_id, original_date);`);
                } catch (e) {
                    // It might already exist if the user is retrying or if SCHEMA_SQL was run by mistake
                    console.warn('[Offline DB] Could not add new constraint (might already exist):', e);
                }
            }

            if (currentVersion < 4) {
                console.log('[Offline DB] Applying version 4 migration (Credit Card Enabled Status & Fix)');
                await database.exec(`ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;`);
            }

            if (currentVersion < 5) {
                console.log('[Offline DB] Applying version 5 migration (Credit Card Sort Order)');
                await database.exec(`ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;`);
                await database.exec(`
                    WITH ordered AS (
                        SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY name, created_at, id) - 1 AS rn
                        FROM credit_cards
                        WHERE deleted_at IS NULL
                    )
                    UPDATE credit_cards
                    SET sort_order = ordered.rn
                    FROM ordered
                    WHERE credit_cards.id = ordered.id;
                `);
            }
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

const LAST_SYNC_STORAGE_KEY = 'piggy_last_sync';

function safeLocalStorageGet(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch (err) {
        console.warn(`[Offline DB] localStorage get failed for ${key}:`, err);
        return null;
    }
}

function safeLocalStorageSet(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch (err) {
        console.warn(`[Offline DB] localStorage set failed for ${key}:`, err);
    }
}

export async function getLastSyncTimestamp(): Promise<string | null> {
    // Try localStorage first (fastest, most reliable for PWA)
    const storedTimestamp = safeLocalStorageGet(LAST_SYNC_STORAGE_KEY);
    if (storedTimestamp) {
        return storedTimestamp;
    }

    // Try DB
    const dbTimestamp = await getSyncMeta('last_sync_at');
    if (dbTimestamp) {
        // Backup to localStorage
        safeLocalStorageSet(LAST_SYNC_STORAGE_KEY, dbTimestamp);
        return dbTimestamp;
    }

    return null;
}

export async function setLastSyncTimestamp(timestamp: string): Promise<void> {
    safeLocalStorageSet(LAST_SYNC_STORAGE_KEY, timestamp);
    return setSyncMeta('last_sync_at', timestamp);
}

const USER_ID_STORAGE_KEY = 'piggy_user_id';

export async function getCurrentUserId(): Promise<string | null> {
    // Try localStorage first (fastest, most reliable for PWA)
    const storedUserId = safeLocalStorageGet(USER_ID_STORAGE_KEY);
    if (storedUserId) {
        return storedUserId;
    }

    // Try DB _sync_meta
    const dbUserId = await getSyncMeta('user_id');
    if (dbUserId) {
        // Backup to localStorage for next time
        safeLocalStorageSet(USER_ID_STORAGE_KEY, dbUserId);
        return dbUserId;
    }

    // Last resort: extract from existing local tables (for users who synced before this update)
    try {
        const database = await getDatabaseAsync();
        const tables = ['parameters', 'exchange_rates', 'credit_cards', 'recurring_rules', 'transactions'];

        for (const table of tables) {
            const result = await database.query<{ user_id: string }>(`
                SELECT DISTINCT user_id FROM ${table} LIMIT 1
            `);
            if (result.rows.length > 0) {
                const userId = result.rows[0].user_id;
                console.log(`[Offline DB] Recovered user_id from ${table}:`, userId);
                // Save for next time
                safeLocalStorageSet(USER_ID_STORAGE_KEY, userId);
                setSyncMeta('user_id', userId).catch(() => { });
                return userId;
            }
        }
    } catch (err) {
        console.error('[Offline DB] Failed to recover user_id from local data:', err);
    }

    return null;
}

export async function setCurrentUserId(userId: string): Promise<void> {
    // Store in both DB and localStorage for redundancy
    safeLocalStorageSet(USER_ID_STORAGE_KEY, userId);
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
