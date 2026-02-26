import { pullChanges, initialHydration, fullTableResync, type PullResult } from './pull';
import { pushChanges, type PushResult } from './push';
import { getPendingChangesCount } from './queue';
import { getLastSyncTimestamp } from '../database';
import { checkReconciliation } from './reconcile';

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
    lastDataUpdate: number;
}

// Sync lock to prevent concurrent syncs
let isSyncing = false;
let syncRequestedWhileBusy = false;
let syncListeners: Array<(state: SyncState) => void> = [];
// Store last data update in memory (persists for session)
let lastDataUpdate = Date.now();

/**
 * Performs a full sync: push local changes, then pull server changes.
 * Push-first ensures local edits aren't overwritten.
 */
export async function runSync(): Promise<SyncResult> {
    if (isSyncing) {
        syncRequestedWhileBusy = true;
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
            // Initial hydration definitely brings data
            lastDataUpdate = Date.now();
        }

        // Push first - ensure local changes get to server before pulling
        const pushResult = await pushChanges();

        // Then pull - get latest server state
        const pullResult = await pullChanges();

        // Update data timestamp if we pulled anything new
        if (pullResult.success && pullResult.recordsProcessed > 0) {
            lastDataUpdate = Date.now();
        }

        // Reconciliation - check counts match between local and server
        const reconcileResult = await checkReconciliation();
        if (reconcileResult.mismatches.length > 0) {
            console.log('[Sync] Reconciliation found mismatches, triggering full re-pull');
            for (const table of reconcileResult.mismatches) {
                await fullTableResync(table);
            }
            // Mismatches mean we fixed/downloaded data
            lastDataUpdate = Date.now();
        }

        const duration = Date.now() - startTime;
        const success = pushResult.success && pullResult.success;

        console.log(`[Sync] Complete in ${duration}ms. Success: ${success}`);

        // Notify listeners of new state (including potentially new lastDataUpdate)
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
        flushDeferredQuickSync();
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
        syncRequestedWhileBusy = true;
        return { success: false, changesPushed: 0, changesFailed: 0, errors: ['Sync in progress'] };
    }

    isSyncing = true;
    try {
        const result = await pushChanges();
        await updateSyncState(result.success ? null : 'Push failed');
        return result;
    } finally {
        isSyncing = false;
        flushDeferredQuickSync();
    }
}

/**
 * Triggers a background sync if online.
 * Non-blocking - fire and forget.
 */
export function triggerBackgroundSync(): void {
    if (!navigator.onLine) return;

    if (isSyncing) {
        syncRequestedWhileBusy = true;
        return;
    }

    quickSync().catch(err => {
        console.error('[Sync] Background sync failed:', err);
    });
}

function flushDeferredQuickSync(): void {
    if (!syncRequestedWhileBusy || isSyncing || !navigator.onLine) return;

    syncRequestedWhileBusy = false;
    quickSync().catch(err => {
        console.error('[Sync] Deferred background sync failed:', err);
    });
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
    const lastSyncAtSync = await getLastSyncTimestamp();
    const pendingChanges = await getPendingChangesCount();

    return {
        status: isSyncing ? 'syncing' : (navigator.onLine ? 'idle' : 'offline'),
        lastSyncAt: lastSyncAtSync,
        pendingChanges,
        error: null,
        isHydrated: lastSyncAtSync !== null, // Renamed variable to avoid conflict
        lastDataUpdate
    };
}

export function subscribeSyncState(listener: (state: SyncState) => void): () => void {
    syncListeners.push(listener);
    return () => {
        syncListeners = syncListeners.filter(l => l !== listener);
    };
}

// Sync setup - triggers on visibility change and online events
let syncCleanup: (() => void) | null = null;

function handleVisibilityChange(): void {
    if (document.visibilityState === 'visible' && navigator.onLine && !isSyncing) {
        console.log('[Sync] App became visible, syncing...');
        runSync().catch(err => {
            console.error('[Sync] Visibility sync failed:', err);
        });
    }
}

function handleOnline(): void {
    if (!isSyncing) {
        console.log('[Sync] Network restored, syncing...');
        runSync().catch(err => {
            console.error('[Sync] Online sync failed:', err);
        });
    }
}

export function startPeriodicSync(): void {
    if (syncCleanup) return;

    // Sync when app becomes visible (tab focus, PWA resume)
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Sync when network is restored
    window.addEventListener('online', handleOnline);

    console.log('[Sync] Started visibility-based sync');

    syncCleanup = () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('online', handleOnline);
    };
}

export function stopPeriodicSync(): void {
    if (syncCleanup) {
        syncCleanup();
        syncCleanup = null;
        console.log('[Sync] Stopped visibility-based sync');
    }
}

export function isPeriodicSyncActive(): boolean {
    return syncCleanup !== null;
}

// Export types and utilities from sub-modules
export { trackChange, getPendingChanges, getPendingChangesCount, subscribePendingChanges } from './queue';
export type { PendingChange, OperationType } from './queue';
export type { PullResult } from './pull';
export type { PushResult } from './push';
export { checkReconciliation } from './reconcile';
export type { ReconcileResult } from './reconcile';
