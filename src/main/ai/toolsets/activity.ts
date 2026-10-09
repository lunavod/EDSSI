/** The commander's journey: what they did today, this trip, or ever, and where they have been. */

import { z } from 'zod';

import type { ActivityData } from '../../activity-service';
import {
  DAY_START_HOUR,
  type Period,
  PERIODS,
  resolvePeriod,
  stamp,
  type TimeRange,
} from '../../activity/periods';
import { rankLabel, rankName } from '../../activity/ranks';
import { MONEY_SOURCES, RECORD_KINDS, searchActivity } from '../../activity/search';
import {
  describeSegment,
  journey,
  minutesPlayed,
  recordsIn,
  summarise,
  visits,
} from '../../activity/summary';
import { fromSol } from '../../activity/tracker';
import { defineTool, type Toolset } from '../tools/define';
import { credits } from './format';

const STILL_READING = 'EDSSI is still reading the older journals; ask again in a moment.';

const periodParameters = {
  period: z
    .enum(PERIODS)
    .default('today')
    .describe(
      `Which stretch of time. "today" runs from ${DAY_START_HOUR}:00 local time, so late at night it ` +
        'still covers the evening before; "since_last_sale" is the current trip.',
    ),
  date: z
    .string()
    .optional()
    .describe(
      `One particular day instead, as YYYY-MM-DD; it runs from ${DAY_START_HOUR}:00 that morning to ` +
        `${DAY_START_HOUR}:00 the next.`,
    ),
  since: z
    .string()
    .optional()
    .describe(
      'Everything from one day up to now instead, as YYYY-MM-DD — use this for "since the ' +
        `10th", "since last Tuesday", "this month", "this year". It runs from ${DAY_START_HOUR}:00 ` +
        'that morning. Work the date out from the local time given above; do not pass it ' +
        'together with `date`.',
    ),
};

function rangeFor(
  activity: ActivityData,
  period: Period,
  date: string | undefined,
  since?: string,
): TimeRange | string {
  return resolvePeriod(
    period,
    new Date(),
    {
      sessionStarts: activity.sessionStarts,
      lastSale: activity.commander.lastDataSale,
    },
    date,
    since,
  );
}

