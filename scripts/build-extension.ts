/**
 * Builds an extension on its own, into a folder any build of EDSSI loads from
 * `<config dir>/extensions/` (see docs/extensions.md):
 *
 *   npm run build:extension -- <name or folder> [--out <folder>] [--install]
 *
 * It writes `main.js` (and the entries `build.json` asks for, beside it), `renderer.js`,
 * `renderer.css` and `extension.json` into `out/extensions/<name>/`, or `--out`. `--install`
 * copies the result into the extensions folder of `EDSSI_CONFIG_DIR`, else `~/.edssi`.
 *
 * EDSSI's own code that an extension imports is bundled into it. What has to be EDSSI's copy is
 * not: React and zod come from the running EDSSI (`SHARED_*_MODULES`), and its native modules from
 * EDSSI's folder (`HOST_NATIVE_MODULES`).
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import react from '@vitejs/plugin-react';
import { build, type Plugin } from 'vite';

import { configDir } from '../src/main/config/paths';
import {
  EXTENSION_API_VERSION,
  EXTENSION_APP_PATH_ENV,
  EXTENSION_HOST_GLOBAL,
  EXTENSION_MANIFEST,
  type ExtensionManifest,
  HOST_NATIVE_MODULES,
  parseManifest,
  SHARED_MAIN_MODULES,
  SHARED_RENDERER_MODULES,
} from '../src/shared/extensions';

const ROOT = resolve(import.meta.dirname, '..');
const requireFromEdssi = createRequire(join(ROOT, 'package.json'));

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, install: { type: 'boolean', default: false } },
});
// PowerShell's npm drops the `--`, so npm takes the flags as its own config, which it passes
// on only as npm_config_* variables.
values.install ||= process.env['npm_config_install'] === 'true';
values.out ??= process.env['npm_config_out'] || undefined;
const target = positionals[0];
if (target === undefined) {
  console.error('Usage: npm run build:extension -- <name or folder> [--out <folder>] [--install]');
  process.exit(1);
}
const folder = existsSync(target) ? resolve(target) : join(ROOT, 'extensions', target);
const name = basename(folder).toLowerCase();
const mainEntry = join(folder, 'main', 'index.ts');
const rendererEntry = join(folder, 'renderer', 'index.tsx');
const out = resolve(values.out ?? join(ROOT, 'out', 'extensions', name));

/** The names a module exports, from EDSSI's own copy. */
function exportNames(id: string): string[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- any module is an object
  const module = requireFromEdssi(id) as object;
  return Object.keys(module).filter(
    (key) => key !== 'default' && key !== '__esModule' && /^[A-Za-z_$][\w$]*$/.test(key),
  );
}

/**
 * A module the extension takes from EDSSI: its import resolves to a stand-in that re-exports
 * `source`, an expression giving EDSSI's copy, under every name the real one exports.
 */
function fromEdssi(
  kind: string,
  ids: readonly string[],
  source: (id: string) => string,
  prelude = '',
): Plugin {
  const prefix = `\0edssi-${kind}:`;
  return {
    name: `edssi-${kind}-modules`,
    enforce: 'pre',
    resolveId: (id) => (ids.includes(id) ? prefix + id : undefined),
    load(id) {
      if (!id.startsWith(prefix)) return undefined;
      const module = id.slice(prefix.length);
      const names = exportNames(module);
      return [
        prelude,
        `const m = ${source(module)};`,
        `export default 'default' in m ? m.default : m;`,
        ...names.map((key, index) => `const e${index} = m[${JSON.stringify(key)}];`),
        `export { ${names.map((key, index) => `e${index} as ${key}`).join(', ')} };`,
      ].join('\n');
    },
  };
}

const shared = (ids: readonly string[]): Plugin =>
  fromEdssi(
    'shared',
    ids,
    (id) => `globalThis[${JSON.stringify(EXTENSION_HOST_GLOBAL)}][${JSON.stringify(id)}]`,
  );

const native = fromEdssi(
  'native',
  HOST_NATIVE_MODULES,
  (id) => `requireFromEdssi(${JSON.stringify(id)})`,
  [
    `import { createRequire } from 'node:module';`,
    `const appPath = process.env[${JSON.stringify(EXTENSION_APP_PATH_ENV)}];`,
    `if (!appPath) throw new Error('${EXTENSION_APP_PATH_ENV} is not set: run this inside EDSSI');`,
    `const requireFromEdssi = createRequire(appPath + '/package.json');`,
  ].join('\n'),
);

/** The main process's extra entries, by output name (`build.json`'s `mainEntries`). */
function mainEntries(): Record<string, string> {
  const file = join(folder, 'build.json');
  if (!existsSync(file)) return {};
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the extension's own file
  const config = JSON.parse(readFileSync(file, 'utf8')) as {
    mainEntries?: Record<string, string>;
  };
  return Object.fromEntries(
    Object.entries(config.mainEntries ?? {}).map(([output, source]) => [
      output,
      join(folder, source),
    ]),
  );
}

/** Empties a folder rather than removing it, as Windows won't remove one a program is in. */
function emptyFolder(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(dir)) rmSync(join(dir, entry), { recursive: true, force: true });
}

async function buildMain(): Promise<void> {
  await build({
    configFile: false,
    root: folder,
    logLevel: 'warn',
    // Natives first: the `fromEdssi` stand-ins resolve before anything else gets a look.
    plugins: [native, shared(SHARED_MAIN_MODULES)],
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: true,
      outDir: out,
      emptyOutDir: false,
      target: 'node22',
      minify: false,
      rolldownOptions: {
        input: { main: mainEntry, ...mainEntries() },
        external: ['electron', /^node:/],
        // Everything in one folder, so `import.meta.dirname` finds the other entries.
        output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
      },
    },
  });
}

async function buildRenderer(): Promise<void> {
  await build({
    configFile: false,
    root: folder,
    logLevel: 'warn',
    plugins: [shared(SHARED_RENDERER_MODULES), react({ compiler: true })],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: out,
      emptyOutDir: false,
      lib: {
        entry: rendererEntry,
        formats: ['es'],
        fileName: () => 'renderer.js',
        cssFileName: 'renderer',
      },
    },
  });
}

const manifest: ExtensionManifest = { name, apiVersion: EXTENSION_API_VERSION };
const checked = parseManifest(manifest);
if ('problem' in checked) {
  console.error(`The folder's name won't do as the extension's: ${checked.problem}.`);
  process.exit(1);
}
emptyFolder(out);
if (existsSync(mainEntry)) {
  await buildMain();
  manifest.main = 'main.js';
}
if (existsSync(rendererEntry)) {
  await buildRenderer();
  manifest.renderer = 'renderer.js';
  if (existsSync(join(out, 'renderer.css'))) manifest.style = 'renderer.css';
}
if (manifest.main === undefined && manifest.renderer === undefined) {
  console.error(`${folder} has neither main/index.ts nor renderer/index.tsx.`);
  process.exit(1);
}
writeFileSync(join(out, EXTENSION_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
console.info(`Built ${name} into ${out}`);

if (values.install) {
  const installed = join(configDir(), 'extensions', name);
  emptyFolder(installed);
  cpSync(out, installed, { recursive: true });
  console.info(`Installed it in ${installed}; restart EDSSI to load it.`);
}
