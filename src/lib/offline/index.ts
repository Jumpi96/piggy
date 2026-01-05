// Main offline module exports

// Database
export {
    initDatabase,
    getDatabase,
    getDatabaseAsync,
    clearDatabase,
    getSyncMeta,
    setSyncMeta,
    getLastSyncTimestamp,
    setLastSyncTimestamp,
    getCurrentUserId,
    setCurrentUserId,
    isUsingPersistence
} from './database';

// Schema
export {
    SCHEMA_VERSION,
    SYNC_TABLES,
    tableHasUpdatedAt,
    tableHasSoftDelete,
    type SyncTableName
} from './schema';

// Sync
export {
    runSync,
    quickSync,
    triggerBackgroundSync,
    getSyncState,
    subscribeSyncState,
    startPeriodicSync,
    stopPeriodicSync,
    trackChange,
    getPendingChanges,
    getPendingChangesCount,
    type SyncResult,
    type SyncStatus,
    type SyncState,
    type PendingChange,
    type OperationType,
    type PullResult,
    type PushResult
} from './sync';

// Network
export {
    useNetworkStatus,
    useSyncState,
    useOfflineStatus,
    formatLastSync,
    type NetworkStatus
} from './network';
