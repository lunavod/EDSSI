/**
 * The Route tab's Spansh page, without Electron: one plot at a time through Spansh's galaxy,
 * neutron or fleet carrier plotter, the ship worked out from the journal, and the finished route
 * kept to look over until the commander follows it (as the CSV route) or saves it.
 */

import type { CsvRoute } from '../../shared/csv-route';
import { type ShipBuild, shipBuild, superchargeMultiplier } from '../../shared/fsd';
import type { LoadoutEvent } from '../../shared/journal';
import { jumpRange } from '../../shared/jump-fuel';
import {
  type SpanshPlotRequest,
  type SpanshPlotState,
  spanshPlotTitle,
  type SpanshShipChoice,
  spanshToCsvRoute,
} from '../../shared/spansh-plot';
import type { OwnedShip } from '../ships-service';
import { type SpanshClient, SpanshError } from './client';

/** How long a job is waited on before giving up on it. Spansh stops a galaxy plot at a minute. */
const JOB_WAIT_MS = 10 * 60_000;

/** Carriers' tritium sums use the carrier's own mass and hold, as Spansh's form sets them. */
const CARRIERS = {
  fleet: { mass: 25_000, capacity: 25_000 },
  squadron: { mass: 15_000, capacity: 60_000 },
};

export type CurrentShip = { loadout: LoadoutEvent; cargo: number } | undefined;

export interface SpanshPlotterOptions {
  client: SpanshClient;
  /** The commander's current system: its name and address. */
  here(): { name?: string; address?: number | bigint };
  ship(): CurrentShip;
  ships(): OwnedShip[];
  onChange(state: SpanshPlotState): void;
  follow(route: CsvRoute): void;
  save(name: string, route: CsvRoute): { id: number } | { problem: string };
  now?: () => Date;
}

export class SpanshPlotter {
  readonly #options: SpanshPlotterOptions;
  #state: SpanshPlotState = {};
  #abort: AbortController | undefined;

  constructor(options: SpanshPlotterOptions) {
    this.#options = options;
  }

  state(): SpanshPlotState {
    return this.#state;
  }

