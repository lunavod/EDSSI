import { describe, expect, it, vi } from 'vitest';

import { demoScenario } from './fixtures/demo';
import { DEMO_ONLY, MockEdssi } from './mock-edssi';

describe('MockEdssi', () => {
  it('answers reads from its scenario', async () => {
    const api = new MockEdssi(demoScenario);
    expect(await api.journal.getSnapshot()).toEqual(demoScenario.journal);
    expect(await api.history.getSnapshot()).toEqual(demoScenario.history);
    expect(await api.getVersion()).toBe(demoScenario.version);
  });

  it('keeps each instance to itself', async () => {
    const one = new MockEdssi(demoScenario);
    const other = new MockEdssi(demoScenario);
    const heard = vi.fn();
    other.commodities.onListChange(heard);
    await one.commodities.setList([]);
    expect((await one.commodities.getList()).items).toEqual([]);
    expect((await other.commodities.getList()).items.length).toBe(
      demoScenario.shoppingList.items.length,
    );
    expect(heard).not.toHaveBeenCalled();
    // Nor does it write through to the scenario it was given.
    expect(demoScenario.shoppingList.items.length).toBeGreaterThan(0);
  });

  it('tells its listeners of the changes a visitor can make', async () => {
    const api = new MockEdssi(demoScenario);
    const snapshots = vi.fn();
    const stop = api.materials.onChange(snapshots);
    const before = (await api.materials.getSnapshot()).version;
    await api.materials.setFavourite('synthesis:fsd:1', true);
    expect(snapshots).toHaveBeenCalledOnce();
    const after = await api.materials.getSnapshot();
    expect(after.favourites).toContain('synthesis:fsd:1');
    expect(after.version).toBe(before + 1);
    stop();
    await api.materials.addTodo({ kind: 'synthesis', synthesis: 'FSD', counts: [1, 0, 0] });
    expect(snapshots).toHaveBeenCalledOnce();
    expect((await api.materials.getSnapshot()).todos.at(-1)?.id).toMatch(/^mock-/);
  });

  it('answers what needs the real EDSSI with why not', async () => {
    const api = new MockEdssi(demoScenario);
    expect(await api.commodities.search({} as never)).toEqual({ error: DEMO_ONLY });
    expect(await api.csvRoute.open()).toBe(DEMO_ONLY);
    expect(await api.edsm.getSystem('Nowhere')).toEqual({ name: 'Nowhere', status: 'unknown' });
  });

  it('has the assistant answer a question, after thinking', async () => {
    vi.useFakeTimers();
    try {
      const api = new MockEdssi(demoScenario);
      const phases: string[] = [];
      api.assistant.onChange((snapshot) => phases.push(snapshot.phase));
      await api.assistant.ask('Where is the nearest neutron star?');
      expect(phases).toEqual(['thinking']);
      await vi.runAllTimersAsync();
      expect(phases).toEqual(['thinking', 'idle']);
      const transcript = (await api.assistant.getSnapshot()).transcript;
      expect(transcript.at(-2)?.text).toBe('Where is the nearest neutron star?');
      expect(transcript.at(-1)?.role).toBe('assistant');
    } finally {
      vi.useRealTimers();
    }
  });
});
