import { type ReactNode, useState } from 'react';

import type { EdssiApi } from '../../../shared/api';
import { createViewOptionsStore } from '../hud/useViewOption';
import { createSettingsRequests } from '../settings/open';
import { EdssiContext, type EdssiInstance, type WindowStorage } from './context';

const documentRoot = () => document.documentElement;

/** The document's own storage, read when used (it can be unavailable, which callers allow for). */
const documentStorage: WindowStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

/** Storage that lasts as long as the instance, for an EDSSI embedded in someone else's page. */
export function memoryStorage(): WindowStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

/**
 * Gives everything under it one EDSSI: `api` and the state kept beside it. The app passes only
 * `api`; an embedded one (the mock) also its own `themeRoot`, `modalDialogs={false}` and
 * `localDevices={false}` and a `storage` of its own.
 */
export function EdssiProvider({
  api,
  themeRoot = documentRoot,
  modalDialogs = true,
  localDevices = true,
  storage = documentStorage,
  children,
}: {
  api: EdssiApi;
  themeRoot?: () => HTMLElement;
  modalDialogs?: boolean;
  localDevices?: boolean;
  storage?: WindowStorage;
  children: ReactNode;
}) {
  // Made once per provider: a new api is a new instance, given a new key by whoever renders this.
  const [instance] = useState<EdssiInstance>(() => ({
    api,
    viewOptions: createViewOptionsStore(api),
    settingsRequests: createSettingsRequests(),
    themeRoot,
    modalDialogs,
    localDevices,
    storage,
  }));
  return <EdssiContext.Provider value={instance}>{children}</EdssiContext.Provider>;
}
