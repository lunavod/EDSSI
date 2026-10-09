/**
 * Installs the FSS Exobio Overlay: EDSSI's own EDHM mod, which marks the FSS bands where bodies
 * that can have life show up.
 *
 * It draws through the shaders of the FSS-Overlay mod (psychicEgg and Parduz, maintained by
 * Fred89210). EDHM's licence doesn't let EDSSI ship those, so when they're missing they are
 * downloaded from EDHM's own repository, just as EDHM-UI's mod manager does, and that mod is
 * unpacked beside ours, switched off.
 *
 * 3Dmigoto loads every `.ini` under `EDHM-ini/3rdPartyMods`, and EDHM-UI lists what's there, so a
 * mod is on when it's in that folder and there is no other switch. Two mods hooking the same
 * shaders clash, so any other mod that does is moved to `3rdPartyMods-disabled`, which nothing
 * loads, and can be moved back by hand.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

import type { FssOverlayInstallResult, FssOverlayStatus } from '../../shared/edhm';
import { readZip } from './zip';

export const MOD_NAME = 'FSS-Overlay-Exobio';
const ORIGINAL_NAME = 'FSS-Overlay';
const PARKED = '3rdPartyMods-disabled';

/** The FSS shaders, one per graphics quality, that both mods draw through. */
export const FSS_SHADERS = [
  'd6c6b9abdf104b6d',
  '1d5a317f0e831e9d',
  '04fc7f00bade5b4a',
  'ea5390a2f20c2368',
];

const MOD_LIST_URL =
  'https://raw.githubusercontent.com/psychicEgg/EDHM/main/Odyssey/3rdPartyMods/mod_list.json';
const DOWNLOADS = 'https://github.com/psychicEgg/EDHM/';

const modsDir = (gameDir: string) => join(gameDir, 'EDHM-ini', '3rdPartyMods');
const parkedDir = (gameDir: string) => join(gameDir, 'EDHM-ini', PARKED);
const shaderPath = (gameDir: string, hash: string) =>
  join(gameDir, 'ShaderFixes', `${hash}-ps.txt`);

/**
 * The FSS-Overlay mod's shaders are in place. The game's own shaders don't sample a third texture,
 * so a file that doesn't declare `t2` isn't one the overlay can draw through.
 */
export function hasShaders(gameDir: string): boolean {
  return FSS_SHADERS.every((hash) => {
    try {
      return /dcl_resource_texture2d\s*\([^)]*\)\s*t2\b/.test(
        readFileSync(shaderPath(gameDir, hash), 'utf8'),
      );
    } catch {
      return false;
    }
  });
}

/** A mod in `3rdPartyMods`: its own folder, or loose `<name>.*` files in the root. */
interface ModFiles {
  name: string;
  paths: string[];
}

/** The mods in `3rdPartyMods`, other than ours, that hook any of the FSS shaders. */
export function findConflicts(gameDir: string): ModFiles[] {
  const root = modsDir(gameDir);
  const hashes = new RegExp(`^\\s*hash\\s*=\\s*(?:0x)?(?:${FSS_SHADERS.join('|')})\\b`, 'im');
  const conflicts = new Map<string, ModFiles>();

  for (const file of iniFiles(root)) {
    const [top, ...rest] = relative(root, file).split(sep);
    if (top === undefined || top === MOD_NAME || conflicts.has(top)) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!hashes.test(text)) continue;

    if (rest.length > 0) {
      conflicts.set(top, { name: top, paths: [join(root, top)] });
    } else {
      const name = basename(top, '.ini');
      const loose = readdirSync(root).filter((entry) => entry.startsWith(`${name}.`));
      conflicts.set(top, { name, paths: loose.map((entry) => join(root, entry)) });
    }
  }
  return [...conflicts.values()];
}

function iniFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return iniFiles(path);
    return entry.name.toLowerCase().endsWith('.ini') ? [path] : [];
  });
}

export function fssOverlayStatus(gameDir: string): FssOverlayStatus {
  return {
    state: 'ready',
    gameDir,
    installed: existsSync(join(modsDir(gameDir), MOD_NAME, `${MOD_NAME}.ini`)),
    shaders: hasShaders(gameDir),
    conflicts: findConflicts(gameDir).map((mod) => mod.name),
  };
}

