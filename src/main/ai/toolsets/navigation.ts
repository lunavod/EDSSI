/** The plotted route: where the ship is heading and what it has to cross to get there. */

import { z } from 'zod';

import { type FollowedSystem, routeForAssistant } from '../../../shared/followed-route';
import { activeRoute, isScoopableClass } from '../../../shared/nav-routes';
import { countSignals } from '../../../shared/signals';
import { stamp } from '../../activity/periods';
import { defineTool, type Tool, type Toolset } from '../tools/define';
import { round } from './format';

/** A galaxy-crossing route can be hundreds of jumps; the model only needs the next stretch. */
const MAX_SYSTEMS = 40;

export const navigationToolset: Toolset = {
  name: 'navigation',
  instructions: `A route is what the commander plotted in the galaxy map, or else one loaded from a CSV file (a Spansh route) on the Route tab, which counts just the same: "the next system in the route" is the next one on whichever get_route returns. get_route lists the jumps still to make, with each star's class and whether it can be scooped, so you can answer "how far to the end?", "where do I refuel?" or "what's after this one?". EDSSI only knows a route it saw plotted or loaded; if there is none, say so rather than guessing. get_current_system is the side panel: the system the ship is in, its star, how much of it has been scanned and whether anyone was here first, its signals and landable bodies, what it is worth, who runs it, and EDSM's traffic and threat.`,

  brief({ game }) {
    const route = routeForAssistant(game.routes(), game.csvRoute(), game.overview().systemAddress);
    const systems = route?.systems;
    if (!route || !systems?.length) return undefined;

    const kind = route.source === 'csv' ? 'CSV route' : 'Route';
    const destination = systems.at(-1)!.name;
    const next = systems[(route.position ?? -1) + 1];
    if (!route.onRoute) {
      return `${kind}: to ${destination}; the ship is off it${next ? `, next route system ${next.name}` : ''}.`;
    }
    if (!next) return `${kind}: ${destination}, arrived.`;
    return (
      `${kind}: ${destination}, jump ${route.position! + 1} of ${systems.length - 1}, ` +
      `next ${next.name}${next.starClass ? ` (${next.starClass})` : ''}`
    );
  },

  tools: [
    currentSystemTool(),
    defineTool({
      name: 'get_route',
      description:
        'The route the commander is following — plotted in the galaxy map, or else loaded from a ' +
        'CSV file (a Spansh route) on the Route tab: what is left of it, system by system, with ' +
        'star classes, whether each can be scooped for fuel, and the distance still to cover.',
      parameters: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SYSTEMS)
          .default(15)
          .describe('How many of the next systems to list.'),
      }),
      run({ limit }, { game }) {
        const route = routeForAssistant(
          game.routes(),
          game.csvRoute(),
          game.overview().systemAddress,
        );
        const systems = route?.systems;
        if (!route) return 'No route is plotted, and none is loaded from a CSV file.';
        if (!systems?.length) {
          return 'A route is plotted, but EDSSI never saw its systems — it was not running then.';
        }

        const plotted = route.source === 'plotted' ? activeRoute(game.routes()) : undefined;
        const from = route.position ?? -1;
        const rest = systems.slice(from + 1);
        const ahead = rest.slice(0, limit);

        return {
          source:
            route.source === 'csv'
              ? 'a route loaded from a CSV file on the Route tab (not plotted in the game)'
              : 'plotted in the galaxy map',
          destination: systems.at(-1)!.name,
          plotted: plotted && stamp(Date.parse(plotted.plottedAt)),
          total_jumps: systems.length - 1,
          scoopable_stars_ahead: rest.filter((system) => scoopable(system) === true).length,
          unscoopable_stars_ahead: rest.filter((system) => scoopable(system) === false).length,
          on_route: route.onRoute,
          last_route_system_reached: !route.onRoute && from >= 0 ? systems[from]!.name : undefined,
          jumps_remaining: systems.length - 1 - from,
          distance_remaining_ly: route.lyLeft === undefined ? undefined : round(route.lyLeft),
          // Undefined until EDSM has answered, or if it couldn't be reached.
          systems_ahead_not_in_edsm: route.unknownAhead,
          jumps: ahead.map((system, index) => ({
            jump: from + index + 1,
            system: system.name,
            star_class: system.starClass,
            scoopable: scoopable(system),
            leg_ly: system.legLy === undefined ? undefined : round(system.legLy),
          })),
          more: rest.length - ahead.length,
        };
      },
    }),
  ],
};

