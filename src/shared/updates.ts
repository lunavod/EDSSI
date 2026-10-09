/**
 * Updating EDSSI, as both sides see it: what the updater is doing, and the "What's new" notes,
 * which are `CHANGELOG_USER.md` cut into one section per version.
 */

/** What the updater is doing. */
export type UpdateState =
  /** Running from source (or a build that can't update itself): nothing to update. */
  | { status: 'unsupported' }
  | { status: 'idle'; checkedAt?: string; problem?: string }
  | { status: 'checking' }
  | { status: 'downloading'; version: string; percent: number }
  /** Downloaded: it installs when EDSSI next starts, or now if the commander says so. */
  | { status: 'ready'; version: string };

/** One version's notes. */
export interface ReleaseNotes {
  version: string;
  /** One line per bullet, `**bold**` kept for the window to render. */
  items: string[];
}

/** The notes as the window asks for them. */
export interface WhatsNew {
  /** The version running. */
  running: string;
  /** What came since the version last shown, newest first; empty once shown, or on a first install. */
  unseen: ReleaseNotes[];
  /** Every version's, newest first. */
  all: ReleaseNotes[];
}

/**
 * Compares two versions (`1.2.3`, `1.2.3-dev.4`) the way semver orders them, near enough: by
 * major, minor and patch, then a pre-release before the release it leads up to.
 */
export function compareVersions(a: string, b: string): number {
  const [aCore = '', aPre] = a.trim().replace(/^v/, '').split('-', 2);
  const [bCore = '', bPre] = b.trim().replace(/^v/, '').split('-', 2);
  const aParts = aCore.split('.').map(Number);
  const bParts = bCore.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (aPre === bPre) return 0;
  if (aPre === undefined) return 1;
  if (bPre === undefined) return -1;
  const aIds = aPre.split('.');
  const bIds = bPre.split('.');
  for (let i = 0; i < Math.max(aIds.length, bIds.length); i++) {
    const x = aIds[i];
    const y = bIds[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return Math.sign(diff);
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Reads `CHANGELOG_USER.md`: every `## <version>` heading starts a section, and each `- ` bullet
 * under it is an item (a bullet wrapped onto further lines is joined back up). Newest first, as
 * the file is written.
 */
export function parseReleaseNotes(markdown: string): ReleaseNotes[] {
  const notes: ReleaseNotes[] = [];
  let current: ReleaseNotes | undefined;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^##\s+v?(\d+\.\d+\.\d+\S*)/.exec(line);
    if (heading) {
      current = { version: heading[1]!, items: [] };
      notes.push(current);
      continue;
    }
    if (!current) continue;
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) current.items.push(bullet[1]!.trim());
    else if (line.trim() && current.items.length > 0) {
      const last = current.items.length - 1;
      current.items[last] = `${current.items[last]} ${line.trim()}`;
    }
  }
  return notes;
}

/**
 * The notes to show after an update: every version newer than the one last seen, up to and
 * including the one running, so skipping a release still shows what it brought. None on a first
 * install, when nothing has been seen yet.
 */
export function notesSince(
  notes: readonly ReleaseNotes[],
  lastSeen: string | undefined,
  running: string,
): ReleaseNotes[] {
  if (lastSeen === undefined) return [];
  return notes.filter(
    (note) =>
      compareVersions(note.version, lastSeen) > 0 && compareVersions(note.version, running) <= 0,
  );
}

/** A note's text cut into plain and `**bold**` runs, for the window to render. */
export function boldRuns(text: string): { text: string; bold: boolean }[] {
  const runs: { text: string; bold: boolean }[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index), bold: false });
    runs.push({ text: match[1]!, bold: true });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), bold: false });
  return runs;
}
