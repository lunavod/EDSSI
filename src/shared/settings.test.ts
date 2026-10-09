import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  defaultSettings,
  extensionSettings,
  parseSettings,
  registerSettingsSections,
  settingTypes,
} from './settings';

describe('parseSettings', () => {
  it('runs on defaults when the file is empty', () => {
    const { settings, problem } = parseSettings(null);
    expect(problem).toBeUndefined();
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.assistant.model).toBe('gpt-5.6-luna');
    expect(settings.assistant.reasoning_effort).toBe('low');
    expect(settings.assistant.ultrathink).toEqual({
      model: 'gpt-5.6-terra',
      reasoning_effort: 'high',
    });
    expect(settings.inworld.voice).toBe('Ashley');
  });

  it('fills in the sections a partial file leaves out', () => {
    const { settings, problem } = parseSettings({ assistant: { provider: 'codex' } });
    expect(problem).toBeUndefined();
    expect(settings.assistant.provider).toBe('codex');
    expect(settings.assistant.model).toBe('gpt-5.6-luna');
    expect(settings.voice.transcription.model).toBe('gpt-transcribe');
  });

  it('treats a key written with no value as unset', () => {
    // `api_key:` on its own is null in YAML, and users write it that way constantly.
    const { settings, problem } = parseSettings({
      openai: { api_key: null },
      assistant: null,
      inworld: { voice: '  ' },
    });
    expect(problem).toBeUndefined();
    expect(settings.openai.api_key).toBeUndefined();
    expect(settings.assistant.enabled).toBe(true);
    expect(settings.inworld.voice).toBe('Ashley');
  });

  it('keeps the defaults and explains itself when a value is wrong', () => {
    const { settings, problem } = parseSettings({ assistant: { provider: 'anthropic' } });
    expect(problem).toContain('provider');
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps uploads on but idle until a key is filled in', () => {
    const { settings } = parseSettings({ edsm: { api_key: null }, inara: null });
    expect(settings.edsm).toEqual({ upload: true, commander_name: undefined, api_key: undefined });
    expect(settings.inara).toEqual({ upload: true, api_key: undefined });
  });

  it('reads the template as the defaults', async () => {
    const { parse } = await import('yaml');
    const { SETTINGS_TEMPLATE } = await import('./settings');
    expect(parseSettings(parse(SETTINGS_TEMPLATE)).problem).toBeUndefined();
  });

  it('takes the keywords the commander lists for transcription', () => {
    const { settings } = parseSettings({ voice: { transcription: { keywords: ['Deciat'] } } });
    expect(settings.voice.transcription.keywords).toEqual(['Deciat']);
  });
});

describe('push-to-talk bindings', () => {
  it('binds Control+Alt+Space until something else is bound', () => {
    expect(parseSettings(null).settings.voice.push_to_talk).toEqual([
      { kind: 'key', accelerator: 'Control+Alt+Space' },
    ]);
    expect(parseSettings(null).settings.voice.hold_to_talk).toBe(true);
  });

  it('reads a bare string as a key chord, the way older files wrote it', () => {
    const { settings, problem } = parseSettings({
      voice: { push_to_talk: 'Control+Alt+Space' },
    });
    expect(problem).toBeUndefined();
    expect(settings.voice.push_to_talk).toEqual([
      { kind: 'key', accelerator: 'Control+Alt+Space' },
    ]);
  });

  it('reads a key and a stick button together', () => {
    const { settings, problem } = parseSettings({
      voice: {
        push_to_talk: [
          { key: 'F13' },
          { device: 'Gladiator EVO R', vendor_id: 8989, product_id: 512, byte: 4, bit: 3 },
        ],
      },
    });
    expect(problem).toBeUndefined();
    expect(settings.voice.push_to_talk).toEqual([
      { kind: 'key', accelerator: 'F13' },
      {
        kind: 'button',
        vendorId: 8989,
        productId: 512,
        serial: undefined,
        product: 'Gladiator EVO R',
        // Left out of the file, so the device sends unnumbered reports.
        reportId: 0,
        byte: 4,
        bit: 3,
      },
    ]);
  });

  it('takes an empty list as push-to-talk being switched off', () => {
    const { settings, problem } = parseSettings({ voice: { push_to_talk: [] } });
    expect(problem).toBeUndefined();
    expect(settings.voice.push_to_talk).toEqual([]);
  });

  it('keeps the defaults when a binding makes no sense', () => {
    // A bit outside a byte can never be read, so the file is wrong rather than unusual.
    const { problem } = parseSettings({
      voice: { push_to_talk: [{ vendor_id: 1, product_id: 2, byte: 4, bit: 9 }] },
    });
    expect(problem).toBeDefined();
  });
});

