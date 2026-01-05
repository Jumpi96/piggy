import { pullChanges, initialHydration, type PullResult } from './pull';
import { pushChanges, type PushResult } from './push';
import { getPendingChangesCount } from './queue';
import { getLastSyncTimestamp } from '../database';

export interface SyncResult {
    success: boolean;
    pull: PullResult;
    push: PushResult;
    duration: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncState {
    status: SyncStatus;
    lastSyncAt: string | null;
    pendingChanges: number;
    error: string | null;
    isHydrated: boolean;
}

// Sync lock to prevent concurrent syncs
let isSyncing = false;
let syncListeners: Array<(state: SyncState) => void> = [];

/**
 * Performs a full sync: push local changes, then pull server changes.
 * Push-first ensures local edits aren't overwritten.
 */
export async function runSync(): Promise<SyncResult> {
    if (isSyncing) {
        console.log('[Sync] Already syncing, skipping');
        return {
            success: false,
            pull: { success: false, tablesUpdated: 0, recordsProcessed: 0, errors: ['Sync already in progress'] },
            push: { success: false, changesPushed: 0, changesFailed: 0, errors: ['Sync already in progress'] },
            duration: 0
        };
    }

    if (!navigator.onLine) {
        console.log('[Sync] Offline, skipping sync');
        notifyListeners({ status: 'offline' });
        return {
            success: false,
            pull: { success: false, tablesUpdated: 0, recordsProcessed: 0, errors: ['Offline'] },
            push: { success: false, changesPushed: 0, changesFailed: 0, errors: ['Offline'] },
            duration: 0
        };
    }

    isSyncing = true;
    const startTime = Date.now();
    notifyListeners({ status: 'syncing' });

    try {
        console.log('[Sync] Starting full sync...');

        // Check if this is first sync
        const lastSync = await getLastSyncTimestamp();
        if (!lastSync) {
            console.log('[Sync] First sync detected, running initial hydration');
            await initialHydration();
        }

        // Push first - ensure local changes get to server before pulling
        const pushResult = await pushChanges();

        // Then pull - get latest server state
        const pullResult = await pullChanges();

        const duration = Date.now() - startTime;
        const success = pushResult.success && pullResult.success;

        console.log(`[Sync] Complete in ${duration}ms. Success: ${success}`);

        // Notify listeners of new state
        await updateSyncState(success ? null : 'Sync completed with errors');

        return {
            success,
            pull: pullResult,
            push: pushResult,
            duration
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[Sync] Fatal error:', errorMsg);

        await updateSyncState(errorMsg);

        return {
            success: false,
            pull: { success: false, tablesUpdated: 0, recordsProcessed: 0, errors: [errorMsg] },
            push: { success: false, changesPushed: 0, changesFailed: 0, errors: [errorMsg] },
            duration: Date.now() - startTime
        };
    } finally {
        isSyncing = false;
    }
}

/**
 * Quick sync - only pushes pending changes.
 * Use this for eager sync after local writes.
 */
export async function quickSync(): Promise<PushResult> {
    if (!navigator.onLine) {
        return { success: false, changesPushed: 0, changesFailed: 0, errors: ['Offline'] };
    }

    if (isSyncing) {
        return { success: false, changesPushed: 0, changesFailed: 0, errors: ['Sync in progress'] };
    }

    isSyncing = true;
    try {
        const result = await pushChanges();
        await updateSyncState(result.success ? null : 'Push failed');
        return result;
    } finally {
        isSyncing = false;
    }
}

/**
 * Triggers a background sync if online.
 * Non-blocking - fire and forget.
 */
export function triggerBackgroundSync(): void {
    if (navigator.onLine && !isSyncing) {
        quickSync().catch(err => {
            console.error('[Sync] Background sync failed:', err);
        });
    }
}

// Sync state management
async function updateSyncState(error: string | null): Promise<void> {
    const state = await getSyncState();
    state.error = error;
    state.status = error ? 'error' : 'idle';
    notifyListeners(state);
}

function notifyListeners(partialState: Partial<SyncState>): void {
    getSyncState().then(fullState => {
        const state = { ...fullState, ...partialState };
        syncListeners.forEach(listener => listener(state));
    });
}

export async function getSyncState(): Promise<SyncState> {
    const lastSyncAt = await getLastSyncTimestamp();
    const pendingChanges = await getPendingChangesCount();

    return {
        status: isSyncing ? 'syncing' : (navigator.onLine ? 'idle' : 'offline'),
        lastSyncAt,
        pendingChanges,
        error: null,
        isHydrated: lastSyncAt !== null
    };
}

export function subscribeSyncState(listener: (state: SyncState) => void): () => void {
    syncListeners.push(listener);
    return () => {
        syncListeners = syncListeners.filter(l => l !== listener);
    };
}

// Periodic sync setup
let syncInterval: ReturnType<typeof setInterval> | null = null;
const SYNC_INTERVAL_MS = 30000; // 30 seconds

export function startPeriodicSync(): void {
    if (syncInterval) return;

    syncInterval = setInterval(() => {
        if (navigator.onLine && !isSyncing) {
            runSync().catch(err => {
                console.error('[Sync] Periodic sync failed:', err);
            });
        }
    }, SYNC_INTERVAL_MS);

    console.log(`[Sync] Started periodic sync (every ${SYNC_INTERVAL_MS / 1000}s)`);
}

export function stopPeriodicSync(): void {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('[Sync] Stopped periodic sync');
    }
}

// Export types and utilities from sub-modules
export { trackChange, getPendingChanges, getPendingChangesCount } from './queue';
export type { PendingChange, OperationType } from './queue';
export type { PullResult } from './pull';
export type { PushResult } from './push';
