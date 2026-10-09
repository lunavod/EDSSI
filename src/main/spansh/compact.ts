/**
 * Spansh's answers cut down for the model: each route plotter's shape folded into a summary and
 * rows, and search results and records reduced to what a commander asks about, with how old
 * Spansh's data is.
 */

import { round } from '../ai/toolsets/format';
import {
  type Coords,
  field,
  type RouteResult,
  type RouteState,
  type SearchKind,
  type SearchableField,
} from './client';
import type { Filter } from './filters';

/** Rows of a route handed over at once; the rest is read with spansh_route_result. */
export const ROUTE_WINDOW = 25;
const MAX_VALUES = 120;
const DAY_MS = 24 * 60 * 60_000;

// ——— Route results ———

export function describeRoute(state: RouteState, offset: number): unknown {
  if (!state.done) {
    return {
      job: state.job,
      status: `still plotting${state.state ? ` (${state.state})` : ''}`,
      note: 'Check back with spansh_route_result and this job id.',
    };
  }
  const route = state.route;
  const { kind, summary, rows } = compactRoute(route);
  const window = rows.slice(offset, offset + ROUTE_WINDOW);
  return {
    job: route.job,
    kind,
    ...summary,
    stops: window,
    from_stop: offset,
    next_offset: offset + ROUTE_WINDOW < rows.length ? offset + ROUTE_WINDOW : undefined,
    stops_total: rows.length,
  };
}

