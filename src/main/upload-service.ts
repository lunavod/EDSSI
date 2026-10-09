import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, ipcMain } from 'electron';

import { IpcChannel } from '../shared/api';
import type { UploadLogEntry, UploadsSnapshot, UploadTarget } from '../shared/uploads';
import { broadcast } from './broadcast';
import type { SettingsStore } from './config/store';
import { COMPANION_FILES, type CompanionName, type JournalReader } from './journal';
import type { JournalService } from './journal-service';
import { parseJournalJson } from './journal/parse';
import type { UploadCursorStore } from './store/upload-cursor-store';
import type { UploadLogStore } from './store/upload-log-store';
import type { JournalPosition } from './uploads/batcher';
import { EddnApi } from './uploads/eddn';
import { EdsmJournalApi } from './uploads/edsm-journal';
import { InaraApi } from './uploads/inara-api';
import type { NewUploadLogEntry } from './uploads/log';
import { type CursorStore, Uploads } from './uploads/uploads';

/** Uploads report every queued event; windows hear at most this often. */
const BROADCAST_INTERVAL_MS = 500;
/** The most log entries a window may ask for at once. */
const MAX_LOG_ENTRIES = 1_000;

/**
 * The name EDSM, Inara and EDDN know EDSSI by. Inara only answers applications it has whitelisted
 * under this exact name.
 */
const SOFTWARE_NAME = 'EDSSI';

export interface UploadService {
  stop(): void;
}

/**
 * Sends the journal to EDSM, Inara and EDDN, so EDDI or EDMC needn't run alongside. `reader` is the
 * current session's reader; the journal service holds what it has read so far, which is replayed
 * into a service whose settings change.
 */
export function startUploadService(options: {
  reader: JournalReader;
  journal: JournalService;
  settings: SettingsStore;
  /** EDSSI's database, if it opened; without it the cursors last until EDSSI closes. */
  cursors: UploadCursorStore | undefined;
  /** Where every request is recorded; without the database the log lasts until EDSSI closes. */
  log: UploadLogStore | undefined;
}): UploadService {
  const log = options.log ?? memoryLog();
  const software = { name: SOFTWARE_NAME, version: app.getVersion() };
  let timer: NodeJS.Timeout | undefined;
  let latest: UploadsSnapshot | undefined;

  const uploads = new Uploads({
    cursors: options.cursors ?? memoryCursors(),
    edsm: new EdsmJournalApi({ software }),
    inara: new InaraApi({ software, isBeingDeveloped: !app.isPackaged }),
    // EDSSI_EDDN_TEST sends to its test schemas, which listeners ignore, for trying the sender out.
    eddn: new EddnApi({ software, test: Boolean(process.env['EDSSI_EDDN_TEST']) }),
    readCompanion: (name) => readCompanion(options.reader, name),
    log: (entry) => log.add(entry),
    onChange: (snapshot) => {
      latest = snapshot;
      timer ??= setTimeout(() => {
        timer = undefined;
        if (latest) broadcast(IpcChannel.UploadsChanged, latest);
      }, BROADCAST_INTERVAL_MS);
    },
  });

  const configure = () =>
    uploads.configure(options.settings.current(), options.journal.snapshot().events);
  configure();
  const unsubscribeSettings = options.settings.onChange(configure);
  const unsubscribeReader = options.reader.onAny((event) => uploads.apply(event));
  ipcMain.handle(IpcChannel.UploadsSnapshot, () => uploads.snapshot());
  ipcMain.handle(IpcChannel.UploadsLog, (_event, limit: unknown) =>
    log.recent(
      typeof limit === 'number' && limit > 0 ? Math.min(Math.floor(limit), MAX_LOG_ENTRIES) : 100,
    ),
  );

  return {
    stop() {
      clearTimeout(timer);
      unsubscribeSettings();
      unsubscribeReader();
      uploads.stop();
    },
  };
}

/**
 * A companion file as it is now. Read on the spot rather than waiting for the reader's next poll:
 * the game writes the file just before the journal line that announces it.
 */
function readCompanion(reader: JournalReader, name: CompanionName): unknown {
  if (!reader.dir) return undefined;
  try {
    return parseJournalJson(readFileSync(join(reader.dir, COMPANION_FILES[name]), 'utf8'));
  } catch {
    // Missing, or caught mid-write: the message is skipped.
    return undefined;
  }
}

function memoryLog(): Pick<UploadLogStore, 'add' | 'recent'> {
  const entries: UploadLogEntry[] = [];
  return {
    add: (entry: NewUploadLogEntry) => {
      entries.push({ ...entry, id: entries.length + 1 });
      if (entries.length > MAX_LOG_ENTRIES) entries.shift();
    },
    recent: (limit) => entries.slice(-limit).toReversed(),
  };
}

function memoryCursors(): CursorStore {
  const cursors = new Map<UploadTarget, JournalPosition>();
  return {
    get: (target) => cursors.get(target),
    set: (target, position) => void cursors.set(target, position),
  };
}
