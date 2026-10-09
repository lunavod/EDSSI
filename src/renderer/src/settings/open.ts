/**
 * Asking for a page of the Settings tab from anywhere in the window — the Comms tab's "the
 * assistant isn't set up" note, say — without passing the request down through every component in
 * between. App switches to the tab; the Settings view turns to the page.
 */

import type { PageId } from './fields';

const EVENT = 'edssi:open-settings';

export function openSettings(page: PageId): void {
  window.dispatchEvent(new CustomEvent<PageId>(EVENT, { detail: page }));
}

/** Calls `listener` with each page asked for. Returns the way to stop listening. */
export function onOpenSettings(listener: (page: PageId) => void): () => void {
  const handle = (event: Event): void => {
    if (event instanceof CustomEvent && typeof event.detail === 'string') {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only openSettings sends it
      listener(event.detail as PageId);
    }
  };
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}
