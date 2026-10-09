/**
 * How the assistant's tools are declared. A tool is a name, a description the model reads, a zod
 * schema for its arguments, and the code that answers. Tools come in toolsets, one per area of the
 * app, so a new area is one file and one line in `toolsets/index.ts`.
 */

import type { z } from 'zod';

import type { PromptAnswer, PromptRequest } from '../../../shared/prompts';
import type { AppControl } from '../app-control';
import type { BrowserControl } from '../browser-control';
import type { GameData } from '../game-data';

/** What every tool can reach: the game's state, and the app itself. */
export interface GameContext {
  game: GameData;
  app: AppControl;
  /** The browser in EDSSI's window; missing where there is no window to put it in. */
  browser?: BrowserControl;
  /**
   * Stops to ask the commander, and waits for the answer. Missing where nobody can answer (tests,
   * scripts); a tool that needs a yes then has to take it as a no.
   */
  askCommander?: (prompt: PromptRequest, signal: AbortSignal) => Promise<PromptAnswer>;
}

export interface ToolContext extends GameContext {
  /** Aborted when the commander interrupts or asks something else. */
  signal: AbortSignal;
  /**
   * Forgets the conversation once the answer in progress is finished, as the Comms tab's New
   * does. Not at once: the tool is running inside that answer, and throwing the conversation away
   * under it would cut the answer off. Missing outside a conversation (tests, scripts).
   */
  startOver?: () => void;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: z.ZodType;
  readonly timeoutMs?: number;
  /** Called with arguments already checked against `parameters`. */
  run(args: unknown, context: ToolContext): unknown;
}

/**
 * A result the model should see as well as read, such as a screenshot. Images are data URLs; they
 * are only kept for the question they were taken for, since every later request would carry them.
 */
export class ToolResultWithImages {
  constructor(
    readonly text: string,
    readonly images: readonly string[],
  ) {}
}

export interface ToolSpec<S extends z.ZodType> {
  /** Lower snake case, unique across every toolset, e.g. `get_system_survey`. */
  name: string;
  /** What it answers and when to reach for it; the model picks tools from this alone. */
  description: string;
  parameters: S;
  /**
   * How long it may take before the model is told it took too long. The default suits a lookup;
   * a tool that waits on the commander needs minutes.
   */
  timeoutMs?: number;
  /**
   * Returns anything JSON can hold; it is serialised for the model. Keep it small and already
   * worked out — totals rather than rows — so the model doesn't have to do arithmetic. Return a
   * `ToolResultWithImages` to show it something.
   */
  run(args: z.output<S>, context: ToolContext): unknown;
}

export function defineTool<S extends z.ZodType>(spec: ToolSpec<S>): Tool {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    timeoutMs: spec.timeoutMs,
    // The registry parses arguments with `parameters` before calling this.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked by the registry
    run: (args, context) => spec.run(args as z.output<S>, context),
  };
}

export interface Toolset {
  /** Names the area in the assistant's instructions, e.g. `navigation`. */
  name: string;
  /** What this area covers, added to the assistant's instructions. One or two sentences. */
  instructions?: string;
  /**
   * A line or two of live state put in front of every question, so the model doesn't have to call
   * a tool to know the obvious. Keep it to what changes and matters; detail belongs in tools.
   */
  brief?(context: GameContext): string | undefined;
  tools: Tool[];
}
