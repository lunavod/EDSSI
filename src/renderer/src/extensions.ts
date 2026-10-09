/**
 * The window's side of extensions (see `src/main/extensions.ts` and docs/extensions.md):
 * `extensions/<name>/renderer/index.tsx`, which exports `extension`, a `RendererExtension`.
 */

import type { ReactNode } from 'react';
import type { z } from 'zod';

import type { CsvRoute, CsvRouteState } from '../../shared/csv-route';
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

export const RENDERER_EXTENSIONS: readonly RendererExtension[] = Object.values(modules).map(
  (module) => module.extension,
);

for (const extension of RENDERER_EXTENSIONS) {
  if (extension.settings) registerSettingsSections(extension.settings);
}
