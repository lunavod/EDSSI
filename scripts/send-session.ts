/**
 * Sends whole game sessions to EDSM (or Inara), for the stretches the live upload never covered:
 * played before the key was set, or while EDSSI wasn't running.
 *
 *   npm run send-session -- --list
 *   npm run send-session                              # the newest session, as a dry run
 *   npm run send-session -- --session 2026-09-12 --send
 *   npm run send-session -- --last 2 --send
 *
 * Options:
 *   --list                 List the sessions in the journal folder and stop.
 *   --session <prefix>     A session to send, by the start of its key (e.g. 2026-09-12T190611 or
 *                          just 2026-09-12). Repeat for more than one.
 *   --last <n>             The newest n sessions (default 1, when --session isn't given).
 *   --target <edsm|inara>  Where to send; repeat for both (default edsm only).
 *   --include-sent         Also send what the live upload already has (past its cursor).
 *   --send                 Actually send. Without it, only says what would be sent.
 *
 * Every request is written to EDSSI's upload log, which the Settings tab shows. Uses the keys in
 * ~/.edssi/config.yaml and the database in %APPDATA%/EDSSI (EDSSI_CONFIG_DIR, EDSSI_DATA_DIR and
 * EDSSI_JOURNAL_DIR move them). EDSSI may keep running meanwhile.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { parse as parseYaml } from 'yaml';

import { configPath } from '../src/main/config/paths';
import { journalSessionKey, listJournalFiles } from '../src/main/journal/journal-files';
import { findJournalDir } from '../src/main/journal/locate';
import { parseJournalJson } from '../src/main/journal/parse';
import { openDatabase } from '../src/main/store/database';
import { UploadCursorStore } from '../src/main/store/upload-cursor-store';
import { UploadLogStore } from '../src/main/store/upload-log-store';
import { planBackfill, sendBackfill } from '../src/main/uploads/backfill';
import {
  comparePositions,
  type JournalPosition,
  type SendResult,
} from '../src/main/uploads/batcher';
import { EdsmJournalApi } from '../src/main/uploads/edsm-journal';
import { InaraApi } from '../src/main/uploads/inara-api';
import {
  EDSM_TIMING,
  type Encoder,
  edsmEncoder,
  INARA_TIMING,
  inaraEncoder,
  type UploadTiming,
} from '../src/main/uploads/uploads';
import type { JournalEvent } from '../src/shared/journal';
import { parseSettings, type Settings } from '../src/shared/settings';
import type { UploadTarget } from '../src/shared/uploads';

interface Session {
  key: string;
  files: string[];
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      list: { type: 'boolean', default: false },
      session: { type: 'string', multiple: true },
      last: { type: 'string' },
      target: { type: 'string', multiple: true },
      'include-sent': { type: 'boolean', default: false },
      send: { type: 'boolean', default: false },
    },
  });

  const dir = await findJournalDir();
  const sessions = groupSessions(await listJournalFiles(dir));
  if (sessions.length === 0) {
    console.error(`No journals in ${dir}`);
    return 1;
  }

  if (values.list) {
    console.log(`Sessions in ${dir}, newest last:`);
    for (const session of sessions.slice(-30)) {
      const parts = session.files.length > 1 ? ` (${session.files.length} parts)` : '';
      console.log(`  ${session.key}${parts}`);
    }
    return 0;
  }

  const chosen = chooseSessions(sessions, values.session, values.last);
  if (!chosen) return 1;

  // EDDN is news: listeners take old market or carrier data as stale, so it is never backfilled.
  const targets = (values.target ?? ['edsm']).filter((target): target is BackfillTarget => {
    const known = (BACKFILL_TARGETS as readonly string[]).includes(target);
    if (!known) console.error(`Unknown target "${target}"; use edsm or inara.`);
    return known;
  });
  if (targets.length === 0) return 1;

  const settings = readSettings();
  if (!settings) return 1;

  const events: JournalEvent[] = [];
  for (const session of chosen) {
    for (const file of session.files) events.push(...(await readJournal(join(dir, file))));
  }
  console.log(
    `Read ${events.length} lines from ${chosen.length} ${chosen.length === 1 ? 'session' : 'sessions'}: ${chosen.map((session) => session.key).join(', ')}`,
  );

  const dataDir =
    process.env['EDSSI_DATA_DIR'] ??
    join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'EDSSI');
  const db = openDatabase(join(dataDir, 'edssi.db'));
  const cursors = new UploadCursorStore(db);
  const log = new UploadLogStore(db);
  const software = { name: 'EDSSI', version: packageVersion() };

  let failed = false;
  try {
    for (const target of targets) {
      const ok = await backfill({
        target,
        events,
        settings,
        until: values['include-sent'] ? undefined : liveStart(target, cursors, log),
        send: values.send,
        log,
        software,
      });
      failed ||= !ok;
    }
  } finally {
    db.close();
  }
  if (!values.send) console.log('\nDry run: nothing was sent. Add --send to send it.');
  return failed ? 1 : 0;
}

const BACKFILL_TARGETS = ['edsm', 'inara'] as const;
type BackfillTarget = (typeof BACKFILL_TARGETS)[number];

async function backfill(options: {
  target: BackfillTarget;
  events: readonly JournalEvent[];
  settings: Settings;
  until: JournalPosition | undefined;
  send: boolean;
  log: UploadLogStore;
  software: { name: string; version: string };
}): Promise<boolean> {
  const { target, settings } = options;
  const name = target === 'edsm' ? 'EDSM' : 'Inara';
  console.log(`\n${name}`);

  const serviceSettings = settings[target];
  const apiKey = serviceSettings.api_key ?? '';
  if (!apiKey) {
    const where = `No ${name} API key in ${configPath()}; set it on the Settings tab first.`;
    // A dry run can still say what would go.
    if (options.send) {
      console.error(`  ${where}`);
      return false;
    }
    console.log(`  ${where}`);
  }
  if (target === 'inara') {
    console.log(
      '  Note: Inara keeps the latest ship, credits and ranks it is told about. Sending an old\n' +
        '  session after a newer one can leave it showing the older values until you play again.',
    );
  }

  // Each run gets its own encoder and client: both keep state from one request to the next.
  if (target === 'edsm') {
    const api = new EdsmJournalApi({ software: options.software });
    const commanderName = settings.edsm.commander_name;
    return runWith(
      edsmEncoder(settings.edsm),
      EDSM_TIMING,
      (batch) => api.send(batch, { apiKey, commanderName }),
      options,
    );
  }
  const api = new InaraApi({ software: options.software, isBeingDeveloped: false });
  return runWith(inaraEncoder(), INARA_TIMING, (batch) => api.send(batch, apiKey), options);
}

async function runWith<T>(
  encoder: Encoder<T>,
  timing: UploadTiming,
  send: (batch: readonly T[]) => Promise<SendResult>,
  options: Parameters<typeof backfill>[0],
): Promise<boolean> {
  const plan = planBackfill(options.events, encoder, options.until);
  const counts = new Map<string, number>();
  const systems = new Set<string>();
  for (const item of plan.items) {
    const { event, system } = encoder.describe(item.payload);
    counts.set(event, (counts.get(event) ?? 0) + 1);
    if (system) systems.add(system);
  }

  if (options.until) {
    console.log(
      `  The live upload covers ${options.until.timestamp} onwards, so the ${plan.alreadySent} ` +
        'lines from then on are left to it (--include-sent sends them too).',
    );
  } else {
    console.log('  The live upload has never run for this service, so everything is sent.');
  }
  for (const [reason, lines] of plan.held) console.log(`  Not sent (${lines} lines): ${reason}`);

  if (plan.items.length === 0) {
    console.log('  Nothing to send.');
    return true;
  }
  const top = [...counts]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([event, count]) => `${event} ×${count}`)
    .join(', ');
  console.log(
    `  ${plan.items.length} events, ${plan.items[0]!.position.timestamp} to ${plan.items.at(-1)!.position.timestamp}`,
  );
  console.log(`  ${top}${counts.size > 8 ? ', …' : ''}`);
  console.log(`  ${systems.size} systems`);
  if (options.target === 'edsm') {
    console.log("  EDSM's discard list drops some of these (Music, for one) as they are sent.");
  }

  if (!options.send) return true;

  const requests = Math.ceil(plan.items.length / timing.maxBatch);
  console.log(
    `  Sending in about ${requests} ${requests === 1 ? 'request' : 'requests'}, one every ${timing.minIntervalMs / 1000} s at most…`,
  );
  const outcome = await sendBackfill({
    target: options.target,
    items: plan.items,
    encoder,
    timing,
    send,
    log: (entry) => options.log.add(entry),
    onResult: (result, done, total) => {
      const detail =
        result.kind === 'sent'
          ? `${result.accepted} kept${result.refused?.length ? `, ${result.refused.length} refused` : ''}${result.skipped ? `, ${result.skipped} not wanted` : ''}`
          : `${result.kind}: ${result.message}`;
      console.log(`  ${done}/${total} · ${detail}`);
    },
  });

  console.log(
    `  Done: ${outcome.accepted} of ${outcome.answered} events kept, in ${outcome.requests} requests.`,
  );
  if (outcome.stopped) {
    console.error(`  Stopped early: ${outcome.stopped}`);
    return false;
  }
  return true;
}

/**
 * Where the live upload's own sending begins: the oldest event it has logged sending, or else its
 * cursor. The cursor alone is how far it has got, and the lines between the key being set and the
 * cursor went too (before the upload log existed, only the cursor is known).
 */