export const activityToolset: Toolset = {
  name: "the commander's journey",
  instructions: `EDSSI keeps a record of everything the commander has done since their first journal: jumps, scans, landings, samples, sales, missions, fights and promotions. That is what you use when they want to talk about their journey — "how's the trip going?", "what did I do yesterday?", "how much have I made today?", "where have I been?", "have I been here before?", "what was the best thing we found?". Talk about it like a crewmate who was there: pick the one or two things that stand out rather than reading out every total.
- get_activity_summary adds a period up: time played, jumps and distance, discoveries, species, money in and out, missions, combat, promotions and notable finds. It is also the counter: for "how many jumps have I made since the 1st?" or "how far have I flown this month?", call it with "since" set to that date and read the travel totals.
- get_journey tells it as a story: the systems where something happened, and the stretches of jumps between them.
- find_visits answers "have I been to…" and "when did I last dock at…" for systems, stations and bodies.
- search_activity searches every record over any stretch of time, all time by default: "when did I last die?", "how many times have I been interdicted?", "how much have I ever made from exobiology?", "when did I last sell tritium?", "how many Earth-like worlds have I found?". It answers with a count, the first and last match, totals and the latest few, never every match. Prefer it to get_activity_summary for a question about one kind of thing, or a range no period names.
- get_career is the long view: ranks, the game's own lifetime statistics, and how far from home the commander is.
- get_missions lists the missions the commander has taken on and not yet finished.
Days: the commander's day starts at ${DAY_START_HOUR}:00 local time, not midnight. If they say "today" or "tonight" at two in the morning, they mean since ${DAY_START_HOUR}:00 the previous morning, and "yesterday" is the day before that; the tools already work it out, so pass the period by name rather than a calendar date. For a stretch no named period covers, pass "date" for one day or "since" for everything from a day up to now, both as YYYY-MM-DD and worked out from the local time in front of you. Times from the tools are local time.`,

  brief({ game }) {
    const activity = game.activity();
    if (!activity.ready) return undefined;
    const range = resolvePeriod('today', new Date(), { sessionStarts: activity.sessionStarts });
    if (typeof range === 'string') return undefined;
    const records = recordsIn(activity.commander.records, range);
    const played = minutesPlayed(activity.commander.spans, range);
    if (played === 0 && records.length === 0) return 'Today so far: nothing played yet.';

    const jumps = records.filter((record) => record.kind === 'jump');
    const distance = jumps.reduce((total, jump) => total + jump.distanceLy, 0);
    const earned = records.reduce(
      (total, record) => total + (record.kind === 'earn' ? record.amount : 0),
      0,
    );
    const parts = [`${Math.floor(played / 60)}h ${played % 60}m played`];
    if (jumps.length) parts.push(`${jumps.length} jumps (${Math.round(distance)} ly)`);
    if (earned > 0) parts.push(`${credits(earned)} earned`);
    return `Today so far: ${parts.join(', ')}`;
  },

  tools: [
    defineTool({
      name: 'get_activity_summary',
      description:
        'What the commander did over a period — today, yesterday, a session, the last week, the ' +
        'current trip, all time, one given day, or everything since a given date: time played, ' +
        'jumps and distance, bodies scanned and first ' +
        'discoveries, species analysed, money earned and spent by source, missions, combat, ' +
        'deaths, promotions and the most notable finds. "income" is what the period made and per ' +
        'hour played, by source, counting data and vouchers when found at their estimated value ' +
        'rather than when sold; "money" is the credits that actually changed hands.',
      parameters: z.object(periodParameters),
      run({ period, date, since }, { game }) {
        const activity = game.activity();
        if (!activity.ready) return STILL_READING;
        const range = rangeFor(activity, period, date, since);
        return typeof range === 'string' ? range : summarise(activity.commander, range);
      },
    }),

    defineTool({
      name: 'get_journey',
      description:
        'The route the commander actually flew over a period, oldest first: each system where ' +
        'they did something (docked, landed, mapped, sampled, sold, fought, died) with what they ' +
        'did there, and the legs of plain jumps in between folded into one line each.',
      parameters: z.object({
        ...periodParameters,
        limit: z
          .number()
          .int()
          .min(1)
          .max(40)
          .default(15)
          .describe('How many of the latest stops and legs to return.'),
      }),
      run({ period, date, since, limit }, { game }) {
        const activity = game.activity();
        if (!activity.ready) return STILL_READING;
        const range = rangeFor(activity, period, date, since);
        if (typeof range === 'string') return range;
        const segments = journey(activity.commander, range);
        if (segments.length === 0) return `The commander didn't go anywhere in ${range.label}.`;
        return {
          period: range.label,
          earlier_segments_not_shown: Math.max(0, segments.length - limit) || undefined,
          segments: segments.slice(-limit).map(describeSegment),
        };
      },
    }),

    defineTool({
      name: 'find_visits',
      description:
        'Whether and when the commander has been to a system, docked at a station or landed on a ' +
        'body, matched by part of its name: how often, first and last time, and what they did on ' +
        'the latest visits.',
      parameters: z.object({
        name: z
          .string()
          .min(2)
          .describe('Part of a system, station or body name; case is ignored.'),
      }),
      run({ name }, { game }) {
        const activity = game.activity();
        if (!activity.ready) return STILL_READING;
        const found = visits(activity.commander, name, Date.now());
        if (found.systems.length === 0 && found.places.length === 0) {
          return `There's no record of the commander visiting anywhere called "${name}".`;
        }
        return found;
      },
    }),

    defineTool({
      name: 'search_activity',
      description:
        "Searches all of the commander's activity records, over every journal unless a period is " +
        'given, by kind, system, body or station, species, commodity, money source, and free ' +
        'text. Returns how many matched, the first and the last, a count and credit total per ' +
        'kind (and distance for jumps), the systems with the most matches, and the latest few.',
      parameters: z.object({
        kinds: z
          .array(z.enum(RECORD_KINDS))
          .optional()
          .describe(
            'Which records: jump, dock, land, on_foot (stepped out), scan, map, organic ' +
              '(analysed species), codex, earn, spend, bounty, bond, mission, interdiction, ' +
              'crime, death, promotion, ship (bought or swapped), scoop (fuel), location ' +
              '(logged in or carrier-jumped). Leave out for all.',
          ),
        text: z
          .string()
          .optional()
          .describe(
            'Words that must all appear in the record\'s line, e.g. "first discovery", ' +
              '"terraformable", "Thargoid", "completed". Case is ignored. Body types are as ' +
              'the journal writes them: "Earthlike body", "Water world", "Ammonia world", ' +
              '"High metal content body", "Sudarsky class II gas giant".',
          ),
        system: z.string().optional().describe('Part of the system name.'),
        place: z.string().optional().describe('Part of a body or station name.'),
        species: z.string().optional().describe('Part of a species or genus name; organics only.'),
        commodity: z
          .string()
          .optional()
          .describe('Part of a commodity name; market sales and purchases only.'),
        source: z
          .enum(MONEY_SOURCES)
          .optional()
          .describe(
            'Where money came from or went; earn and spend only. "exobiology" and ' +
              '"exploration" are sales of data.',
          ),
        period: z
          .enum(PERIODS)
          .default('all_time')
          .describe('Which stretch of time, as for get_activity_summary; everything by default.'),
        date: periodParameters.date,
        since: periodParameters.since,
        until: z
          .string()
          .optional()
          .describe(
            'With "since", the last day to include, as YYYY-MM-DD, for a range that ends in ' +
              'the past.',
          ),
        examples: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(10)
          .describe('How many of the latest matches to list.'),
      }),
      run({ period, date, since, until, examples, ...query }, { game }) {
        const activity = game.activity();
        if (!activity.ready) return STILL_READING;
        const range = rangeFor(activity, period, date, since);
        if (typeof range === 'string') return range;
        if (until !== undefined) {
          const end = rangeFor(activity, 'today', until);
          if (typeof end === 'string') return end;
          if (end.to <= range.from) return `${until} comes before the start of ${range.label}.`;
          range.to = Math.min(range.to, end.to);
          range.label = `${range.label}, up to ${until}`;
        }
        return searchActivity(activity.commander.records, range, query, examples);
      },
    }),

    defineTool({
      name: 'get_career',
      description:
        "The commander's career: ranks with progress to the next, credits, current ship, how " +
        'far they are from Sol and the farthest they have been, how long they have played, and ' +
        "the game's own lifetime statistics for exploration, exobiology, combat, trade and mining.",
      parameters: z.object({}),
      run(_args, { game }) {
        const activity = game.activity();
        const commander = activity.commander;
        const stats = commander.statistics;
        const balance = game.session().companions.Status?.Balance ?? commander.credits;
        return {
          still_reading_journals: activity.ready ? undefined : true,
          commander: commander.name,
          credits_cr: balance,
          ship: commander.ship,
          ship_name: commander.shipName?.trim() || undefined,
          game_mode: commander.gameMode,
          ranks:
            commander.ranks &&
            Object.fromEntries(
              Object.entries(commander.ranks).flatMap(([rank, level]) => {
                if (level === undefined) return [];
                const progress = commander.progress?.[rank];
                const name = rankName(rank, level);
                return [
                  [
                    rankLabel(rank),
                    progress === undefined ? name : `${name}, ${progress}% to the next`,
                  ],
                ];
              }),
            ),
          distance_from_sol_ly: commander.position && Math.round(fromSol(commander.position)),
          farthest_from_sol: commander.farthestFromSol && {
            ly: Math.round(commander.farthestFromSol.ly),
            system: commander.farthestFromSol.system,
            when: stamp(commander.farthestFromSol.at),
          },
          first_journal: commander.firstSeen === undefined ? undefined : stamp(commander.firstSeen),
          game_sessions: activity.sessionStarts.length,
          systems_visited_in_journals: commander.visited.size,
          game_statistics: stats && {
            as_of: stats.timestamp,
            hours_played: Math.round(stats.Exploration.Time_Played / 3600),
            current_wealth_cr: stats.Bank_Account.Current_Wealth,
            ships_owned: stats.Bank_Account.Owned_Ship_Count,
            insurance_claims: stats.Bank_Account.Insurance_Claims,
            exploration: {
              systems_visited: stats.Exploration.Systems_Visited,
              jumps: stats.Exploration.Total_Hyperspace_Jumps,
              distance_ly: Math.round(stats.Exploration.Total_Hyperspace_Distance),
              greatest_distance_from_start_ly: Math.round(
                stats.Exploration.Greatest_Distance_From_Start,
              ),
              profits_cr: stats.Exploration.Exploration_Profits,
              highest_payout_cr: stats.Exploration.Highest_Payout,
              planets_mapped: stats.Exploration.Planets_Scanned_To_Level_3,
              efficient_maps: stats.Exploration.Efficient_Scans,
              first_footfalls: stats.Exploration.First_Footfalls,
              planet_footfalls: stats.Exploration.Planet_Footfalls,
              fuel_scooped_t: stats.Exploration.Fuel_Scooped,
            },
            exobiology: stats.Exobiology && {
              profits_cr: stats.Exobiology.Organic_Data_Profits,
              species: stats.Exobiology.Organic_Species_Encountered,
              genuses: stats.Exobiology.Organic_Genus_Encountered,
              first_logged: stats.Exobiology.First_Logged,
              first_logged_profits_cr: stats.Exobiology.First_Logged_Profits,
            },
            combat: {
              bounties_claimed: stats.Combat.Bounties_Claimed,
              bounty_profits_cr: stats.Combat.Bounty_Hunting_Profit,
              combat_bonds: stats.Combat.Combat_Bonds,
              combat_bond_profits_cr: stats.Combat.Combat_Bond_Profits,
              thargoids_killed: stats.TG_ENCOUNTERS?.TG_ENCOUNTER_KILLED,
            },
            trade: {
              market_profits_cr: stats.Trading.Market_Profits,
              markets_traded_with: stats.Trading.Markets_Traded_With,
              mining_profits_cr: stats.Mining.Mining_Profits,
              mined_t: stats.Mining.Quantity_Mined,
            },
            engineers_used: stats.Crafting?.Count_Of_Used_Engineers,
          },
          note: 'The game writes its statistics at login, so they miss this session.',
        };
      },
    }),

    defineTool({
      name: 'get_missions',
      description:
        'The missions the commander has accepted and not yet completed, failed or abandoned: ' +
        'who gave them, where to go, the reward and how long is left.',
      parameters: z.object({}),
      run(_args, { game }) {
        const activity = game.activity();
        if (!activity.ready) return STILL_READING;
        const missions = [...activity.commander.missions.values()];
        if (missions.length === 0) return 'The commander has no missions on the board.';
        const now = Date.now();
        return {
          active: missions.length,
          total_reward_cr: missions.reduce((total, mission) => total + (mission.reward ?? 0), 0),
          missions: missions
            .toSorted((a, b) => (a.expires ?? Infinity) - (b.expires ?? Infinity))
            .map((mission) => ({
              name: mission.name,
              faction: mission.faction,
              destination_system: mission.destinationSystem,
              destination_station: mission.destinationStation,
              commodity: mission.commodity,
              count: mission.count,
              kills: mission.killCount,
              passengers: mission.passengers,
              reward_cr: mission.reward,
              wing: mission.wing || undefined,
              accepted: stamp(mission.acceptedAt),
              hours_left:
                mission.expires === undefined
                  ? undefined
                  : Math.max(0, Math.round(((mission.expires - now) / 3_600_000) * 10) / 10),
              expired: mission.expires !== undefined && mission.expires < now ? true : undefined,
            })),
        };
      },
    }),
  ],
};