/** Each plotter answers in its own shape; this folds them all into a summary and rows. */
export function compactRoute(route: RouteResult): {
  kind: string;
  summary: Record<string, unknown>;
  rows: unknown[];
} {
  const result = route.result;

  if (Array.isArray(result)) {
    if (result.some((hop) => field(hop, 'commodities') !== undefined)) {
      return {
        kind: 'trade',
        summary: { total_profit_cr: sum(result, (hop) => field(hop, 'total_profit')) },
        rows: result.map((hop) => ({
          from: `${text(field(field(hop, 'source'), 'station'))}, ${text(field(field(hop, 'source'), 'system'))}`,
          to: `${text(field(field(hop, 'destination'), 'station'))}, ${text(field(field(hop, 'destination'), 'system'))}`,
          distance_ly: round(Number(field(hop, 'distance'))),
          buy: asArray(field(hop, 'commodities')).map((commodity) => ({
            commodity: field(commodity, 'name'),
            tonnes: field(commodity, 'amount'),
            buy_cr: field(field(commodity, 'source_commodity'), 'buy_price'),
            sell_cr: field(field(commodity, 'destination_commodity'), 'sell_price'),
            profit_cr: field(commodity, 'total_profit'),
          })),
          profit_cr: field(hop, 'total_profit'),
          cumulative_profit_cr: field(hop, 'cumulative_profit'),
        })),
      };
    }
    // Road to riches is asked with use_mapping_value; the exobiology plotter values landmarks.
    const exobiology =
      field(route.parameters, 'use_mapping_value') === undefined &&
      result.some((system) =>
        asArray(field(system, 'bodies')).some((body) => Number(field(body, 'landmark_value')) > 0),
      );
    const rows = result.map((system) => ({
      system: field(system, 'name'),
      jumps: field(system, 'jumps'),
      bodies: asArray(field(system, 'bodies')).map((body) =>
        exobiology
          ? {
              name: field(body, 'name'),
              arrival_ls: whole(field(body, 'distance_to_arrival')),
              value_cr: field(body, 'landmark_value'),
              species: asArray(field(body, 'landmarks')).map((species) => ({
                species: field(species, 'subtype'),
                value_cr: field(species, 'value'),
              })),
            }
          : {
              name: field(body, 'name'),
              type: field(body, 'subtype'),
              terraformable: field(body, 'is_terraformable') || undefined,
              arrival_ls: whole(field(body, 'distance_to_arrival')),
              scan_cr: field(body, 'estimated_scan_value'),
              mapping_cr: field(body, 'estimated_mapping_value'),
            },
      ),
    }));
    return {
      kind: exobiology ? 'exobiology' : 'road to riches',
      summary: {
        total_jumps: sum(result, (system) => field(system, 'jumps')),
        total_value_cr: sum(result, (system) =>
          sum(asArray(field(system, 'bodies')), (body) =>
            exobiology
              ? field(body, 'landmark_value')
              : (field(body, 'estimated_mapping_value') ?? field(body, 'estimated_scan_value')),
          ),
        ),
      },
      rows,
    };
  }

  const systemJumps = asArray(field(result, 'system_jumps'));
  if (field(result, 'destination_systems') !== undefined) {
    return {
      kind: 'tourist',
      summary: { total_jumps: sum(systemJumps, (stop) => field(stop, 'jumps')) },
      rows: systemJumps.map((stop) => ({
        system: field(stop, 'system'),
        jumps: field(stop, 'jumps'),
        distance_ly: round(Number(field(stop, 'distance'))),
      })),
    };
  }
  if (systemJumps.length) {
    return {
      kind: 'neutron',
      summary: {
        from: field(result, 'source_system'),
        to: field(result, 'destination_system'),
        distance_ly: whole(field(result, 'distance')),
        total_jumps: field(result, 'total_jumps'),
        neutron_boosts: systemJumps.filter((stop) => field(stop, 'neutron_star') === true).length,
      },
      rows: systemJumps.map((stop) => ({
        system: field(stop, 'system'),
        jumps: field(stop, 'jumps'),
        neutron: field(stop, 'neutron_star') || undefined,
        left_ly: whole(field(stop, 'distance_left')),
      })),
    };
  }

  const jumps = asArray(field(result, 'jumps'));
  if (jumps.some((jump) => field(jump, 'engineer') !== undefined)) {
    return {
      kind: 'engineers',
      summary: {},
      rows: jumps.map((stop) => ({
        system: field(stop, 'system'),
        engineer: field(stop, 'engineer'),
        distance_ly: round(Number(field(stop, 'distance'))),
        blueprints: asArray(field(stop, 'blueprints')).map((blueprint) => {
          const to = field(blueprint, 'to');
          return `${text(field(to, 'slot'))}: ${text(field(to, 'name'))} G${text(field(to, 'grade'))}`;
        }),
      })),
    };
  }
  if (jumps.some((jump) => field(jump, 'tritium_in_market') !== undefined)) {
    return {
      kind: 'fleet carrier',
      summary: {
        carrier_jumps: Math.max(0, jumps.length - 1),
        tritium_t: sum(jumps, (jump) => field(jump, 'fuel_used')),
        restocks: jumps.filter((jump) => Number(field(jump, 'must_restock')) > 0).length,
      },
      rows: jumps.map((jump) => ({
        system: field(jump, 'name'),
        distance_ly: round(Number(field(jump, 'distance'))),
        tritium_used_t: field(jump, 'fuel_used'),
        tritium_in_tank_t: field(jump, 'fuel_in_tank'),
        restock_t:
          Number(field(jump, 'must_restock')) > 0 ? field(jump, 'restock_amount') : undefined,
        destination: Number(field(jump, 'is_desired_destination')) > 0 || undefined,
        icy_ring: field(jump, 'has_icy_ring') || undefined,
        pristine: field(jump, 'is_system_pristine') || undefined,
      })),
    };
  }
  if (jumps.some((jump) => field(jump, 'must_refuel') !== undefined)) {
    return {
      kind: 'galaxy',
      summary: {
        jumps: Math.max(0, jumps.length - 1),
        distance_ly: whole(sum(jumps, (jump) => field(jump, 'distance'))),
        refuels: jumps.filter((jump) => field(jump, 'must_refuel') === true).length,
        neutron_boosts: jumps.filter((jump) => field(jump, 'has_neutron') === true).length,
        injections: jumps.filter((jump) => Number(field(jump, 'must_inject')) > 0).length,
      },
      rows: jumps.map((jump) => ({
        system: field(jump, 'name'),
        distance_ly: round(Number(field(jump, 'distance'))),
        scoopable: field(jump, 'is_scoopable'),
        refuel: field(jump, 'must_refuel') || undefined,
        neutron: field(jump, 'has_neutron') || undefined,
        inject: Number(field(jump, 'must_inject')) > 0 || undefined,
        fuel_left_t: round(Number(field(jump, 'fuel_in_tank'))),
      })),
    };
  }
  return {
    kind: 'colonisation',
    summary: {
      complete: field(result, 'incomplete') ? false : undefined,
      note: field(result, 'reason'),
    },
    rows: jumps.map((jump) => ({
      system: field(jump, 'name'),
      distance_ly: round(Number(field(jump, 'distance'))),
      left_ly: whole(field(jump, 'distance_to_destination')),
      bodies: field(jump, 'body_count'),
      mapping_cr: field(jump, 'estimated_mapping_value'),
    })),
  };
}

