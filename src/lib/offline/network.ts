import { useState, useEffect, useCallback } from 'react';
import { runSync, triggerBackgroundSync, getSyncState, subscribeSyncState, subscribePendingChanges, isPeriodicSyncActive, type SyncState } from './sync';

export interface NetworkStatus {
    isOnline: boolean;
    lastOnlineAt: Date | null;
}

/**
 * React hook for monitoring network status.
 * Triggers sync when coming back online.
 */
export function useNetworkStatus(): NetworkStatus {
    const [status, setStatus] = useState<NetworkStatus>({
        isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
        lastOnlineAt: typeof navigator !== 'undefined' && navigator.onLine ? new Date() : null
    });

    useEffect(() => {
        const handleOnline = () => {
            console.log('[Network] Back online');
            setStatus(() => ({
                isOnline: true,
                lastOnlineAt: new Date()
            }));

            if (!isPeriodicSyncActive()) {
                // Fallback for contexts where periodic sync isn't running.
                triggerBackgroundSync();
            }
        };

        const handleOffline = () => {
            console.log('[Network] Gone offline');
            setStatus(prev => ({
                ...prev,
                isOnline: false
            }));
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return status;
}

/**
 * React hook for monitoring sync state.
 * Provides current sync status, pending changes count, and last sync time.
 */
export function useSyncState(): SyncState & { refresh: () => Promise<void> } {
    const [state, setState] = useState<SyncState>({
        status: 'idle',
        lastSyncAt: null,
        pendingChanges: 0,
        error: null,
        isHydrated: false
    });

    const refresh = useCallback(async () => {
        const newState = await getSyncState();
        setState(newState);
    }, []);

    useEffect(() => {
        // Initial load
        refresh();

        // Subscribe to sync state changes
        const unsubscribeSyncState = subscribeSyncState((newState) => {
            setState(newState);
        });

        // Subscribe to pending changes updates (for real-time pending count)
        const unsubscribePending = subscribePendingChanges((count) => {
            setState(prev => ({ ...prev, pendingChanges: count }));
        });

        return () => {
            unsubscribeSyncState();
            unsubscribePending();
        };
    }, [refresh]);

    return { ...state, refresh };
}

/**
 * React hook that combines network and sync state.
 * Provides a unified view of offline/online and sync status.
 */
export function useOfflineStatus() {
    const network = useNetworkStatus();
    const sync = useSyncState();

    const manualSync = useCallback(async () => {
        if (!network.isOnline) {
            console.log('[Offline] Cannot sync while offline');
            return;
        }
        await runSync();
    }, [network.isOnline]);

    return {
        isOnline: network.isOnline,
        isSyncing: sync.status === 'syncing',
        lastSyncAt: sync.lastSyncAt ? new Date(sync.lastSyncAt) : null,
        pendingChanges: sync.pendingChanges,
        syncError: sync.error,
        isHydrated: sync.isHydrated,
        manualSync
    };
}

/**
 * Formats last sync time for display.
 */
export function formatLastSync(lastSyncAt: Date | null): string {
    if (!lastSyncAt) return 'Never';

    const now = new Date();
    const diffMs = now.getTime() - lastSyncAt.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);

    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    return lastSyncAt.toLocaleDateString();
}
