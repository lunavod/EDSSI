import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { DEFAULT_SETTINGS } from '../../shared/settings';
import { Assistant } from './assistant';
import type { GameData } from './game-data';
import type { ModelProvider, ModelRequest } from './model/provider';
import { defineTool, ToolResultWithImages, type Toolset } from './tools/define';
import { ToolRegistry } from './tools/registry';

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

function call(name: string, args = '{}', id = 'call_1'): OutputItem {
  return {
    type: 'function_call',
    id: 'fc_1',
    call_id: id,
    name,
    arguments: args,
    status: 'completed',
  } as unknown as OutputItem;
}

/** A model that answers with whatever the test scripted, one round at a time. */
function scripted(rounds: OutputItem[][]) {
  const requests: ModelRequest[] = [];
  let round = 0;
  const provider: ModelProvider = {
    name: 'test',
    problem: () => undefined,
    stream(request) {
      requests.push(request);
      const output = rounds[round++] ?? [message('…')];
      return Promise.resolve(
        (async function* (): AsyncGenerator<Event> {
          for (const item of output) {
            // Text arrives a piece at a time, as it does from the real API.
            if (item.type === 'message') {
              for (const part of item.content) {
                if (part.type === 'output_text') {
                  yield event({ type: 'response.output_text.delta', delta: part.text });
                }
              }
            }
            yield event({ type: 'response.output_item.done', item });
          }
          yield event({ type: 'response.completed', response: { output } });
        })(),
      );
    },
  };
  return { provider, requests };
}

const opened = vi.fn();

const testTools: Toolset = {
  name: 'test',
  brief: () => 'System: Deciat',
  tools: [
    defineTool({
      name: 'open_tab',
      description: 'Shows a module.',
      parameters: z.object({ tab: z.enum(['journal', 'route', 'comms']) }),
      run: ({ tab }, { app }) => {
        app.openTab(tab);
        return `The ${tab} view is up.`;
      },
    }),
    defineTool({
      name: 'look',
      description: 'Takes a picture.',
      parameters: z.object({}),
      run: () => new ToolResultWithImages('A page.', ['data:image/jpeg;base64,AAAA']),
    }),
    defineTool({
      name: 'start_over',
      description: 'Forgets the conversation.',
      parameters: z.object({}),
      run: (_args, { startOver }) => {
        startOver?.();
        return 'Forgotten once this answer is done.';
      },
    }),
  ],
};

function build(rounds: OutputItem[][], settings = DEFAULT_SETTINGS.assistant) {
  const { provider, requests } = scripted(rounds);
  const assistant = new Assistant({
    provider,
    registry: new ToolRegistry([testTools]),
    settings,
    context: {
      game: {} as GameData,
      app: {
        openTab: opened,
        surface: vi.fn(),
        acknowledge: vi.fn(),
        copy: vi.fn(),
        viewOptions: vi.fn(),
        setViewOptions: vi.fn(),
      },
    },
    onChange: () => {},
  });
  return { assistant, requests };
}

