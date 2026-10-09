/**
 * Spansh: what the whole community's uploads know about stations, systems and bodies, searched
 * from wherever the commander is, and Spansh's route plotters. The client and the filter shapes
 * are in `src/main/spansh/`; this file is what the model sees, and how answers are cut down.
 */

import { z } from 'zod';

import { shipBuild, superchargeMultiplier } from '../../../shared/fsd';
import type { LoadoutEvent } from '../../../shared/journal';
import { CARRIER_TYPE, jumpsFor } from '../../carriers/alert';
import { type Coords, field, SpanshClient, SpanshError } from '../../spansh/client';
import {
  asArray,
  compactBody,
  compactSearchResult,
  compactStation,
  compactSystem,
  daysAgo,
  describeFields,
  describeRoute,
  howToFilter,
  largestPad,
  listValues,
  sameName,
  text,
} from '../../spansh/compact';
import { buildFilters, buildSort, type Filter, FilterError } from '../../spansh/filters';
import {
  CARRIER_MAX_AGE_DAYS,
  lightYears,
  notableServices,
  padFor,
  readSellStops,
  routeDestination,
  type SellStop,
  sellStopFilters,
} from '../../spansh/sell-stop';
import {
  defineTool,
  type GameContext,
  type Tool,
  type ToolContext,
  type Toolset,
} from '../tools/define';
import { round } from './format';

const KINDS = ['stations', 'systems', 'bodies'] as const;
/** A route job is waited on this long before the model is told to check back. */
const ROUTE_WAIT_MS = 75_000;
const ROUTE_TIMEOUT_MS = ROUTE_WAIT_MS + 15_000;

/** Carriers' tritium sums use the carrier's own mass and hold, as Spansh's form sets them. */
const CARRIERS = {
  fleet: { mass: 25_000, capacity: 25_000 },
  squadron: { mass: 15_000, capacity: 60_000 },
};

const conditionShape = {
  field: z.string().min(1).describe('A field name from spansh_search_fields.'),
  values: z
    .array(z.string())
    .min(1)
    .optional()
    .describe('Match any of these, for fields with fixed values: type, services, allegiance…'),
  text: z.string().optional().describe('For free-text fields: name, system_name…'),
  min: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Lower bound: a number, or an ISO date for *_updated_at.'),
  max: z.union([z.number(), z.string()]).optional().describe('Upper bound.'),
  is: z.boolean().optional().describe('For yes/no fields.'),
};

const filterSchema = z.object({
  ...conditionShape,
  name: z
    .string()
    .optional()
    .describe('For named amounts (signals, materials, economies…): which one; min/max bound it.'),
  parts: z
    .array(z.object(conditionShape))
    .optional()
    .describe(
      'For item lists (marketplace, modules, ships, stations, rings…): conditions one item must ' +
        'meet together. Repeat the filter to require several items.',
    ),
});

const nearSchema = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Measure distances from this system instead of the commander's position. Leave it out to " +
      'search around the commander, which works even where nobody has been.',
  );

export function createSpanshToolset(client: SpanshClient): Toolset {
  return {
    name: 'Spansh',
    instructions: `Spansh is a database built from what players' tools upload, with search and route plotters. Its searches measure from the commander's own coordinates, so they work deep in the black where Inara and EDSM don't know the system: "the nearest fleet carrier", "where can I buy a 5A fuel scoop", "the closest encoded material trader", "who buys tritium near here", "an Earth-like world within 200 ly".

spansh_search takes filters on named fields. Common ones, for stations: type (values like "Drake-Class Carrier", "Coriolis Starport", "Outpost"), services (parts name: ["Refuel"], ["Universal Cartographics"], ["Vista Genomics"], ["Interstellar Factors Contact"]), material_trader (values Raw/Manufactured/Encoded), technology_broker (Human/Guardian), has_large_pad (is), marketplace (parts commodity, supply, demand, buy_price, sell_price), modules (parts name, class, rating), ships (parts name), market_updated_at (min as a date). For bodies: subtype, is_landable, gravity, signals (name Biological, min 3), genuses, rings. For systems: population, allegiance, power, security, needs_permit. Exact spellings matter; when unsure, spansh_search_fields lists fields and their values. Results are sorted nearest first unless you sort otherwise.

Its data is only as fresh as the last upload: carriers move and markets change. Say how old a result is when it's more than a day or two ("seen 3 weeks ago"). spansh_get_system, spansh_get_station and spansh_get_body read one record in full.

"Find the next sell stop" (or "next sell stop", "where do I sell") means find_next_sell_stop: the nearest station or open carrier with Vista Genomics that is nearer the route's destination than the commander, so selling costs no progress. Pass what else they ask for, e.g. "with repair and refuel" as services ["Repair", "Refuel"]. Say the system, the station, how far and how many jumps, and offer to copy the system name.

The plotters take a few seconds to a minute. They start from the current system and use the current ship's jump range unless told otherwise. A plotter can't set the route in the game; read out the next stops, or offer the whole list. A long route comes a window at a time: read on with spansh_route_result.`,

    tools: [
      searchFieldsTool(client),
      searchTool(client),
      nearestTool(client),
      sellStopTool(client),
      systemTool(client),
      stationTool(client),
      bodyTool(client),
      neutronRouteTool(client),
      exactRouteTool(client),
      richesRouteTool(client),
      exobiologyRouteTool(client),
      touristRouteTool(client),
      carrierRouteTool(client),
      tradeRouteTool(client),
      colonisationRouteTool(client),
      engineerRouteTool(client),
      routeResultTool(client),
    ],
  };
}

