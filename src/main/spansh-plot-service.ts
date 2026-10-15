import { ipcMain } from 'electron';
import { z } from 'zod';

import { IpcChannel } from '../shared/api';
import { CARRIER_KINDS, GALAXY_ALGORITHMS, type SpanshPlotRequest } from '../shared/spansh-plot';
import { broadcast } from './broadcast';
import type { CsvRouteService } from './csv-route-service';
import type { OwnedShip } from './ships-service';
import { SpanshClient } from './spansh/client';
import { type CurrentShip, SpanshPlotter } from './spansh/plot';

const name = z.string().max(100);
const ends = {
  from: name,
  to: name.min(1),
  via: z.array(name.min(1)).max(50).optional(),
};

/** What the window may ask to plot; it is checked, as anything from the renderer is. */
const RequestSchema: z.ZodType<SpanshPlotRequest> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('galaxy'),
    ...ends,
    shipId: z.number().int().optional(),
    algorithm: z.enum(GALAXY_ALGORITHMS),
    supercharge: z.boolean(),
    injections: z.boolean(),
    excludeSecondary: z.boolean(),
    refuelEveryScoopable: z.boolean(),
    cargo: z.number().min(0).max(10_000).optional(),
    reserve: z.number().min(0).max(1000),
  }),
  z.object({
    kind: z.literal('neutron'),
    ...ends,
    shipId: z.number().int().optional(),
    range: z.number().positive().max(1000).optional(),
    efficiency: z.number().int().min(1).max(100),
  }),
  z.object({
    kind: z.literal('carrier'),
    ...ends,
    carrier: z.enum(CARRIER_KINDS),
    used: z.number().int().min(0).max(60_000),
    tritium: z
      .object({ tank: z.number().int().min(0).max(1000), market: z.number().int().min(0) })
      .optional(),
  }),
]);

/**
 * The Route tab's Spansh page: Spansh's galaxy, neutron and fleet carrier plotters over IPC. A
 * finished route waits on the page until the commander follows it, which makes it the CSV route.
 */
export function startSpanshPlotService(options: {
  csvRoute: CsvRouteService;
  here(): { name?: string; address?: number | bigint };
  ship(): CurrentShip;
  ships(): OwnedShip[];
  client?: SpanshClient;
}): SpanshPlotter {
  const client = options.client ?? new SpanshClient();
  const plotter = new SpanshPlotter({
    client,
    here: () => options.here(),
    ship: () => options.ship(),
    ships: () => options.ships(),
    onChange: (state) => broadcast(IpcChannel.SpanshPlotChanged, state),
    follow: (route) => options.csvRoute.load(route),
    save: (routeName, route) => options.csvRoute.save(routeName, route),
  });

  ipcMain.handle(IpcChannel.SpanshPlotGet, () => plotter.state());
  ipcMain.handle(IpcChannel.SpanshPlotShips, () => plotter.ships());
  ipcMain.handle(IpcChannel.SpanshPlotPlot, (_event, value: unknown) => {
    const parsed = RequestSchema.safeParse(value);
    return parsed.success ? plotter.plot(parsed.data) : z.prettifyError(parsed.error);
  });
  ipcMain.handle(IpcChannel.SpanshPlotCancel, () => plotter.cancel());
  ipcMain.handle(IpcChannel.SpanshPlotFollow, () => plotter.follow());
  ipcMain.handle(IpcChannel.SpanshPlotSave, (_event, routeName: unknown) =>
    plotter.save(typeof routeName === 'string' ? routeName : ''),
  );
  ipcMain.handle(IpcChannel.SpanshPlotSystems, async (_event, prefix: unknown) => {
    if (typeof prefix !== 'string' || prefix.trim().length < 2) return [];
    try {
      const matches = await client.systemsNamed(prefix.trim());
      return matches.slice(0, 20).map((match) => match.name);
    } catch {
      // Suggestions are a convenience; typing on works without them.
      return [];
    }
  });
  return plotter;
}
