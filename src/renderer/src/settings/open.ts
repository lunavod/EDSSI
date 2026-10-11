/**
 * Asking for a page of the Settings tab from anywhere in the window — the Comms tab's "the
 * assistant isn't set up" note, say — without passing the request down through every component in
 * between. App switches to the tab; the Settings view turns to the page. One per EDSSI on the page
 * (`EdssiProvider`), so a request in one never turns another.
 */

import { useEdssiInstance, type SettingsRequests } from '../api/context';
import type { PageId } from './fields';

export function createSettingsRequests(): SettingsRequests {
  const listeners = new Set<(page: PageId) => void>();
  return {
    open: (page) => {
      for (const listener of listeners) listener(page);
    },
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useSettingsRequests(): SettingsRequests {
  return useEdssiInstance().settingsRequests;
}
