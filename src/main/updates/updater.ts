/**
 * The update cycle, over electron-updater's `autoUpdater` (or a fake one, in the tests).
 *
 * An update downloads in the background while EDSSI runs, and is never installed on quit: the
 * commander closes EDSSI expecting it to stay closed. It installs at the next start instead, before
 * anything else is up (`installPending`), since the services start processes of their own — Kokoro's
 * worker, whisper-server, the VR host — and the installer can't replace files while they hold them.
 * A marker in the data folder says a download finished, so a start only asks when there is
 * something to install. The commander can also restart into it at once.
 */

import type { UpdateState } from '../../shared/updates';
import { compareVersions } from '../../shared/updates';
import { clearPending, readPending, type UpdaterLogger, writePending } from './files';

/** The parts of electron-updater's `AppUpdater` used here. */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  disableWebInstaller: boolean;
  /** Set to an `UpdaterLogger`; electron-updater types its own more narrowly. */
  logger: object | null;
  on(event: 'checking-for-update', listener: () => void): unknown;
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown;
  on(event: 'update-not-available', listener: () => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  off(event: string, listener: (...args: never[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

/** How long a start waits to hear the pending update is there before carrying on without it. */
export const INSTALL_CHECK_TIMEOUT_MS = 5000;

function configure(updater: Updater, logger: UpdaterLogger): void {
  // autoDownload is also what makes electron-updater find an installer it already downloaded and
  // say `update-downloaded` straight away; without it the cached file is ignored.
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  // EDSSI ships the whole installer, never a web one.
  updater.disableWebInstaller = true;
  updater.logger = logger;
}

/**
 * Installs the update downloaded on an earlier run, if there is one, before EDSSI starts anything.
 * Resolves true when the installer is on its way (EDSSI is quitting, and the installer starts it
 * again), false to carry on starting.
 */
export async function installPending(options: {
  dir: string;
  running: string;
  updater: () => Promise<Updater>;
  logger: UpdaterLogger;
  timeoutMs?: number;
}): Promise<boolean> {
  const { dir, running, logger } = options;
  const pending = readPending(dir);
  if (!pending) return false;
  if (compareVersions(pending.version, running) <= 0) {
    // Installed last time (or never needed): the marker has done its job.
    logger.info(`running ${running}, clearing the marker for ${pending.version}`);
    clearPending(dir);
    return false;
  }
  logger.info(`${pending.version} is waiting to be installed over ${running}`);
  const updater = await options.updater();
  configure(updater, logger);

  return new Promise<boolean>((resolve) => {
    const finish = (installing: boolean): void => {
      clearTimeout(timer);
      updater.off('update-downloaded', onDownloaded);
      updater.off('update-not-available', onNotAvailable);
      updater.off('error', onError);
      resolve(installing);
    };
    const onDownloaded = (info: { version: string }): void => {
      logger.info(`installing ${info.version}`);
      finish(true);
      // Silent (the installer's /S), so an update never walks the commander through its pages,
      // and started again once it is done.
      updater.quitAndInstall(true, true);
    };
    const onNotAvailable = (): void => {
      // Pulled from the server, most likely: nothing to install after all.
      logger.info('no update available after all, clearing the marker');
      clearPending(dir);
      finish(false);
    };
    const onError = (error: Error): void => {
      logger.warn('could not install the pending update:', error);
      finish(false);
    };
    // The installer may be gone from the cache, in which case this downloads it again: rather than
    // keep the commander waiting for that, start as usual and let the running EDSSI fetch it.
    const timer = setTimeout(() => {
      logger.warn('the pending update took too long to find, starting without it');
      finish(false);
    }, options.timeoutMs ?? INSTALL_CHECK_TIMEOUT_MS);
    updater.on('update-downloaded', onDownloaded);
    updater.on('update-not-available', onNotAvailable);
    updater.on('error', onError);
    updater.checkForUpdates().catch(onError);
  });
}

/** Follows the updater while EDSSI runs, saying what it is doing. */
export interface UpdateWatch {
  state(): UpdateState;
  /** Asks the server; nothing happens once an update is downloaded and waiting. */
  check(): void;
  /** Quits and installs the downloaded update, starting EDSSI again after. */
  install(): void;
}

export function watchUpdater(options: {
  dir: string;
  running: string;
  updater: Updater;
  logger: UpdaterLogger;
  onChange: (state: UpdateState) => void;
  now?: () => Date;
}): UpdateWatch {
  const { dir, updater, logger } = options;
  const now = options.now ?? (() => new Date());
  configure(updater, logger);
  logger.info(`watching for updates to ${options.running}`);

  let state: UpdateState = { status: 'idle' };
  const set = (next: UpdateState): void => {
    state = next;
    options.onChange(state);
  };

  updater.on('checking-for-update', () => {
    if (state.status === 'idle') set({ status: 'checking' });
  });
  updater.on('update-available', (info) => {
    set({ status: 'downloading', version: info.version, percent: 0 });
  });
  updater.on('download-progress', (progress) => {
    if (state.status === 'downloading') {
      set({ ...state, percent: Math.round(progress.percent) });
    }
  });
  updater.on('update-not-available', () => {
    set({ status: 'idle', checkedAt: now().toISOString() });
  });
  updater.on('update-downloaded', (info) => {
    try {
      writePending(dir, { version: info.version, downloadedAt: now().toISOString() });
    } catch (error) {
      logger.warn('could not write the pending-update marker:', error);
    }
    set({ status: 'ready', version: info.version });
  });
  updater.on('error', (error) => {
    logger.error('update failed:', error);
    // The first line says what went wrong; the rest is electron-updater's detail, in the log.
    const problem = (error.message || String(error)).split('\n')[0];
    if (state.status !== 'ready') {
      set({ status: 'idle', checkedAt: now().toISOString(), ...(problem && { problem }) });
    }
  });

  return {
    state: () => state,
    check() {
      if (state.status === 'ready' || state.status === 'downloading') return;
      updater.checkForUpdates().catch((error: unknown) => {
        // The 'error' event has said it already.
        logger.warn('check failed:', error);
      });
    },
    install() {
      if (state.status !== 'ready') return;
      logger.info(`restarting into ${state.version}`);
      updater.quitAndInstall(true, true);
    },
  };
}
