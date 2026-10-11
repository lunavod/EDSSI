import { useCallback, useSyncExternalStore } from 'react';

import type { EdssiApi } from '../../../shared/api';
import {
  defaultViewOptions,
  type ViewOptionId,
  type ViewOptions,
  type ViewOptionsPatch,
  type ViewOptionValue,
} from '../../../shared/view-options';
import { useEdssiInstance } from '../api/context';

/**
 * The view options as the main process keeps them, one copy per EDSSI (`EdssiProvider`). They
 * start at the defaults, so a view draws at once, and catch up when the main process answers.
 */
export interface ViewOptionsStore {
  get: () => ViewOptions;
  subscribe: (listener: () => void) => () => void;
  /** Changes view options in every window; this one shows the change at once. */
  set: (patch: ViewOptionsPatch) => void;
}

export function createViewOptionsStore(api: EdssiApi): ViewOptionsStore {
  let options: ViewOptions = defaultViewOptions();
  const listeners = new Set<() => void>();
  let started = false;

  function publish(next: ViewOptions): void {
    options = next;
    for (const listener of listeners) listener();
  }

  function start(): void {
    if (started) return;
    started = true;
    let heard = false;
    // Subscribe first so nothing falls between the two; a change heard first is newer than the get.
    api.view.onChange((next) => {
      heard = true;
      publish(next);
    });
    api.view.get().then(
      (next) => {
        if (!heard) publish(next);
      },
      (error: unknown) => console.error('[view] failed to load the view options', error),
    );
  }

  return {
    get: () => options,
    subscribe: (listener) => {
      start();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (patch) => {
      publish({ ...options, ...patch });
      api.view
        .set(patch)
        .then(publish, (error: unknown) =>
          console.error('[view] failed to save the view options', error),
        );
    },
  };
}

/** Changes view options in every window; this one shows the change at once. */
export function useSetViewOptions(): (patch: ViewOptionsPatch) => void {
  return useEdssiInstance().viewOptions.set;
}

/** One view option, shared with every other window and the assistant, and a setter for it. */
export function useViewOption<K extends ViewOptionId>(
  id: K,
): [ViewOptionValue<K>, (value: ViewOptionValue<K>) => void] {
  const store = useEdssiInstance().viewOptions;
  const value = useSyncExternalStore(store.subscribe, () => store.get()[id]);
  const set = useCallback(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one key of the right type
    (next: ViewOptionValue<K>) => store.set({ [id]: next } as ViewOptionsPatch),
    [store, id],
  );
  return [value, set];
}
