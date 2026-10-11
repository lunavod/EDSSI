/**
 * What the mock UI's builds (vite.mock.config.ts, vite.mock-lib.config.ts) change in the app's
 * sources, so it can sit inside someone else's page, many to a page.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

import type { Plugin } from 'vite';

const RENDERER = resolve('src/renderer/src') + sep;
const EXTENSIONS = resolve('extensions') + sep;

/**
 * The app's stylesheets, scoped to `.edssi-theme`: the design tokens move off `:root` onto it, and
 * the rules written for the whole document (resets, scrollbars, checkboxes) only apply inside it,
 * with no more specificity than they had. A window's `100vh`/`100vw` become the root's size.
 */
export function scopeAppStyles(): Plugin {
  return {
    name: 'edssi-mock-scope-styles',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      if (!file.endsWith('.css') || !resolve(file).startsWith(RENDERER)) return undefined;
      // Vite inlines `@import`s after this, unseen; so they're inlined (and scoped) here first.
      const inline = (css: string, from: string): string =>
        scopeCss(css).replace(/^@import '(\.[^']+\.css)';$/gm, (_line, path: string) => {
          const imported = resolve(dirname(from), path);
          this.addWatchFile(imported);
          return inline(readFileSync(imported, 'utf8'), imported);
        });
      return { code: inline(code, file), map: null };
    },
  };
}

/** Exported for its test. */
export function scopeCss(css: string): string {
  return css
    .split('\n')
    .map((line) => {
      if (line.startsWith(':root {')) return line.replace(':root', '.edssi-theme');
      // A selector at the top level, not a class (those are the app's own) or an at-rule.
      if (/^[^\s.@}/]/.test(line) && !line.startsWith(':root.')) {
        return `:where(.edssi-theme) ${line}`;
      }
      return line;
    })
    .join('\n')
    .replaceAll('100vh', '100%')
    .replaceAll('100vw', '100%');
}

/**
 * No extension, ever: `extensions/` is private, and a mock built in a checkout that has some must
 * not carry them out to a published page. The renderer finds them with `import.meta.glob`, which
 * becomes an empty list; anything else that reaches into the folder fails the build.
 */
export function withoutExtensions(): Plugin {
  return {
    name: 'edssi-mock-without-extensions',
    enforce: 'pre',
    transform(code, id) {
      if (!resolve(id.split('?')[0] ?? id).startsWith(RENDERER)) return undefined;
      if (!code.includes('extensions/*/')) return undefined;
      const emptied = code.replace(
        /import\.meta\.glob(?:<[^>]*>)?\(\s*'[^']*extensions\/\*\/[^']*',[^)]*\)/g,
        '({})',
      );
      if (emptied.includes('extensions/*/')) {
        throw new Error(`${id} still finds extensions; teach withoutExtensions its pattern`);
      }
      return { code: emptied, map: null };
    },
    load(id) {
      if (resolve(id.split('?')[0] ?? id).startsWith(EXTENSIONS)) {
        throw new Error(`The mock UI must not include an extension: ${id}`);
      }
      return undefined;
    },
  };
}

/**
 * The library build inlines every font into `style.css` as base64, whatever `assetsInlineLimit`
 * says, which made it 900 KB. This takes them back out into files beside it, and drops the WOFF
 * copies, which every browser that can run the app has WOFF2 in place of.
 */
export function fontsAsFiles(): Plugin {
  return {
    name: 'edssi-mock-fonts-as-files',
    apply: 'build',
    // After Vite's own CSS plugin, which writes the stylesheet in this same hook.
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) continue;
        let css = String(asset.source).replace(
          /,\s*url\(["']?data:font\/woff;base64,[^)"']+["']?\)\s*format\(["']?woff["']?\)/g,
          '',
        );
        const emitted = new Map<string, string>();
        css = css.replace(
          /url\(["']?data:font\/woff2;base64,([^)"']+)["']?\)/g,
          (_match, data: string) => {
            let file = emitted.get(data);
            if (!file) {
              const id = this.emitFile({
                type: 'asset',
                name: `font-${emitted.size + 1}.woff2`,
                source: Buffer.from(data, 'base64'),
              });
              file = this.getFileName(id);
              emitted.set(data, file);
            }
            return `url(./${file})`;
          },
        );
        asset.source = css;
      }
    },
  };
}