// ——— Searches ———

function searchFieldsTool(client: SpanshClient): Tool {
  return defineTool({
    name: 'spansh_search_fields',
    description:
      'The fields spansh_search can filter stations, systems or bodies on, grouped by how to ' +
      'filter them. With a field, the values it takes (e.g. every service, ship, module or ' +
      'commodity name, spelled as Spansh spells them).',
    parameters: z.object({
      kind: z.enum(KINDS),
      field: z.string().optional().describe('One field, to list the values it takes.'),
      search: z.string().optional().describe('Only values containing this, case ignored.'),
    }),
    async run({ kind, field: name, search }, { signal }) {
      return spanshCall(async () => {
        const fields = await client.searchableFields(kind, signal);
        if (name === undefined) return describeFields(fields);
        const known = fields.find((candidate) => candidate.field === name);
        if (!known) return `There is no ${kind} field called ${name}.`;
        const values = await client.fieldValues(kind, name, signal);
        return {
          field: name,
          filter_with: howToFilter(known),
          parts: known.subfields && Object.keys(known.subfields),
          values: listValues(values, search),
        };
      });
    },
  });
}

function searchTool(client: SpanshClient): Tool {
  return defineTool({
    name: 'spansh_search',
    description:
      'Searches Spansh for stations (including fleet carriers), systems or bodies matching ' +
      'filters, nearest to the commander first. Answers with each match, its distance and how ' +
      "old Spansh's data on it is.",
    parameters: z.object({
      kind: z.enum(KINDS),
      filters: z.array(filterSchema).default([]),
      near: nearSchema,
      sort: z
        .array(
          z.object({
            field: z.string(),
            direction: z.enum(['asc', 'desc']),
            name: z
              .string()
              .optional()
              .describe('For market_sell_price, market_buy_price, market_supply, market_demand.'),
          }),
        )
        .optional()
        .describe('Leave out for nearest first.'),
      limit: z.number().int().min(1).max(25).default(8),
      page: z.number().int().min(0).default(0),
    }),
    async run({ kind, filters, near, sort, limit, page }, context) {
      const reference = referenceFor(near, context);
      if (typeof reference === 'string') return reference;
      return spanshCall(async () => {
        const fields = await client.searchableFields(kind, context.signal);
        const body = await client.search(
          kind,
          {
            filters: buildFilters(filters, fields),
            sort: buildSort(sort ?? [{ field: 'distance', direction: 'asc' }]),
            size: limit,
            page,
            ...reference,
          },
          context.signal,
        );
        const results = asArray(field(body, 'results'));
        const count = Number(field(body, 'count') ?? 0);
        return {
          matches: count >= 10_000 ? 'at least 10000' : count,
          measured_from: near ?? 'the commander',
          results: results.map((record) => compactSearchResult(kind, record, filters)),
          next_page: (page + 1) * limit < count ? page + 1 : undefined,
        };
      });
    },
  });
}

function nearestTool(client: SpanshClient): Tool {
  return defineTool({
    name: 'spansh_nearest_known_system',
    description:
      'The system nearest the commander (or a point) that Spansh knows, with its distance. ' +
      'Useful as a named starting point for a site that needs a system name.',
    parameters: z.object({
      x: z.number().optional(),
      y: z.number().optional(),
      z: z.number().optional(),
    }),
    async run(point, { game, signal }) {
      const coords =
        point.x !== undefined && point.y !== undefined && point.z !== undefined
          ? { x: point.x, y: point.y, z: point.z }
          : commanderPosition(game);
      if (!coords) return "The commander's position isn't known yet; give coordinates.";
      return spanshCall(async () => {
        const system = field(await client.nearest(coords, signal), 'system');
        if (!system) return 'Spansh knows no system near there.';
        return {
          system: field(system, 'name'),
          distance_ly: round(Number(field(system, 'distance'))),
          id64: text(field(system, 'id64')),
        };
      });
    },
  });
}

