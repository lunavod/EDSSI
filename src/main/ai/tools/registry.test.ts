import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { GameData } from '../game-data';
import { defineTool, type ToolContext, type Toolset } from './define';
import { ToolRegistry } from './registry';

const context: ToolContext = {
  game: {} as GameData,
  app: {
    openTab: vi.fn(),
    surface: vi.fn(),
    acknowledge: vi.fn(),
    copy: vi.fn(),
    viewOptions: vi.fn(),
    setViewOptions: vi.fn(),
  },
  signal: new AbortController().signal,
};

function registry(...toolsets: Toolset[]): ToolRegistry {
  return new ToolRegistry(toolsets);
}

const echo: Toolset = {
  name: 'test',
  instructions: 'Only for tests.',
  brief: () => 'Fuel: 12 t',
  tools: [
    defineTool({
      name: 'echo',
      description: 'Says it back.',
      parameters: z.object({ text: z.string(), times: z.number().int().default(1) }),
      run: ({ text, times }) => ({ said: text.repeat(times) }),
    }),
  ],
};

describe('ToolRegistry', () => {
  it('declares every tool with a JSON schema the API will take', () => {
    const [definition] = registry(echo).definitions();
    expect(definition?.name).toBe('echo');
    expect(definition?.type).toBe('function');
    // `$schema` isn't part of what the API accepts.
    expect(definition?.parameters).not.toHaveProperty('$schema');
    expect(definition?.parameters).toMatchObject({ type: 'object' });
  });

  it('refuses two tools with the same name', () => {
    expect(() => registry(echo, echo)).toThrow(/echo/);
  });

  it('runs a tool and serialises what it returns', async () => {
    const result = await registry(echo).run('echo', '{"text":"ho","times":2}', context);
    expect(result).toEqual({ output: '{"said":"hoho"}', failed: false });
  });

  it('tells the model when a tool does not exist', async () => {
    const result = await registry(echo).run('warp_drive', '{}', context);
    expect(result.failed).toBe(true);
    expect(result.output).toContain('no tool called warp_drive');
  });

  it('explains bad arguments instead of failing the turn', async () => {
    const result = await registry(echo).run('echo', '{"times":2}', context);
    expect(result.failed).toBe(true);
    expect(result.output).toContain('Invalid arguments');
    expect(result.output).toContain('text');
  });

  it('survives arguments that are not JSON', async () => {
    const result = await registry(echo).run('echo', 'text=hi', context);
    expect(result).toEqual({ output: 'The arguments were not valid JSON.', failed: true });
  });

  it('reports a tool that throws rather than letting it escape', async () => {
    const breaking: Toolset = {
      name: 'broken',
      tools: [
        defineTool({
          name: 'break',
          description: 'Always fails.',
          parameters: z.object({}),
          run: () => {
            throw new Error('the scanner is offline');
          },
        }),
      ],
    };
    const result = await registry(breaking).run('break', '{}', context);
    expect(result).toEqual({ output: 'The tool failed: the scanner is offline', failed: true });
  });

  it('serialises the bigints the journal puts in system addresses', async () => {
    const big: Toolset = {
      name: 'big',
      tools: [
        defineTool({
          name: 'address',
          description: 'A system address.',
          parameters: z.object({}),
          run: () => ({ systemAddress: 1826293003n }),
        }),
      ],
    };
    const result = await registry(big).run('address', '{}', context);
    expect(result.output).toBe('{"systemAddress":"1826293003"}');
  });

  it('cuts a result that would swamp the next prompt', async () => {
    const huge: Toolset = {
      name: 'huge',
      tools: [
        defineTool({
          name: 'everything',
          description: 'Far too much.',
          parameters: z.object({}),
          run: () => 'x'.repeat(20_000),
        }),
      ],
    };
    const result = await registry(huge).run('everything', '{}', context);
    expect(result.output.length).toBeLessThan(20_000);
    expect(result.output).toContain('cut short');
  });

  it('gathers the toolsets instructions and briefs', () => {
    const quiet: Toolset = { name: 'quiet', tools: [] };
    const both = registry(echo, quiet);
    expect(both.instructions()).toBe('## test\nOnly for tests.');
    expect(both.brief(context)).toBe('Fuel: 12 t');
  });
});