// ——— Records ———

export function compactSearchResult(
  kind: SearchKind,
  record: unknown,
  filters: readonly Filter[],
): unknown {
  if (kind === 'stations') return compactStationResult(record, filters);
  if (kind === 'bodies') return compactBody(record, false);
  return {
    system: field(record, 'name'),
    distance_ly: round(Number(field(record, 'distance'))),
    population: field(record, 'population') || undefined,
    allegiance: field(record, 'allegiance'),
    government: field(record, 'government'),
    economy: field(record, 'primary_economy'),
    security: field(record, 'security'),
    power: field(record, 'controlling_power'),
    power_state: field(record, 'power_state'),
    needs_permit: field(record, 'needs_permit') || undefined,
    bodies: field(record, 'body_count'),
    updated_days_ago: daysAgo(field(record, 'updated_at')),
  };
}

export function compactStationResult(record: unknown, filters: readonly Filter[]): unknown {
  const wanted = (name: string) =>
    filters.filter((filter) => filter.field === name).flatMap((filter) => filter.parts ?? []);
  const commodities = wanted('marketplace').flatMap((part) =>
    part.field === 'commodity' ? (part.values ?? []) : [],
  );
  const modules = wanted('modules').flatMap((part) =>
    part.field === 'name' ? (part.values ?? []) : [],
  );
  const ships = wanted('ships').flatMap((part) =>
    part.field === 'name' ? (part.values ?? []) : [],
  );

  return {
    name: field(record, 'name'),
    type: field(record, 'type'),
    system: field(record, 'system_name'),
    distance_ly: round(Number(field(record, 'distance'))),
    arrival_ls: whole(field(record, 'distance_to_arrival')),
    largest_pad: largestPad(record),
    planetary: field(record, 'is_planetary') || undefined,
    carrier_access: field(record, 'carrier_docking_access'),
    material_trader: field(record, 'material_trader'),
    technology_broker: field(record, 'technology_broker'),
    market: commodities.length
      ? asArray(field(record, 'market'))
          .filter((row) => includesName(commodities, field(row, 'commodity')))
          .map(marketRow)
      : undefined,
    modules: modules.length
      ? asArray(field(record, 'modules'))
          .filter((module) => includesName(modules, field(module, 'name')))
          .map(moduleRow)
          .slice(0, 8)
      : undefined,
    ships: ships.length
      ? asArray(field(record, 'ships'))
          .filter((ship) => includesName(ships, field(ship, 'name')))
          .map((ship) => ({ ship: field(ship, 'name'), price_cr: field(ship, 'price') }))
      : undefined,
    updated_days_ago: daysAgo(field(record, 'updated_at')),
    market_updated_days_ago: commodities.length
      ? daysAgo(field(record, 'market_updated_at'))
      : undefined,
    outfitting_updated_days_ago: modules.length
      ? daysAgo(field(record, 'outfitting_updated_at'))
      : undefined,
  };
}