/** Results per page, and pages per search: the nearest 300 of each kind are looked through. */
const SELL_PAGE = 100;
const SELL_PAGES = 3;
/** How many of the route's last systems are tried when Spansh doesn't know where it ends. */
const DESTINATION_TRIES = 5;

function sellStopTool(client: SpanshClient): Tool {
  return defineTool({
    name: 'find_next_sell_stop',
    description:
      'The next place to sell organic data: the nearest station or fleet carrier with Vista ' +
      'Genomics. Carriers only if open to all and reported lately. While a route is set (plotted ' +
      'in the game or loaded from a CSV), only stops nearer its destination than the commander ' +
      'is, so no progress is undone. Fits the ship: a large ship only gets large pads.',
    parameters: z.object({
      services: z
        .array(z.string().min(1))
        .default([])
        .describe(
          'Other services it must have, as Spansh names them: "Repair", "Refuel", "Restock" ' +
            '(rearm), "Universal Cartographics", "Outfitting", "Shipyard", ' +
            '"Interstellar Factors Contact", "Material Trader"…',
        ),
      pad: z
        .enum(['auto', 'small', 'medium', 'large'])
        .default('auto')
        .describe('The landing pad needed; auto goes by the current ship.'),
      carriers: z.boolean().default(true).describe('Whether fleet carriers count.'),
      carrier_max_age_days: z
        .number()
        .int()
        .min(1)
        .default(CARRIER_MAX_AGE_DAYS)
        .describe('Skip carriers nobody has reported for longer than this.'),
      any_direction: z
        .boolean()
        .default(false)
        .describe('Ignore the route and take the nearest, even if it lies behind.'),
      limit: z.number().int().min(1).max(5).default(3),
    }),
    timeoutMs: 45_000,
    async run(args, context) {
      const { game, signal } = context;
      const here = commanderPosition(game);
      if (!here) return "The commander's position isn't known yet.";
      return spanshCall(async () => {
        const services = await spanshServices(client, args.services, signal);
        if (typeof services === 'string') return services;
        const route = args.any_direction ? undefined : await sellRoute(client, context, here);
        const destination = typeof route === 'object' ? route.coords : undefined;
        const ship = loadout(context);
        const pad = args.pad === 'auto' ? padFor(ship?.Ship) : args.pad;
        const [fields, types] = await Promise.all([
          client.searchableFields('stations', signal),
          client.fieldValues('stations', 'type', signal),
        ]);
        const options = {
          services,
          pad,
          carrierMaxAgeDays: args.carrier_max_age_days,
          now: Date.now(),
        };

        const searchGroup = async (group: 'carriers' | 'stations') => {
          const filters = buildFilters(
            sellStopFilters(group, asArray(field(types, 'values')).map(text), options),
            fields,
          );
          const stops: SellStop[] = [];
          let behind = 0;
          let complete = false;
          for (let page = 0; page < SELL_PAGES && stops.length < args.limit; page++) {
            const body = await client.search(
              'stations',
              {
                filters,
                sort: buildSort([{ field: 'distance', direction: 'asc' }]),
                size: SELL_PAGE,
                page,
                reference_coords: here,
              },
              signal,
            );
            const read = readSellStops(body, here, destination, pad);
            stops.push(...read.stops);
            behind += read.behind;
            complete = asArray(field(body, 'results')).length < SELL_PAGE;
            if (complete) break;
          }
          return { stops, behind, complete: complete || stops.length >= args.limit };
        };
        const groups = await Promise.all(
          (args.carriers ? (['stations', 'carriers'] as const) : (['stations'] as const)).map(
            searchGroup,
          ),
        );
        const stops = groups
          .flatMap((group) => group.stops)
          .toSorted((a, b) => a.distanceLy - b.distanceLy)
          .slice(0, args.limit);
        const behind = groups.reduce((total, group) => total + group.behind, 0);
        const range = ship?.MaxJumpRange;

        return {
          route:
            typeof route === 'object'
              ? route.summary
              : (route ?? (args.any_direction ? 'ignored, as asked' : 'none set')),
          pad_needed: pad,
          stops: stops.map((stop) => sellStopRow(stop, range)),
          skipped_behind: behind || undefined,
          note:
            stops.length === 0
              ? groups.every((group) => group.complete)
                ? 'Spansh knows no such stop' +
                  (destination ? ' nearer the destination.' : '.') +
                  (services.length ? ' Try without the extra services.' : '')
                : `None among the nearest ${SELL_PAGE * SELL_PAGES} with Vista Genomics` +
                  (destination ? ' lies towards the destination.' : '.')
              : undefined,
        };
      });
    },
  });
}

