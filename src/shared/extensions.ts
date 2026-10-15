/**
 * Installed extensions: ones built on their own (`npm run build:extension`) into a folder of
 * `<config dir>/extensions/`, which any build of EDSSI loads at start, beside the ones compiled in.
 * See docs/extensions.md.
 */

/**
 * The version of what EDSSI gives extensions (`MainExtension`, `RendererExtension` and their
 * contexts) and of the modules it shares with them, which a build writes into its manifest. Bump
 * it whenever either gains something: an extension built against a later version than the running
 * EDSSI's is left out, as it may use what this EDSSI lacks.
 *
 * 2: the journal feeds, `game`, `ask`, `dataDir`, `log` and `showTab` on the main context; tabs
 * and side panel blocks of its own; `useEdssi()` working from an installed extension.
 */
export const EXTENSION_API_VERSION = 2;

/**
 * The oldest version still loaded. Raise it to `EXTENSION_API_VERSION` when a change would trip up
 * an extension built before: something taken away, renamed or made to mean something else.
 */
export const OLDEST_EXTENSION_API_VERSION = 1;

/** Why an extension built against `apiVersion` can't be loaded, if it can't. */
export function apiVersionProblem(name: string, apiVersion: number): string | undefined {
  if (apiVersion > EXTENSION_API_VERSION) {
    return (
      `${name} was built for extension API ${apiVersion}, and this EDSSI only has ` +
      `${EXTENSION_API_VERSION}; update EDSSI`
    );
  }
  if (apiVersion < OLDEST_EXTENSION_API_VERSION) {
    return (
      `${name} was built for extension API ${apiVersion}, and this EDSSI needs at least ` +
      `${OLDEST_EXTENSION_API_VERSION}; build it again against this EDSSI`
    );
  }
  return undefined;
}

/** What an installed extension's folder says about itself, written by its build. */
export interface ExtensionManifest {
  name: string;
  apiVersion: number;
  /** The main process's side, an ES module exporting `extension`. */
  main?: string;
  /** The window's side, an ES module exporting `extension`. */
  renderer?: string;
  /** The window's stylesheet. */
  style?: string;
}

export const EXTENSION_MANIFEST = 'extension.json';

/** The scheme an installed extension's window files are served on: `edssi-ext://<name>/<file>`. */
export const EXTENSION_SCHEME = 'edssi-ext';

/** Lower case: the name is the host of its files' URLs, and a URL's host has no case. */
const NAME = /^[a-z0-9][a-z0-9-]*$/;

/** The manifest, or what is wrong with it. */
export function parseManifest(raw: unknown): ExtensionManifest | { problem: string } {
  if (typeof raw !== 'object' || raw === null) return { problem: 'it is not an object' };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field is checked below
  const record = raw as Record<string, unknown>;
  const { name, apiVersion } = record;
  if (typeof name !== 'string' || !NAME.test(name)) {
    return { problem: 'its name has to be lower case letters, digits and dashes' };
  }
  if (typeof apiVersion !== 'number') return { problem: 'it has no apiVersion' };
  const manifest: ExtensionManifest = { name, apiVersion };
  for (const key of ['main', 'renderer', 'style'] as const) {
    const file = record[key];
    if (file === undefined) continue;
    if (typeof file !== 'string' || !isPlainRelative(file)) {
      return { problem: `its ${key} has to be a file in its folder` };
    }
    manifest[key] = file;
  }
  return manifest;
}

/** A path inside the folder: relative, and never climbing out of it. */
function isPlainRelative(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.startsWith('\\') || /^[a-z]:/i.test(path)) {
    return false;
  }
  return path.split(/[\\/]/).every((part) => part !== '..' && part !== '');
}

/** An installed extension's window side, for the window to load. */
export interface InstalledRendererExtension {
  name: string;
  /** `edssi-ext://` URLs. */
  script?: string;
  style?: string;
}

/**
 * Where EDSSI puts the modules it shares with installed extensions, on `globalThis`, by module
 * name. They have to be EDSSI's own copies, not the extension's: React's hooks only work with the
 * React that renders them, and zod's schemas are merged into EDSSI's settings schema.
 */
export const EXTENSION_HOST_GLOBAL = '__edssiExtensionHost';

export const SHARED_MAIN_MODULES = ['zod'] as const;

export const SHARED_RENDERER_MODULES = [
  'react',
  'react/jsx-runtime',
  'react/compiler-runtime',
  'react-dom',
  'react-dom/client',
  'zod',
] as const;

/**
 * EDSSI's native modules (`dependencies` in package.json, unpacked from the asar), which an
 * installed extension takes from EDSSI's folder: it has no `node_modules` of its own, and native
 * code can't be bundled. Its utility processes and worker threads find them the same way, so the
 * folder rides in an environment variable rather than on `globalThis`.
 */
export const HOST_NATIVE_MODULES = ['koffi', 'node-hid', 'uiohook-napi', 'onnxruntime-node'];

/** Names EDSSI's app folder, where `HOST_NATIVE_MODULES` are found from. */
export const EXTENSION_APP_PATH_ENV = 'EDSSI_APP_PATH';

/** Where an extension comes from: compiled into this build, or installed beside its settings. */
export type ExtensionSource = 'built-in' | 'installed';

/** An extension as the Settings tab lists it. */
export interface ExtensionInfo {
  name: string;
  source: ExtensionSource;
  /**
   * How it stands in this run: running, turned off, failed to load or start, or (installed) left
   * out for one of the same name built in.
   */
  state: 'running' | 'disabled' | 'failed' | 'shadowed';
  /** On at the next start, as `extensions.json` says. */
  enabled: boolean;
  /** An installed one's folder. */
  folder?: string;
  /** Why it failed. */
  problem?: string;
}

export interface ExtensionsView {
  extensions: ExtensionInfo[];
  /** Where installed extensions live. */
  folder: string;
  /** Folders there that can't be loaded, and why. */
  problems: string[];
}

/** The extensions turned off, kept in `<config dir>/extensions.json`. */
export interface ExtensionsFile {
  disabled: string[];
}

/** The file's contents, tolerating a missing or broken one: nothing is turned off. */
export function parseExtensionsFile(raw: unknown): ExtensionsFile {
  if (typeof raw !== 'object' || raw === null) return { disabled: [] };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- its one field is checked below
  const { disabled } = raw as { disabled?: unknown };
  return {
    disabled: Array.isArray(disabled)
      ? disabled.filter((name): name is string => typeof name === 'string')
      : [],
  };
}

/** A change to a running extension takes effect only when EDSSI starts again. */
export function needsRestart(extension: ExtensionInfo): boolean {
  if (extension.state === 'shadowed') return false;
  return extension.enabled === (extension.state === 'disabled');
}
