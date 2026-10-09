/** The game's own log of this session: what happened, and when. */

import { z } from 'zod';

import type { JournalEvent } from '../../../shared/journal';
import { defineTool, type Toolset } from '../tools/define';

/** A single event's fields are trimmed to this before it goes to the model. */
const MAX_FIELD_CHARS = 400;

export const journalToolset: Toolset = {
  name: 'the journal',
  instructions: `The journal is the game's own log of the current session, newest first: jumps, scans, docking, missions, combat, trades, everything. Use get_recent_events to see what just happened ("what did I just scan?", "did that go through?") and search_journal to find something by name — a system, a station, a commodity, a mission giver. Only this session is in the log. For anything earlier, or for totals over a stretch of time, use the journey tools instead of reading events one by one.`,

  tools: [
    defineTool({
      name: 'get_recent_events',
      description:
        'The latest events from this session, newest first. Narrow it with event names when ' +
        'you know what you are after, e.g. FSDJump, Scan, Docked, MissionAccepted, Bounty.',
      parameters: z.object({
        limit: z.number().int().min(1).max(50).default(15).describe('How many events to return.'),
        events: z
          .array(z.string())
          .optional()
          .describe('Journal event names to keep, exactly as the game writes them.'),
      }),
      run({ limit, events }, { game }) {
        const wanted = events && new Set(events.map((name) => name.toLowerCase()));
        const matching = game
          .session()
          .events.filter((event) => !wanted || wanted.has(event.event.toLowerCase()));
        return summarise(matching, limit);
      },
    }),

    defineTool({
      name: 'search_journal',
      description:
        'Finds events from this session mentioning a word — a system, station, commodity, ' +
        'ship or commander name. Newest first.',
      parameters: z.object({
        query: z.string().min(1).describe('Text to look for; case is ignored.'),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      run({ query, limit }, { game }) {
        const needle = query.toLowerCase();
        const matching = game
          .session()
          .events.filter((event) => text(event).toLowerCase().includes(needle));
        return matching.length === 0
          ? `Nothing in this session's journal mentions "${query}".`
          : summarise(matching, limit);
      },
    }),
  ],
};

function summarise(events: readonly JournalEvent[], limit: number): unknown {
  return {
    matched: events.length,
    events: events.slice(-limit).toReversed().map(compact),
  };
}

/**
 * Events like Loadout carry hundreds of lines nobody asked for. Long fields are replaced by a note
 * so the shape of the event still shows, and a dedicated tool can be used for the detail.
 */
function compact(event: JournalEvent): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    const rendered = text(value);
    compacted[key] = rendered.length > MAX_FIELD_CHARS ? '[too long to show here]' : value;
  }
  return compacted;
}

function text(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'bigint' ? item.toString() : item,
    ) ?? ''
  );
}