/** The services asked for, spelled as Spansh spells them, or a sentence naming one it lacks. */
async function spanshServices(
  client: SpanshClient,
  wanted: readonly string[],
  signal: AbortSignal,
): Promise<string[] | string> {
  if (wanted.length === 0) return [];
  const known = asArray(
    field(field(await client.fieldValues('stations', 'services', signal), 'values'), 'name'),
  ).map(text);
  const spelled: string[] = [];
  for (const name of wanted) {
    const match = known.find((service) => sameName(service, name));
    if (!match) return `Spansh has no service called ${name}. It has: ${known.join(', ')}.`;
    spelled.push(match);
  }
  return spelled;
}

/**
 * The route the stop must lie along: its destination and how far off it is, or a sentence saying
 * why none is used. Undefined when no route is set.
 */
async function sellRoute(
  client: SpanshClient,
  { game, signal }: ToolContext,
  here: Coords,
): Promise<{ coords: Coords; summary: Record<string, unknown> } | string | undefined> {
  const destination = routeDestination(game.routes(), game.csvRoute());
  if (!destination) return undefined;
  let coords = destination.coords;
  let name = destination.names[0];
  for (const candidate of coords ? [] : destination.names.slice(0, DESTINATION_TRIES)) {
    const match = await client.system(candidate, signal);
    if (match && [match.x, match.y, match.z].every(Number.isFinite)) {
      coords = { x: match.x, y: match.y, z: match.z };
      name = candidate;
      break;
    }
  }
  const from = destination.source === 'plotted' ? 'plotted in the game' : 'the CSV route';
  if (!coords || !name) {
    return `Spansh doesn't know where ${from} ends, so this is the nearest in any direction.`;
  }
  const left = lightYears(here, coords);
  if (left < 1) return `Already at the end of ${from}, so this is the nearest in any direction.`;
  return {
    coords,
    summary: {
      destination: destination.names[0],
      measured_to: name === destination.names[0] ? undefined : name,
      from,
      commander_to_destination_ly: round(left),
    },
  };
}

function sellStopRow(stop: SellStop, jumpRangeLy: number | undefined): unknown {
  const { row } = stop;
  const carrier = field(row, 'type') === CARRIER_TYPE;
  return {
    system: field(row, 'system_name'),
    station: field(row, carrier ? 'carrier_name' : 'name'),
    callsign: carrier ? field(row, 'name') : undefined,
    type: field(row, 'type'),
    distance_ly: round(stop.distanceLy),
    jumps: jumpRangeLy ? jumpsFor(stop.distanceLy, jumpRangeLy) : undefined,
    then_to_destination_ly:
      stop.toDestinationLy === undefined ? undefined : round(stop.toDestinationLy),
    arrival_ls:
      typeof field(row, 'distance_to_arrival') === 'number'
        ? Math.round(Number(field(row, 'distance_to_arrival')))
        : undefined,
    largest_pad: largestPad(row),
    planetary: field(row, 'is_planetary') || undefined,
    also: notableServices(row),
    updated_days_ago: daysAgo(field(row, 'updated_at')),
  };
}

function systemTool(client: SpanshClient): Tool {
  return defineTool({
    name: 'spansh_get_system',
    description:
      "Spansh's full record of one system: population, government, factions and their " +
      'influence, powerplay, permit, its stations with their pads and key services, its most ' +
      'valuable and notable bodies, and how many are known.',
    parameters: z.object({ name: z.string().min(1) }),
    async run({ name }, { game, signal }) {
      return spanshCall(async () => {
        const match = await client.system(name, signal);
        if (!match) return `Spansh doesn't know a system called ${name}.`;
        const record = await client.record('system', match.id64, signal);
        if (!record) return `Spansh has no record for ${match.name}.`;
        const here = commanderPosition(game);
        return compactSystem(record, here);
      });
    },
  });
}

function stationTool(client: SpanshClient): Tool {
  return defineTool({
    name: 'spansh_get_station',
    description:
      "Spansh's record of one station or fleet carrier: its services and pads, or its market, " +
      'outfitting or shipyard with prices, and when each was last updated.',
    parameters: z.object({
      name: z.string().min(1).describe('The station or carrier name (a carrier by its ID).'),
      system: z.string().optional().describe('Its system, if known; narrows the search.'),
      section: z.enum(['overview', 'market', 'outfitting', 'shipyard']).default('overview'),
      match: z
        .string()
        .optional()
        .describe('In market, outfitting or shipyard: only items containing this.'),
    }),
    async run({ name, system, section, match }, context) {
      const reference = system ? { reference_system: system } : referenceFor(undefined, context);
      if (typeof reference === 'string') return reference;
      return spanshCall(async () => {
        const fields = await client.searchableFields('stations', context.signal);
        const filters: Filter[] = [{ field: 'name', text: name }];
        if (system) filters.push({ field: 'system_name', text: system });
        const found = asArray(
          field(
            await client.search(
              'stations',
              {
                filters: buildFilters(filters, fields),
                sort: buildSort([{ field: 'distance', direction: 'asc' }]),
                size: 10,
                ...reference,
              },
              context.signal,
            ),
            'results',
          ),
        );
        const station =
          found.find((candidate) => sameName(field(candidate, 'name'), name)) ?? found[0];
        if (!station) return `Spansh knows no station called ${name}.`;
        const marketId = text(field(station, 'market_id'));
        const record =
          (marketId && (await client.record('station', marketId, context.signal))) || station;
        return compactStation(record, section, match, Number(field(station, 'distance')));
      });
    },
  });
}

