import { describe, expect, it, vi } from 'vitest';

import {
  IMPLICIT_LAYERS_KEY,
  parseRegistered,
  queryArgs,
  registerArgs,
  setLayerRegistered,
  unregisterArgs,
} from './openxr-layer';

const MANIFEST = 'C:\\EDSSI\\openxr-layer\\edssi_openxr_layer.json';

describe('parseRegistered', () => {
  it('reads an enabled value', () => {
    const output = `\r\n${IMPLICIT_LAYERS_KEY}\r\n    ${MANIFEST}    REG_DWORD    0x0\r\n\r\n`;
    expect(parseRegistered(output)).toBe(true);
  });

  it('reads a disabled value as not registered', () => {
    expect(parseRegistered(`    ${MANIFEST}    REG_DWORD    0x1\r\n`)).toBe(false);
  });
});

describe('setLayerRegistered', () => {
  it('adds the value when it is missing', async () => {
    const run = vi.fn((args: string[]) => Promise.resolve({ ok: args[0] !== 'query', stdout: '' }));
    // The manifest has to exist to be registered; this file does.
    const result = await setLayerRegistered(true, import.meta.filename, run);
    expect(result).toBe('registered');
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      queryArgs(import.meta.filename),
      registerArgs(import.meta.filename),
    ]);
  });

  it('does nothing when it is already as wanted', async () => {
    const run = vi.fn(() =>
      Promise.resolve({ ok: true, stdout: `${MANIFEST}    REG_DWORD    0x0` }),
    );
    expect(await setLayerRegistered(true, MANIFEST, run)).toBe('unchanged');
    expect(run).toHaveBeenCalledOnce();
  });

  it('will not register a manifest that is not there', async () => {
    const run = vi.fn(() => Promise.resolve({ ok: false, stdout: '' }));
    expect(await setLayerRegistered(true, 'C:\\nowhere\\layer.json', run)).toBe('missing');
    expect(run).toHaveBeenCalledOnce();
  });

  it('takes it out', async () => {
    const run = vi.fn((args: string[]) =>
      Promise.resolve({
        ok: true,
        stdout: args[0] === 'query' ? `${MANIFEST}    REG_DWORD    0x0` : '',
      }),
    );
    expect(await setLayerRegistered(false, MANIFEST, run)).toBe('unregistered');
    expect(run.mock.calls[1]?.[0]).toEqual(unregisterArgs(MANIFEST));
  });
});