describe('Assistant', () => {
  it('answers a question and remembers both sides of it', async () => {
    const { assistant, requests } = build([[message('Fuel is at half.')]]);

    const reply = await assistant.ask('how much fuel');

    expect(reply).toBe('Fuel is at half.');
    expect(assistant.transcript.map((entry) => [entry.role, entry.text])).toEqual([
      ['commander', 'how much fuel'],
      ['assistant', 'Fuel is at half.'],
    ]);
    // The live state goes in front of the question, so the model never works from stale facts.
    expect(JSON.stringify(requests[0]?.input)).toContain('System: Deciat');
  });

  it('answers an ultrathink question, every round of it, with the ultrathink model', async () => {
    const settings = {
      ...DEFAULT_SETTINGS.assistant,
      ultrathink: { model: 'deep-model', reasoning_effort: 'xhigh' as const },
    };
    const { assistant, requests } = build(
      [[call('open_tab', '{"tab":"route"}')], [message('Route is up.')], [message('Half.')]],
      settings,
    );

    await assistant.ask('Ultrathink: show me the route');
    await assistant.ask('how much fuel');

    expect(requests.map((request) => [request.model, request.reasoningEffort])).toEqual([
      ['deep-model', 'xhigh'],
      ['deep-model', 'xhigh'],
      [settings.model, settings.reasoning_effort],
    ]);
    expect(assistant.transcript[1]).toMatchObject({
      role: 'tool',
      text: 'ultrathink',
      detail: 'deep-model, xhigh reasoning',
    });
  });

  it('passes the text on as it is written, so it can be spoken before the turn ends', async () => {
    const { assistant } = build([[call('open_tab', '{"tab":"route"}')], [message('Route is up.')]]);
    const spoken: string[] = [];

    await assistant.ask('show me the route', (delta) => spoken.push(delta));

    expect(spoken.join('')).toBe('Route is up.');
  });

  it('shows a web search before its answer, and its sources beside it, never spoken', async () => {
    const search = {
      type: 'web_search_call',
      id: 'ws_1',
      status: 'completed',
      action: { type: 'search', queries: ['exobiology values'] },
    } as unknown as OutputItem;
    const cited = message(
      'Nebulus pays most. ([fandom.com](https://fandom.com/wiki?utm_source=openai))',
    );
    // The search's item is done before the answer starts streaming, as the API sends them.
    const { assistant } = build([[search, cited]]);
    const spoken: string[] = [];

    const reply = await assistant.ask('dearest bacterium', (delta) => spoken.push(delta));

    expect(reply).toBe('Nebulus pays most.');
    expect(spoken.join('')).toBe('Nebulus pays most.');
    expect(assistant.transcript.map((entry) => [entry.role, entry.text])).toEqual([
      ['commander', 'dearest bacterium'],
      ['tool', 'web_search'],
      ['assistant', 'Nebulus pays most.'],
    ]);
    expect(assistant.transcript[2]?.sources).toEqual([
      { title: 'fandom.com', url: 'https://fandom.com/wiki', site: 'fandom.com' },
    ]);
  });

  it('runs the tools the model asks for and answers with what they said', async () => {
    const { assistant, requests } = build([
      [call('open_tab', '{"tab":"route"}')],
      [message('Route is up.')],
    ]);

    const reply = await assistant.ask('show me the route');

    expect(opened).toHaveBeenCalledWith('route');
    expect(reply).toBe('Route is up.');
    // The transcript keeps what the tool was asked and what it said, for the Comms tab to show.
    expect(assistant.transcript[1]?.call).toEqual({
      input: '{"tab":"route"}',
      output: 'The route view is up.',
    });
    expect(assistant.transcript.map((entry) => entry.role)).toEqual([
      'commander',
      'tool',
      'assistant',
    ]);
    // The second request carries the call and its result, so the model knows what happened.
    const second = JSON.stringify(requests[1]?.input);
    expect(second).toContain('function_call_output');
    expect(second).toContain('The route view is up.');
  });

  it('hands a tool failure back to the model instead of giving up', async () => {
    const { assistant, requests } = build([
      [call('open_tab', '{"tab":"galaxy map"}')],
      [message('No such view.')],
    ]);

    await assistant.ask('open the galaxy map');

    expect(JSON.stringify(requests[1]?.input)).toContain('Invalid arguments');
  });

  it('drops the oldest exchanges so the prompt stays small', async () => {
    // One exchange is kept, so by the third question the first has fallen off.
    const settings = { ...DEFAULT_SETTINGS.assistant, history_turns: 1 };
    const { assistant, requests } = build(
      [[message('One.')], [message('Two.')], [message('Three.')]],
      settings,
    );

    await assistant.ask('first question');
    await assistant.ask('second question');
    await assistant.ask('third question');

    const third = JSON.stringify(requests[2]?.input);
    expect(third).toContain('second question');
    expect(third).not.toContain('first question');
  });

  it('says what went wrong when the model fails', async () => {
    const provider: ModelProvider = {
      name: 'test',
      problem: () => undefined,
      stream: () =>
        Promise.resolve(
          (async function* (): AsyncGenerator<Event> {
            yield event({
              type: 'response.failed',
              response: { output: [], error: { message: 'rate limited' } },
            });
          })(),
        ),
    };
    const assistant = new Assistant({
      provider,
      registry: new ToolRegistry([testTools]),
      settings: DEFAULT_SETTINGS.assistant,
      context: {
        game: {} as GameData,
        app: {
          openTab: opened,
          surface: vi.fn(),
          acknowledge: vi.fn(),
          copy: vi.fn(),
          viewOptions: vi.fn(),
          setViewOptions: vi.fn(),
        },
      },
      onChange: () => {},
    });

    const reply = await assistant.ask('anything');

    expect(reply).toBeUndefined();
    expect(assistant.transcript.at(-1)).toMatchObject({ role: 'error', text: 'rate limited' });
  });

  it('stops after too many rounds of tool calls', async () => {
    const settings = { ...DEFAULT_SETTINGS.assistant, max_tool_rounds: 2 };
    const { assistant } = build(
      [[call('open_tab', '{"tab":"route"}')], [call('open_tab', '{"tab":"journal"}')]],
      settings,
    );

    await assistant.ask('keep going');

    expect(assistant.transcript.at(-1)).toMatchObject({ role: 'error' });
  });

  it('shows the model an image for the question it was taken for, and not after', async () => {
    const { assistant, requests } = build([
      [call('look')],
      [message('It shows a plotter.')],
      [message('Still a plotter.')],
    ]);

    await assistant.ask('what is on the page');
    await assistant.ask('and now');

    expect(JSON.stringify(requests[1]?.input)).toContain('"type":"input_image"');
    const later = JSON.stringify(requests[2]?.input);
    expect(later).not.toContain('input_image');
    expect(later).toContain('A page.');
    expect(later).toContain('no longer shown');
  });

  it('goes back to idle when a question is cancelled mid-way', async () => {
    let started = false;
    const slow: Toolset = {
      name: 'slow',
      tools: [
        defineTool({
          name: 'wait',
          description: 'Waits.',
          parameters: z.object({}),
          run: async (_args, { signal }) =>
            new Promise((_resolve, reject) => {
              started = true;
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            }),
        }),
      ],
    };
    const { provider } = scripted([[call('wait')], [message('Done.')]]);
    const assistant = new Assistant({
      provider,
      registry: new ToolRegistry([slow]),
      settings: DEFAULT_SETTINGS.assistant,
      context: {
        game: {} as GameData,
        app: {
          openTab: opened,
          surface: vi.fn(),
          acknowledge: vi.fn(),
          copy: vi.fn(),
          viewOptions: vi.fn(),
          setViewOptions: vi.fn(),
        },
      },
      onChange: () => {},
    });

    const asking = assistant.ask('take your time');
    await vi.waitFor(() => expect(started).toBe(true));
    expect(assistant.phase).toBe('thinking');
    assistant.cancel();

    expect(await asking).toBeUndefined();
    expect(assistant.phase).toBe('idle');
  });

  it('forgets everything once an answer that asked to start over is finished', async () => {
    const { assistant, requests } = build([
      [message('Deciat is ahead.')],
      [call('start_over')],
      [message('')],
      [message('Fresh.')],
    ]);

    await assistant.ask('where are we going');
    await assistant.ask('start over');
    // The answer that asked for it still ran to its end: the tool's result went back to the model.
    expect(requests).toHaveLength(3);
    expect(assistant.transcript).toEqual([]);

    await assistant.ask('hello');
    expect(JSON.stringify(requests[3]?.input)).not.toContain('where are we going');
    expect(JSON.stringify(requests[3]?.input)).not.toContain('start over');
    expect(requests[3]?.cacheKey).not.toBe(requests[0]?.cacheKey);
  });

  it('forgets everything when the conversation is reset', async () => {
    const { assistant, requests } = build([[message('One.')], [message('Two.')]]);

    await assistant.ask('first question');
    assistant.reset();
    await assistant.ask('second question');

    expect(assistant.transcript).toHaveLength(2);
    expect(JSON.stringify(requests[1]?.input)).not.toContain('first question');
  });
});