function bodyTool(client: SpanshClient): Tool {
  return defineTool({
    name: 'spansh_get_body',
    description:
      "Spansh's record of one planet or star: atmosphere, gravity, temperature, volcanism, " +
      'materials, rings and their hotspots, signals, the biology others have logged on it by ' +
      'species, and its scan and mapping value.',
    parameters: z.object({
      name: z.string().min(1).describe('The full body name, e.g. "Colonia 5 a".'),
    }),
    async run({ name }, context) {
      const reference = referenceFor(undefined, context);
      return spanshCall(async () => {
        const fields = await client.searchableFields('bodies', context.signal);
        const found = asArray(
          field(
            await client.search(
              'bodies',
              {
                filters: buildFilters([{ field: 'name', text: name }], fields),
                size: 10,
                ...(typeof reference === 'string' ? {} : reference),
              },
              context.signal,
            ),
            'results',
          ),
        );
        const body = found.find((candidate) => sameName(field(candidate, 'name'), name));
        if (!body) return `Spansh knows no body called ${name}.`;
        return compactBody(body, true);
      });
    },
  });
}

// ——— Routes ———

const fromSchema = z
  .string()
  .min(1)
  .optional()
  .describe('The starting system. Leave out to start where the commander is.');
const rangeSchema = z
  .number()
  .positive()
  .optional()
  .describe("Jump range in ly. Leave out to use the current ship's.");

function neutronRouteTool(client: SpanshClient): Tool {
  return routeTool(client, {
    name: 'spansh_plot_neutron_route',
    description:
      "Plots a route that jumps through neutron stars to supercharge the ship's range: the " +
      'fastest way across long distances. Knows the SCO Mk II drive boosts range sixfold.',
    parameters: z.object({
      from: fromSchema,
      to: z.string().min(1),
      range_ly: rangeSchema,
      via: z.array(z.string()).optional().describe('Systems to pass through, in order.'),
      efficiency: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(60)
        .describe('How far from the straight line it may stray for neutrons; higher stays closer.'),
    }),
    async start(args, context) {
      const from = args.from ?? currentSystem(context);
      const range = args.range_ly ?? loadout(context)?.MaxJumpRange;
      if (!from) return 'Where does it start? The current system is not known.';
      if (!range) return 'What is the jump range? There is no loadout to read it from.';
      return client.plot(
        '/route',
        {
          from,
          to: args.to,
          range,
          via: args.via,
          efficiency: args.efficiency,
          supercharge_multiplier: superchargeMultiplier(loadout(context)),
        },
        { signal: context.signal },
      );
    },
  });
}

function exactRouteTool(client: SpanshClient): Tool {
  return routeTool(client, {
    name: 'spansh_plot_exact_route',
    description:
      'Plots an exact route for the current ship, from its loadout: fuel use, where it must ' +
      'refuel from a star, neutron boosts and, if asked, synthesised FSD injections. Slower ' +
      'than the neutron plotter but safe for a ship with a small tank.',
    parameters: z.object({
      from: fromSchema,
      to: z.string().min(1),
      algorithm: z
        .enum(['optimistic', 'pessimistic', 'fuel', 'fuel_jumps', 'guided'])
        .default('optimistic')
        .describe('optimistic is fastest to plot; fuel and fuel_jumps save fuel.'),
      use_neutrons: z.boolean().default(true),
      use_injections: z.boolean().default(false).describe('Plan on synthesised FSD injections.'),
      exclude_secondary: z
        .boolean()
        .default(false)
        .describe('Only refuel from the primary star, not companion stars.'),
      refuel_every_scoopable: z.boolean().default(true),
      cargo_t: z.number().min(0).default(0),
      fuel_reserve_t: z.number().min(0).default(0),
    }),
    async start(args, context) {
      const ship = loadout(context);
      if (!ship) return "There is no loadout in this session to read the ship's drive from.";
      const build = shipBuild(ship);
      if (typeof build === 'string') return build;
      const source = await systemId(client, args.from, context);
      if (!/^\d+$/.test(source)) return source;
      const destination = await systemId(client, args.to, context);
      if (!/^\d+$/.test(destination)) return destination;
      return client.plot(
        '/generic/route',
        {
          source,
          destination,
          is_supercharged: false,
          use_supercharge: args.use_neutrons,
          use_injections: args.use_injections,
          use_injections_when_required: false,
          exclude_secondary: args.exclude_secondary,
          refuel_every_scoopable: args.refuel_every_scoopable,
          ...build,
          reserve_size: args.fuel_reserve_t,
          max_time: 60,
          cargo: args.cargo_t,
          algorithm: args.algorithm,
        },
        { signal: context.signal },
      );
    },
  });
}

