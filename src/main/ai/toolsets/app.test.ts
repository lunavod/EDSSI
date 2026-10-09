import { describe, expect, it, vi } from 'vitest';

import { defaultViewOptions, type ViewOptionsPatch } from '../../../shared/view-options';
import type { GameData } from '../game-data';
import type { ToolContext } from '../tools/define';
import { appToolset } from './app';

function context() {
  let options = defaultViewOptions();
  const app = {
    openTab: vi.fn(),
    surface: vi.fn(),
    acknowledge: vi.fn(),
    copy: vi.fn(),
    viewOptions: vi.fn(() => options),
    setViewOptions: vi.fn((patch: ViewOptionsPatch) => (options = { ...options, ...patch })),
  };
  const ctx: ToolContext = { game: {} as GameData, app, signal: new AbortController().signal };
  return { ...ctx, app };
}

function tool(name: string) {
  const found = appToolset.tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no ${name} tool`);
  return found;
}

describe('copy_text', () => {
  it('copies the text and chirps, without leaving that to acknowledge', async () => {
    const ctx = context();
    const result = await tool('copy_text').run({ text: 'Hyades Sector DB-X d1-112' }, ctx);
    expect(ctx.app.copy).toHaveBeenCalledWith('Hyades Sector DB-X d1-112');
    expect(ctx.app.acknowledge).toHaveBeenCalled();
    expect(String(result)).toContain('Hyades Sector DB-X d1-112');
  });

  it('refuses nothing at all, so an empty clipboard is never the answer', () => {
    expect(() => tool('copy_text').parameters.parse({ text: '' })).toThrow();
  });
});

describe('start_over', () => {
  it('asks for the conversation to be forgotten, and chirps', async () => {
    const ctx = context();
    const startOver = vi.fn();
    await tool('start_over').run({}, { ...ctx, startOver });
    expect(startOver).toHaveBeenCalled();
    expect(ctx.app.acknowledge).toHaveBeenCalled();
  });

  it('says so where there is no conversation to forget', async () => {
    const ctx = context();
    const result = await tool('start_over').run({}, ctx);
    expect(ctx.app.acknowledge).not.toHaveBeenCalled();
    expect(String(result)).toContain('no conversation');
  });
});

describe('set_view_options', () => {
  it('changes the options named, and chirps', async () => {
    const ctx = context();
    const args = tool('set_view_options').parameters.parse({ 'mission.bio_sort': 'value' });
    await tool('set_view_options').run(args, ctx);
    expect(ctx.app.setViewOptions).toHaveBeenCalledWith({ 'mission.bio_sort': 'value' });
    expect(ctx.app.acknowledge).toHaveBeenCalled();
  });

  it('refuses a value the option does not take, and a call that changes nothing', () => {
    const { parameters } = tool('set_view_options');
    expect(() => parameters.parse({ 'mission.bio_sort': 'colour' })).toThrow();
    expect(() => parameters.parse({ 'materials.missing_show_covered': 'yes' })).toThrow();
    expect(() => parameters.parse({})).toThrow();
  });

  it('puts only the options away from their defaults in the brief', () => {
    const ctx = context();
    expect(appToolset.brief?.(ctx)).toBeUndefined();
    ctx.app.setViewOptions({ 'materials.missing_show_covered': true });
    expect(appToolset.brief?.(ctx)).toBe(
      'View options away from their defaults: materials.missing_show_covered: true.',
    );
  });
});
