/**
 * The window's side of extensions (see `src/main/extensions.ts` and docs/extensions.md):
 * `extensions/<name>/renderer/index.tsx`, which exports `extension`, a `RendererExtension`, and
 * the installed extensions' `renderer.js`, served from their folders on `edssi-ext://`.
 */

import * as React from 'react';
import type { ComponentType, ReactNode } from 'react';
import * as ReactDom from 'react-dom';
import * as ReactDomClient from 'react-dom/client';
import * as compilerRuntime from 'react/compiler-runtime';
import * as jsxRuntime from 'react/jsx-runtime';
import * as zod from 'zod';
import type { z } from 'zod';

import type { EdssiApi } from '../../shared/api';
import type { CsvRoute, CsvRouteState } from '../../shared/csv-route';
import {
  EXTENSION_HOST_GLOBAL,
  type InstalledRendererExtension,
  type SHARED_RENDERER_MODULES,
} from '../../shared/extensions';
import type { SystemSurvey } from '../../shared/history';
import type { BioBody } from '../../shared/mission';
import { registerSettingsSections } from '../../shared/settings';
import type { ShipView } from '../../shared/ships';
import { type ExtensionTabId, extensionTabId } from '../../shared/ui';
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
  /**
   * Modules of its own, on the tab bar after EDSSI's, as `extensionTabId(name, id)`. Each stays
   * mounted, as EDSSI's do, and is told whether it is on screen.
   */
  tabs?: readonly ExtensionTab[];
  /** Blocks of the side panel, under the fuel, in the order given. */
  sidePanel?: readonly SidePanelBlock[];
  /**
   * The bodies with life the Mission tab's "Biology here" lists, in place of EDSSI's own (made
   * from the journal by `bioBodies`), when it has them; undefined leaves EDSSI's. A hook, called
   * on every render of the section. The first extension to answer wins.
   */
  useMissionBiology?: (context: MissionBiologyContext) => MissionBiology | undefined;
  /**
   * The health of a ship's modules and hull as it is now, for the Ships tab to show in place of
   * its last `Loadout`'s; undefined leaves the `Loadout`'s. A hook, called on every render of the
   * ship's page. The first extension to answer wins.
   */
  useShipCondition?: (context: ShipConditionContext) => ShipCondition | undefined;
}

export interface ShipConditionContext {
  /** The ship on show: `current` when it is the one being flown; `shipId` -1 for a stock hull. */
  ship: ShipView;
}

export interface ShipCondition {
  /** Health, 0–1, by the journal's slot name (`Slot`, any case), for the slots it knows. */
  modules: Readonly<Record<string, number>>;
  /** The hull's health, 0–1. */
  hull?: number;
  /** Where it comes from, shown under the slots. */
  source: string;
  /** When it was read (ISO), when that is not now: shown beside the source. */
  asOf?: string;
}

export interface MissionBiologyContext {
  /** The current system, from the session's journal. */
  systemAddress: number | bigint | undefined;
  /** What the journal says of the current system's bodies, once the history reader is there. */
  survey: SystemSurvey | undefined;
  /** EDSSI's own bodies with life for it, the same `survey` folded by `bioBodies`. */
  bodies: readonly BioBody[];
  /** The probe cutoff (`mission.min_probe_value`), for a body's `mapping`. */
  minValue: number;
}

export interface MissionBiology {
  /** In `bioBodies`' shape; a body may carry `shipDistance`. Sorted by the section. */
  bodies: BioBody[];
  /** Where they come from, shown in the section's heading: the extension's own name for it. */
  source: string;
  /** The system's name, when the survey has none yet. */
  systemName?: string;
}

/**
 * The first extension's answer to `useMissionBiology`, every extension's hook called on every
 * render in the same order (the list is fixed before the app loads), as hooks must be.
 */
export function useExtensionMissionBiology(
  context: MissionBiologyContext,
): MissionBiology | undefined {
  let answer: MissionBiology | undefined;
  for (const extension of RENDERER_EXTENSIONS) {
    if (!extension.useMissionBiology) continue;
    const biology = extension.useMissionBiology(context);
    answer ??= biology;
  }
  return answer;
}

/** The first extension's answer to `useShipCondition`, every extension's hook called in order. */
export function useExtensionShipCondition(
  context: ShipConditionContext,
): ShipCondition | undefined {
  let answer: ShipCondition | undefined;
  for (const extension of RENDERER_EXTENSIONS) {
    if (!extension.useShipCondition) continue;
    const condition = extension.useShipCondition(context);
    answer ??= condition;
  }
  return answer;
}

/** Every extension's tabs, with the ids the tab bar knows them by. */
export function extensionTabs(): {
  id: ExtensionTabId;
  extension: string;
  tab: ExtensionTab;
}[] {
  return RENDERER_EXTENSIONS.flatMap((extension) =>
    (extension.tabs ?? []).map((tab) => ({
      id: extensionTabId(extension.name, tab.id),
      extension: extension.name,
      tab,
    })),
  );
}

/** Every extension's side panel blocks. */
export function sidePanelBlocks(): { key: string; extension: string; block: SidePanelBlock }[] {
  return RENDERER_EXTENSIONS.flatMap((extension) =>
    (extension.sidePanel ?? []).map((block) => ({
      key: `${extension.name}/${block.id}`,
      extension: extension.name,
      block,
    })),
  );
}

export interface ExtensionTab {
  id: string;
  label: string;
  View: ComponentType<{ active: boolean }>;
  /**
   * What the tab's badge says (a count, a state), or nothing. A hook, called on every render of
   * the window.
   */
  useBadge?: () => string | number | undefined;
}

export interface SidePanelBlock {
  id: string;
  /**
   * A `<section className="side-block">` of its own, as EDSSI's blocks are; null when it has
   * nothing to say.
   */
  Block: ComponentType;
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
export async function loadInstalledExtensions(api: EdssiApi): Promise<void> {
  const shared: Record<(typeof SHARED_RENDERER_MODULES)[number], unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'react/compiler-runtime': compilerRuntime,
    'react-dom': ReactDom,
    'react-dom/client': ReactDomClient,
    zod,
  };
  Object.assign(globalThis, { [EXTENSION_HOST_GLOBAL]: shared });
  try {
    // The ones compiled in that are turned off; an installed one turned off isn't listed below.
    const { extensions } = await api.extensions.list();
    const off = new Set(
      extensions
        .filter((extension) => extension.source === 'built-in' && extension.state === 'disabled')
        .map((extension) => extension.name),
    );
    const kept = RENDERER_EXTENSIONS.filter((extension) => !off.has(extension.name));
    RENDERER_EXTENSIONS.splice(0, RENDERER_EXTENSIONS.length, ...kept);
  } catch (error) {
    console.error('[extensions] could not list the extensions', error);
  }
  let installed: InstalledRendererExtension[];
  try {
    installed = await api.extensions.installed();
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
