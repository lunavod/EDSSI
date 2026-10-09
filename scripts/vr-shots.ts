/**
 * Photographs the VR panels from a real EDSSI, so `npm run vr:preview` can show what they actually
 * look like rather than blank rectangles.
 *
 * It runs the app with `EDSSI_VR_CAPTURE` set, which renders the five panels and writes a PNG of
 * each every few seconds. Nothing is hung in SteamVR while capturing — see `vrCapturing` —
 * because the commander may well be flying with the real cockpit up, and two applications cannot
 * own the same overlay keys.
 *
 * Its own Electron user-data directory, its own EDSSI config and database, and the commander's real
 * journals read only: a capture must not disturb a running EDSSI, and must not upload anything.
 *
 * The commander's own `vr-overlay.json` is copied into that scratch config, though, so the panels
 * are photographed at the size and shape they have actually been given. Only that file: the rest of
 * the config holds API keys, and a capture has no business uploading anything.
 *
 *   npm run vr:shots                 about half a minute, into vr-shots/
 *   npm run vr:shots -- --seconds 45 longer, if the ledger hasn't finished reading
 *   npm run vr:shots -- --live       the real journal folder, whatever state the game is in
 *   npm run vr:shots -- --defaults   the built-in layout instead of the commander's own
 *   npm run vr:shots -- --layout <f> some other vr-overlay.json, for trying a size out
 *
 * By default it copies the newest journals that contain actual play into a scratch folder and
 * points EDSSI at those. With the game sitting at the main menu there is no session at all, and
 * every panel says "waiting for the journal" — which says nothing about how the panels look.
 */

import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Long enough for the journals to be read; the ledger is the slowest part. */
const DEFAULT_SECONDS = 30;

/** How many played-in journals to copy. Enough for a ledger and a route, quick to replay. */
const DEFAULT_JOURNALS = 4;

/** Where the game keeps them, when `EDSSI_JOURNAL_DIR` doesn't say otherwise. */
function journalFolder(): string {
  return (
    process.env['EDSSI_JOURNAL_DIR'] ??
    join(homedir(), 'Saved Games', 'Frontier Developments', 'Elite Dangerous')
  );
}

/**
 * The newest journals that hold a real session, newest first. A journal written while the game sat
 * at the main menu has a `Fileheader` and little else; replaying one leaves every panel empty.
 */
function playedJournals(folder: string, wanted: number): string[] {
  const files = readdirSync(folder)
    .filter((name) => name.startsWith('Journal.') && name.endsWith('.log'))
    .map((name) => ({ name, at: statSync(join(folder, name)).mtimeMs }))
    .toSorted((a, b) => b.at - a.at);

  const played: string[] = [];
  for (const file of files) {
    if (played.length >= wanted) break;
    const text = readFileSync(join(folder, file.name), 'utf8');
    // LoadGame means someone actually launched into the game; a jump or a scan means they played.
    if (!text.includes('"LoadGame"')) continue;
    if (!text.includes('"FSDJump"') && !text.includes('"Scan"')) continue;
    played.push(file.name);
  }

  return played;
}

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(`--${flag}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * Throwing away a scratch folder, and not minding if Windows is still holding a file in it — the
 * database is often locked for a moment after the app is killed, and it is scratch either way.
 */
function clean(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // Left behind; the next run writes over it.
  }
}

/**
 * Stops the whole spawned tree. Electron is several processes, and killing only the one we started
 * leaves its renderers and GPU process behind — they accumulate quickly across runs.
 */
function stop(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // Already gone, which is the outcome we wanted.
  }
}

function main(): void {
  const seconds = Number(argument('seconds') ?? DEFAULT_SECONDS);
  const shots = argument('out') ?? 'vr-shots';
  // Beside the shots, so one folder holds everything a capture makes and nothing of the commander's.
  const scratch = join(shots, '.run');

  clean(shots);
  mkdirSync(shots, { recursive: true });
  for (const part of ['userdata', 'config', 'data']) {
    mkdirSync(join(scratch, part), { recursive: true });
  }

  // The commander's own cockpit, unless the built-in one was asked for. Copied rather than used
  // where it lies, so a capture can never write over what they have arranged.
  if (!process.argv.includes('--defaults')) {
    const saved = argument('layout') ?? join(homedir(), '.edssi', 'vr-overlay.json');
    if (existsSync(saved)) {
      copyFileSync(saved, join(scratch, 'config', 'vr-overlay.json'));
      console.log(`Using ${saved}; --defaults for the built-in layout.`);
    } else {
      console.log('No saved layout found; using the built-in one.');
    }
  }

  // Journals with real play in them, unless asked for whatever the game is doing right now.
  let journals: string | undefined;
  if (!process.argv.includes('--live')) {
    const folder = journalFolder();
    const chosen = playedJournals(folder, Number(argument('journals') ?? DEFAULT_JOURNALS));
    if (chosen.length === 0) {
      console.error(`No played-in journals found in ${folder}; capturing live instead.`);
    } else {
      journals = join(process.cwd(), scratch, 'journals');
      mkdirSync(journals, { recursive: true });
      for (const name of chosen) copyFileSync(join(folder, name), join(journals, name));
      // The companion files the game rewrites in place; the panels read these too.
      for (const name of readdirSync(folder).filter((file) => file.endsWith('.json'))) {
        copyFileSync(join(folder, name), join(journals, name));
      }
      console.log(`Replaying ${chosen.length} played-in journals: ${chosen.join(', ')}`);
    }
  }

  console.log(`Capturing the panels for ${seconds}s into ${shots}/ …`);
  console.log('SteamVR is not touched, and a running EDSSI is left alone.\n');

  const child = spawn(
    'npx',
    ['electron', '.', `--user-data-dir=${join(process.cwd(), scratch, 'userdata')}`],
    {
      // npx is a shell script on Windows, so it needs one.
      shell: true,
      env: {
        ...process.env,
        EDSSI_VR_CAPTURE: join(process.cwd(), shots),
        ...(journals === undefined ? {} : { EDSSI_JOURNAL_DIR: journals }),
        EDSSI_CONFIG_DIR: join(process.cwd(), scratch, 'config'),
        EDSSI_DATA_DIR: join(process.cwd(), scratch, 'data'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      if (line.startsWith('[vr]')) console.log(line.trim());
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    // Chromium is noisy about caches it cannot share; only real trouble is worth showing.
    const lines = chunk
      .split('\n')
      .filter((line) => /error/i.test(line) && !/disk_cache|gpu/i.test(line));
    if (lines.length > 0) process.stderr.write(`${lines.join('\n')}\n`);
  });

  setTimeout(() => {
    stop(child.pid);
    setTimeout(() => {
      // Counted from what landed, rather than from the child's chatter.
      const written = readdirSync(shots).filter((name) => name.endsWith('.png'));
      clean(scratch);
      console.log(`\n${written.length} panels captured. Now run: npm run vr:preview`);
      process.exit(0);
    }, 2500);
  }, seconds * 1000);
}

main();
