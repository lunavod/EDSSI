import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, esmExternalRequirePlugin, type Plugin } from 'vite';

import { fontsAsFiles, scopeAppStyles, withoutExtensions } from './scripts/mock/vite-plugins';

/**
 * The mock UI as a library (`src/mock/index.ts`) for another site to embed: one ES module and one
 * `style.css` in `dist/mock-ui/`, React left to the site, with a `package.json` and the README.
 * `npm run mock:lib` builds it and then its type declarations (tsconfig.mock-lib.json); the release
 * workflow publishes it to GitHub Packages with each release of the app.
 */
/** The package around the build, at EDSSI's own version. */
function packageFiles(): Plugin {
  return {
    name: 'edssi-mock-package',
    apply: 'build',
    generateBundle() {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- our own package.json
      const { version, license, devDependencies } = JSON.parse(
        readFileSync('package.json', 'utf8'),
      ) as { version: string; license: string; devDependencies: Record<string, string> };
      const manifest = {
        // GitHub Packages takes only packages scoped to the repository's owner.
        name: '@lunavod/edssi-mock-ui',
        version,
        description: "EDSSI's windows against made-up data, for embedding in other pages",
        license,
        // Links the package to the repository, which lets the release workflow's token publish it.
        repository: {
          type: 'git',
          url: 'git+https://github.com/lunavod/EDSSI.git',
          directory: 'src/mock',
        },
        publishConfig: { registry: 'https://npm.pkg.github.com' },
        type: 'module',
        main: './index.js',
        types: './types/mock/index.d.ts',
        exports: {
          '.': { types: './types/mock/index.d.ts', default: './index.js' },
          './style.css': './style.css',
        },
        sideEffects: ['*.css'],
        peerDependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        // Bundled into index.js, but its types are named in the declarations (the settings).
        dependencies: { zod: devDependencies['zod'] },
      };
      this.emitFile({
        type: 'asset',
        fileName: 'package.json',
        source: `${JSON.stringify(manifest, null, 2)}
`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'README.md',
        source: readFileSync('src/mock/README.md'),
      });
    },
  };
}

/**
 * React is the embedding site's. Imported, not `require`d: the CommonJS packages bundled in (the
 * route map's renderer) would otherwise call a `require` no browser has.
 */
const REACT = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/compiler-runtime',
];

export default defineConfig({
  plugins: [
    withoutExtensions(),
    scopeAppStyles(),
    react({ compiler: true }),
    esmExternalRequirePlugin({ external: REACT }),
    fontsAsFiles(),
    packageFiles(),
  ],
  build: {
    outDir: resolve('dist/mock-ui'),
    emptyOutDir: true,
    // No source map: it was 7.5 MB, more than the rest of the package together.
    sourcemap: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    lib: {
      entry: resolve('src/mock/entry.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rolldownOptions: {
      output: {
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.css'))
            ? 'style.css'
            : 'assets/[name][extname]',
      },
    },
  },
});