export function compactStation(
  record: unknown,
  section: 'overview' | 'market' | 'outfitting' | 'shipyard',
  match: string | undefined,
  distance: number,
): unknown {
  const head = {
    name: field(record, 'name'),
    type: field(record, 'type'),
    system: field(record, 'system_name'),
    distance_ly: Number.isFinite(distance) ? round(distance) : undefined,
    arrival_ls: whole(field(record, 'distance_to_arrival')),
  };
  const contains = (value: unknown) =>
    !match || text(value).toLowerCase().includes(match.toLowerCase());

  switch (section) {
    case 'market':
      return {
        ...head,
        updated_days_ago: daysAgo(field(record, 'market_updated_at')),
        market: asArray(field(record, 'market'))
          .filter((row) => contains(field(row, 'commodity')))
          .filter(
            (row) => Number(field(row, 'supply')) > 0 || Number(field(row, 'demand')) > 1 || match,
          )
          .map(marketRow)
          .slice(0, 60),
      };
    case 'outfitting':
      return {
        ...head,
        updated_days_ago: daysAgo(field(record, 'outfitting_updated_at')),
        modules: asArray(field(record, 'modules'))
          .filter((module) =>
            contains(
              `${text(field(module, 'class'))}${text(field(module, 'rating'))} ${text(field(module, 'name'))}`,
            ),
          )
          .filter((module) => match || field(module, 'ship') === undefined)
          .map(moduleRow)
          .slice(0, 80),
      };
    case 'shipyard':
      return {
        ...head,
        updated_days_ago: daysAgo(field(record, 'shipyard_updated_at')),
        ships: asArray(field(record, 'ships'))
          .filter((ship) => contains(field(ship, 'name')))
          .map((ship) => ({ ship: field(ship, 'name'), price_cr: field(ship, 'price') })),
      };
    default:
      return {
        ...head,
        largest_pad: largestPad(record),
        pads: {
          large: field(record, 'large_pads'),
          medium: field(record, 'medium_pads'),
          small: field(record, 'small_pads'),
        },
        planetary: field(record, 'is_planetary') || undefined,
        carrier_access: field(record, 'carrier_docking_access'),
        faction: field(record, 'controlling_minor_faction'),
        government: field(record, 'government'),
        allegiance: field(record, 'allegiance'),
        economy: field(record, 'primary_economy'),
        state: field(record, 'state'),
        services: asArray(field(record, 'services')).map((service) =>
          typeof service === 'string' ? service : field(service, 'name'),
        ),
        material_trader: field(record, 'material_trader'),
        technology_broker: field(record, 'technology_broker'),
        has_market: field(record, 'has_market'),
        has_outfitting: field(record, 'has_outfitting'),
        has_shipyard: field(record, 'has_shipyard'),
        updated_days_ago: daysAgo(field(record, 'updated_at')),
      };
  }
}

/** Services worth naming in a system's station list; the rest are in spansh_get_station. */
const KEY_SERVICES = new Set([
  'Refuel',
  'Repair',
  'Restock',
  'Shipyard',
  'Outfitting',
  'Universal Cartographics',
  'Vista Genomics',
  'Interstellar Factors Contact',
  'Material Trader',
  'Technology Broker',
  'Black Market',
]);

export function compactSystem(record: unknown, here: Coords | undefined): unknown {
  const stations = asArray(field(record, 'stations'));
  const carriers = stations.filter((station) => field(station, 'type') === 'Drake-Class Carrier');
  const bodies = asArray(field(record, 'bodies'));
  const notable = bodies
    .filter(
      (body) =>
        /Earth-like|Water world|Ammonia/.test(String(field(body, 'subtype'))) ||
        /Candidate/.test(String(field(body, 'terraforming_state'))) ||
        Number(field(body, 'landmark_value')) > 0,
    )
    .toSorted((a, b) => bodyWorth(b) - bodyWorth(a))
    .slice(0, 12);
  const coords = {
    x: Number(field(record, 'x')),
    y: Number(field(record, 'y')),
    z: Number(field(record, 'z')),
  };

  return {
    system: field(record, 'name'),
    distance_from_commander_ly: here ? round(lightYears(here, coords)) : undefined,
    region: field(record, 'region'),
    population: field(record, 'population') || undefined,
    allegiance: field(record, 'allegiance'),
    government: field(record, 'government'),
    economy: field(record, 'primary_economy'),
    second_economy: field(record, 'secondary_economy'),
    security: field(record, 'security'),
    controlling_faction: field(record, 'controlling_minor_faction'),
    faction_state: field(record, 'controlling_minor_faction_state'),
    power: field(record, 'controlling_power'),
    power_state: field(record, 'power_state'),
    needs_permit: field(record, 'needs_permit') || undefined,
    colonised: field(record, 'is_colonised') || undefined,
    being_colonised: field(record, 'is_being_colonised') || undefined,
    bodies_in_system: field(record, 'body_count'),
    bodies_known: bodies.length,
    scan_value_cr: field(record, 'estimated_scan_value'),
    mapping_value_cr: field(record, 'estimated_mapping_value'),
    notable_bodies: notable.map((body) => ({
      name: field(body, 'name'),
      type: field(body, 'subtype'),
      arrival_ls: whole(field(body, 'distance_to_arrival')),
      terraformable: /Candidate/.test(String(field(body, 'terraforming_state'))) || undefined,
      mapping_cr: field(body, 'estimated_mapping_value'),
      biology_cr: Number(field(body, 'landmark_value')) || undefined,
    })),
    stations: stations
      .filter((station) => field(station, 'type') !== 'Drake-Class Carrier')
      .slice(0, 20)
      .map((station) => ({
        name: field(station, 'name'),
        type: field(station, 'type'),
        arrival_ls: whole(field(station, 'distance_to_arrival')),
        largest_pad: largestPad(station),
        services: asArray(field(station, 'services')).filter((service) =>
          KEY_SERVICES.has(String(service)),
        ),
      })),
    fleet_carriers: carriers.length || undefined,
    factions: asArray(field(record, 'minor_faction_presences'))
      .map((faction) => ({
        name: field(faction, 'name'),
        influence_pct: round(Number(field(faction, 'influence')) * 100),
        state: field(faction, 'state'),
        allegiance: field(faction, 'allegiance'),
      }))
      .slice(0, 10),
    updated_days_ago: daysAgo(field(record, 'updated_at')),
  };
}

