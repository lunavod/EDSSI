/** What other commanders know: EDSM's crowd-sourced view of a system. */

import { z } from 'zod';

import { defineTool, type Toolset } from '../tools/define';
import { round } from './format';

export const galaxyToolset: Toolset = {
  name: 'the wider galaxy',
  instructions: `lookup_system asks EDSM, a database other commanders upload to, about any system by name — how busy it is, how many ships have been lost there lately, its primary star, and the nearest starport. It is the only way to know anything about a system the commander hasn't visited. It is crowd-sourced, so it can be out of date or simply not have the system; say so rather than filling the gap yourself.`,

  tools: [
    defineTool({
      name: 'lookup_system',
      description:
        'What EDSM knows about a system: traffic in the last day and week, ships lost there, ' +
        'the primary star and whether it can be scooped, and the closest starport.',
      parameters: z.object({
        name: z.string().min(1).describe('The system name, spelled as the game spells it.'),
      }),
      async run({ name }, { game }) {
        const info = await game.system(name);
        if (info.status === 'unknown') return `EDSM has never heard of a system called ${name}.`;
        if (info.status === 'unavailable') return 'EDSM could not be reached just now.';
        return {
          system: info.name,
          traffic_last_day: info.traffic?.day,
          traffic_last_week: info.traffic?.week,
          ships_lost_last_day: info.deaths?.day,
          primary_star: info.primaryStar?.type,
          scoopable: info.primaryStar?.scoopable,
          closest_starport: info.closestStarport && {
            name: info.closestStarport.name,
            type: info.closestStarport.type,
            distance_ls: round(info.closestStarport.distanceLs),
          },
        };
      },
    }),
  ],
};
