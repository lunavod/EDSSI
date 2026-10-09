import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { parseSettings } from '../../shared/settings';
import { saveSettings } from './save';

let path: string;

beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), 'edssi-settings-')), 'config.yaml');
});

function write(text: string): void {
  writeFileSync(path, text, 'utf8');
}

function read(): string {
  return readFileSync(path, 'utf8');
}

describe('saveSettings', () => {
  it('leaves the commander’s comments and the rest of the file alone', () => {
    write(`# my settings
openai:
  # the key I pay with
  api_key: sk-old

assistant:
  model: gpt-5.6-luna
`);
    saveSettings(path, { openai: { api_key: 'sk-new' } });

    const text = read();
    expect(text).toContain('# my settings');
    expect(text).toContain('# the key I pay with');
    expect(text).toContain('sk-new');
    expect(text).not.toContain('sk-old');
    expect(text).toContain('model: gpt-5.6-luna');
  });

  it('creates a section the file does not have yet', () => {
    write('assistant:\n  model: gpt-5.6-luna\n');
    saveSettings(path, { voice: { speech: { speed: 1.2 } } });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the file this test wrote
    expect(parse(read()) as { voice: { speech: { speed: number } } }).toMatchObject({
      voice: { speech: { speed: 1.2 } },
    });
  });

  it('removes a field set to null, so it goes back to its default', () => {
    write('inworld:\n  voice: Wendy\n');
    saveSettings(path, { inworld: { voice: null } });
    expect(read()).not.toContain('Wendy');
    expect(parseSettings(parse(read())).settings.inworld.voice).toBe('Ashley');
  });

  it('writes bindings in the shape the schema reads back', () => {
    write('# bindings\n');
    saveSettings(path, {
      voice: {
        push_to_talk: [
          { kind: 'key', accelerator: 'Control+Alt+Space' },
          {
            kind: 'button',
            vendorId: 0x231d,
            productId: 0x0200,
            product: 'VKBsim Gladiator EVO R',
            reportId: 1,
            byte: 4,
            bit: 3,
          },
        ],
      },
    });

    const { settings, problem } = parseSettings(parse(read()));
    expect(problem).toBeUndefined();
    expect(settings.voice.push_to_talk).toEqual([
      { kind: 'key', accelerator: 'Control+Alt+Space' },
      {
        kind: 'button',
        vendorId: 0x231d,
        productId: 0x0200,
        serial: undefined,
        product: 'VKBsim Gladiator EVO R',
        reportId: 1,
        byte: 4,
        bit: 3,
      },
    ]);
  });

  it('replaces a list rather than merging into it', () => {
    write('voice:\n  push_to_talk:\n    - key: Control+Alt+Space\n    - key: F13\n');
    saveSettings(path, { voice: { push_to_talk: [{ kind: 'key', accelerator: 'F13' }] } });
    expect(parseSettings(parse(read())).settings.voice.push_to_talk).toEqual([
      { kind: 'key', accelerator: 'F13' },
    ]);
  });

  it('writes a cockpit command’s bindings, and how each is pressed', () => {
    saveSettings(path, {
      vr: {
        bindings: {
          place: [
            {
              binding: {
                kind: 'control',
                vendorId: 8989,
                productId: 512,
                product: 'Gladiator EVO R',
                usagePage: 9,
                usage: 35,
                mode: 'button',
              },
              clicks: 2,
            },
          ],
        },
      },
    });

    const text = read();
    expect(text).toContain('usage: 35');
    expect(text).toContain('clicks: 2');
    expect(parseSettings(parse(text)).settings.vr.bindings.place).toEqual([
      {
        binding: {
          kind: 'control',
          vendorId: 8989,
          productId: 512,
          serial: undefined,
          product: 'Gladiator EVO R',
          usagePage: 9,
          usage: 35,
          mode: 'button',
        },
        clicks: 2,
      },
    ]);
  });

  it('writes the paste bindings with how each is pressed', () => {
    const binding = {
      kind: 'control',
      vendorId: 8989,
      productId: 512,
      product: 'Gladiator EVO R',
      usagePage: 9,
      usage: 12,
      mode: 'button',
    } as const;
    saveSettings(path, { input: { paste: [{ binding, clicks: 3 }] } });

    const text = read();
    expect(text).toContain('clicks: 3');
    expect(parseSettings(parse(text)).settings.input.paste).toEqual([
      { binding: { ...binding, serial: undefined }, clicks: 3 },
    ]);
  });

  it('clears a cockpit command that has been emptied, rather than leaving an empty list', () => {
    write('vr:\n  bindings:\n    toggle:\n      - key: F13\n');
    saveSettings(path, { vr: { bindings: { toggle: null } } });
    expect(read()).not.toContain('F13');
    expect(parseSettings(parse(read())).settings.vr.bindings.toggle).toBeUndefined();
  });

  it('starts a fresh file when there is none, and when the old one is broken', () => {
    saveSettings(path, { assistant: { model: 'gpt-5.6-luna' } });
    expect(parseSettings(parse(read())).settings.assistant.model).toBe('gpt-5.6-luna');

    write('assistant: [this is: not valid\n');
    saveSettings(path, { assistant: { model: 'rescued' } });
    expect(parseSettings(parse(read())).settings.assistant.model).toBe('rescued');
  });
});