  /** Every ship the commander owns, the one being flown first, with its range. */
  ships(): SpanshShipChoice[] {
    return shipChoices(this.#options.ship(), this.#options.ships());
  }

  /** Plots a route, kept as the `result`. Resolves with why it failed, if it did. */
  async plot(request: SpanshPlotRequest): Promise<string | undefined> {
    if (this.#state.running) return 'A route is being plotted already.';
    const abort = new AbortController();
    this.#abort = abort;
    const startedAt = this.#now();
    // The last route stays on show while another is plotted, and if that one fails.
    this.#set({ ...this.#state, running: { request, startedAt: startedAt.toISOString() } });
    let error: string | undefined;
    try {
      const results: unknown[] = [];
      const jobs: string[] = [];
      const starts = await this.#jobs(request, abort.signal);
      for (const [index, start] of starts.entries()) {
        const job = await start();
        jobs.push(job);
        const leg = starts.length > 1 ? { at: index + 1, of: starts.length } : undefined;
        this.#set({
          ...this.#state,
          running: { ...this.#state.running!, job, ...(leg && { leg }) },
        });
        const state = await this.#options.client.waitForRoute(job, JOB_WAIT_MS, abort.signal);
        if (!state.done) throw new SpanshError('Spansh is still plotting it; try again later.');
        results.push(state.route.result);
      }
      const finished = this.#now();
      const here = this.#options.here().name;
      const { route, summary } = spanshToCsvRoute(
        request.kind,
        results,
        spanshPlotTitle(request, here),
        finished.toISOString(),
      );
      this.#state = {
        ...this.#state,
        result: {
          request,
          summary: { ...summary, seconds: (finished.getTime() - startedAt.getTime()) / 1000 },
          route,
          jobs,
        },
      };
    } catch (caught) {
      error = abort.signal.aborted
        ? 'cancelled'
        : caught instanceof SpanshError || caught instanceof PlotProblem
          ? caught.message
          : `Spansh couldn't be asked: ${caught instanceof Error ? caught.message : String(caught)}`;
    } finally {
      this.#abort = undefined;
    }
    const { running: _, ...rest } = this.#state;
    this.#set({
      ...rest,
      last: { request, finishedAt: this.#now().toISOString(), ...(error && { error }) },
    });
    return error;
  }

  cancel(): void {
    this.#abort?.abort();
  }

  /** Makes the last route plotted the CSV route followed; false if there is none. */
  follow(): boolean {
    const result = this.#state.result;
    if (!result) return false;
    const loadedAt = this.#now().toISOString();
    this.#options.follow({ ...result.route, loadedAt });
    this.#set({ ...this.#state, result: { ...result, followedAt: loadedAt } });
    return true;
  }

  /** Saves the last route plotted under a name; resolves with why it couldn't, if it couldn't. */
  save(name: string): string | undefined {
    const result = this.#state.result;
    if (!result) return 'There is no route to save.';
    const saved = this.#options.save(name, result.route);
    if ('problem' in saved) return saved.problem;
    this.#set({
      ...this.#state,
      result: { ...result, route: { ...result.route, savedId: saved.id } },
    });
    return undefined;
  }

  /** What to queue, one call per job (a galaxy route with stops is a job per leg). */
  async #jobs(request: SpanshPlotRequest, signal: AbortSignal): Promise<(() => Promise<string>)[]> {
    const { client } = this.#options;
    const here = this.#options.here();
    const places = [request.from, ...(request.via ?? []), request.to];

    if (request.kind === 'neutron') {
      const ship = this.#ship(request.shipId);
      const build = typeof ship.build === 'string' ? undefined : ship.build;
      const range = request.range ?? (build && jumpRange(build, build.tank_size, ship.cargo));
      if (!range) throw new PlotProblem(`What is the jump range? ${ship.problem ?? ''}`.trim());
      const from = request.from.trim() || here.name;
      if (!from) throw new PlotProblem('Where does it start? The current system is not known.');
      return [
        () =>
          client.plot(
            '/route',
            {
              from,
              to: request.to.trim(),
              range: Math.round(range * 100) / 100,
              via: request.via?.map((stop) => stop.trim()),
              efficiency: request.efficiency,
              supercharge_multiplier: superchargeMultiplier(ship.loadout),
            },
            { signal },
          ),
      ];
    }

    const ids: string[] = [];
    for (const place of places) ids.push(await this.#systemId(place, here.address, signal));

    if (request.kind === 'carrier') {
      const [source, ...destinations] = ids;
      const { tritium } = request;
      return [
        () =>
          client.plot(
            '/fleetcarrier/route',
            {
              source,
              destinations,
              ...CARRIERS[request.carrier],
              capacity_used: request.used,
              calculate_starting_fuel: !tritium,
              ...(tritium && { fuel_loaded: tritium.tank, tritium_stored: tritium.market }),
            },
            { signal },
          ),
      ];
    }

    const ship = this.#ship(request.shipId);
    if (typeof ship.build === 'string') throw new PlotProblem(ship.build);
    const build = ship.build;
    return ids.slice(1).map(
      (destination, index) => () =>
        client.plot(
          '/generic/route',
          {
            source: ids[index],
            destination,
            is_supercharged: false,
            use_supercharge: request.supercharge,
            use_injections: request.injections,
            use_injections_when_required: false,
            exclude_secondary: request.excludeSecondary,
            refuel_every_scoopable: request.refuelEveryScoopable,
            ...build,
            reserve_size: request.reserve,
            max_time: 60,
            cargo: request.cargo ?? ship.cargo,
            algorithm: request.algorithm,
          },
          { signal },
        ),
    );
  }

  /** The ship a plot flies: the one being flown, or another the commander owns, hold empty. */
  #ship(shipId: number | undefined): {
    loadout?: LoadoutEvent;
    cargo: number;
    build: ShipBuild | string;
    problem?: string;
  } {
    const current = this.#options.ship();
    const owned =
      shipId === undefined
        ? undefined
        : this.#options.ships().find((candidate) => candidate.shipId === shipId);
    if (shipId !== undefined && !owned) {
      const problem = "That ship isn't among the commander's.";
      return { cargo: 0, build: problem, problem };
    }
    const flying = !owned || owned.current;
    const loadout = flying ? (current?.loadout ?? owned?.loadout) : owned.loadout;
    if (!loadout) {
      const problem = "The journal hasn't shown the ship's loadout yet.";
      return { cargo: 0, build: problem, problem };
    }
    const build = shipBuild(loadout);
    return {
      loadout,
      cargo: flying ? (current?.cargo ?? 0) : 0,
      build,
      ...(typeof build === 'string' && { problem: build }),
    };
  }

  /** A system's id64 as digits: the current one's address for an empty name. */
  async #systemId(
    name: string,
    address: number | bigint | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    const trimmed = name.trim();
    if (trimmed === '') {
      if (address === undefined) throw new PlotProblem('The current system is not known yet.');
      return String(address);
    }
    const match = await this.#options.client.system(trimmed, signal);
    if (!match) throw new PlotProblem(`Spansh doesn't know a system called ${trimmed}.`);
    return match.id64;
  }

  #set(state: SpanshPlotState): void {
    this.#state = state;
    this.#options.onChange(state);
  }

  #now(): Date {
    return this.#options.now?.() ?? new Date();
  }
}

/** Why a plot can't be asked for, in words for the commander. */
class PlotProblem extends Error {}

/** Every ship the commander owns, for the Spansh page, with each one's range on a full tank. */
export function shipChoices(current: CurrentShip, owned: readonly OwnedShip[]): SpanshShipChoice[] {
  return owned.map((ship): SpanshShipChoice => {
    const loadout = ship.current ? (current?.loadout ?? ship.loadout) : ship.loadout;
    const cargo = ship.current ? (current?.cargo ?? 0) : 0;
    const name = ship.name?.trim();
    const choice: SpanshShipChoice = {
      id: ship.shipId,
      label: name ? `${name} (${ship.type})` : ship.type,
      current: ship.current,
      ...(ship.where !== undefined && { where: ship.where }),
    };
    if (!loadout) return { ...choice, problem: "The journal hasn't shown its loadout yet." };
    const build = shipBuild(loadout);
    if (typeof build === 'string') return { ...choice, problem: build };
    return {
      ...choice,
      range: jumpRange(build, build.tank_size, cargo),
      supercharge: build.supercharge_multiplier,
      cargo,
    };
  });
}