export function compactBody(record: unknown, full: boolean): unknown {
  const species = new Map<string, { value: number; count: number }>();
  for (const landmark of asArray(field(record, 'landmarks'))) {
    const value = Number(field(landmark, 'value'));
    if (!(value > 0)) continue;
    const name = String(field(landmark, 'subtype'));
    const entry = species.get(name) ?? { value, count: 0 };
    entry.count += Number(field(landmark, 'count') ?? 1) || 1;
    species.set(name, entry);
  }
  const signals = Object.fromEntries(
    asArray(field(record, 'signals')).map((signal) => [
      field(signal, 'name'),
      field(signal, 'count'),
    ]),
  );
  const common = {
    name: field(record, 'name'),
    system: field(record, 'system_name'),
    distance_ly:
      field(record, 'distance') === undefined
        ? undefined
        : round(Number(field(record, 'distance'))),
    arrival_ls: whole(field(record, 'distance_to_arrival')),
    type: field(record, 'subtype'),
    landable: field(record, 'is_landable') || undefined,
    gravity_g: numberOr(field(record, 'gravity'), 2),
    temperature_k: whole(field(record, 'surface_temperature')),
    atmosphere: field(record, 'atmosphere'),
    signals: Object.keys(signals).length ? signals : undefined,
    genuses: asArray(field(record, 'genuses')).map((genus) => field(genus, 'name')),
    species: species.size
      ? [...species].map(([name, entry]) => ({ species: name, value_cr: entry.value }))
      : undefined,
    mapping_cr: field(record, 'estimated_mapping_value'),
    updated_days_ago: daysAgo(field(record, 'updated_at')),
  };
  if (!full) return common;
  return {
    ...common,
    pressure_atm: numberOr(field(record, 'surface_pressure'), 3),
    atmosphere_composition: shares(field(record, 'atmosphere_composition')),
    volcanism: field(record, 'volcanism_type'),
    terraforming: field(record, 'terraforming_state'),
    radius_km: whole(field(record, 'radius')),
    earth_masses: numberOr(field(record, 'earth_masses'), 3),
    materials: shares(field(record, 'materials')),
    reserve: field(record, 'reserve_level'),
    rings: asArray(field(record, 'rings')).map((ring) => ({
      name: field(ring, 'name'),
      type: field(ring, 'type'),
      hotspots: Object.fromEntries(
        asArray(field(ring, 'signals')).map((signal) => [
          field(signal, 'name'),
          field(signal, 'count'),
        ]),
      ),
    })),
    scan_cr: field(record, 'estimated_scan_value'),
    tidally_locked: field(record, 'is_rotational_period_tidally_locked') || undefined,
  };
}

// ——— Field lists ———

/** A kind's searchable fields, grouped by how a filter on each is written. */
export function describeFields(fields: readonly SearchableField[]) {
  const by = (types: string[]) =>
    fields
      .filter((known) => types.includes(known.type))
      .map((known) => known.field)
      .toSorted();
  return {
    values: by(['group', 'keyword']),
    text: by(['string']),
    min_max: by(['numeric', 'timestamp']),
    is: by(['boolean']),
    name_with_min_max: by(['value_struct']),
    parts: fields
      .filter((known) => known.type === 'combined' || known.type === 'special')
      .filter((known) => known.field !== 'market')
      .map((known) => {
        const parts = known.subfields ? Object.keys(known.subfields) : RING_PARTS;
        return `${known.field} (${parts.join(', ')})`;
      })
      .toSorted(),
  };
}

