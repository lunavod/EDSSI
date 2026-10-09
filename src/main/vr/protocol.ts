/**
 * The framing EDSSI speaks to `tools/vr-overlay-host` over its stdin. One pipe carries the pixels
 * for every panel and the state of the whole rig, so each message is length-prefixed and tagged:
 *
 *     magic: u8 (0xED)  kind: u8  length: u32 LE  payload: length bytes
 *
 * A frame's payload names its panel — `u8` id length, the id in utf-8 — then `width: u32 LE`,
 * `height: u32 LE`, then premultiplied BGRA as Chromium painted it; the host swizzles it to the
 * RGBA SteamVR wants. A state payload is JSON describing every panel at once, which is simpler than
 * tracking which of five has changed and keeps the host's idea of the rig whole.
 *
 * A texture payload says the same thing without the pixels: the panel, the size Chromium drew and
 * the size it drew it into, and an NT handle to the D3D11 texture holding it. It is what a frame
 * should be whenever it can — a frame of bytes is megabytes down a pipe and a rebuilt texture at
 * the far end, which is what made the cockpit blink. `MESSAGE_FRAME` remains for the machines that
 * cannot share a texture.
 *
 * Keep this in step with `Protocol` in `tools/vr-overlay-host/Program.cs`.
 */

import type { Matrix34 } from './transform';

export const PROTOCOL_MAGIC = 0xed;
export const MESSAGE_FRAME = 1;
export const MESSAGE_STATE = 2;
export const MESSAGE_TEXTURE = 3;
export const HEADER_BYTES = 6;

/** The host refuses anything larger, taking it as proof the stream has lost its place. */
export const MAX_PAYLOAD_BYTES = 4096 * 4096 * 4;

/** One panel, as the host needs to know it. */
export interface PanelState {
  id: string;
  /** Where it hangs, relative to the anchor. Worked out in `transform.ts`. */
  matrix: Matrix34;
  widthMeters: number;
  alpha: number;
  curvature: number;
  /**
   * Whether looking at this may pick it as the panel the tuning keys act on. Left out means yes.
   * The seam lines hang in the gaps between the panels, so their middles are exactly where a
   * commander looks when glancing from one panel to the next: offered to the gaze, they would win
   * that glance and the keys would have nothing sensible to act on.
   */
  gaze?: boolean;
}

/** Everything the host needs in one message: the rig, and every panel in it. */
export interface RigState {
  /** Whether the cockpit is up at all. */
  visible: boolean;
  lock: 'head' | 'world';
  /** Bumped to ask for the rig to be pinned where the commander is looking now. */
  anchor: number;
  panels: PanelState[];
}

/**
 * One frame of pixels for one panel. The bitmap is copied rather than referenced: the message
 * carries a header in front of it, and the pipe may still be writing it when the next paint
 * arrives.
 */
export function frameMessage(panel: string, width: number, height: number, bitmap: Buffer): Buffer {
  const expected = width * height * 4;
  if (bitmap.length !== expected) {
    throw new Error(`a ${width}x${height} frame needs ${expected} bytes, not ${bitmap.length}`);
  }

  const id = Buffer.from(panel, 'utf8');
  if (id.length === 0 || id.length > 255) throw new Error(`"${panel}" is not a usable panel id`);

  const message = Buffer.allocUnsafe(HEADER_BYTES + 1 + id.length + 8 + bitmap.length);
  writeHeader(message, MESSAGE_FRAME, 1 + id.length + 8 + bitmap.length);
  let at = HEADER_BYTES;
  at = message.writeUInt8(id.length, at);
  at += id.copy(message, at);
  at = message.writeUInt32LE(width, at);
  at = message.writeUInt32LE(height, at);
  bitmap.copy(message, at);
  return message;
}

/** One panel's frame, as the GPU texture Chromium drew it into. */
export interface SharedTexture {
  /** The NT handle, in EDSSI's own process; the host duplicates it into its own. */
  handle: bigint;
  /** Where in the texture the page actually is. Not always the corner, so it is not assumed. */
  x: number;
  y: number;
  /** What the page actually covers, in pixels. */
  width: number;
  height: number;
  /**
   * The texture Chromium allocated, which can be larger than the page: it draws into a pool of
   * textures and reuses one that is big enough rather than one that fits exactly. The overlay has
   * to be told which corner of it to show, or the panel comes out with the padding around it.
   */
  codedWidth: number;
  codedHeight: number;
}

/**
 * One panel's frame as a handle rather than as pixels. Tiny, and the same every time, so unlike a
 * frame it is never worth dropping.
 */
export function textureMessage(panel: string, texture: SharedTexture): Buffer {
  const id = Buffer.from(panel, 'utf8');
  if (id.length === 0 || id.length > 255) throw new Error(`"${panel}" is not a usable panel id`);

  const payload = 1 + id.length + 24 + 8;
  const message = Buffer.allocUnsafe(HEADER_BYTES + payload);
  writeHeader(message, MESSAGE_TEXTURE, payload);
  let at = HEADER_BYTES;
  at = message.writeUInt8(id.length, at);
  at += id.copy(message, at);
  for (const value of [
    texture.x,
    texture.y,
    texture.width,
    texture.height,
    texture.codedWidth,
    texture.codedHeight,
  ]) {
    at = message.writeUInt32LE(value, at);
  }
  message.writeBigUInt64LE(texture.handle, at);
  return message;
}

/** The rig and every panel in it. */
export function stateMessage(state: RigState): Buffer {
  const json = Buffer.from(JSON.stringify(state), 'utf8');
  const message = Buffer.allocUnsafe(HEADER_BYTES + json.length);
  writeHeader(message, MESSAGE_STATE, json.length);
  json.copy(message, HEADER_BYTES);
  return message;
}

function writeHeader(message: Buffer, kind: number, length: number): void {
  if (length > MAX_PAYLOAD_BYTES) throw new Error(`a ${length}-byte message is too large to send`);
  message.writeUInt8(PROTOCOL_MAGIC, 0);
  message.writeUInt8(kind, 1);
  message.writeUInt32LE(length, 2);
}