const tripShape = {
  from: fromSchema,
  to: z.string().optional().describe('Where to end up; leave out to wander from the start.'),
  range_ly: rangeSchema,
  radius_ly: z
    .number()
    .positive()
    .default(25)
    .describe('How far from the line between start and end systems may be.'),
  max_systems: z.number().int().min(1).max(100).default(20),
  max_distance_ls: z
    .number()
    .int()
    .positive()
    .default(50_000)
    .describe('Skip bodies further than this from arrival.'),
  avoid_thargoids: z.boolean().default(true),
  loop: z.boolean().default(false).describe('Come back to the start.'),
};

function richesRouteTool(client: SpanshClient): Tool {
  return routeTool(client, {
    name: 'spansh_plot_road_to_riches',
    description:
      'Plots a road to riches: nearby systems with valuable bodies to scan and map ' +
      '(Earth-likes, water and ammonia worlds, terraformables), with each body and its value.',
    parameters: z.object({
      ...tripShape,
      min_value_cr: z.number().int().min(0).default(300_000),
      use_mapping_value: z.boolean().default(true).describe('Value bodies as mapped, not scanned.'),
      body_types: z
        .array(z.string())
        .optional()
        .describe('Only these, e.g. ["Earth-like world"], ["Ammonia world"], ["Water world"].'),
    }),
    async start(args, context) {
      const from = args.from ?? currentSystem(context);
      const range = args.range_ly ?? loadout(context)?.MaxJumpRange;
      if (!from || !range) return 'Need a start system and a jump range.';
      return client.plot(
        '/riches/route',
        {
          ...tripParams(args, from, range),
          min_value: args.body_types ? 1 : args.min_value_cr,
          use_mapping_value: args.use_mapping_value,
          body_types: args.body_types,
        },
        { signal: context.signal },
      );
    },
  });
}

function exobiologyRouteTool(client: SpanshClient): Tool {
  return routeTool(client, {
    name: 'spansh_plot_exobiology_route',
    description:
      'Plots an exobiology route: nearby bodies where others have logged valuable species, with ' +
      "each body's species and what they are worth.",
    parameters: z.object({
      ...tripShape,
      min_value_cr: z
        .number()
        .int()
        .min(0)
        .default(10_000_000)
        .describe("A body's total species value, at least."),
    }),
    async start(args, context) {
      const from = args.from ?? currentSystem(context);
      const range = args.range_ly ?? loadout(context)?.MaxJumpRange;
      if (!from || !range) return 'Need a start system and a jump range.';
      return client.plot(
        '/exobiology/route',
        { ...tripParams(args, from, range), min_value: args.min_value_cr },
        { signal: context.signal },
      );
    },
  });
}

function touristRouteTool(client: SpanshClient): Tool {
  return routeTool(client, {
    name: 'spansh_plot_tourist_route',
    description:
      'Plots the shortest order to visit several systems, e.g. sightseeing or mission ' +
      'destinations, jump by jump.',
    parameters: z.object({
      from: fromSchema,
      destinations: z.array(z.string().min(1)).min(1),
      final_destination: z.string().optional().describe('Where to finish, after the rest.'),
      range_ly: rangeSchema,
      loop: z.boolean().default(false),
    }),
    async start(args, context) {
      const from = args.from ?? currentSystem(context);
      const range = args.range_ly ?? loadout(context)?.MaxJumpRange;
      if (!from || !range) return 'Need a start system and a jump range.';
      return client.plot(
        '/tourist/route',
        {
          source: from,
          destination: args.destinations,
          final_destination: args.final_destination,
          range,
          loop: args.loop,
        },
        { signal: context.signal },
      );
    },
  });
}

