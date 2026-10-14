import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { countPendingImportEntries } from '../lib/api';
import { subscribePendingChanges } from '../lib/offline/sync';
import { useSyncData } from './useSyncData';

/**
 * Number of Inbox entries waiting for review. Refreshes after syncs, on navigation, and on
 * every local change (confirming or dismissing an entry queues one).
 */
export function usePendingImportCount(): number {
    const [count, setCount] = useState(0);
    const [localChanges, setLocalChanges] = useState(0);
    const lastDataUpdate = useSyncData();
    const location = useLocation();

    useEffect(() => subscribePendingChanges(() => setLocalChanges(n => n + 1)), []);

    useEffect(() => {
        let cancelled = false;
        countPendingImportEntries()
            .then(n => { if (!cancelled) setCount(n); })
            .catch(err => console.error('[Inbox] Failed to count pending entries', err));
        return () => { cancelled = true; };
    }, [lastDataUpdate, location.pathname, localChanges]);

    return count;
}
