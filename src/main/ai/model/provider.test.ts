import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { asInput, readTurn, requestBody, spokenText, toolCalls, webSearchQuery } from './provider';

type Event = OpenAI.Responses.ResponseStreamEvent;
type OutputItem = OpenAI.Responses.ResponseOutputItem;

/** Stream events as the API sends them, without the bookkeeping fields nothing here reads. */
function event(value: Record<string, unknown>): Event {
  return value as unknown as Event;
}

function message(text: string): OutputItem {
  return {
    type: 'message',
    id: 'msg_1',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  } as unknown as OutputItem;
}

function call(name: string, args: string): OutputItem {
  return {
    type: 'function_call',
    id: 'fc_1',
    call_id: 'call_1',
    name,
    arguments: args,
    status: 'completed',
  } as unknown as OutputItem;
}

async function* events(...list: Event[]): AsyncGenerator<Event> {
  for (const item of list) yield item;
}

describe('readTurn', () => {
  it('hands over the text as it is written and collects the output', async () => {
    const onText = vi.fn();
    const answer = message('Docked at Jameson.');
    const turn = await readTurn(
      events(
        event({ type: 'response.output_text.delta', delta: 'Docked ' }),
        event({ type: 'response.output_text.delta', delta: 'at Jameson.' }),
        event({ type: 'response.output_item.done', item: answer }),
        event({ type: 'response.completed', response: { output: [answer] } }),
      ),
      onText,
    );

    expect(onText.mock.calls.flat().join('')).toBe('Docked at Jameson.');
    expect(turn.error).toBeUndefined();
    expect(spokenText(turn.output)).toBe('Docked at Jameson.');
  });

  it('falls back to the items when the final response carries no output', async () => {
    // The ChatGPT backend does this; the items it streamed are still the answer.
    const answer = message('Understood.');
    const turn = await readTurn(
      events(
        event({ type: 'response.output_item.done', item: answer }),
        event({ type: 'response.completed', response: { output: [] } }),
      ),
      vi.fn(),
    );
    expect(turn.output).toEqual([answer]);
  });

  it('reports a response that failed', async () => {
    const turn = await readTurn(
      events(
        event({
          type: 'response.failed',
          response: { output: [], error: { message: 'model overloaded' } },
        }),
      ),
      vi.fn(),
    );
    expect(turn.error).toBe('model overloaded');
  });

  it('reports one that was cut short', async () => {
    const turn = await readTurn(
      events(
        event({
          type: 'response.incomplete',
          response: { output: [], incomplete_details: { reason: 'max_output_tokens' } },
        }),
      ),
      vi.fn(),
    );
    expect(turn.error).toContain('max_output_tokens');
  });
});

function search(queries: string[]): OutputItem {
  return {
    type: 'web_search_call',
    id: 'ws_1',
    status: 'completed',
    action: { type: 'search', queries },
  } as unknown as OutputItem;
}

describe('requestBody', () => {
  const request = {
    model: 'm',
    instructions: '',
    input: [],
    tools: [],
    reasoningEffort: 'low' as const,
    cacheKey: 'k',
  };

  it('adds hosted web search only when it is on', () => {
    expect(requestBody({ ...request, webSearch: true }).tools).toEqual([
      expect.objectContaining({ type: 'web_search' }),
    ]);
    expect(requestBody({ ...request, webSearch: false }).tools).toEqual([]);
  });

  it('asks for no tool choice when there are no tools', () => {
    expect(requestBody({ ...request, webSearch: false })).not.toHaveProperty('tool_choice');
    expect(requestBody({ ...request, webSearch: true })).toHaveProperty('tool_choice', 'auto');
  });
});

describe('asInput', () => {
  it('drops the ids, which point at a response nobody stored', () => {
    const [item] = asInput([call('get_route', '{}')]);
    expect(item).not.toHaveProperty('id');
    expect(item).toMatchObject({ type: 'function_call', call_id: 'call_1', name: 'get_route' });
  });

  it("leaves web searches out, since they can't be replayed", () => {
    const items = asInput([search(['colonia bridge']), message('Found it.')]);
    expect(items.map((item) => ('type' in item ? item.type : undefined))).toEqual(['message']);
  });
});

describe('webSearchQuery', () => {
  it('says what a search looked for', () => {
    expect(webSearchQuery(search(['a', 'b']))).toBe('a; b');
    expect(webSearchQuery(message('x'))).toBeUndefined();
  });
});

describe('toolCalls', () => {
  it('picks out what the model wants run', () => {
    const calls = toolCalls([message('One moment.'), call('get_ledger', '{}')]);
    expect(calls.map((item) => item.name)).toEqual(['get_ledger']);
  });
});
