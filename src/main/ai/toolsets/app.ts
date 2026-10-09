/** Driving EDSSI's own window. */

import { z } from 'zod';

import { TAB_IDS } from '../../../shared/ui';
import {
  defaultViewOptions,
  VIEW_OPTION_IDS,
  VIEW_OPTIONS,
  type ViewOptionId,
  type ViewOptionsPatch,
} from '../../../shared/view-options';
import { defineTool, type Toolset } from '../tools/define';

/** One optional argument per view option, read from the list, so a new option needs no change here. */
const viewOptionsPatch = z
  .object(
    Object.fromEntries(
      VIEW_OPTION_IDS.map((id) => {
        const option = VIEW_OPTIONS[id];
        const value = option.kind === 'toggle' ? z.boolean() : z.enum(option.values);
        return [
          id,
          value.optional().describe(`${option.label}. Default ${String(option.default)}.`),
        ];
      }),
    ),
  )
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'Name at least one option to change.',
  });

/** "mission.bio_sort: value; …", or undefined when every one is at its default. */
function changedViewOptions(options: Record<ViewOptionId, unknown>): string | undefined {
  const defaults = defaultViewOptions();
  const changed = VIEW_OPTION_IDS.filter((id) => options[id] !== defaults[id]);
  return changed.length === 0
    ? undefined
    : changed.map((id) => `${id}: ${String(options[id])}`).join('; ');
}

export const appToolset: Toolset = {
  name: 'the display',
  instructions: `EDSSI shows one module at a time: mission (the route at a glance, life on the bodies of the current system, and organic samples since the last sale), materials (crafting recipes with what they need and how many times the commander can make each, favourites first, and what they have crafted), journal (the log of the session), route (the plotted route, jump by jump), comms (this conversation), browser (the web page you have open) and settings (keys, models, voice, and what opens the microphone). Put one up with open_tab whenever the commander asks to see something that lives there. open_tab chirps by itself, so don't call acknowledge with it, and write no reply unless they asked something more.

copy_text puts something on the commander's clipboard, so they can paste it into the game's galaxy map search or anywhere else: "copy the name of the system we're in", "copy where we're headed", "copy that station". Copy the bare thing asked for and nothing else — a system name on its own, spelt as the journal spells it, with no quotes, no label and no distance after it. It chirps by itself too.

When you have done anything else the commander asked and there is nothing to tell them, call acknowledge and write no reply at all: the chirp is the answer. Call it in the same step as the action itself, alongside whatever carries the request out, never in a step after it: waiting for the action's result first makes the chirp seconds late. Never say "Done", "Complete", "Switched to…" or anything like it. Only speak when there is something the commander didn't already know, such as an answer to a question they also asked, or a problem.

set_view_options changes how the modules show things — which way a list is sorted, what it leaves out — in the window and the VR panels alike, and it stays that way: "sort the biology by value", "show the materials I have enough of". It chirps by itself. The options are its arguments; change only those asked about.

start_over forgets this conversation, for "start over", "new conversation", "reset the conversation", "forget all that" and the like: what was said so far, and the Comms log with it. It chirps by itself. Reply with no text: nothing said now will be remembered. Don't call it on your own account, only when asked.`,

  brief({ app }) {
    const changed = changedViewOptions(app.viewOptions());
    return changed && `View options away from their defaults: ${changed}.`;
  },

  tools: [
    defineTool({
      name: 'open_tab',
      description:
        "Shows a module in EDSSI's window, and chirps to say so: no need to acknowledge it or say it's done.",
      parameters: z.object({
        tab: z.enum(TAB_IDS).describe('Which module to show.'),
      }),
      run({ tab }, { app }) {
        app.openTab(tab);
        // Chirped here rather than left to acknowledge, which the model tends to call a round later.
        app.acknowledge();
        return `The ${tab} view is up, and the commander heard the chirp.`;
      },
    }),
    defineTool({
      name: 'copy_text',
      description:
        "Puts text on the commander's clipboard for them to paste, and chirps to say so: no need " +
        'to acknowledge it or say it is done. Copy exactly the thing they asked for, such as a ' +
        'system name by itself.',
      parameters: z.object({
        text: z.string().min(1).describe('The text to copy, and nothing besides it.'),
      }),
      run({ text }, { app }) {
        app.copy(text);
        // Chirped here rather than left to acknowledge, which the model tends to call a round later.
        app.acknowledge();
        return `"${text}" is on the clipboard, and the commander heard the chirp.`;
      },
    }),
    defineTool({
      name: 'set_view_options',
      description:
        'Changes how the modules show things, such as the order a list is sorted in, in every ' +
        "window and VR panel, and chirps to say so: no need to acknowledge it or say it's done. " +
        "Pass only the options to change. It doesn't bring the module up; call open_tab too if " +
        'the commander wants to see it.',
      parameters: viewOptionsPatch,
      run(patch, { app }) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked by the schema, built from the list
        const options = app.setViewOptions(patch as ViewOptionsPatch);
        // Chirped here rather than left to acknowledge, which the model tends to call a round later.
        app.acknowledge();
        return {
          options,
          note: 'Every window and VR panel shows it now, and the commander heard the chirp.',
        };
      },
    }),
    defineTool({
      name: 'start_over',
      description:
        'Forgets this conversation and clears the Comms log once this answer is finished, as ' +
        'though the commander had pressed New. Only when they ask for it. Chirps to say so: reply ' +
        'with no text.',
      parameters: z.object({}),
      run(_args, { app, startOver }) {
        if (!startOver) return 'There is no conversation here to forget.';
        startOver();
        // Chirped here rather than left to acknowledge, which the model tends to call a round later.
        app.acknowledge();
        return (
          'The conversation will be forgotten as soon as this answer is finished, and the commander ' +
          'heard the chirp. Reply with no text.'
        );
      },
    }),
    defineTool({
      name: 'acknowledge',
      description:
        'Plays a short chirp to tell the commander a request was carried out. Use it in place of a spoken "Done". Call it together with the action, in the same step, not after its result; then reply with no text unless there is something new to say.',
      parameters: z.object({}),
      run(_args, { app }) {
        app.acknowledge();
        return 'The commander heard the chirp. Say nothing more unless there is something to add.';
      },
    }),
  ],
};