/** Whether a fuel scoop works there, as far as the route says. */
function scoopable(system: FollowedSystem): boolean | undefined {
  return system.starClass === undefined ? system.scoopable : isScoopableClass(system.starClass);
}

/** The side panel's view of the system the ship is in. */
function currentSystemTool(): Tool {
  return defineTool({
    name: 'get_current_system',
    description:
      'The system the ship is in, as the side panel shows it: star class and whether it can be ' +
      'scooped, bodies scanned against the discovery scan, whether it was undiscovered, biological ' +
      'and other surface signals, landable bodies, estimated value of the scans, population, ' +
      'economy, security, government and allegiance, and from EDSM the traffic, ships lost and ' +
      'the closest starport.',
    parameters: z.object({}),
    async run(_args, { game }) {
      const overview = game.overview();
      if (!overview.system) return 'The journal has not said where the ship is yet.';
      const history = game.history().survey;
      const survey =
        history && String(history.systemAddress) === String(overview.systemAddress)
          ? history
          : undefined;
      const scanned = survey?.bodies.filter((body) => body.kind !== undefined) ?? [];
      const star = scanned.find((body) => body.kind === 'star');
      const landable = survey?.bodies.filter((body) => body.landable) ?? [];
      const withLife = survey?.bodies.filter((body) => body.bioSignals > 0) ?? [];
      const surfaceSignals = countSignals(survey?.bodies ?? [], (type) => !/biolog/i.test(type));
      const details = overview.systemDetails;
      const inhabited = (details?.population ?? 0) > 0;
      const edsm = await game.system(overview.system);
      const known = edsm.status === 'ok' ? edsm : undefined;
      const starClass = overview.starClass ?? known?.primaryStar?.type;

      return {
        system: overview.system,
        docked_at: overview.station,
        star_class: starClass,
        scoopable:
          overview.starClass === undefined
            ? known?.primaryStar?.scoopable
            : isScoopableClass(overview.starClass),
        undiscovered_before_commander: star ? star.firstDiscovery : undefined,
        first_discoveries: scanned.filter((body) => body.firstDiscovery).length || undefined,
        honked: survey ? survey.bodyCount !== undefined : false,
        bodies_in_system: survey?.bodyCount,
        bodies_scanned: scanned.length,
        all_bodies_found: survey?.allFound || undefined,
        other_signals: survey?.nonBodyCount || undefined,
        bio_signals: withLife.length
          ? {
              signals: withLife.reduce((sum, body) => sum + body.bioSignals, 0),
              bodies: withLife.length,
              genuses: [...new Set(withLife.flatMap((body) => body.genuses.map((g) => g.name)))],
            }
          : undefined,
        surface_signals: surfaceSignals.size ? Object.fromEntries(surfaceSignals) : undefined,
        landable_bodies: landable.length || undefined,
        closest_landable:
          landable[0] &&
          `${landable[0].name}${landable[0].distanceLs === undefined ? '' : ` at ${Math.round(landable[0].distanceLs)} ls`}`,
        scan_value_cr:
          Math.round(
            survey?.bodies
              .filter((body) => body.status === 'pending')
              .reduce((sum, body) => sum + body.value, 0) ?? 0,
          ) || undefined,
        population: details?.population,
        economy: inhabited ? details?.economy : undefined,
        government: inhabited ? details?.government : undefined,
        security: inhabited ? details?.security : undefined,
        allegiance: inhabited ? details?.allegiance : undefined,
        edsm:
          edsm.status === 'ok'
            ? {
                traffic_last_day: edsm.traffic?.day,
                traffic_last_week: edsm.traffic?.week,
                ships_lost_last_day: edsm.deaths?.day,
                ships_lost_last_week: edsm.deaths?.week,
                closest_starport: edsm.closestStarport && {
                  name: edsm.closestStarport.name,
                  type: edsm.closestStarport.type,
                  distance_ls: round(edsm.closestStarport.distanceLs, 0),
                },
              }
            : edsm.status === 'unknown'
              ? 'not in EDSM: nobody has uploaded this system'
              : 'EDSM could not be reached',
      };
    },
  });
}
