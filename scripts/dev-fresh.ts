/**
 * `npm run dev:fresh`: EDSSI as a first-time user sees it. The dev server, started with a settings
 * folder, data folder (database, downloads, the window's own storage) and journal folder that are
 * all new and empty, under the system's temp folder — nothing of the real EDSSI is read or touched.
 *
 *   npm run dev:fresh             a new, empty run
 *   npm run dev:fresh -- --keep   carry on from the last fresh run (a second start, say)
 *
 * Each run gets a folder of its own, so one still open (a fresh EDSSI left running holds its
 * settings folder) never stops the next from starting; the old ones are cleared away as far as
 * they can be.
 *
 * The journal folder is empty, so nothing is uploaded to EDSM, Inara or EDDN; drop a journal file
 * in it to play one back.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = join(tmpdir(), 'edssi-fresh');
const keep = process.argv.includes('--keep');
mkdirSync(base, { recursive: true });

// Runs are named by when they started, so the newest sorts last.
const runs = readdirSync(base)
  .filter((name) => /^\d+$/u.test(name))
  .toSorted();
const last = runs.at(-1);
const root = keep && last ? join(base, last) : join(base, String(Date.now()));

if (!keep) {
  // Every earlier run, and anything else left in here (older versions used the folder itself).
  for (const old of readdirSync(base)) {
    try {
      rmSync(join(base, old), { recursive: true, force: true });
    } catch {
      // Still in use by a fresh EDSSI that is running; it goes next time.
    }
  }
}

const dirs = {
  EDSSI_CONFIG_DIR: join(root, 'config'),
  EDSSI_DATA_DIR: join(root, 'data'),
  EDSSI_JOURNAL_DIR: join(root, 'journal'),
};
for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });

console.log(
  keep && last ? 'Carrying on from the last fresh run:' : 'A fresh EDSSI, with nothing set up:',
);
for (const [name, dir] of Object.entries(dirs)) console.log(`  ${name}=${dir}`);

const child = spawn('npx', ['electron-vite', 'dev'], {
  env: { ...process.env, ...dirs },
  stdio: 'inherit',
  // npx is a .cmd on Windows, which only runs through a shell.
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 0));
