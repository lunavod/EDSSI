/**
 * The model layer. Both providers speak the Responses API — OpenAI's own, and the ChatGPT backend
 * the Codex CLI uses — so they share one request body and one reader, and differ only in how they
 * are authenticated.
 */

import type OpenAI from 'openai';

import type { ReasoningEffort } from '../../../shared/settings';

export interface ModelRequest {
  model: string;
  instructions: string;
  input: OpenAI.Responses.ResponseInputItem[];
  tools: OpenAI.Responses.FunctionTool[];
  /** Adds the provider's own hosted web search to the tools. */
  webSearch: boolean;
  reasoningEffort: ReasoningEffort;
  /** Same for every turn of a conversation, so the cached prompt prefix is reused. */
  cacheKey: string;
}

export interface ModelProvider {
  readonly name: string;
  /** Why it can't be used — no API key, not signed in — or undefined when it's ready. */
  problem(): string | undefined;
  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<AsyncIterable<OpenAI.Responses.ResponseStreamEvent>>;
}

/**
 * Searched on the provider's side, so it needs no key of EDSSI's own. A small context keeps a
 * spoken answer quick and cheap; the page itself can be read with `fetch_page`.
 */
const WEB_SEARCH: OpenAI.Responses.WebSearchTool = {
  type: 'web_search',
  search_context_size: 'low',
};

/**
 * Nothing is stored on the provider's side (`store: false`), so EDSSI keeps the conversation and
 * asks for the model's thinking to come back encrypted, to hand back with the tool results.
 */
export function requestBody(request: ModelRequest): OpenAI.Responses.ResponseCreateParamsStreaming {
  const tools = request.webSearch ? [...request.tools, WEB_SEARCH] : request.tools;
  return {
    model: request.model,
    instructions: request.instructions,
    input: request.input,
    tools,
    // A question asked with no tools (reading a screenshot) has none to choose between.
    ...(tools.length > 0 && { tool_choice: 'auto', parallel_tool_calls: true }),
    reasoning: { effort: request.reasoningEffort },
    include: ['reasoning.encrypted_content'],
    store: false,
    stream: true,
    prompt_cache_key: request.cacheKey,
  };
}

export interface ModelTurn {
  /** What the model produced: its thinking, what it said, and any tool calls. */
  output: OpenAI.Responses.ResponseOutputItem[];
  /** Set when the model stopped before finishing. */
  error?: string;
}

/**
 * Reads one streamed response. Text arrives through `onText` as it is written, so the HUD can
 * show it before the model has finished, and each finished item through `onItem`, so a web search
 * shows up when it happens rather than after the answer it fed.
 */
export async function readTurn(
  events: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
  onText: (delta: string) => void,
  onItem?: (item: OpenAI.Responses.ResponseOutputItem) => void,
): Promise<ModelTurn> {
  const items: OpenAI.Responses.ResponseOutputItem[] = [];
  let response: OpenAI.Responses.Response | undefined;
  let error: string | undefined;

  for await (const event of events) {
    switch (event.type) {
      case 'response.output_text.delta':
        onText(event.delta);
        break;
      case 'response.output_item.done':
        items.push(event.item);
        onItem?.(event.item);
        break;
      case 'response.completed':
        response = event.response;
        break;
      case 'response.incomplete':
        response = event.response;
        error = `the answer was cut short (${event.response.incomplete_details?.reason ?? 'unknown'})`;
        break;
      case 'response.failed':
        response = event.response;
        error = event.response.error?.message ?? 'the model failed to answer';
        break;
      case 'error':
        error = event.message;
        break;
      default:
        break;
    }
  }

  // The ChatGPT backend sometimes finishes with an empty output; the items it sent still stand.
  const output = response?.output?.length ? response.output : items;
  return { output, error };
}

/**
 * Turns what the model produced into what goes back in the next request. Item ids point at a
 * stored response, and nothing is stored, so they are dropped — the Codex CLI does the same.
 *
 * A web search call can't be replayed without its id, and the answer that used it already says
 * what was found, so it is left out.
 */
export function asInput(
  output: readonly OpenAI.Responses.ResponseOutputItem[],
): OpenAI.Responses.ResponseInputItem[] {
  return output
    .filter((item) => item.type !== 'web_search_call')
    .map((item) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every item is a plain object
      const { id: _id, ...rest } = item as unknown as { id?: string } & Record<string, unknown>;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- output items are input items
      return rest as unknown as OpenAI.Responses.ResponseInputItem;
    });
}

/** The tool calls in a turn, in the order the model made them. */
export function toolCalls(
  output: readonly OpenAI.Responses.ResponseOutputItem[],
): OpenAI.Responses.ResponseFunctionToolCall[] {
  return output.filter((item) => item.type === 'function_call');
}

/** What a web search looked for, for the transcript; undefined for any other item. */
export function webSearchQuery(item: OpenAI.Responses.ResponseOutputItem): string | undefined {
  if (item.type !== 'web_search_call') return undefined;
  const action = item.action;
  if (action?.type === 'search') return (action.queries ?? [action.query ?? '']).join('; ');
  if (action?.type === 'open_page') return action.url ?? '';
  return '';
}

/** Everything the model said, as one piece of text. */
export function spokenText(output: readonly OpenAI.Responses.ResponseOutputItem[]): string {
  return output
    .filter((item) => item.type === 'message')
    .flatMap((message) => message.content)
    .map((part) => (part.type === 'output_text' ? part.text : ''))
    .join('')
    .trim();
}