function carrierRouteTool(client: SpanshClient): Tool {
  return routeTool(client, {
    name: 'spansh_plot_carrier_route',
    description:
      'Plots a fleet carrier route: each jump (up to 500 ly), the tritium it burns, and where ' +
      'the carrier has to restock tritium from its market.',
    parameters: z.object({
      from: z.string().optional().describe("The carrier's system; leave out for the current one."),
      destinations: z.array(z.string().min(1)).min(1).describe('In order; the last is the end.'),
      carrier: z.enum(['fleet', 'squadron']).default('fleet'),
      used_capacity_t: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe('Cargo, modules and market stock aboard, in tonnes.'),
      tritium_in_tank_t: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Leave both tritium figures out to have Spansh work out what to start with.'),
      tritium_in_market_t: z.number().int().min(0).optional(),
    }),
    async start(args, context) {
      const source = await systemId(client, args.from, context);
      if (!/^\d+$/.test(source)) return source;
      const destinations: string[] = [];
      for (const name of args.destinations) {
        const id = await systemId(client, name, context);
        if (!/^\d+$/.test(id)) return id;
        destinations.push(id);
      }
      const known = args.tritium_in_tank_t !== undefined || args.tritium_in_market_t !== undefined;
      return client.plot(
        '/fleetcarrier/route',
        {
          source,
          destinations,
          ...CARRIERS[args.carrier],
          capacity_used: args.used_capacity_t,
          calculate_starting_fuel: !known,
          ...(known
            ? {
                fuel_loaded: args.tritium_in_tank_t ?? 0,
                tritium_stored: args.tritium_in_market_t ?? 0,
              }
            : {}),
        },
        { signal: context.signal },
      );
    },
  });
}

function tradeRouteTool(client: SpanshClient): Tool {
  return routeTool(client, {
    name: 'spansh_plot_trade_route',
    description:
      'Plots a trade loop from a station: what to buy at each stop, where to sell it, and the ' +
      'profit per hop and in total, from recent market data.',
    parameters: z.object({
      system: z.string().optional().describe('The starting system; defaults to the current one.'),
      station: z.string().optional().describe('The starting station; defaults to the docked one.'),
      capital_cr: z.number().int().positive(),
      cargo_t: z.number().int().positive().optional().describe("Defaults to the ship's hold."),
      max_hops: z.number().int().min(1).max(20).default(5),
      max_hop_distance_ly: z.number().positive().default(30),
      max_arrival_ls: z.number().int().positive().default(5000),
      max_price_age_days: z.number().positive().default(7),
      large_pad: z.boolean().default(true),
      allow_planetary: z.boolean().default(false),
      allow_carriers: z.boolean().default(false),
      allow_prohibited: z.boolean().default(false),
      allow_permit_systems: z.boolean().default(false),
      unique: z.boolean().default(false).describe('Never visit a station twice.'),
    }),
    async start(args, context) {
      const overview = context.game.overview();
      const system = args.system ?? overview.system;
      const station = args.station ?? overview.station;
      const cargo = args.cargo_t ?? loadout(context)?.CargoCapacity;
      if (!system || !station) return 'Which station does the loop start from?';
      if (!cargo) return 'How much cargo can the ship carry?';
      return client.plot(
        '/trade/route',
        {
          system,
          station,
          starting_capital: args.capital_cr,
          max_cargo: cargo,
          max_hops: args.max_hops,
          max_hop_distance: args.max_hop_distance_ly,
          max_system_distance: args.max_arrival_ls,
          max_price_age: Math.round(args.max_price_age_days * 86_400),
          requires_large_pad: args.large_pad,
          allow_prohibited: args.allow_prohibited,
          allow_planetary: args.allow_planetary,
          allow_player_owned: args.allow_carriers,
          allow_restricted_access: false,
          unique: args.unique,
          permit: args.allow_permit_systems,
        },
        { signal: context.signal },
      );
    },
  });
}

function colonisationRouteTool(client: SpanshClient): Tool {
  return routeTool(client, {
    name: 'spansh_plot_colonisation_route',
    description:
      'Plots a chain of systems within colonisation reach (15 ly per claim) from a colonised ' +
      "system towards a target, with each system's bodies and value.",
    parameters: z.object({ from: fromSchema, to: z.string().min(1) }),
    async start(args, context) {
      const from = args.from ?? currentSystem(context);
      if (!from) return 'Where does it start?';
      return client.plot(
        '/colonisation/route',
        { source_system: from, destination_system: args.to },
        { signal: context.signal },
      );
    },
  });
}

