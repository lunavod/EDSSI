import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SAVED_GAMES_FOLDER_ID = '{4C5C32FF-BB9D-43b0-B5B4-2D72E54EAAA4}';
const SHELL_FOLDER_KEYS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders',
];
const GAME_SUBDIR = join('Frontier Developments', 'Elite Dangerous');

/**
 * Finds the journal directory: `EDSSI_JOURNAL_DIR` if set, otherwise the game's folder under
 * Saved Games (which users can relocate, hence the registry lookup). Falls back to the default
 * location even if it doesn't exist yet — the game may simply not have been run.
 */
export async function findJournalDir(): Promise<string> {
  const override = process.env['EDSSI_JOURNAL_DIR'];
  if (override) return override;

  if (process.platform === 'win32') {
    for (const key of SHELL_FOLDER_KEYS) {
      const savedGames = await readRegistryString(key, SAVED_GAMES_FOLDER_ID);
      // reg.exe prints in the OEM code page, so a non-ASCII path can come back mangled; the
      // existence check weeds that out.
      if (savedGames && (await isDirectory(join(savedGames, GAME_SUBDIR)))) {
        return join(savedGames, GAME_SUBDIR);
      }
    }
  }
  return join(homedir(), 'Saved Games', GAME_SUBDIR);
}

async function readRegistryString(key: string, name: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', key, '/v', name], {
      windowsHide: true,
    });
    const value = /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(stdout)?.[1]?.trim();
    return value && expandEnvironmentVariables(value);
  } catch {
    return undefined; // Value not present.
  }
}

function expandEnvironmentVariables(value: string): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
