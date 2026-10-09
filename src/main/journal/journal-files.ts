import { readdir } from 'node:fs/promises';

// Current names look like Journal.2026-09-10T195058.01.log; pre-Odyssey ones like Journal.190110123456.01.log.
const JOURNAL_FILE_NAME =
  /^Journal\.(?:(\d{4}-\d{2}-\d{2}T\d{6})|(\d{2})(\d{2})(\d{2})(\d{6}))\.(\d{2})\.log$/;

/**
 * Returns a key that sorts journal files chronologically across both naming schemes, or
 * `undefined` if `fileName` isn't a journal file.
 */
export function journalSortKey(fileName: string): string | undefined {
  const match = JOURNAL_FILE_NAME.exec(fileName);
  if (!match) return undefined;
  const [, stamp, yy, mm, dd, time, part] = match;
  return `${stamp ?? `20${yy}-${mm}-${dd}T${time}`}.${part}`;
}

/** Key shared by all parts (`.01`, `.02`, …) of one game session. */
export function journalSessionKey(fileName: string): string | undefined {
  return journalSortKey(fileName)?.slice(0, -3);
}

/** Lists journal file names in `dir`, oldest first. A missing directory yields an empty list. */
export async function listJournalFiles(dir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  return names
    .flatMap((name) => {
      const key = journalSortKey(name);
      return key === undefined ? [] : [{ name, key }];
    })
    .toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ name }) => name);
}

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
