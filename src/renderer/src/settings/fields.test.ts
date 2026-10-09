import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../../shared/settings';
import {
  defaultAt,
  effectiveValue,
  type Field,
  fieldKey,
  hidden,
  holds,
  locate,
  mergePatches,
  PAGE_IDS,
  PAGES,
  patchFor,
  problemWith,
  search,
  speakingProvider,
} from './fields';

// The settings' own pages; a guide (Quickstart) borrows fields from them.
const FIELDS = PAGES.filter((page) => !page.guide).flatMap((page) =>
  page.sections.flatMap((section) => section.fields),
);

/** Every leaf of the settings, by dotted path. */
function leaves(value: unknown, path: string[] = []): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [path.join('.')];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]));
}

function field(key: string): Field {
  const match = locate(key);
  if (!match) throw new Error(`no field ${key}`);
  return match.field;
}

function keys(query: string): string[] {
  return search(query).map((match) => fieldKey(match.field));
}

describe('the pages', () => {
  it('put every setting on the screen once', () => {
    const shown = FIELDS.map(fieldKey);
    expect(new Set(shown).size).toBe(shown.length);
    // Bindings are made by pressing them, in their own panels, rather than as fields: push-to-talk
    // on the Voice page, paste on the Routes one and the cockpit's commands on the VR one.
    const settings = leaves(DEFAULT_SETTINGS).filter(
      (key) =>
        key !== 'voice.push_to_talk' && key !== 'input.paste' && !key.startsWith('vr.bindings'),
    );
    expect(shown).toEqual(expect.arrayContaining(settings));
    // Text with no default (keys, names) is left out of the parsed defaults, so only its section
    // can be checked.
    for (const candidate of FIELDS) {
      expect(defaultAt(candidate.path.slice(0, -1)), fieldKey(candidate)).toBeTypeOf('object');
    }
  });

  it('borrow every Quickstart field from its own page, and leave the guide out of search', () => {
    const guide = PAGES.find((page) => page.id === 'quickstart')!;
    expect(guide.guide).toBe(true);
    const own = new Set(FIELDS.map(fieldKey));
    for (const section of guide.sections) {
      for (const candidate of section.fields)
        expect(own, fieldKey(candidate)).toContain(fieldKey(candidate));
    }
    const found = search('kokoro voice').map((match) => match.page.id);
    expect(found.length).toBeGreaterThan(0);
    expect(found).not.toContain('quickstart');
  });

  it('have a page for every id, and the binding panels on theirs', () => {
    expect(PAGES.map((page) => page.id)).toEqual([...PAGE_IDS]);
    const panels = PAGES.flatMap((page) => page.sections.map((section) => section.panel));
    // None can be a field: each is bound by pressing, which needs a panel of its own.
    expect(panels).toContain('bindings');
    expect(panels).toContain('paste-bindings');
    expect(panels).toContain('vr-bindings');
  });

  it('only depend on settings that exist', () => {
    const known = new Set(leaves(DEFAULT_SETTINGS));
    for (const page of PAGES) {
      for (const section of page.sections) {
        const conditions = [section.when, ...section.fields.map((candidate) => candidate.when)];
        for (const condition of conditions) {
          if (condition) expect(known).toContain(condition.path.join('.'));
        }
      }
    }
  });

  it('show every default within its own range', () => {
    for (const candidate of FIELDS) {
      expect(
        problemWith(candidate, defaultAt(candidate.path)),
        fieldKey(candidate),
      ).toBeUndefined();
    }
  });
});

describe('effectiveValue', () => {
  it('takes the draft over the file, and null or empty text as the default', () => {
    const path = ['assistant', 'model'];
    expect(effectiveValue('a', path)).toBe('a');
    expect(effectiveValue('a', path, 'b')).toBe('b');
    expect(effectiveValue('a', path, null)).toBe(DEFAULT_SETTINGS.assistant.model);
    expect(effectiveValue('a', path, '')).toBe(DEFAULT_SETTINGS.assistant.model);
  });
});

