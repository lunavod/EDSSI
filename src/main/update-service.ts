/**
 * Keeps EDSSI up to date (see `updates/updater.ts` for how), and serves the "What's new" notes
 * after an update. Updates come from the `publish` server in `electron-builder.yml`, which a
 * packaged build carries as `resources/app-update.yml`; running from source there is none, and
 * the window is told updating isn't supported.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, ipcMain } from 'electron';

import { IpcChannel } from '../shared/api';
import { notesSince, parseReleaseNotes, type UpdateState, type WhatsNew } from '../shared/updates';
import { broadcast } from './broadcast';
import {
  readSeenVersion,
  rotateLog,
  UPDATER_LOG_FILE,
  type UpdaterLogger,
  updaterLog,
  writeSeenVersion,
} from './updates/files';
import { installPending, type Updater, watchUpdater } from './updates/updater';

/** The first look waits until the window has painted and the services are up. */
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 30 * 60_000;
const LOG_KEEP_MS = 31 * 24 * 3600_000;

/** Whether this build can update itself: only an installed one can. */
export function canUpdate(): boolean {
  return app.isPackaged && process.platform === 'win32';
}

async function loadUpdater(): Promise<Updater> {
  // Loaded only when wanted: reading it sets up the NSIS updater, which a run from source can't use.
  const { autoUpdater } = await import('electron-updater');
  return autoUpdater;
}

function logFor(dataDir: string): UpdaterLogger {
  const path = join(dataDir, UPDATER_LOG_FILE);
  rotateLog(path, new Date(), LOG_KEEP_MS);
  return updaterLog(path);
}

/**
 * Before anything else starts: installs the update an earlier run downloaded. True when EDSSI is
 * quitting for the installer, which starts it again.
 */
export async function installPendingUpdate(dataDir: string): Promise<boolean> {
  if (!canUpdate()) return false;
  try {
    return await installPending({
      dir: dataDir,
      running: app.getVersion(),
      updater: loadUpdater,
      logger: logFor(dataDir),
    });
  } catch (error) {
    console.error('[updates] could not install the pending update', error);
    return false;
  }
}

/** `CHANGELOG_USER.md`: shipped beside the app, or at the top of the repository. */
function readChangelog(): string {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'CHANGELOG_USER.md')
    : join(app.getAppPath(), 'CHANGELOG_USER.md');
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export function startUpdateService(options: { dataDir: string }): { stop(): void } {
  const { dataDir } = options;
  const running = app.getVersion();

  // What's new: worked out once, against the version seen before this start. A first install has
  // seen nothing and is shown nothing; from then on this version counts as seen.
  const all = parseReleaseNotes(readChangelog());
  const seen = readSeenVersion(dataDir);
  let unseen = notesSince(all, seen, running);
  try {
    if (seen === undefined) writeSeenVersion(dataDir, running);
  } catch (error) {
    console.error('[updates] could not record the version seen', error);
  }
  ipcMain.handle(IpcChannel.UpdatesWhatsNew, (): WhatsNew => ({ running, unseen, all }));
  ipcMain.handle(IpcChannel.UpdatesSeen, () => {
    unseen = [];
    try {
      writeSeenVersion(dataDir, running);
    } catch (error) {
      console.error('[updates] could not record the version seen', error);
    }
  });

  let state: UpdateState = { status: 'unsupported' };
  let watcher: ReturnType<typeof watchUpdater> | undefined;
  ipcMain.handle(IpcChannel.UpdatesState, (): UpdateState => state);
  ipcMain.handle(IpcChannel.UpdatesCheck, () => watcher?.check());
  ipcMain.handle(IpcChannel.UpdatesInstall, () => watcher?.install());

  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  if (canUpdate()) {
    state = { status: 'idle' };
    void loadUpdater()
      .then((updater) => {
        if (stopped) return;
        watcher = watchUpdater({
          dir: dataDir,
          running,
          updater,
          logger: logFor(dataDir),
          onChange: (next) => {
            state = next;
            broadcast(IpcChannel.UpdatesChanged, state);
          },
        });
        const check = (): void => watcher?.check();
        timers.push(setTimeout(check, FIRST_CHECK_MS), setInterval(check, CHECK_EVERY_MS));
      })
      .catch((error: unknown) => {
        console.error('[updates] the updater failed to load', error);
        state = { status: 'idle', problem: 'The updater failed to load.' };
        broadcast(IpcChannel.UpdatesChanged, state);
      });
  }

  return {
    stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
    },
  };
}
