/**
 * Installed extensions on disk (see `src/shared/extensions.ts`): finding them, and which file of
 * one a URL of its scheme names. Nothing here touches Electron, so it is tested on its own.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  EXTENSION_API_VERSION,
  EXTENSION_MANIFEST,
  type ExtensionManifest,
  parseManifest,
} from '../shared/extensions';

export interface InstalledExtension {
  manifest: ExtensionManifest;
  /** Its folder. */
  root: string;
}

/** Every extension in `dir` that this build can load, and why each of the others can't be. */
export function findInstalledExtensions(dir: string): {
  found: InstalledExtension[];
  problems: string[];
} {
  const found: InstalledExtension[] = [];
  const problems: string[] = [];
  if (!existsSync(dir)) return { found, problems };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = join(dir, entry.name);
    const file = join(root, EXTENSION_MANIFEST);
    if (!existsSync(file)) {
      problems.push(`${entry.name} has no ${EXTENSION_MANIFEST}; is it built?`);
      continue;
    }
    let manifest: ReturnType<typeof parseManifest>;
    try {
      manifest = parseManifest(JSON.parse(readFileSync(file, 'utf8')));
    } catch (error) {
      problems.push(`${entry.name}'s ${EXTENSION_MANIFEST} can't be read: ${String(error)}`);
      continue;
    }
    if ('problem' in manifest) {
      problems.push(`${entry.name}'s ${EXTENSION_MANIFEST} is wrong: ${manifest.problem}`);
    } else if (manifest.apiVersion !== EXTENSION_API_VERSION) {
      problems.push(
        `${manifest.name} was built for extension API ${manifest.apiVersion}, and this EDSSI ` +
          `has ${EXTENSION_API_VERSION}; build it again against this EDSSI`,
      );
    } else if (found.some((other) => other.manifest.name === manifest.name)) {
      problems.push(`${manifest.name} is installed twice; ${entry.name} is left out`);
    } else {
      found.push({ manifest, root });
    }
  }
  return { found, problems };
}

/** The file a URL's path names in an extension's folder, or undefined if it is outside it. */
export function extensionFile(root: string, urlPath: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(urlPath);
  } catch {
    return undefined;
  }
  const file = resolve(root, `.${path.startsWith('/') ? '' : '/'}${path}`);
  const inside = relative(resolve(root), file);
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return undefined;
  }
  return file;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** A module script is refused unless it is served as JavaScript. */
export function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}
