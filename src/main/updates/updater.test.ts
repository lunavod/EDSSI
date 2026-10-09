import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UpdateState } from '../../shared/updates';
import {
  readPending,
  readSeenVersion,
  trimLog,
  type UpdaterLogger,
  updaterLog,
  writePending,
  writeSeenVersion,
} from './files';
import { installPending, type Updater, watchUpdater } from './updater';

/** An updater that does what the test tells it to, when it says so. */
class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  disableWebInstaller = false;
  logger: object | null = null;
  checks = 0;
  installs: [boolean | undefined, boolean | undefined][] = [];
  onCheck: () => void = () => {};

  checkForUpdates(): Promise<unknown> {
    this.checks += 1;
    this.onCheck();
    return Promise.resolve(null);
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installs.push([isSilent, isForceRunAfter]);
  }
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- EventEmitter's loose overloads
const asUpdater = (fake: FakeUpdater): Updater => fake as unknown as Updater;

const quiet: UpdaterLogger = { info() {}, warn() {}, error() {}, debug() {} };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'edssi-updates-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('installPending', () => {
  it('does nothing without a marker', async () => {
    const updater = vi.fn();
    expect(await installPending({ dir, running: '1.0.0', updater, logger: quiet })).toBe(false);
    expect(updater).not.toHaveBeenCalled();
  });

  it('clears a marker for the version already running', async () => {
    writePending(dir, { version: '1.1.0', downloadedAt: '' });
    const updater = vi.fn();
    expect(await installPending({ dir, running: '1.1.0', updater, logger: quiet })).toBe(false);
    expect(readPending(dir)).toBeUndefined();
    expect(updater).not.toHaveBeenCalled();
  });

  it('installs the downloaded update silently and starts again', async () => {
    writePending(dir, { version: '1.1.0', downloadedAt: '' });
    const fake = new FakeUpdater();
    fake.onCheck = () => fake.emit('update-downloaded', { version: '1.1.0' });
    const installing = await installPending({
      dir,
      running: '1.0.0',
      updater: () => Promise.resolve(asUpdater(fake)),
      logger: quiet,
    });
    expect(installing).toBe(true);
    expect(fake.installs).toEqual([[true, true]]);
    expect(fake.autoDownload).toBe(true);
    expect(fake.autoInstallOnAppQuit).toBe(false);
  });

  it('clears the marker when the server has nothing after all', async () => {
    writePending(dir, { version: '1.1.0', downloadedAt: '' });
    const fake = new FakeUpdater();
    fake.onCheck = () => fake.emit('update-not-available');
    const installing = await installPending({
      dir,
      running: '1.0.0',
      updater: () => Promise.resolve(asUpdater(fake)),
      logger: quiet,
    });
    expect(installing).toBe(false);
    expect(readPending(dir)).toBeUndefined();
  });

  it('starts without it when the update is slow to turn up or fails', async () => {
    writePending(dir, { version: '1.1.0', downloadedAt: '' });
    const slow = new FakeUpdater();
    expect(
      await installPending({
        dir,
        running: '1.0.0',
        updater: () => Promise.resolve(asUpdater(slow)),
        logger: quiet,
        timeoutMs: 10,
      }),
    ).toBe(false);
    expect(slow.listenerCount('update-downloaded')).toBe(0);
    // Kept, so the running EDSSI downloads it again and the next start tries once more.
    expect(readPending(dir)?.version).toBe('1.1.0');

    const failing = new FakeUpdater();
    failing.onCheck = () => failing.emit('error', new Error('offline'));
    expect(
      await installPending({
        dir,
        running: '1.0.0',
        updater: () => Promise.resolve(asUpdater(failing)),
        logger: quiet,
      }),
    ).toBe(false);
    expect(failing.installs).toEqual([]);
  });
});

describe('watchUpdater', () => {
  function watch() {
    const fake = new FakeUpdater();
    const states: UpdateState[] = [];
    const watcher = watchUpdater({
      dir,
      running: '1.0.0',
      updater: asUpdater(fake),
      logger: quiet,
      onChange: (state) => states.push(state),
      now: () => new Date('2026-10-10T12:00:00Z'),
    });
    return { fake, states, watcher };
  }

  it('follows a check through the download, leaving a marker', () => {
    const { fake, states, watcher } = watch();
    fake.emit('checking-for-update');
    fake.emit('update-available', { version: '1.1.0' });
    fake.emit('download-progress', { percent: 41.6 });
    fake.emit('update-downloaded', { version: '1.1.0' });
    expect(states).toEqual([
      { status: 'checking' },
      { status: 'downloading', version: '1.1.0', percent: 0 },
      { status: 'downloading', version: '1.1.0', percent: 42 },
      { status: 'ready', version: '1.1.0' },
    ]);
    expect(readPending(dir)).toEqual({
      version: '1.1.0',
      downloadedAt: '2026-10-10T12:00:00.000Z',
    });

    // Waiting to be installed: no more checks, and the commander can restart into it.
    watcher.check();
    expect(fake.checks).toBe(0);
    watcher.install();
    expect(fake.installs).toEqual([[true, true]]);
  });

  it('says when it last looked, and what went wrong', () => {
    const { fake, states, watcher } = watch();
    watcher.check();
    expect(fake.checks).toBe(1);
    fake.emit('update-not-available');
    fake.emit('error', new Error('net::ERR_NAME_NOT_RESOLVED\nat somewhere'));
    expect(states.at(-2)).toEqual({ status: 'idle', checkedAt: '2026-10-10T12:00:00.000Z' });
    expect(states.at(-1)).toEqual({
      status: 'idle',
      checkedAt: '2026-10-10T12:00:00.000Z',
      problem: 'net::ERR_NAME_NOT_RESOLVED',
    });
    // Nothing downloaded, nothing to install.
    watcher.install();
    expect(fake.installs).toEqual([]);
  });
});

describe('files', () => {
  it('keeps the version last seen', () => {
    expect(readSeenVersion(dir)).toBeUndefined();
    writeSeenVersion(dir, '1.2.0');
    expect(readSeenVersion(dir)).toBe('1.2.0');
  });

  it('ignores a marker that is not one', () => {
    writeFileSync(join(dir, 'pending-update.json'), '{"vers');
    expect(readPending(dir)).toBeUndefined();
  });

  it('logs a line per message', () => {
    const path = join(dir, 'updater.log');
    const log = updaterLog(path, () => new Date('2026-10-10T12:00:00Z'));
    log.info('checking', { channel: 'latest' });
    log.warn('failed:', new Error('boom'));
    const text = readFileSync(path, 'utf8');
    expect(text).toMatch(/^2026-10-10T12:00:00.000Z \[INFO\] checking {"channel":"latest"}\n/);
    expect(text).toContain('[WARN] failed: Error: boom');
  });

  it('trims old lines, with whatever continues them', () => {
    const text = [
      '2026-08-01T00:00:00.000Z [ERROR] old',
      '    at the old stack',
      '2026-10-01T00:00:00.000Z [INFO] new',
      '    at the new stack',
      '',
    ].join('\n');
    expect(trimLog(text, new Date('2026-10-10T00:00:00Z'), 30 * 24 * 3600 * 1000)).toBe(
      '2026-10-01T00:00:00.000Z [INFO] new\n    at the new stack\n',
    );
  });
});
