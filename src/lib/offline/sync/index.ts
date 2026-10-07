import { pullChanges, initialHydration, fullTableResync, discardLocalChanges, type PullResult } from './pull';
import { pushChanges, type PushResult } from './push';
import { getPendingChangesCount, getFailedChanges, resetFailedChange, type PendingChange } from './queue';
import { getLastSyncTimestamp, getSyncMeta, setSyncMeta } from '../database';
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
// A full sync (push + pull) asked for while busy — e.g. the app resumed while a push from
// a save was running. Without this it degraded to push-only and the resume pull was lost.
let fullSyncRequestedWhileBusy = false;
let syncListeners: Array<(state: SyncState) => void> = [];
// Asked for while busy alongside the deferred full sync (e.g. "Sync now" during a push).
let forceReconcileRequestedWhileBusy = false;
// Store last data update in memory (persists for session)
let lastDataUpdate = Date.now();

// On phones visibilitychange fires on every app switch. A pull that ran this recently has
// nothing new to bring, so a resume inside this window only pushes pending changes.
export const RESUME_SYNC_COOLDOWN_MS = 60 * 1000;
// Completion time (ms) of the last fully successful runSync, for the resume cooldown.
let lastSuccessfulSyncAt = 0;

// Reconciliation compares whole-table counts and resyncs any table that differs. It is a
// safety net for silent divergence, not part of the normal flow, so it runs at most this
// often. Persisted, so cold launches of the PWA don't each count as "due".
export const RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
const LAST_RECONCILE_KEY = 'last_reconcile_at';

export interface RunSyncOptions {
    // Reconcile even if the interval hasn't elapsed (user-initiated "Sync now").
    forceReconcile?: boolean;
}

async function isReconcileDue(): Promise<boolean> {
    const last = await getSyncMeta(LAST_RECONCILE_KEY);
    const lastMs = last ? new Date(last).getTime() : NaN;
    // A stamp in the future (device clock moved back) must not suppress reconciliation.
    return !Number.isFinite(lastMs) || lastMs > Date.now() || Date.now() - lastMs >= RECONCILE_INTERVAL_MS;
}

/**
 * Performs a full sync: push local changes, then pull server changes.
 * Push-first ensures local edits aren't overwritten.
 */
export async function runSync({ forceReconcile = false }: RunSyncOptions = {}): Promise<SyncResult> {
    if (isSyncing) {
        fullSyncRequestedWhileBusy = true;
        forceReconcileRequestedWhileBusy ||= forceReconcile;
        console.log('[Sync] Already syncing, will run a full sync after');
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
        if (forceReconcile || await isReconcileDue()) {
            const reconcileResult = await checkReconciliation();
            if (reconcileResult.mismatches.length > 0) {
                console.log('[Sync] Reconciliation found mismatches, triggering full re-pull');
                for (const table of reconcileResult.mismatches) {
                    await fullTableResync(table);
                }
                // Mismatches mean we fixed/downloaded data
                lastDataUpdate = Date.now();
            }
            // Only a complete check starts the next interval. A failed RPC, or tables
            // skipped for pending changes, leave it due so the next sync checks again.
            // (A throwing resync never reaches this line, for the same reason.)
            if (reconcileResult.checked && reconcileResult.skipped.length === 0) {
                await setSyncMeta(LAST_RECONCILE_KEY, new Date().toISOString());
            }
        } else {
            console.log('[Sync] Reconciliation not due, skipping');
        }

        const duration = Date.now() - startTime;
        const success = pushResult.success && pullResult.success;
        if (success) {
            lastSuccessfulSyncAt = Date.now();
        }

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
    if (isSyncing || !navigator.onLine) return;

    if (fullSyncRequestedWhileBusy) {
        // A full sync pushes too, so it covers any pending quick sync.
        const forceReconcile = forceReconcileRequestedWhileBusy;
        fullSyncRequestedWhileBusy = false;
        syncRequestedWhileBusy = false;
        forceReconcileRequestedWhileBusy = false;
        runSync({ forceReconcile }).catch(err => {
            console.error('[Sync] Deferred full sync failed:', err);
        });
        return;
    }

    if (!syncRequestedWhileBusy) return;

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
    if (document.visibilityState === 'visible' && navigator.onLine) {
        const sinceLastSync = Date.now() - lastSuccessfulSyncAt;
        // Negative means the clock moved back: treat as expired, or pulls stop until it recovers.
        if (sinceLastSync >= 0 && sinceLastSync < RESUME_SYNC_COOLDOWN_MS) {
            // Pulled moments ago; still push anything queued since.
            console.log('[Sync] App became visible, synced recently - push only');
            triggerBackgroundSync();
            return;
        }
        console.log('[Sync] App became visible, syncing...');
        runSync().catch(err => {
            console.error('[Sync] Visibility sync failed:', err);
        });
    }
}

function handleOnline(): void {
    console.log('[Sync] Network restored, syncing...');
    runSync().catch(err => {
        console.error('[Sync] Online sync failed:', err);
    });
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

/** Changes that hit MAX_RETRIES and are no longer pushed automatically. */
export async function listFailedChanges(): Promise<PendingChange[]> {
    return getFailedChanges();
}

/** Puts a failed change back in the queue with a fresh retry budget and pushes it. */
export async function retryFailedChange(changeId: number): Promise<void> {
    await resetFailedChange(changeId);
    triggerBackgroundSync();
}

/**
 * Gives up on a failed change: drops every unsynced change for that record and restores
 * the server's copy locally. Needs to be online.
 */
export async function discardFailedChange(change: PendingChange): Promise<void> {
    await discardLocalChanges(change.table_name, change.record_id);
    // The local row changed: let pages reload.
    lastDataUpdate = Date.now();
    await updateSyncState(null);
}

// Export types and utilities from sub-modules
export { trackChange, getPendingChanges, getPendingChangesCount, subscribePendingChanges } from './queue';
export type { PendingChange, OperationType } from './queue';
export type { PullResult } from './pull';
export type { PushResult } from './push';
export { checkReconciliation } from './reconcile';
export type { ReconcileResult } from './reconcile';