function liveStart(
  target: UploadTarget,
  cursors: UploadCursorStore,
  log: UploadLogStore,
): JournalPosition | undefined {
  const cursor = cursors.get(target);
  const first = log.firstLiveEvent(target);
  if (first === undefined) return cursor;
  const start = { timestamp: first, index: 0 };
  return cursor && comparePositions(cursor, start) < 0 ? cursor : start;
}

function groupSessions(files: readonly string[]): Session[] {
  const sessions: Session[] = [];
  for (const file of files) {
    const key = journalSessionKey(file);
    if (key === undefined) continue;
    const last = sessions.at(-1);
    if (last?.key === key) last.files.push(file);
    else sessions.push({ key, files: [file] });
  }
  return sessions;
}

function chooseSessions(
  sessions: readonly Session[],
  prefixes: readonly string[] | undefined,
  last: string | undefined,
): Session[] | undefined {
  if (prefixes && prefixes.length > 0) {
    const chosen = sessions.filter((session) =>
      prefixes.some((prefix) => session.key.startsWith(prefix)),
    );
    if (chosen.length === 0) {
      console.error(`No session starts with ${prefixes.join(' or ')}. Try --list.`);
      return undefined;
    }
    return chosen;
  }
  const count = last === undefined ? 1 : Number.parseInt(last, 10);
  if (!Number.isInteger(count) || count < 1) {
    console.error('--last takes a whole number of sessions.');
    return undefined;
  }
  return sessions.slice(-count);
}

function readSettings(): Settings | undefined {
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(configPath(), 'utf8'));
  } catch (error) {
    console.error(`Couldn't read ${configPath()}:`, error instanceof Error ? error.message : error);
    return undefined;
  }
  const { settings, problem } = parseSettings(raw);
  if (problem) {
    console.error(`${configPath()} was rejected: ${problem}`);
    return undefined;
  }
  return settings;
}

async function readJournal(path: string): Promise<JournalEvent[]> {
  const events: JournalEvent[] = [];
  for (const line of (await readFile(path, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- journal lines, typed not validated
      events.push(parseJournalJson(line) as JournalEvent);
    } catch {
      // A half-written last line, most likely; the rest of the file is still good.
    }
  }
  return events;
}

function packageVersion(): string {
  const url = new URL('../package.json', import.meta.url);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own package.json
  return (JSON.parse(readFileSync(url, 'utf8')) as { version: string }).version;
}

process.exitCode = await main();