function engineerRouteTool(client: SpanshClient): Tool {
  return routeTool(client, {
    name: 'spansh_plot_engineer_route',
    description:
      'Plots the shortest tour of engineers who can apply the given blueprints. Blueprint names ' +
      'are as Spansh spells them, e.g. slot "Frame Shift Drive", name "Increased FSD Range".',
    parameters: z.object({
      from: fromSchema,
      blueprints: z
        .array(
          z.object({
            slot: z.string().describe('The module, e.g. "Frame Shift Drive", "Thrusters".'),
            name: z.string().describe('The blueprint, e.g. "Dirty Drive Tuning".'),
            grade: z.number().int().min(1).max(5),
            effect: z.string().optional().describe('An experimental effect, e.g. "Mass Manager".'),
          }),
        )
        .min(1),
      engineers: z.array(z.string()).optional().describe('Only these engineers.'),
    }),
    async start(args, context) {
      const from = args.from ?? currentSystem(context);
      if (!from) return 'Where does it start?';
      return client.plot(
        '/engineer/route',
        { source: from, blueprints: args.blueprints, engineers: args.engineers },
        { json: true, signal: context.signal },
      );
    },
  });
}

function routeResultTool(client: SpanshClient): Tool {
  return defineTool({
    name: 'spansh_route_result',
    description:
      'A route a Spansh plotter made, by its job id: whether it is done yet, and a window of ' +
      'its stops from an offset.',
    parameters: z.object({
      job: z.string().min(1),
      offset: z.number().int().min(0).default(0),
    }),
    timeoutMs: ROUTE_TIMEOUT_MS,
    async run({ job, offset }, { signal }) {
      return spanshCall(async () => describeRoute(await client.routeState(job, signal), offset));
    },
  });
}

interface RouteSpec<S extends z.ZodType> {
  name: string;
  description: string;
  parameters: S;
  /** Queues the job and gives its id, or says why it can't. */
  start(args: z.output<S>, context: ToolContext): Promise<string>;
}

function routeTool<S extends z.ZodType>(client: SpanshClient, spec: RouteSpec<S>): Tool {
  return defineTool({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    timeoutMs: ROUTE_TIMEOUT_MS,
    async run(args, context) {
      return spanshCall(async () => {
        const job = await spec.start(args, context);
        if (!isJob(job)) return job;
        return describeRoute(await client.waitForRoute(job, ROUTE_WAIT_MS, context.signal), 0);
      });
    },
  });
}

function tripParams(
  args: {
    to?: string;
    radius_ly: number;
    max_systems: number;
    max_distance_ls: number;
    avoid_thargoids: boolean;
    loop: boolean;
  },
  from: string,
  range: number,
): Record<string, unknown> {
  return {
    from,
    to: args.to,
    range,
    radius: args.radius_ly,
    max_results: args.max_systems,
    max_distance: args.max_distance_ls,
    avoid_thargoids: args.avoid_thargoids,
    loop: args.loop,
  };
}

// ——— Helpers ———

/** Where searches measure from: a named system, or the commander's coordinates. */
function referenceFor(
  near: string | undefined,
  { game }: GameContext,
): { reference_system: string } | { reference_coords: Coords } | string {
  if (near) return { reference_system: near };
  const coords = commanderPosition(game);
  if (coords) return { reference_coords: coords };
  const system = game.overview().system;
  return system
    ? { reference_system: system }
    : "The commander's position isn't known yet; name a system to search around.";
}

/** The newest coordinates the journal gave, from this session or any before it. */
export function commanderPosition(game: GameContext['game']): Coords | undefined {
  const events = game.session().events;
  for (let index = events.length - 1; index >= 0; index--) {
    const position: unknown = Reflect.get(events[index]!, 'StarPos');
    if (isPosition(position)) return { x: position[0], y: position[1], z: position[2] };
  }
  const known = game.activity().commander.position;
  return known ? { x: known[0], y: known[1], z: known[2] } : undefined;
}

function isPosition(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number');
}

function currentSystem({ game }: GameContext): string | undefined {
  return game.overview().system;
}

function loadout({ game }: GameContext): LoadoutEvent | undefined {
  return game
    .session()
    .events.findLast((event): event is LoadoutEvent => event.event === 'Loadout');
}

/** A system's id64 as a string of digits, or a sentence saying why there isn't one. */
async function systemId(
  client: SpanshClient,
  name: string | undefined,
  context: ToolContext,
): Promise<string> {
  if (name === undefined) {
    const address = context.game.overview().systemAddress;
    return address === undefined ? 'The current system is not known yet.' : String(address);
  }
  const match = await client.system(name, context.signal);
  return match ? match.id64 : `Spansh doesn't know a system called ${name}.`;
}

function isJob(value: string): boolean {
  return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(value);
}

/** Runs a Spansh call, turning the answers Spansh or a filter refuse into words for the model. */
async function spanshCall(call: () => Promise<unknown>): Promise<unknown> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof SpanshError || error instanceof FilterError) return error.message;
    throw error;
  }
}

/** Built last: the tools read the schemas declared above. */
export const spanshToolset = createSpanshToolset(new SpanshClient());
