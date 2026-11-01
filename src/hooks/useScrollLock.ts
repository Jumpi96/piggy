import { useEffect } from 'react';

/**
 * Stops the page behind a modal from scrolling while it is open. Which element scrolls the
 * page depends on the layout: on a phone the document does (the layout is `min-h-screen`, so
 * <main> grows with its content), on desktop <main> can. Lock both, and restore their previous
 * values on close.
 */
export function useScrollLock(active: boolean = true): void {
    useEffect(() => {
        if (!active) return;
        const scrollers = [document.documentElement, document.querySelector('main')]
            .filter((el): el is HTMLElement => el instanceof HTMLElement);
        const previous = scrollers.map(el => el.style.overflow);
        scrollers.forEach(el => { el.style.overflow = 'hidden'; });
        return () => {
            scrollers.forEach((el, i) => { el.style.overflow = previous[i]; });
        };
    }, [active]);
}
