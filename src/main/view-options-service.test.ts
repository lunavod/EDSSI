import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultViewOptions } from '../shared/view-options';
import { ViewOptionsStore } from './view-options-service';

vi.mock('electron', () => ({ ipcMain: {}, BrowserWindow: {} }));

const dirs: string[] = [];

function path(): string {
  const dir = mkdtempSync(join(tmpdir(), 'edssi-view-'));
  dirs.push(dir);
  return join(dir, 'view-options.json');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('ViewOptionsStore', () => {
  it('starts at the defaults with no file', () => {
    expect(new ViewOptionsStore(path()).current()).toEqual(defaultViewOptions());
  });

  it('keeps a change across a restart, writing only what differs from the defaults', () => {
    const file = path();
    new ViewOptionsStore(file).set({ 'mission.bio_sort': 'value' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'mission.bio_sort': 'value' });
    expect(new ViewOptionsStore(file).current()['mission.bio_sort']).toBe('value');
  });

  it('ignores what it does not know, from the file or a patch', () => {
    const file = path();
    writeFileSync(file, JSON.stringify({ 'mission.bio_sort': 'colour', 'gone.option': 1 }));
    const store = new ViewOptionsStore(file);
    expect(store.current()).toEqual(defaultViewOptions());
    store.set({ 'materials.missing_show_covered': 'yes' });
    expect(store.current()['materials.missing_show_covered']).toBe(false);
  });

  it('tells its listeners only when something changed', () => {
    const store = new ViewOptionsStore(path());
    const listener = vi.fn();
    store.onChange(listener);
    store.set({ 'mission.bio_sort': 'name' });
    expect(listener).not.toHaveBeenCalled();
    store.set({ 'mission.bio_sort': 'distance' });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ 'mission.bio_sort': 'distance' }),
    );
  });

  it('survives a file that is not JSON', () => {
    const file = path();
    writeFileSync(file, '{');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(new ViewOptionsStore(file).current()).toEqual(defaultViewOptions());
  });
});
