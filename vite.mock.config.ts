import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { scopeAppStyles, withoutExtensions } from './scripts/mock/vite-plugins';

/**
 * The mock UI's demo page (`src/mock/index.html`): EDSSI's real windows against made-up data,
 * several to a page, as a plain web page in `out/mock/`. `npm run mock:dev` serves it,
 * `npm run mock:build` builds it. The library build is vite.mock-lib.config.ts.
 */
export default defineConfig({
  root: resolve('src/mock'),
  base: './',
  plugins: [withoutExtensions(), scopeAppStyles(), react({ compiler: true })],
  build: {
    outDir: resolve('out/mock'),
    emptyOutDir: true,
    // The route map's three.js is most of it; it's one page, loaded once.
    chunkSizeWarningLimit: 4000,
  },
});