const RING_PARTS = ['type', 'inner_radius', 'outer_radius'];

export function howToFilter(known: SearchableField): string {
  switch (known.type) {
    case 'group':
    case 'keyword':
      return 'values';
    case 'string':
      return 'text';
    case 'numeric':
    case 'timestamp':
      return known.field === 'distance' ? 'min/max in ly' : 'min/max';
    case 'boolean':
      return 'is';
    case 'value_struct':
      return 'name, with min/max';
    default:
      return 'parts';
  }
}

/** A field's values, as a list (or a list per part), cut to what fits. */
export function listValues(body: unknown, search: string | undefined): unknown {
  const keep = (names: string[]) => {
    const found = search
      ? names.filter((name) => name.toLowerCase().includes(search.toLowerCase()))
      : names;
    return found.length > MAX_VALUES
      ? [
          ...found.slice(0, MAX_VALUES),
          `…and ${found.length - MAX_VALUES} more; narrow with search`,
        ]
      : found;
  };
  const values = field(body, 'values');
  if (Array.isArray(values)) return keep(values.map(String));
  if (values && typeof values === 'object') {
    return Object.fromEntries(
      Object.entries(values).map(([part, list]) => [
        part,
        Array.isArray(list) ? keep(list.map(String)) : list,
      ]),
    );
  }
  const minMax = field(body, 'min_max');
  return minMax && typeof minMax === 'object' ? keep(Object.keys(minMax)) : [];
}

function marketRow(row: unknown) {
  return {
    commodity: field(row, 'commodity'),
    buy_cr: field(row, 'buy_price') || undefined,
    supply: field(row, 'supply') || undefined,
    sell_cr: field(row, 'sell_price') || undefined,
    demand: field(row, 'demand') || undefined,
  };
}

function moduleRow(module: unknown) {
  return {
    module: `${text(field(module, 'class'))}${text(field(module, 'rating'))} ${text(field(module, 'name'))}`,
    ship: field(module, 'ship'),
    mount: field(module, 'weapon_mode'),
    price_cr: field(module, 'price'),
  };
}

export function largestPad(record: unknown): string | undefined {
  if (field(record, 'has_large_pad') === true || Number(field(record, 'large_pads')) > 0)
    return 'L';
  if (Number(field(record, 'medium_pads')) > 0) return 'M';
  if (Number(field(record, 'small_pads')) > 0) return 'S';
  return undefined;
}

function bodyWorth(body: unknown): number {
  return (
    Number(field(body, 'landmark_value') ?? 0) + Number(field(body, 'estimated_mapping_value') ?? 0)
  );
}

function shares(value: unknown): Record<string, number> | undefined {
  const list = asArray(value);
  if (!list.length) return undefined;
  return Object.fromEntries(
    list.map((entry) => [String(field(entry, 'name')), round(Number(field(entry, 'share')))]),
  );
}

/** Whole days since a Spansh timestamp ("2026-06-13 13:23:24+00"). */
export function daysAgo(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== 'string') return undefined;
  const at = Date.parse(value.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  return Number.isNaN(at) ? undefined : Math.max(0, Math.floor((now - at) / DAY_MS));
}

function lightYears(a: Coords, b: Coords): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function includesName(names: readonly string[], value: unknown): boolean {
  return names.some((name) => sameName(value, name));
}

export function sameName(value: unknown, name: string): boolean {
  return typeof value === 'string' && value.toLowerCase() === name.trim().toLowerCase();
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'
    ? String(value)
    : '';
}

function whole(value: unknown): number | undefined {
  return typeof value === 'number' ? Math.round(value) : undefined;
}

function numberOr(value: unknown, digits: number): number | undefined {
  return typeof value === 'number' ? round(value, digits) : undefined;
}

function sum(list: readonly unknown[], pick: (item: unknown) => unknown): number {
  return list.reduce<number>((total, item) => total + (Number(pick(item)) || 0), 0);
}
