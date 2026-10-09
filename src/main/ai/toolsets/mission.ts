/**
 * The Mission tab: life on the bodies of this system, which are worth a probe run, and the samples
 * since the last sale.
 */

import { z } from 'zod';

import type { ExobiologyEntry } from '../../../shared/history';
import {
  bioBodies,
  exobiologyStops,
  jumpsSinceLastStop,
  probeTargets,
} from '../../../shared/mission';
import { stamp } from '../../activity/periods';
import { GENERA } from '../../history/biology/species.generated';
import { organicValue } from '../../history/values';
import { defineTool, type Toolset } from '../tools/define';
import { credits, round } from './format';

function range(min: number | undefined, max: number | undefined) {
  if (min === undefined) return undefined;
  if (min === max) return Math.round(min);
  return { min: Math.round(min), max: Math.round(max ?? min) };
}

/** The bonus Vista Genomics pays for a species nobody had logged on that body before. */
const FIRST_FOOTFALL = 5;

/** Every value any of the rules allows, or undefined when a rule doesn't care. */
function union(lists: readonly (readonly string[] | undefined)[]): string[] | undefined {
  const values = new Set<string>();
  for (const list of lists) {
    if (list === undefined) return undefined;
    for (const value of list) values.add(value);
  }
  return values.size > 0 ? [...values] : undefined;
}

function totalValue(entries: readonly ExobiologyEntry[]): number {
  return Math.round(entries.reduce((total, entry) => total + (entry.value ?? 0), 0));
}