describe('problemWith', () => {
  it('checks numbers in the units they are shown in', () => {
    const zoom = field('display.zoom');
    expect(problemWith(zoom, 1.25)).toBeUndefined();
    expect(problemWith(zoom, 0.4)).toMatch(/between 50 and 300/i);
    expect(problemWith(field('flight_alerts.low_fuel_fraction'), 0.15)).toBeUndefined();
  });

  it('leaves an empty value alone, as that is the default', () => {
    expect(problemWith(field('display.zoom'), null)).toBeUndefined();
    expect(problemWith(field('openai.base_url'), '')).toBeUndefined();
  });

  it('runs a field’s own check', () => {
    expect(problemWith(field('openai.base_url'), 'https://gateway.example/v1')).toBeUndefined();
    expect(problemWith(field('openai.base_url'), 'gateway')).toBeDefined();
    expect(problemWith(field('voice.transcription.language'), 'en')).toBeUndefined();
    expect(problemWith(field('voice.transcription.language'), 'English')).toBeDefined();
  });
});

describe('hidden', () => {
  it('leaves out a field whose condition hides it, and only while it doesn’t hold', () => {
    const field = (provider: string) =>
      PAGES.flatMap((page) => page.sections)
        .flatMap((section) => section.fields)
        .find((candidate) => candidate.path.join('.') === `${provider}.voice`)!;
    const speakingBy =
      (provider: string, inworldKey?: string) =>
      (path: readonly string[]): unknown =>
        path.join('.') === 'voice.speech.provider'
          ? provider
          : path.join('.') === 'inworld.api_key'
            ? inworldKey
            : undefined;
    expect(hidden(field('kokoro'), speakingBy('inworld'))).toBe(true);
    expect(hidden(field('kokoro'), speakingBy('kokoro'))).toBe(false);
    // Auto shows only the provider it comes to: Kokoro until Inworld has a key, then Inworld.
    expect(hidden(field('kokoro'), speakingBy('auto'))).toBe(false);
    expect(hidden(field('inworld'), speakingBy('auto'))).toBe(true);
    expect(hidden(field('inworld'), speakingBy('auto', 'key'))).toBe(false);
    expect(hidden(field('kokoro'), speakingBy('auto', 'key'))).toBe(true);
    expect(hidden(field('wyoming'), speakingBy('auto'))).toBe(true);
  });
});

describe('the Quickstart page', () => {
  const at =
    (values: Record<string, unknown>) =>
    (path: readonly string[]): unknown =>
      values[path.join('.')];
  const guide = PAGES.find((page) => page.id === 'quickstart')!;
  const key = guide.sections
    .flatMap((section) => section.fields)
    .find((candidate) => fieldKey(candidate) === 'openai.api_key')!;

  it('asks for the OpenAI key only where something uses it', () => {
    const plan = { 'assistant.provider': 'codex' };
    expect(hidden(key, at({ ...plan, 'voice.transcription.provider': 'whisper' }))).toBe(true);
    // Hearing through OpenAI needs the key even on the ChatGPT plan.
    expect(hidden(key, at({ ...plan, 'voice.transcription.provider': 'openai' }))).toBe(false);
    expect(hidden(key, at({ 'assistant.provider': 'openai' }))).toBe(false);
  });

  it('marks the provider Auto comes to', () => {
    expect(speakingProvider(at({ 'voice.speech.provider': 'auto' }))).toBe('kokoro');
    expect(
      speakingProvider(at({ 'voice.speech.provider': 'auto', 'inworld.api_key': 'key' })),
    ).toBe('inworld');
    expect(speakingProvider(at({ 'voice.speech.provider': 'wyoming' }))).toBe('wyoming');
  });
});

describe('holds', () => {
  it('is true without a condition, and otherwise asks the getter', () => {
    const condition = { path: ['voice', 'speech', 'provider'], is: ['inworld'], note: '' };
    expect(holds(undefined, () => undefined)).toBe(true);
    expect(holds(condition, () => 'inworld')).toBe(true);
    expect(holds(condition, () => 'kokoro')).toBe(false);
  });
});

describe('search', () => {
  it('finds fields by label, help, section or key, needing every word', () => {
    expect(keys('inworld api key')).toEqual(['inworld.api_key']);
    expect(keys('max tool rounds')).toEqual(['assistant.max_tool_rounds']);
    expect(keys('ultrathink reasoning')).toEqual(['assistant.ultrathink.reasoning_effort']);
    expect(keys('   ')).toEqual([]);
    expect(keys('nothing like this')).toEqual([]);
  });
});

describe('patches', () => {
  it('builds only the branch a field lives in, and merges them', () => {
    expect(
      mergePatches([
        patchFor(['voice', 'speech', 'speed'], 1.2),
        patchFor(['voice', 'hold_to_talk'], false),
        patchFor(['openai', 'api_key'], null),
      ]),
    ).toEqual({
      voice: { speech: { speed: 1.2 }, hold_to_talk: false },
      openai: { api_key: null },
    });
  });
});
