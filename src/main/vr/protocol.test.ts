import { describe, expect, it } from 'vitest';

import { DEFAULT_PLACEMENTS } from './panels';
import {
  frameMessage,
  HEADER_BYTES,
  MESSAGE_FRAME,
  MESSAGE_STATE,
  MESSAGE_TEXTURE,
  PROTOCOL_MAGIC,
  type RigState,
  stateMessage,
  textureMessage,
} from './protocol';
import { DEFAULT_RIG } from './rig';
import { panelMatrix } from './transform';

/** Reads a message back the way `tools/vr-overlay-host` does, so the two stay in step. */
function readHeader(message: Buffer): { magic: number; kind: number; length: number } {
  return {
    magic: message.readUInt8(0),
    kind: message.readUInt8(1),
    length: message.readUInt32LE(2),
  };
}

describe('frameMessage', () => {
  it('names its panel, then the size, then the pixels', () => {
    const bitmap = Buffer.alloc(2 * 3 * 4, 7);
    const message = frameMessage('sidebar', 2, 3, bitmap);

    expect(readHeader(message)).toEqual({
      magic: PROTOCOL_MAGIC,
      kind: MESSAGE_FRAME,
      length: 1 + 'sidebar'.length + 8 + bitmap.length,
    });

    const idLength = message.readUInt8(HEADER_BYTES);
    expect(idLength).toBe('sidebar'.length);
    expect(message.subarray(HEADER_BYTES + 1, HEADER_BYTES + 1 + idLength).toString()).toBe(
      'sidebar',
    );
    const at = HEADER_BYTES + 1 + idLength;
    expect(message.readUInt32LE(at)).toBe(2);
    expect(message.readUInt32LE(at + 4)).toBe(3);
    expect(message.subarray(at + 8)).toEqual(bitmap);
  });

  it('copies the bitmap, so a later paint cannot change a message in flight', () => {
    const bitmap = Buffer.alloc(4, 1);
    const message = frameMessage('main', 1, 1, bitmap);
    bitmap.fill(9);
    expect(message.subarray(message.length - 4)).toEqual(Buffer.alloc(4, 1));
  });

  it('refuses a bitmap that does not match the size it claims', () => {
    expect(() => frameMessage('main', 4, 4, Buffer.alloc(8))).toThrow(/needs 64 bytes/);
  });

  it('refuses a panel id that could not be framed', () => {
    expect(() => frameMessage('', 1, 1, Buffer.alloc(4))).toThrow(/not a usable panel id/);
    expect(() => frameMessage('x'.repeat(256), 1, 1, Buffer.alloc(4))).toThrow(/panel id/);
  });
});

describe('stateMessage', () => {
  it('carries the rig and every panel as JSON the host can read', () => {
    const state: RigState = {
      visible: true,
      lock: 'world',
      anchor: 3,
      panels: [
        {
          id: 'main',
          matrix: panelMatrix(DEFAULT_RIG, DEFAULT_PLACEMENTS, 'main'),
          widthMeters: 1.6,
          alpha: 1,
          curvature: 0,
        },
      ],
    };
    const message = stateMessage(state);
    const header = readHeader(message);

    expect(header.magic).toBe(PROTOCOL_MAGIC);
    expect(header.kind).toBe(MESSAGE_STATE);
    expect(message.length).toBe(HEADER_BYTES + header.length);

    const decoded = JSON.parse(message.subarray(HEADER_BYTES).toString('utf8'));
    expect(decoded.anchor).toBe(3);
    expect(decoded.panels).toHaveLength(1);
    // Twelve numbers, which is what the host reads into an HmdMatrix34_t.
    expect(decoded.panels[0].matrix).toHaveLength(12);
  });
});

describe('textureMessage', () => {
  const texture = {
    handle: 0xfedc_ba98_7654_3210n,
    x: 8,
    y: 16,
    width: 1480,
    height: 1040,
    codedWidth: 1536,
    codedHeight: 1080,
  };

  /** Read back the way `TextureFrame.Parse` in the host does, so the two stay in step. */
  function read(message: Buffer) {
    const header = readHeader(message);
    let at = HEADER_BYTES;
    const idLength = message.readUInt8(at);
    at += 1;
    const panel = message.subarray(at, at + idLength).toString('utf8');
    at += idLength;
    const numbers: number[] = [];
    for (let i = 0; i < 6; i++, at += 4) numbers.push(message.readUInt32LE(at));
    return { header, panel, numbers, handle: message.readBigUInt64LE(at) };
  }

  it('says which panel, where in the texture, and which texture', () => {
    const read_ = read(textureMessage('main', texture));
    expect(read_.header.magic).toBe(PROTOCOL_MAGIC);
    expect(read_.header.kind).toBe(MESSAGE_TEXTURE);
    expect(read_.panel).toBe('main');
    expect(read_.numbers).toEqual([8, 16, 1480, 1040, 1536, 1080]);
  });

  it('carries a handle with the top bit set', () => {
    // A 64-bit handle is unsigned; read as signed it would come back negative and open nothing.
    expect(read(textureMessage('main', texture)).handle).toBe(0xfedc_ba98_7654_3210n);
  });

  it('is the length its header claims, so the stream keeps its place', () => {
    const message = textureMessage('comms', texture);
    expect(message.length).toBe(HEADER_BYTES + readHeader(message).length);
    // Tiny, whatever the panel: this is why a texture is never worth dropping the way a frame is.
    expect(message.length).toBeLessThan(64);
  });

  it('refuses a panel id it cannot frame', () => {
    expect(() => textureMessage('', texture)).toThrow();
    expect(() => textureMessage('p'.repeat(256), texture)).toThrow();
  });
});