export const missionToolset: Toolset = {
  name: 'the mission tab',
  instructions: `The Mission tab is what the commander looks at most: the route (here, next, final), the life on this system's bodies, and the organic samples since they last sold to Vista Genomics. get_biology_here answers "what's worth sampling here?", "how much is left on this moon?" or "is that one new?": for each body its species and how far sampling has got, or for a genus not sampled yet the range its species pay, and whether the commander has ever logged it. It also predicts, from the community's spawn rules and the body's scan: before the body is mapped, which genera its signals could be and what they'd pay at least and at most; after, which species (and colour) each named genus is likely to be. Use that to say whether a far-off body is worth the trip, e.g. when everything it could hold is cheap. Predictions can be wrong: say "could be", never "is". get_probe_targets answers "anything worth mapping here?" before the commander leaves: the few bodies whose surface scan pays a lot (terraformables, water worlds, ammonia worlds, Earth-likes; one to four million each, more than most biology for a minute's probing), in the order to visit them. Unmapped bodies with life are in get_biology_here. get_exobiology_log is the trip: every species analysed since the last sale, stop by stop with the jumps between, what it's all worth and how much of it is new. get_species_values is the price list for the whole galaxy ("what's the dearest bacterium?"): use it rather than searching the web for organic values. Values are EDSSI's estimates; first footfall pays five times. Along the bottom of the tab is a strip with what today (by default), this session, or the trip since the last data sale has made and per hour, time played, jumps and distance, and where the money came from; get_activity_summary with period "today", "this_session" or "since_last_sale" returns the same numbers under "income".`,

  brief({ game }) {
    const { exobiology, ready } = game.history();
    if (!ready) return undefined;
    const pending = exobiology.entries.filter((entry) => entry.status === 'pending');
    if (pending.length === 0) return undefined;
    const value = pending.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
    return `Organics since the last sale: ${pending.length} species, ${credits(value)}`;
  },

  tools: [
    defineTool({
      name: 'get_biology_here',
      description:
        'Bodies in the current system with biological signals, nearest first: each species being ' +
        'or already sampled with its progress and value, genuses not yet sampled with the price ' +
        'range of their species, whether each is new to the commander, and the total still to ' +
        'collect. Signals not yet named come with the genera they could be and a predicted value ' +
        'range; named genera with the species they could be.',
      parameters: z.object({}),
      run(_args, { game }) {
        const overview = game.overview();
        const survey = game.history().survey;
        if (!survey || String(survey.systemAddress) !== String(overview.systemAddress)) {
          return 'Nothing has been scanned in this system yet.';
        }
        const bodies = bioBodies(survey);
        if (bodies.length === 0) {
          return survey.bodyCount === undefined
            ? 'No biological signals found yet; the system has not been honked.'
            : 'No biological signals in this system.';
        }
        const sumOf = (pick: (bio: (typeof bodies)[number]) => number) =>
          Math.round(bodies.reduce((total, bio) => total + pick(bio), 0));
        return {
          system: survey.systemName,
          bodies_with_life: bodies.length,
          signals: bodies.reduce((total, bio) => total + bio.body.bioSignals, 0),
          collected_cr: sumOf((bio) => bio.collected),
          still_to_collect_cr: {
            min: sumOf((bio) => bio.potentialMin),
            max: sumOf((bio) => bio.potentialMax),
          },
          bodies: bodies.map((bio) => ({
            body: bio.body.name,
            distance_ls:
              bio.body.distanceLs === undefined ? undefined : Math.round(bio.body.distanceLs),
            signals: bio.body.bioSignals,
            first_footfall: bio.body.firstFootfall || undefined,
            unnamed_signals:
              bio.unnamed > 0
                ? bio.body.genuses.length === 0
                  ? `${bio.unnamed}; map the body to name them`
                  : bio.unnamed
                : undefined,
            collected_cr: Math.round(bio.collected) || undefined,
            to_collect_cr:
              bio.potentialMax > 0
                ? { min: Math.round(bio.potentialMin), max: Math.round(bio.potentialMax) }
                : undefined,
            life: bio.lines.map((line) => ({
              name: line.name,
              variant: line.variant,
              progress:
                line.status === 'unsampled'
                  ? 'not sampled'
                  : line.status === 'predicted'
                    ? 'not named yet; value predicted'
                    : line.progress,
              value_cr: range(line.minValue, line.maxValue),
              new_to_commander: line.isNew && line.status !== 'sold' ? true : undefined,
              could_be:
                line.candidates && (line.status === 'predicted' || line.candidates.length > 1)
                  ? line.candidates.map((candidate) => ({
                      name: candidate.name,
                      value_cr: range(candidate.minValue, candidate.maxValue),
                      colours: candidate.colours.length > 0 ? candidate.colours : undefined,
                      new_to_commander: candidate.isNew || undefined,
                    }))
                  : undefined,
            })),
          })),
        };
      },
    }),

    defineTool({
      name: 'get_probe_targets',
      description:
        'Bodies in the current system worth mapping with the surface scanner that the commander ' +
        'has not mapped: first those that pay for it (terraformable, water, ammonia and ' +
        "Earth-like worlds worth at least the commander's threshold once mapped), with what the " +
        'probe run adds, best earnings per light second of detour first.',
      parameters: z.object({}),
      run(_args, { game }) {
        const overview = game.overview();
        const survey = game.history().survey;
        if (!survey || String(survey.systemAddress) !== String(overview.systemAddress)) {
          return 'Nothing has been scanned in this system yet.';
        }
        const minValue = game.settings().mission.min_probe_value;
        const targets = probeTargets(survey, minValue);
        if (targets.length === 0) {
          return survey.bodyCount === undefined
            ? 'Nothing worth mapping found yet; the system has not been honked.'
            : `Nothing in this system is worth mapping (the commander's threshold is ${credits(minValue)} once mapped).`;
        }
        return {
          system: survey.systemName,
          all_bodies_found: survey.allFound,
          only_bodies_worth_at_least_cr: minValue,
          probe_run_earns_cr: Math.round(
            targets.reduce((sum, target) => sum + (target.earns ?? 0), 0),
          ),
          bodies: targets.map((target) => ({
            body: target.body.name,
            type: target.body.type,
            terraformable: target.body.terraformable || undefined,
            distance_ls:
              target.body.distanceLs === undefined ? undefined : Math.round(target.body.distanceLs),
            mapping_earns_cr: target.earns === undefined ? undefined : Math.round(target.earns),
            value_now_cr: Math.round(target.body.value),
            value_mapped_cr: Math.round(target.worth),
            bio_signals: target.body.bioSignals || undefined,
          })),
        };
      },
    }),

    defineTool({
      name: 'get_species_values',
      description:
        'What every exobiology species in the galaxy pays Vista Genomics, dearest first, from ' +
        "EDSSI's own price list: the base value and with first footfall, plus what the species " +
        'needs to grow (body types, atmospheres, regions). For "what\'s the most valuable ' +
        'bacterium?" or "which organics are worth hunting?" anywhere, not just here.',
      parameters: z.object({
        genus: z
          .string()
          .optional()
          .describe('Only this genus, e.g. "Bacterium", "Stratum", "Fonticulua".'),
        limit: z.number().int().min(1).max(150).default(10).describe('How many to list.'),
      }),
      run({ genus, limit }) {
        const wanted = genus?.trim().toLowerCase();
        const genera = GENERA.filter((rules) => !wanted || rules.name.toLowerCase() === wanted);
        if (genera.length === 0) {
          const names = [...new Set(GENERA.map((rules) => rules.name))];
          return `No genus called "${genus}". Genera: ${names.join(', ')}.`;
        }
        const seen = new Set<string>();
        const species = genera
          .flatMap((rules) => rules.species.map((entry) => ({ genus: rules.name, entry })))
          .filter(({ entry }) => {
            // The spawn data can list a species under two entries of its genus (Stratum does).
            if (seen.has(entry.code)) return false;
            seen.add(entry.code);
            return true;
          })
          .map(({ genus: name, entry }) => ({
            name: entry.name,
            genus: name,
            value: organicValue(entry.code) ?? entry.value,
            rules: entry.rules,
          }))
          .toSorted((a, b) => b.value - a.value);
        return {
          species_count: species.length,
          species: species.slice(0, limit).map((entry) => ({
            name: entry.name,
            genus: entry.genus,
            value_cr: entry.value,
            first_footfall_cr: entry.value * FIRST_FOOTFALL,
            body_types: union(entry.rules.map((rule) => rule.bodyType)),
            atmospheres: union(entry.rules.map((rule) => rule.atmosphere)),
            regions: union(entry.rules.map((rule) => rule.regions)),
          })),
        };
      },
    }),

    defineTool({
      name: 'get_exobiology_log',
      description:
        'Organic samples analysed since the last sale to Vista Genomics, stop by stop with the ' +
        'jumps between stops: species, bodies, values, which are new, what was lost, and the ' +
        'totals for the trip and for this game session.',
      parameters: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(10)
          .describe('How many of the latest stops to list.'),
      }),
      run({ limit }, { game }) {
        const { exobiology, ready } = game.history();
        if (!ready) return 'EDSSI is still reading the older journals.';
        const { lastSale, entries, jumps } = exobiology;
        const pending = entries.filter((entry) => entry.status === 'pending');
        const stops = exobiologyStops(entries);
        return {
          last_sale: lastSale && {
            when: stamp(Date.parse(lastSale.timestamp)),
            value_cr: Math.round(lastSale.value),
            species: lastSale.species,
          },
          unsold_species: pending.length,
          unsold_value_cr: totalValue(pending),
          new_species: pending.filter((entry) => entry.newSpecies).length,
          this_session: {
            species: pending.filter((entry) => entry.thisSession).length,
            value_cr: totalValue(pending.filter((entry) => entry.thisSession)),
          },
          lost_with_the_ship:
            entries.filter((entry) => entry.status === 'lost').length || undefined,
          stops: stops.length,
          jumps_since_last_stop: jumpsSinceLastStop(entries, jumps),
          latest_stops: stops
            .slice(-limit)
            .toReversed()
            .map((stop) => ({
              system: stop.systemName,
              jumps_from_previous_stop: stop.jumpsBefore,
              value_cr: totalValue(stop.entries.filter((entry) => entry.status === 'pending')),
              species: stop.entries.map((entry) => ({
                name: entry.name,
                body: entry.bodyName,
                when: stamp(Date.parse(entry.timestamp)),
                value_cr: entry.value === undefined ? undefined : round(entry.value, 0),
                new: entry.newSpecies || undefined,
                lost: entry.status === 'lost' || undefined,
              })),
            })),
        };
      },
    }),
  ],
};
