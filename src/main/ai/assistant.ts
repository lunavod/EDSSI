/**
 * One conversation with the model: the transcript the HUD shows, the history sent back with each
 * question, and the round trip of tool calls that answers one.
 *
 * The provider and the toolsets are handed in, so this can be tested without a network or a game.
 */

import { randomUUID } from 'node:crypto';

import type OpenAI from 'openai';

import type {
  AnswerSource,
  AssistantPhase,
  ToolCallRecord,
  TranscriptEntry,
  TranscriptRole,
} from '../../shared/assistant';
import type { AssistantSettings } from '../../shared/settings';
import { describeNow } from '../activity/periods';
import { addSource, annotatedSources, CitationFilter, stripCitations } from './citations';
import { buildInstructions } from './instructions';
import {
  asInput,
  type ModelProvider,
  readTurn,
  spokenText,
  toolCalls,
  webSearchQuery,
} from './model/provider';
import type { GameContext } from './tools/define';
import type { ToolRegistry } from './tools/registry';
import { modelFor, ULTRATHINK } from './ultrathink';

/** Entries older than this fall off the transcript; the conversation itself is trimmed separately. */
const MAX_TRANSCRIPT = 200;

/** One exchange: the question, and everything the model produced answering it. */
interface Turn {
  items: OpenAI.Responses.ResponseInputItem[];
}

export interface AssistantOptions {
  provider: ModelProvider;
  registry: ToolRegistry;
  settings: AssistantSettings;
  context: GameContext;
  /** Called whenever the transcript or the phase changes, however small the change. */
  onChange: () => void;
}

export class Assistant {
  readonly #registry: ToolRegistry;
  readonly #context: GameContext;
  readonly #onChange: () => void;
  #provider: ModelProvider;
  #settings: AssistantSettings;

  #turns: Turn[] = [];
  #transcript: TranscriptEntry[] = [];
  #phase: AssistantPhase = 'idle';
  #nextId = 1;
  /** Shared by every request of a conversation, so the provider can reuse its cached prefix. */
  #cacheKey = randomUUID();
  #running: AbortController | undefined;
  /** The question that asked, through `startOver`, for the conversation to end with it. */
  #endsWith: AbortSignal | undefined;

  constructor(options: AssistantOptions) {
    this.#provider = options.provider;
    this.#registry = options.registry;
    this.#settings = options.settings;
    this.#context = options.context;
    this.#onChange = options.onChange;
  }

  get phase(): AssistantPhase {
    return this.#phase;
  }

  get transcript(): TranscriptEntry[] {
    return this.#transcript;
  }

  /** Settings are reloaded from the file while EDSSI runs, so both can change mid-conversation. */
  configure(provider: ModelProvider, settings: AssistantSettings): void {
    this.#provider = provider;
    this.#settings = settings;
  }

