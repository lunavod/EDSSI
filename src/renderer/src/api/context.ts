/**
 * Where the window's components reach the main process: through the context, never through
 * `window.edssi`, so one page can hold several EDSSIs, each with an `EdssiApi` of its own (the mock
 * UI in `src/mock/` draws the app against made-up data that way). Only `main.tsx` reads
 * `window.edssi`, to hand it to the provider.
 */

import { createContext, useCallback, useContext } from 'react';

import type { EdssiApi } from '../../../shared/api';
import type { ViewOptionsStore } from '../hud/useViewOption';
import type { PageId } from '../settings/fields';

/** Pages of the Settings tab asked for from elsewhere in the window (see `settings/open.ts`). */
export interface SettingsRequests {
  open: (page: PageId) => void;
  /** Calls `listener` with each page asked for. Returns the way to stop listening. */
  on: (listener: (page: PageId) => void) => () => void;
}

/** One EDSSI's link to its main process, and the state its windows keep per instance. */
export interface EdssiInstance {
  api: EdssiApi;
  viewOptions: ViewOptionsStore;
  settingsRequests: SettingsRequests;
  /**
   * The element carrying the design tokens, where the HUD colour is set: the document's root in
   * the app, one embedded EDSSI's own root in the mock.
   */
  themeRoot: () => HTMLElement;
  /**
   * Whether dialogs open modal. A modal dialog is drawn over the whole page, outside whatever
   * contains it, which an EDSSI embedded in someone else's page mustn't do.
   */
  modalDialogs: boolean;
  /**
   * Whether the window may use this computer's microphone, speakers and their list. The app's
   * window does, opening the microphone ahead of time; an EDSSI embedded in someone else's page
   * must never ask the visitor for a microphone.
   */
  localDevices: boolean;
  /**
   * Where a window remembers its small choices (a page's filters, the last Settings page): the
   * document's `localStorage` in the app; an embedded EDSSI's own, in memory, so it neither writes
   * into its host's storage nor shares choices with another instance.
   */
  storage: WindowStorage;
}

export type WindowStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const EdssiContext = createContext<EdssiInstance | null>(null);

export function useEdssiInstance(): EdssiInstance {
  const instance = useContext(EdssiContext);
  if (!instance) throw new Error('useEdssi() called outside <EdssiProvider>');
  return instance;
}

/** Opens a dialog the way this instance opens them (see `modalDialogs`). */
export function useOpenDialog(): (dialog: HTMLDialogElement) => void {
  const { modalDialogs } = useEdssiInstance();
  return useCallback(
    (dialog: HTMLDialogElement) => {
      if (dialog.open) return;
      if (modalDialogs) dialog.showModal();
      else dialog.show();
    },
    [modalDialogs],
  );
}

/** Whether this instance may use the computer's microphone and speakers (see `localDevices`). */
export function useLocalDevices(): boolean {
  return useEdssiInstance().localDevices;
}

/** This instance's storage for small choices (see `storage`). */
export function useWindowStorage(): WindowStorage {
  return useEdssiInstance().storage;
}

/**
 * Whether an event happened in this instance. In the app, which is the whole document, every one
 * did; an embedded EDSSI only owns what happened inside its root, so a listener on the window or
 * the document (Ctrl+S, a paste) leaves the rest of its host's page alone.
 */
export function useOwnsEvent(): (event: Event) => boolean {
  const { themeRoot } = useEdssiInstance();
  return useCallback(
    (event: Event) => {
      const root = themeRoot();
      return root === document.documentElement || event.composedPath().includes(root);
    },
    [themeRoot],
  );
}

/** The main process's API, for this instance of the app. */
export function useEdssi(): EdssiApi {
  return useEdssiInstance().api;
}
