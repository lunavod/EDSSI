/**
 * The window's side of extensions (see `src/main/extensions.ts` and docs/extensions.md):
 * `extensions/<name>/renderer/index.tsx`, which exports `extension`, a `RendererExtension`, and
 * the installed extensions' `renderer.js`, served from their folders on `edssi-ext://`.
 */

import * as React from 'react';
import type { ReactNode } from 'react';
import * as ReactDom from 'react-dom';
import * as ReactDomClient from 'react-dom/client';
import * as compilerRuntime from 'react/compiler-runtime';
import * as jsxRuntime from 'react/jsx-runtime';
import * as zod from 'zod';
import type { z } from 'zod';

import type { CsvRoute, CsvRouteState } from '../../shared/csv-route';
import {
  EXTENSION_HOST_GLOBAL,
  type InstalledRendererExtension,
  type SHARED_RENDERER_MODULES,
} from '../../shared/extensions';
import { registerSettingsSections } from '../../shared/settings';
import type { PageId, Section } from './settings/fields';

export interface RendererExtension {
  name: string;
  /** The same sections of the settings file as its main side, for their defaults here. */
  settings?: Readonly<Record<string, z.ZodType>>;
  /** Sections of the Settings tab, each put at the end of a page. */
  settingsSections?: readonly { page: PageId; section: Section }[];
  /**
   * Pages of the Route tab of its own. A hook: it is called on every render of the tab, which
   * stays mounted.
   */
  useRoutePages?: (context: RoutePagesContext) => RoutePages;
}

export interface RoutePagesContext {
  csvRoute: CsvRouteState | undefined;
  /** The commander's current system. */
  here: string | undefined;
  /** In the main tank now, t. */
  fuel: number | undefined;
  /** The page on show: `plotted`, `csv`, `map`, or one of an extension's. */
  active: string;
  show(page: string): void;
}

export interface RoutePages {
  /** Put before the Map page. */
  pages: RoutePage[];
  /** A route for the Map page to show beside the CSV route, and what its chip says. */
  mapRoute?: { route: CsvRoute; label: string };
}

export interface RoutePage {
  id: string;
  label: string;
  badge?: string;
  content: ReactNode;
}

const modules = import.meta.glob<{ extension: RendererExtension }>(
  '../../../extensions/*/renderer/index.tsx',
  { eager: true },
);

/**
 * The extensions compiled in, then the installed ones once `loadInstalledExtensions` is done.
 * `main.tsx` imports the app only after that, so modules that read this list as they load see
 * every extension.
 */
export const RENDERER_EXTENSIONS: RendererExtension[] = Object.values(modules).map(
  (module) => module.extension,
);

for (const extension of RENDERER_EXTENSIONS) {
  if (extension.settings) registerSettingsSections(extension.settings);
}

/**
 * Loads the window side of the extensions installed in `<config dir>/extensions/` (see
 * `src/main/extensions.ts`). One that fails is reported and left out; this never throws.
 */
export async function loadInstalledExtensions(): Promise<void> {
  const shared: Record<(typeof SHARED_RENDERER_MODULES)[number], unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'react/compiler-runtime': compilerRuntime,
    'react-dom': ReactDom,
    'react-dom/client': ReactDomClient,
    zod,
  };
  Object.assign(globalThis, { [EXTENSION_HOST_GLOBAL]: shared });
  let installed: InstalledRendererExtension[];
  try {
    installed = await window.edssi.extensions.installed();
  } catch (error) {
    console.error('[extensions] could not list the installed extensions', error);
    return;
  }
  for (const { name, script, style } of installed) {
    if (RENDERER_EXTENSIONS.some((other) => other.name === name)) continue;
    try {
      if (script !== undefined) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked just below
        const module = (await import(/* @vite-ignore */ script)) as {
          extension?: RendererExtension;
        };
        if (typeof module.extension?.name !== 'string') throw new Error('it exports no extension');
        if (module.extension.settings) registerSettingsSections(module.extension.settings);
        RENDERER_EXTENSIONS.push(module.extension);
      }
      if (style !== undefined) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = style;
        document.head.append(link);
      }
    } catch (error) {
      console.error(`[extensions] ${name} failed to load`, error);
    }
  }
}
