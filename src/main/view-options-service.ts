/**
 * The view options (`src/shared/view-options.ts`), kept here so every window — the VR panels are
 * windows of their own — and the assistant share them, and kept in `~/.edssi/view-options.json` so
 * they survive a restart. Not in `config.yaml`: they change with every click of a sort button, and
 * the settings file is the commander's to read.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { ipcMain } from 'electron';

import { IpcChannel } from '../shared/api';
import {
  defaultViewOptions,
  VIEW_OPTION_IDS,
  type ViewOptions,
  type ViewOptionsPatch,
  readViewOptionsPatch,
  withViewOptions,
} from '../shared/view-options';
import { broadcast } from './broadcast';
import { viewOptionsPath } from './config/paths';

export class ViewOptionsStore {
  private options: ViewOptions;
  private readonly listeners = new Set<(options: ViewOptions) => void>();

  constructor(private readonly path = viewOptionsPath()) {
    this.options = withViewOptions({}, this.load());
  }

  current(): ViewOptions {
    return this.options;
  }

  /** Applies the valid entries of `patch`; whatever else it holds is ignored. */
  set(patch: unknown): ViewOptions {
    const next = withViewOptions(this.options, patch);
    if (VIEW_OPTION_IDS.every((id) => next[id] === this.options[id])) return this.options;
    this.options = next;
    this.save();
    for (const listener of this.listeners) listener(next);
    return next;
  }

  onChange(listener: (options: ViewOptions) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private load(): ViewOptionsPatch {
    try {
      if (!existsSync(this.path)) return {};
      return readViewOptionsPatch(JSON.parse(readFileSync(this.path, 'utf8')));
    } catch (error) {
      console.error('[view] could not read the view options', error);
      return {};
    }
  }

  /** Writes only what differs from the defaults, so a better default later still reaches them. */
  private save(): void {
    const defaults = defaultViewOptions();
    const changed = Object.fromEntries(
      VIEW_OPTION_IDS.filter((id) => this.options[id] !== defaults[id]).map((id) => [
        id,
        this.options[id],
      ]),
    );
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, `${JSON.stringify(changed, null, 2)}\n`, 'utf8');
    } catch (error) {
      console.error('[view] could not save the view options', error);
    }
  }
}

export function startViewOptionsService(store: ViewOptionsStore): { stop(): void } {
  const unsubscribe = store.onChange((options) =>
    broadcast(IpcChannel.ViewOptionsChanged, options),
  );
  ipcMain.handle(IpcChannel.ViewOptionsGet, (): ViewOptions => store.current());
  ipcMain.handle(IpcChannel.ViewOptionsSet, (_event, patch: unknown): ViewOptions =>
    store.set(patch),
  );
  return { stop: unsubscribe };
}
