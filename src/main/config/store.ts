import { mkdirSync, readFileSync, watchFile, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { parse } from 'yaml';

import {
  defaultSettings,
  parseSettings,
  type Settings,
  SETTINGS_TEMPLATE,
} from '../../shared/settings';
import { configPath } from './paths';

/** The file is edited by hand, so it's polled rather than watched (watching is unreliable here). */
const POLL_INTERVAL_MS = 1000;

export interface SettingsStore {
  readonly path: string;
  current(): Settings;
  /** Why the file was rejected; the defaults are in use until it is fixed. */
  problem(): string | undefined;
  /** Called whenever the file changes into something new. Returns an unsubscribe function. */
  onChange(listener: (settings: Settings) => void): () => void;
  /** Reads the file now rather than waiting for the next poll, after EDSSI itself wrote it. */
  reload(): void;
  stop(): void;
}

/**
 * Reads `~/.edssi/config.yaml` and keeps it up to date while EDSSI runs, so the commander can
 * change a model or a voice without restarting. A missing file is created from a template, and a
 * broken one leaves the last good settings in place.
 */
export function openSettings(path = configPath()): SettingsStore {
  const listeners = new Set<(settings: Settings) => void>();
  let settings = defaultSettings();
  let problem: string | undefined;
  let serialised = '';

  const load = (): void => {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      // No file yet: leave a template behind so there's something to fill in.
      settings = defaultSettings();
      problem = undefined;
      writeTemplate(path);
      return;
    }

    let parsed;
    try {
      parsed = parseSettings(parse(text));
    } catch (error) {
      // Not YAML at all; keep whatever was working before.
      problem = error instanceof Error ? error.message : String(error);
      return;
    }

    problem = parsed.problem;
    if (parsed.problem !== undefined) return; // Keep the last good settings.

    const next = JSON.stringify(parsed.settings);
    if (next === serialised) return;
    serialised = next;
    settings = parsed.settings;
    for (const listener of listeners) listener(settings);
  };

  load();
  serialised = JSON.stringify(settings);

  const onFileChange = (): void => {
    try {
      load();
    } catch (error) {
      console.error('[config] failed to reload', error);
    }
  };
  watchFile(path, { interval: POLL_INTERVAL_MS }, onFileChange);

  return {
    path,
    current: () => settings,
    problem: () => problem,
    reload: onFileChange,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      listeners.clear();
    },
  };
}

/** Best effort: a home directory EDSSI can't write to shouldn't stop the app. */
function writeTemplate(path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, SETTINGS_TEMPLATE, { flag: 'wx' });
  } catch (error) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a failed write throws this
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      console.error('[config] failed to write the settings template', error);
    }
  }
}
