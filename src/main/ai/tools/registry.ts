/**
 * Holds every toolset, hands the model their declarations, and runs what it calls.
 *
 * Arguments are checked here rather than by the API's strict mode, because the ChatGPT provider
 * and strict schemas don't always agree, and because a clear "invalid arguments" answer lets the
 * model correct itself in the next round.
 */

import type OpenAI from 'openai';
import { z } from 'zod';

import {
  type GameContext,
  type Tool,
  type ToolContext,
  ToolResultWithImages,
  type Toolset,
} from './define';

/** Long enough for EDSM, short enough that a wedged tool doesn't hang the answer. */
const TOOL_TIMEOUT_MS = 20_000;

/** Tool results are part of the next prompt, so they are capped rather than sent whole. */
const MAX_RESULT_CHARS = 8000;

export interface ToolRun {
  output: string;
  /** Data URLs, for a tool that shows the model something. */
  images?: readonly string[];
  failed: boolean;
}

export class ToolRegistry {
  readonly #toolsets: readonly Toolset[];
  readonly #tools = new Map<string, Tool>();
  readonly #definitions: OpenAI.Responses.FunctionTool[] = [];

  constructor(toolsets: readonly Toolset[]) {
    this.#toolsets = toolsets;
    for (const toolset of toolsets) {
      for (const tool of toolset.tools) {
        if (this.#tools.has(tool.name)) {
          throw new Error(`Two tools are called ${tool.name}`);
        }
        this.#tools.set(tool.name, tool);
        this.#definitions.push({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: jsonSchema(tool.parameters),
          strict: false,
        });
      }
    }
  }

  /** What goes in the request's `tools`. */
  definitions(): OpenAI.Responses.FunctionTool[] {
    return this.#definitions;
  }

  /** The toolsets' own instructions, as sections of the assistant's prompt. */
  instructions(): string {
    return this.#toolsets
      .filter((toolset) => toolset.instructions !== undefined)
      .map((toolset) => `## ${toolset.name}\n${toolset.instructions!.trim()}`)
      .join('\n\n');
  }

  /** The live state put in front of a question. A toolset that has nothing to say is skipped. */
  brief(context: GameContext): string {
    const lines: string[] = [];
    for (const toolset of this.#toolsets) {
      try {
        const line = toolset.brief?.(context)?.trim();
        if (line) lines.push(line);
      } catch (error) {
        console.error(`[ai] ${toolset.name} failed to describe itself`, error);
      }
    }
    return lines.join('\n');
  }

  /**
   * Runs one call from the model. Never throws: the model is told what went wrong so it can try
   * something else, which is more useful than failing the whole turn.
   */
  async run(name: string, argumentsJson: string, context: ToolContext): Promise<ToolRun> {
    const tool = this.#tools.get(name);
    if (!tool) return { output: `There is no tool called ${name}.`, failed: true };

    let parsedArguments: unknown;
    try {
      parsedArguments = argumentsJson.trim() === '' ? {} : JSON.parse(argumentsJson);
    } catch {
      return { output: 'The arguments were not valid JSON.', failed: true };
    }

    const args = tool.parameters.safeParse(parsedArguments);
    if (!args.success) {
      return { output: `Invalid arguments: ${z.prettifyError(args.error)}`, failed: true };
    }

    try {
      const result = await withTimeout(
        tool.run(args.data, context),
        context.signal,
        tool.timeoutMs ?? TOOL_TIMEOUT_MS,
      );
      if (result instanceof ToolResultWithImages) {
        return { output: serialise(result.text), images: result.images, failed: false };
      }
      return { output: serialise(result), failed: false };
    } catch (error) {
      if (context.signal.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ai] tool ${name} failed`, error);
      return { output: `The tool failed: ${message}`, failed: true };
    }
  }
}

async function withTimeout(
  result: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  if (!(result instanceof Promise)) return result;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      result,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('it took too long')), timeoutMs);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whatever a tool returns has to reach the model as text. */
function serialise(result: unknown): string {
  if (result === undefined || result === null) return 'Done.';
  const text =
    typeof result === 'string'
      ? result
      : // System addresses and mission ids can be bigints (see journal/parse.ts).
        JSON.stringify(result, (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
        );
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n…cut short; ask for less at a time.`;
}

/** zod schemas become the JSON Schema the API wants; `$schema` isn't part of it. */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON Schema is an object
  const { $schema: _schema, ...rest } = generated as Record<string, unknown>;
  return rest;
}
