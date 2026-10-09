import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * The main process's extra entries that extensions ask for (`extensions/<name>/build.json`, see
 * docs/extensions.md): utility processes and worker threads of their own, by output name.
 */
function extensionEntries(): Record<string, string> {
  const root = resolve('extensions');
  if (!existsSync(root)) return {};
  const entries: Record<string, string> = {};
  for (const name of readdirSync(root)) {
    const file = join(root, name, 'build.json');
    if (!existsSync(file)) continue;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the extension's own file
    const build = JSON.parse(readFileSync(file, 'utf8')) as {
      mainEntries?: Record<string, string>;
    };
    for (const [output, source] of Object.entries(build.mainEntries ?? {})) {
      entries[output] = join(root, name, source);
    }
  }
  return entries;
}

export default defineConfig({
  main: {
    // uiohook-napi, node-hid, koffi and onnxruntime-node are native: they can't be bundled, so
    // they stay `require`d from node_modules and electron-builder unpacks them from the asar (see
    // electron-builder.yml). The phonemizer is plain JavaScript, so it is bundled like the rest.
    plugins: [externalizeDepsPlugin({ exclude: ['phonemizer'] })],
    build: {
      rolldownOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // Kokoro's utility process: onnxruntime freezes whatever process runs it, so not main.
          'kokoro-worker': resolve('src/main/ai/kokoro/worker.ts'),
          ...extensionEntries(),
        },
      },
    },
  },
  preload: {
    build: {
      rolldownOptions: {
        // Sandboxed preloads can't be ESM, so emit CJS even though the package is "type": "module".
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react({ compiler: true })],
  },
});
