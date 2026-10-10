/**
 * Installed extensions: ones built on their own (`npm run build:extension`) into a folder of
 * `<config dir>/extensions/`, which any build of EDSSI loads at start, beside the ones compiled in.
 * See docs/extensions.md.
 */

/**
 * The version of what EDSSI gives extensions (`MainExtension`, `RendererExtension` and their
 * contexts) and of the modules it shares with them. An installed extension built against another
 * is left out, so bump it whenever either changes in a way one built before would trip over.
 */
export const EXTENSION_API_VERSION = 1;

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
