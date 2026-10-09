/** The commander's carriers: their own and their squadron's, where they are, fuel and cargo. */

import { z } from 'zod';

import type { CarrierView } from '../../../shared/carriers';
import { defineTool, type Toolset } from '../tools/define';
import { round } from './format';

export const carrierToolset: Toolset = {
  name: 'carriers',
  instructions: `The commander may own a fleet carrier and see their squadron's. get_carriers says where each is (and how far), the jump it has scheduled, its tritium and how many full-range jumps that lasts, its space, its balance and what it holds. The journal never lists a carrier's hold: EDSSI adds up what the commander moved in and out, and checks the total whenever they open the carrier's management screen. Say so when \`unaccounted_t\` isn't zero (others traded at its market, or it's a squadron carrier others stock). Fuel marked \`fuel_estimated\` is the last reading less what the jumps since burned, by the game's own formula; the numbers are exact at \`fuel_read_at\`. Upkeep is taken every Thursday at 07:00 UTC: the base fee, each service (less while suspended) and 100,000 CR a jump (twice that for a squadron carrier), from the wiki's table. \`weeks_covered\` is how many of those charges the balance pays with no more jumps and no tariff income, which the journal doesn't show.`,

  brief({ game }) {
    const own = game.carriers().carriers.find((carrier) => carrier.kind === 'own');
    if (!own?.system) return undefined;
    const parts = [`Carrier ${own.callsign ?? own.name ?? ''}`.trim() + ` at ${own.system}`];
    if (own.distanceLy !== undefined && own.distanceLy > 0) {
      parts.push(`${Math.round(own.distanceLy)} ly away`);
    }
    if (own.jump) parts.push(`jumping to ${own.jump.system}`);
    if (own.fuel) parts.push(`${own.fuel.level} t tritium`);
    return parts.join(', ');
  },

  tools: [
    defineTool({
      name: 'get_carriers',
      description:
        "The commander's fleet carrier and their squadron's: location, distance, scheduled jump, " +
        'tritium and jumps left, space, balance, weekly upkeep and how long the balance lasts, ' +
        'services and cargo by commodity.',
      parameters: z.object({}),
      run(_args, { game }) {
        const { carriers } = game.carriers();
        if (carriers.length === 0) return 'The journals show no carrier of the commander’s own.';
        return carriers.map(describe);
      },
    }),
  ],
};

function describe(carrier: CarrierView) {
  return {
    kind: carrier.kind,
    name: carrier.name,
    callsign: carrier.callsign,
    system: carrier.system,
    body: carrier.body,
    arrived_at: carrier.arrivedAt,
    distance_from_commander_ly:
      carrier.distanceLy === undefined ? undefined : round(carrier.distanceLy),
    scheduled_jump: carrier.jump && {
      system: carrier.jump.system,
      body: carrier.jump.body,
      departs: carrier.jump.departs,
      distance_ly:
        carrier.jump.distanceLy === undefined ? undefined : round(carrier.jump.distanceLy),
      fuel_t: carrier.jump.fuel,
    },
    fuel_t: carrier.fuel?.level,
    fuel_read_at: carrier.fuel?.readAt,
    fuel_estimated: carrier.fuel?.estimated || undefined,
    jumps_not_counted_in_fuel: carrier.fuel?.uncounted || undefined,
    jump_range_ly: carrier.rangeLy,
    full_jump_fuel_t: carrier.fullJumpFuel,
    full_jumps_left: carrier.jumpsLeft,
    space_t: carrier.space,
    balance_cr: carrier.finance?.balance,
    available_balance_cr: carrier.finance?.available,
    docking_access: carrier.dockingAccess,
    services: carrier.services.map((service) => ({
      name: service.name,
      state: service.state,
      weekly_cr: service.weekly,
    })),
    upkeep: carrier.upkeep && {
      weekly_cr: carrier.upkeep.weekly,
      per_jump_cr: carrier.upkeep.perJump,
      jumps_this_week: carrier.upkeep.jumpsThisWeek,
      next_charge_cr: carrier.upkeep.nextCharge,
      next_charge_at: carrier.upkeep.nextChargeAt,
      balance_now_cr: carrier.upkeep.balance,
      balance_estimated: carrier.upkeep.balanceEstimated || undefined,
      weeks_covered: carrier.upkeep.weeksCovered,
      in_debt_from: carrier.upkeep.debtAt,
      services_of_unknown_cost: carrier.upkeep.unknownServices.length
        ? carrier.upkeep.unknownServices
        : undefined,
    },
    cargo: carrier.cargo.map((item) => ({ name: item.name, count: item.count })),
    unaccounted_t: carrier.unaccounted,
    figures_exact_at: carrier.statsAt,
    decommission_at: carrier.decommissionAt,
  };
}
