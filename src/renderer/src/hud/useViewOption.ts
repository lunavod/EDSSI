import { useCallback, useSyncExternalStore } from 'react';

import {
  defaultViewOptions,
  type ViewOptionId,
  type ViewOptions,
  type ViewOptionsPatch,
  type ViewOptionValue,
} from '../../../shared/view-options';

/**
 * The view options as the main process keeps them, one copy per window. They start at the
 * defaults, so a view draws at once, and catch up when the main process answers.
 */
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
  window.edssi.view.onChange((next) => {
    heard = true;
    publish(next);
  });
  window.edssi.view.get().then(
    (next) => {
      if (!heard) publish(next);
    },
    (error: unknown) => console.error('[view] failed to load the view options', error),
  );
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes view options in every window; this one shows the change at once. */
export function setViewOptions(patch: ViewOptionsPatch): void {
  publish({ ...options, ...patch });
  window.edssi.view
    .set(patch)
    .then(publish, (error: unknown) =>
      console.error('[view] failed to save the view options', error),
    );
}

/** One view option, shared with every other window and the assistant, and a setter for it. */
export function useViewOption<K extends ViewOptionId>(
  id: K,
): [ViewOptionValue<K>, (value: ViewOptionValue<K>) => void] {
  const value = useSyncExternalStore(subscribe, () => options[id]);
  const set = useCallback(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one key of the right type
    (next: ViewOptionValue<K>) => setViewOptions({ [id]: next } as ViewOptionsPatch),
    [id],
  );
  return [value, set];
}