  setPhase(phase: AssistantPhase): void {
    if (this.#phase === phase) return;
    this.#phase = phase;
    this.#onChange();
  }

  /** Adds a line to the transcript. Returns it, so streaming text can keep appending. */
  say(role: TranscriptRole, text: string, detail?: string, call?: ToolCallRecord): TranscriptEntry {
    const entry: TranscriptEntry = {
      id: this.#nextId++,
      role,
      text,
      at: new Date().toISOString(),
      detail,
      call,
    };
    this.#transcript = [...this.#transcript, entry].slice(-MAX_TRANSCRIPT);
    this.#onChange();
    return entry;
  }

  /** Drops the conversation and starts a new one; the transcript is cleared with it. */
  reset(): void {
    this.cancel();
    this.#turns = [];
    this.#transcript = [];
    this.#cacheKey = randomUUID();
    this.#onChange();
  }

  /** Stops whatever is in flight. The half-finished exchange is thrown away, not remembered. */
  cancel(): void {
    if (!this.#running) return;
    this.#running.abort(new Error('cancelled'));
    this.#running = undefined;
    // The cancelled question no longer owns the phase, so it can't put it back itself.
    this.setPhase('idle');
  }

  /**
   * Answers one question, calling tools until the model has nothing left to call. Returns what to
   * say out loud, or undefined when there is nothing to say (interrupted, or an error).
   */
  async ask(question: string, onText?: (delta: string) => void): Promise<string | undefined> {
    // A new question replaces the one in flight: the commander has moved on.
    this.cancel();
    const running = new AbortController();
    this.#running = running;
    const { signal } = running;

    this.say('commander', question);
    const chosen = modelFor(this.#settings, question);
    if (chosen.ultrathink) {
      this.say('tool', ULTRATHINK, `${chosen.model}, ${chosen.reasoningEffort} reasoning`);
    }
    const items: OpenAI.Responses.ResponseInputItem[] = [
      { role: 'developer', content: `<game_state>\n${this.#brief()}\n</game_state>` },
      { role: 'user', content: question },
    ];
    const instructions = buildInstructions({
      toolInstructions: this.#registry.instructions(),
      extra: this.#settings.instructions,
    });

    this.setPhase('thinking');
    try {
      const reply = await this.#rounds(question, items, instructions, signal, onText);
      // Only a finished exchange is remembered: a half-run tool call would break the next request.
      this.#turns.push({ items: withoutImages(items) });
      this.#turns = this.#turns.slice(-this.#settings.history_turns);
      return reply;
    } catch (error) {
      if (signal.aborted) return undefined;
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ai]', error);
      this.say('error', message);
      return undefined;
    } finally {
      if (this.#running === running) {
        this.#running = undefined;
        this.setPhase('idle');
      }
      // Only if this question ran to its end: one that was overtaken by another must not take the
      // new one's conversation with it.
      if (this.#endsWith === signal) {
        this.#endsWith = undefined;
        if (!signal.aborted) this.reset();
      }
    }
  }

  /** The model, its tools, and the model again, until it stops calling tools. */
  async #rounds(
    question: string,
    items: OpenAI.Responses.ResponseInputItem[],
    instructions: string,
    signal: AbortSignal,
    onText?: (delta: string) => void,
  ): Promise<string | undefined> {
    const history = this.#turns.flatMap((turn) => turn.items);
    let spoken: string | undefined;
    // Sources from a round that said nothing go with the next thing said.
    let unshown: AnswerSource[] = [];

    for (let round = 0; round < this.#settings.max_tool_rounds; round++) {
      let streaming: TranscriptEntry | undefined;
      // Chosen each round, as settings can be reloaded while a question runs.
      const { model, reasoningEffort } = modelFor(this.#settings, question);
      const stream = await this.#provider.stream(
        {
          model,
          instructions,
          input: [...history, ...items],
          tools: this.#registry.definitions(),
          webSearch: this.#settings.web_search,
          reasoningEffort,
          cacheKey: this.#cacheKey,
        },
        signal,
      );

      // Web search writes its sources into the text; they are shown, never spoken.
      const citations = new CitationFilter();
      const write = (delta: string): void => {
        if (!delta) return;
        // Speech starts on the first finished sentence rather than the finished answer.
        onText?.(delta);
        // The answer shows up as it is written; tool rounds usually produce no text at all.
        streaming ??= this.say('assistant', '', undefined);
        streaming.text += delta;
        streaming.pending = true;
        this.#onChange();
      };
      const turn = await readTurn(
        stream,
        (delta) => write(citations.push(delta)),
        (item) => {
          const query = webSearchQuery(item);
          if (query !== undefined) {
            this.say('tool', 'web_search', query, { input: JSON.stringify({ query }) });
          }
        },
      );
      write(citations.end());
      if (turn.error !== undefined) throw new Error(turn.error);

      items.push(...asInput(turn.output));
      const { text, sources } = stripCitations(spokenText(turn.output));
      for (const source of [...annotatedSources(turn.output), ...sources]) {
        addSource(unshown, source.title, source.url);
      }
      const answer = streaming ?? (text ? this.say('assistant', text) : undefined);
      if (answer) {
        answer.text = text;
        answer.pending = false;
        if (unshown.length > 0) answer.sources = unshown;
        unshown = [];
        this.#onChange();
      }
      spoken = text || spoken;

      const calls = toolCalls(turn.output);
      if (calls.length === 0) return text || undefined;

      // Calls in one round don't depend on each other, so they run together.
      const context = {
        ...this.#context,
        signal,
        startOver: () => {
          this.#endsWith = signal;
        },
      };
      const results = await Promise.all(
        calls.map((call) => this.#registry.run(call.name, call.arguments, context)),
      );
      for (const [index, call] of calls.entries()) {
        const result = results[index]!;
        items.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: result.images?.length
            ? [
                { type: 'input_text', text: result.output },
                ...result.images.map((url) => ({
                  type: 'input_image' as const,
                  image_url: url,
                  detail: 'auto' as const,
                })),
              ]
            : result.output,
        });
        this.say('tool', call.name, result.failed ? result.output : call.arguments, {
          input: call.arguments,
          output: result.output,
          failed: result.failed || undefined,
          images: result.images?.length || undefined,
        });
      }
    }

    // The model kept calling tools; stop rather than let one question run away with the bill.
    this.say('error', 'Gave up after too many steps.');
    return spoken;
  }

  /** The live state that goes in front of every question. */
  #brief(): string {
    const lines = [describeNow(new Date()), this.#registry.brief(this.#context)];
    return lines.filter(Boolean).join('\n');
  }
}

/**
 * A remembered exchange keeps what tools said but not what they showed: a screenshot is thousands
 * of tokens, and every later question would send it again.
 */
export function withoutImages(
  items: readonly OpenAI.Responses.ResponseInputItem[],
): OpenAI.Responses.ResponseInputItem[] {
  return items.map((item) => {
    if (item.type !== 'function_call_output' || typeof item.output === 'string') return item;
    const text = item.output
      .map((part) => (part.type === 'input_text' ? part.text : '[an image, no longer shown]'))
      .join('\n');
    return { ...item, output: text };
  });
}