export interface InstallOptions {
  gameDir: string;
  /** The mod as EDSSI ships it: the folder holding `FSS-Overlay-Exobio`. */
  bundleDir: string;
  /** Fetches the FSS-Overlay mod's zip, only called when its shaders are missing. */
  download: () => Promise<Buffer>;
}

export async function installFssOverlay({
  gameDir,
  bundleDir,
  download,
}: InstallOptions): Promise<FssOverlayInstallResult> {
  let downloaded = false;
  if (!hasShaders(gameDir)) {
    unpackOriginal(gameDir, await download());
    downloaded = true;
    if (!hasShaders(gameDir)) {
      throw new Error('The FSS-Overlay download didn’t have the shaders the overlay needs.');
    }
  }

  const parked: string[] = [];
  for (const mod of findConflicts(gameDir)) {
    park(gameDir, mod);
    parked.push(mod.name);
  }

  const target = join(modsDir(gameDir), MOD_NAME);
  rmSync(target, { recursive: true, force: true });
  cpSync(join(bundleDir, MOD_NAME), target, { recursive: true });

  return { status: fssOverlayStatus(gameDir), downloaded, parked };
}

/**
 * Writes the FSS-Overlay zip's shaders into `ShaderFixes`, and the mod itself into
 * `3rdPartyMods-disabled` so it's there to switch back to, unless it's already installed.
 * The zip's paths are relative to the game folder.
 */
function unpackOriginal(gameDir: string, zip: Buffer): void {
  const original = `EDHM-ini/3rdPartyMods/${ORIGINAL_NAME}/`;
  const keepOriginal =
    !existsSync(join(modsDir(gameDir), ORIGINAL_NAME)) &&
    !existsSync(join(parkedDir(gameDir), ORIGINAL_NAME));

  for (const { name, data } of readZip(zip)) {
    if (name.endsWith('/') || name.split('/').includes('..')) continue;

    let target: string | undefined;
    if (/^ShaderFixes\/[0-9a-f]{16}-ps\.txt$/i.test(name)) {
      target = join(gameDir, ...name.split('/'));
    } else if (keepOriginal && name.startsWith(original)) {
      target = join(parkedDir(gameDir), ORIGINAL_NAME, ...name.slice(original.length).split('/'));
    }
    if (!target) continue;

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}

/** Moves a mod out of `3rdPartyMods`, next to any it's already been parked beside. */
function park(gameDir: string, mod: ModFiles): void {
  let name = mod.name;
  for (let n = 2; existsSync(join(parkedDir(gameDir), name)); n++) name = `${mod.name} (${n})`;
  const into = join(parkedDir(gameDir), name);

  if (mod.paths.length === 1 && mod.paths[0] === join(modsDir(gameDir), mod.name)) {
    mkdirSync(parkedDir(gameDir), { recursive: true });
    move(mod.paths[0], into);
  } else {
    mkdirSync(into, { recursive: true });
    for (const path of mod.paths) move(path, join(into, basename(path)));
  }
}

function move(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    // Across volumes, or blocked by something holding the folder open for a moment.
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

/** Downloads the FSS-Overlay mod's current release, found through EDHM's own mod list. */
export async function downloadOriginal(fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const list = await fetchImpl(MOD_LIST_URL);
  if (!list.ok) throw new Error(`EDHM's mod list answered ${list.status}.`);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked below
  const mods = (await list.json()) as { mod_name?: unknown; download_url?: unknown }[];
  const url = Array.isArray(mods)
    ? mods.find((mod) => mod.mod_name === ORIGINAL_NAME)?.download_url
    : undefined;
  if (typeof url !== 'string' || !url.startsWith(DOWNLOADS)) {
    throw new Error('FSS-Overlay isn’t in EDHM’s mod list any more.');
  }

  const zip = await fetchImpl(url);
  if (!zip.ok) throw new Error(`Downloading FSS-Overlay answered ${zip.status}.`);
  return Buffer.from(await zip.arrayBuffer());
}
