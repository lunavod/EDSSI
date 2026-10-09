/** Where the commander is and what they're flying: the state the HUD's header and status show. */

import { z } from 'zod';

import type { CargoEvent, JournalEvent, LoadoutEvent } from '../../../shared/journal';
import { defineTool, type Toolset } from '../tools/define';
import { round } from './format';
import { describeFlags, guiFocus } from './status-flags';

export const shipToolset: Toolset = {
  name: 'the ship',
  instructions: `The game_state note already has the commander, the ship, the system and whether they're docked. Use get_ship_status for anything finer — fuel, cargo tonnage, balance, wanted status, what's deployed, where they are on a planet — and get_ship_loadout for the ship's own numbers, like jump range, cargo capacity and rebuy.`,

  brief({ game }) {
    const overview = game.overview();
    const status = game.session().companions.Status;
    const parts: string[] = [];

    if (overview.commander) parts.push(`CMDR ${overview.commander}`);
    const ship = overview.shipName ? `${overview.ship} "${overview.shipName}"` : overview.ship;
    if (ship) parts.push(ship);

    const lines = [parts.join(' · ')];
    const place = overview.station
      ? `${overview.system}, docked at ${overview.station}`
      : (status?.BodyName ?? overview.system);
    if (place) lines.push(`Location: ${place}`);
    if (overview.charging) lines.push(`Jumping to: ${overview.charging.system}`);

    const flags = describeFlags(status?.Flags, status?.Flags2);
    if (flags.length) lines.push(`Ship: ${flags.join(', ')}`);
    const fuel = status?.Fuel?.FuelMain;
    if (fuel !== undefined) lines.push(`Fuel: ${round(fuel)} t in the main tank`);

    return lines.filter(Boolean).join('\n');
  },

  tools: [
    defineTool({
      name: 'get_ship_status',
      description:
        "The ship's live state from the game: fuel, cargo carried, credits, wanted status, " +
        'everything that is deployed or charging, and the position on a planet if there is one.',
      parameters: z.object({}),
      run(_args, { game }) {
        const status = game.session().companions.Status;
        if (!status) return 'The game has not written a status yet.';
        return {
          flags: describeFlags(status.Flags, status.Flags2),
          fuel_main_t: status.Fuel?.FuelMain,
          fuel_reservoir_t: status.Fuel?.FuelReservoir,
          cargo_t: status.Cargo,
          balance_cr: status.Balance,
          legal_state: status.LegalState,
          body: status.BodyName,
          latitude: status.Latitude,
          longitude: status.Longitude,
          altitude_m: status.Altitude,
          heading: status.Heading,
          gravity_g: status.Gravity,
          // On foot only; both run 0 to 1.
          oxygen: status.Oxygen,
          health: status.Health,
          /** Half-pips to systems, engines and weapons. */
          pips: status.Pips,
          looking_at: guiFocus(status.GuiFocus),
          selected_target: status.Destination?.Name_Localised ?? status.Destination?.Name,
        };
      },
    }),

    defineTool({
      name: 'get_ship_loadout',
      description:
        "The current ship's own figures: jump range, cargo and fuel capacity, rebuy, hull " +
        'health, and which modules are engineered.',
      parameters: z.object({}),
      run(_args, { game }) {
        const loadout = lastEvent(game.session().events, 'Loadout');
        if (!loadout)
          return 'No loadout in this session yet; the commander has not boarded a ship.';
        return {
          ship: loadout.Ship,
          name: loadout.ShipName,
          ident: loadout.ShipIdent,
          max_jump_range_ly: loadout.MaxJumpRange,
          cargo_capacity_t: loadout.CargoCapacity,
          fuel_capacity_t: loadout.FuelCapacity.Main,
          hull_health: loadout.HullHealth,
          unladen_mass_t: loadout.UnladenMass,
          rebuy_cr: loadout.Rebuy,
          hull_value_cr: loadout.HullValue,
          modules_value_cr: loadout.ModulesValue,
          engineered: loadout.Modules.filter((module) => module.Engineering).map((module) => ({
            slot: module.Slot,
            module: module.Item,
            blueprint: module.Engineering?.BlueprintName,
            level: module.Engineering?.Level,
          })),
        };
      },
    }),

    defineTool({
      name: 'get_cargo',
      description: 'What is in the cargo hold right now, by commodity.',
      parameters: z.object({}),
      run(_args, { game }) {
        const cargo: CargoEvent | undefined = game.session().companions.Cargo;
        if (!cargo) return 'The game has not written a cargo manifest yet.';
        return {
          total_t: cargo.Count,
          items: (cargo.Inventory ?? []).map((item) => ({
            name: item.Name_Localised ?? item.Name,
            count: item.Count,
            stolen: item.Stolen || undefined,
            for_mission: item.MissionID !== undefined || undefined,
          })),
        };
      },
    }),
  ],
};

/** The newest event of a kind in the session, e.g. the loadout of the ship being flown now. */
function lastEvent(events: readonly JournalEvent[], name: 'Loadout'): LoadoutEvent | undefined {
  return events.findLast((event): event is LoadoutEvent => event.event === name);
}