describe('VR cockpit bindings', () => {
  it('binds nothing until the commander binds something', () => {
    expect(parseSettings(null).settings.vr.bindings).toEqual({});
  });

  it('reads a stick control against a command, however the command is spelt', () => {
    const { settings, problem } = parseSettings({
      vr: {
        bindings: {
          scroll_up: {
            device: 'Gladiator EVO R',
            vendor_id: 8989,
            product_id: 512,
            usage_page: 1,
            usage: 0x34,
            mode: 'axis',
            direction: 'high',
          },
          toggle: [{ key: 'Control+Shift+H' }],
        },
      },
    });
    expect(problem).toBeUndefined();
    expect(settings.vr.bindings).toEqual({
      scrollUp: [
        {
          binding: {
            kind: 'control',
            vendorId: 8989,
            productId: 512,
            serial: undefined,
            product: 'Gladiator EVO R',
            usagePage: 1,
            usage: 0x34,
            mode: 'axis',
            direction: 'high',
          },
        },
      ],
      toggle: [{ binding: { kind: 'key', accelerator: 'Control+Shift+H' } }],
    });
  });

  it('carries how a control has to be pressed', () => {
    const { settings } = parseSettings({
      vr: {
        bindings: {
          place: [
            {
              vendor_id: 1,
              product_id: 2,
              usage_page: 9,
              usage: 35,
              mode: 'button',
              clicks: 2,
            },
          ],
          scrollDown: [{ key: 'PageDown', repeat: false }],
        },
      },
    });
    expect(settings.vr.bindings.place?.[0]?.clicks).toBe(2);
    expect(settings.vr.bindings.scrollDown?.[0]?.repeat).toBe(false);
    // Nothing said about the other half, so the command's own default still applies.
    expect(settings.vr.bindings.place?.[0]?.repeat).toBeUndefined();
  });

  it('leaves out a name that is not a command, and keeps the rest of the file', () => {
    const { settings, problem } = parseSettings({
      vr: { bindings: { wibble: [{ key: 'F13' }], toggle: [{ key: 'F14' }] } },
    });
    expect(problem).toBeUndefined();
    expect(Object.keys(settings.vr.bindings)).toEqual(['toggle']);
  });

  it('takes an emptied command as nothing bound', () => {
    const { settings } = parseSettings({ vr: { bindings: { toggle: [] } } });
    expect(settings.vr.bindings.toggle).toBeUndefined();
  });
});

describe('extension sections', () => {
  const { section, text, number } = settingTypes;
  const schema = section({ folder: text(), threads: number(0, 0, 8) });

  it('reads a section an extension registered, and leaves the rest alone', () => {
    // Unregistered, the section is dropped like any unknown key, and only its defaults are known.
    const before = parseSettings({ extra: { folder: 'D:/x' } }).settings;
    expect(extensionSettings(before, 'extra', schema)).toEqual({ folder: undefined, threads: 0 });

    registerSettingsSections({ extra: schema });
    const { settings, problem } = parseSettings({ extra: { folder: ' D:/x ', threads: null } });
    expect(problem).toBeUndefined();
    expect(extensionSettings(settings, 'extra', schema)).toEqual({ folder: 'D:/x', threads: 0 });
    expect(settings.display).toEqual(DEFAULT_SETTINGS.display);
    expect(extensionSettings(defaultSettings(), 'extra', schema)).toEqual({
      folder: undefined,
      threads: 0,
    });
    expect(parseSettings({ extra: { threads: 99 } }).problem).toBeDefined();
  });

  it("won't take a key the file already has", () => {
    expect(() => registerSettingsSections({ display: schema })).toThrow();
  });
});
