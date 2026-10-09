/** What the commander is owed, and what they have found in the system they're in. */

import { z } from 'zod';

import { defineTool, type Toolset } from '../tools/define';
import { credits, round } from './format';

export const explorationToolset: Toolset = {
  name: 'exploration and the ledger',
  instructions: `The ledger is money that hasn't been collected or paid yet: unsold scan data (Universal Cartographics), unsold organic samples (Vista Genomics), uncashed bounty and combat bond vouchers, and outstanding fines. The values are EDSSI's own estimates, so say "about". get_system_survey lists the bodies in the current system that the commander has scanned, what each is worth and whether it has been mapped or has life on it — that's what answers "is anything here worth mapping?".`,

  brief({ game }) {
    const { ledger, ready } = game.history();
    if (!ready) return 'Ledger: EDSSI is still reading past journals.';

    const owed: string[] = [];
    if (ledger.cartographics.value > 0) {
      owed.push(`${credits(ledger.cartographics.value)} of scan data`);
    }
    if (ledger.exobiology.value > 0) owed.push(`${credits(ledger.exobiology.value)} of organics`);
    if (ledger.bounties > 0) owed.push(`${credits(ledger.bounties)} in bounty vouchers`);
    if (ledger.combatBonds > 0) owed.push(`${credits(ledger.combatBonds)} in combat bonds`);
    if (ledger.fines > 0) owed.push(`${credits(ledger.fines)} of fines owed`);
    return owed.length ? `Uncollected: ${owed.join(', ')}` : undefined;
  },

  tools: [
    defineTool({
      name: 'get_ledger',
      description:
        'Everything the commander has earned but not collected — scan data, organic samples, ' +
        'bounty and combat bond vouchers — and any fines they owe.',
      parameters: z.object({}),
      run(_args, { game }) {
        const { ledger, ready } = game.history();
        return {
          still_reading_journals: ready ? undefined : true,
          cartographics: {
            value_cr: Math.round(ledger.cartographics.value),
            earned_this_session_cr: Math.round(ledger.cartographics.sessionValue),
            bodies: ledger.cartographics.bodies,
            systems: ledger.cartographics.systems,
          },
          exobiology: {
            value_cr: Math.round(ledger.exobiology.value),
            earned_this_session_cr: Math.round(ledger.exobiology.sessionValue),
            species: ledger.exobiology.species,
          },
          bounty_vouchers_cr: ledger.bounties,
          combat_bonds_cr: ledger.combatBonds,
          fines_cr: ledger.fines,
          note: 'Values are estimates from the journal, not what a station will actually pay.',
        };
      },
    }),

    defineTool({
      name: 'get_system_survey',
      description:
        'The bodies the commander has found in the system they are in: type, distance, what ' +
        'the scan data is worth, whether it has been mapped, and any biological signals.',
      parameters: z.object({
        limit: z.number().int().min(1).max(50).default(20),
        min_value_cr: z
          .number()
          .min(0)
          .optional()
          .describe('Leave out bodies worth less than this.'),
        unmapped_only: z
          .boolean()
          .default(false)
          .describe('Only bodies that have not been mapped with the surface scanner.'),
      }),
      run({ limit, min_value_cr, unmapped_only }, { game }) {
        const survey = game.history().survey;
        if (!survey) return 'Nothing has been scanned in this system yet.';

        const matching = survey.bodies
          .filter((body) => min_value_cr === undefined || body.value >= min_value_cr)
          .filter((body) => !unmapped_only || !body.mapped);

        return {
          system: survey.systemName,
          bodies_in_system: survey.bodyCount,
          all_found: survey.allFound,
          scanned: survey.bodies.length,
          shown: Math.min(matching.length, limit),
          bodies: matching
            .toSorted((a, b) => b.value - a.value)
            .slice(0, limit)
            .map((body) => ({
              name: body.name,
              kind: body.kind,
              type: body.type,
              distance_ls: body.distanceLs === undefined ? undefined : round(body.distanceLs),
              value_cr: Math.round(body.value),
              landable: body.landable || undefined,
              terraformable: body.terraformable || undefined,
              first_discovery: body.firstDiscovery || undefined,
              mapped: body.mapped,
              mapped_efficiently: body.mappedEfficiently || undefined,
              first_footfall: body.firstFootfall || undefined,
              already_sold: body.status === 'sold' || undefined,
              bio_signals: body.bioSignals || undefined,
              other_signals: body.signals.filter((signal) => !/biolog/i.test(signal.type)).length
                ? body.signals
                    .filter((signal) => !/biolog/i.test(signal.type))
                    .map((signal) => `${signal.count} ${signal.type}`)
                : undefined,
              genuses: body.genuses.length ? body.genuses.map((genus) => genus.name) : undefined,
              organics: body.organics.length
                ? body.organics.map((organic) => ({
                    species: organic.name,
                    samples: organic.samples,
                    value_cr: organic.value,
                    status: organic.status,
                  }))
                : undefined,
            })),
        };
      },
    }),
  ],
};
