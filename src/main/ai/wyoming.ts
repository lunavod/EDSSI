/**
 * Wyoming, the protocol Home Assistant's voice servers speak (wyoming-piper, wyoming-faster-whisper
 * and the rest): events over a TCP socket, each a line of JSON naming its `type`, then `data_length`
 * bytes of JSON data and `payload_length` bytes of payload (audio, for the events that carry it).
 * One connection per request, as Home Assistant does it.
 *
 * Speaking: `synthesize` with the text, answered by `audio-start`, `audio-chunk`s of PCM and
 * `audio-stop`. Listening: `transcribe`, then the audio as `audio-start`, `audio-chunk`s and
 * `audio-stop`, answered by a `transcript`.
 */

import { connect, type Socket } from 'node:net';

/** What EDSSI says it speaks; the framing hasn't changed since data moved out of the header. */
const VERSION = '1.8.0';

/** Nothing heard from the server for this long and the request is given up. */
const TIMEOUT_MS = 30_000;

/** Audio is sent in pieces of about this long, as a microphone would send it. */
const CHUNK_SAMPLES = 1024;

export interface WyomingEvent {
  type: string;
  data: Record<string, unknown>;
  payload?: Uint8Array;
}

export interface WyomingAddress {
  host: string;
  port: number;
}

/** `tcp://host:port`, the way Home Assistant writes a Wyoming server's address. */
export function parseWyomingUri(uri: string): WyomingAddress {
  let url: URL;
  try {
    url = new URL(uri.includes('://') ? uri : `tcp://${uri}`);
  } catch {
    throw new Error(`${uri} isn't a Wyoming address; write it as tcp://host:port.`);
  }
  if (url.protocol !== 'tcp:') throw new Error(`${uri}: Wyoming servers are reached over tcp://.`);
  const port = Number(url.port);
  if (!url.hostname || !Number.isInteger(port) || port <= 0) {
    throw new Error(`${uri} needs a host and a port, e.g. tcp://127.0.0.1:10200.`);
  }
  // A literal IPv6 address keeps its brackets in a URL, which `connect` doesn't want.
  return { host: url.hostname.replace(/^\[(.*)\]$/u, '$1'), port };
}

export function encodeEvent(event: WyomingEvent): Uint8Array {
  const header: Record<string, unknown> = { type: event.type, version: VERSION };
  const data =
    Object.keys(event.data).length > 0 ? Buffer.from(JSON.stringify(event.data)) : undefined;
  if (data) header['data_length'] = data.length;
  if (event.payload?.length) header['payload_length'] = event.payload.length;
  return Buffer.concat([
    Buffer.from(`${JSON.stringify(header)}\n`),
    ...(data ? [data] : []),
    ...(event.payload?.length ? [event.payload] : []),
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Collects bytes off the socket and hands back whole events, holding back a partial one. */
export class EventReader {
  #buffer: Buffer = Buffer.alloc(0);

  push(bytes: Uint8Array): WyomingEvent[] {
    this.#buffer = Buffer.concat([this.#buffer, bytes]);
    const events: WyomingEvent[] = [];
    for (;;) {
      const newline = this.#buffer.indexOf(0x0a);
      if (newline < 0) break;
      const header: unknown = JSON.parse(this.#buffer.subarray(0, newline).toString('utf8'));
      if (!isRecord(header) || typeof header['type'] !== 'string') {
        throw new Error('The Wyoming server sent something that isn’t an event.');
      }
      const dataLength = typeof header['data_length'] === 'number' ? header['data_length'] : 0;
      const payloadLength =
        typeof header['payload_length'] === 'number' ? header['payload_length'] : 0;
      const end = newline + 1 + dataLength + payloadLength;
      if (this.#buffer.length < end) break;

      // Data may ride in the header (older servers), after it, or both; the two are merged.
      const data = isRecord(header['data']) ? { ...header['data'] } : {};
      if (dataLength > 0) {
        const extra: unknown = JSON.parse(
          this.#buffer.subarray(newline + 1, newline + 1 + dataLength).toString('utf8'),
        );
        if (isRecord(extra)) Object.assign(data, extra);
      }
      events.push({
        type: header['type'],
        data,
        ...(payloadLength > 0
          ? { payload: Uint8Array.from(this.#buffer.subarray(end - payloadLength, end)) }
          : {}),
      });
      this.#buffer = this.#buffer.subarray(end);
    }
    return events;
  }
}

/**
 * One exchange with a server: sends `events`, then hands each event that comes back to `onEvent`
 * until it says it has what it wanted (by returning true). Rejects on an `error` event, a closed
 * connection, silence, or `signal`.
 */
export function exchange(
  address: WyomingAddress,
  events: readonly WyomingEvent[],
  onEvent: (event: WyomingEvent) => boolean,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const socket: Socket = connect(address);
    const reader = new EventReader();
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      socket.destroy();
      if (error === undefined) resolve();
      else
        reject(
          error instanceof Error
            ? error
            : new Error('The Wyoming request failed.', { cause: error }),
        );
    };
    const abort = (): void => finish(signal.reason);
    signal.addEventListener('abort', abort, { once: true });

    socket.setTimeout(TIMEOUT_MS, () =>
      finish(new Error(`The Wyoming server at ${address.host}:${address.port} stopped answering.`)),
    );
    socket.on('connect', () => {
      for (const event of events) socket.write(encodeEvent(event));
    });
    socket.on('data', (bytes: Buffer) => {
      try {
        for (const event of reader.push(bytes)) {
          if (event.type === 'error') {
            const text = typeof event.data['text'] === 'string' ? event.data['text'] : 'an error';
            throw new Error(`The Wyoming server said: ${text}`);
          }
          if (onEvent(event)) {
            finish();
            return;
          }
        }
      } catch (error) {
        finish(error);
      }
    });
    socket.on('error', (error) =>
      finish(
        new Error(
          `Couldn’t reach the Wyoming server at ${address.host}:${address.port}: ${error.message}`,
        ),
      ),
    );
    socket.on('close', () =>
      finish(new Error('The Wyoming server hung up before it had finished.')),
    );
  });
}

/** The PCM format of an audio event: samples a second, bytes a sample, channels. */
export interface AudioFormat {
  rate: number;
  width: number;
  channels: number;
}

function audioFormat(data: Record<string, unknown>): AudioFormat | undefined {
  const { rate, width, channels } = data;
  if (typeof rate !== 'number' || typeof width !== 'number' || typeof channels !== 'number') {
    return undefined;
  }
  return { rate, width, channels };
}

/** 16-bit PCM down to one channel, by averaging; one channel passes straight through. */
export function toMono16(pcm: Uint8Array, format: AudioFormat): Uint8Array {
  if (format.width !== 2) {
    throw new Error(`The Wyoming server sends ${format.width * 8}-bit audio; only 16-bit plays.`);
  }
  if (format.channels === 1) return pcm;
  const frames = Math.floor(pcm.length / (2 * format.channels));
  const input = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const output = new Uint8Array(frames * 2);
  const view = new DataView(output.buffer);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel++) {
      sum += input.getInt16((frame * format.channels + channel) * 2, true);
    }
    view.setInt16(frame * 2, Math.round(sum / format.channels), true);
  }
  return output;
}

/**
 * Reads `text` aloud on a Wyoming server, handing on its mono 16-bit PCM and the rate it is at
 * (Piper's voices are mostly 22,050 Hz). `voice` unset is the server's own default.
 */
export async function wyomingSpeak(
  address: WyomingAddress,
  text: string,
  voice: string | undefined,
  onAudio: (pcm: Uint8Array, rate: number) => void,
  signal: AbortSignal,
): Promise<void> {
  let format: AudioFormat | undefined;
  const speaking = exchange(
    address,
    [{ type: 'synthesize', data: { text, ...(voice ? { voice: { name: voice } } : {}) } }],
    (event) => {
      if (event.type === 'audio-start') format = audioFormat(event.data);
      if (event.type === 'audio-chunk' && event.payload) {
        // Each chunk carries its format too, which is all a server that skips audio-start sends.
        const chunkFormat = audioFormat(event.data) ?? format;
        if (!chunkFormat)
          throw new Error('The Wyoming server sent audio without saying its format.');
        onAudio(toMono16(event.payload, chunkFormat), chunkFormat.rate);
      }
      return event.type === 'audio-stop';
    },
    signal,
  );
  try {
    await speaking;
  } catch (error) {
    // Piper's whole complaint about a voice it doesn't have is the voice's name.
    if (voice && error instanceof Error && error.message.endsWith(`said: ${voice}`)) {
      throw new Error(`The Wyoming server has no voice called ${voice}.`, { cause: error });
    }
    throw error;
  }
}

/** Turns 16 kHz mono 16-bit PCM into text on a Wyoming server. */
export async function wyomingTranscribe(
  address: WyomingAddress,
  pcm: Uint8Array,
  language: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  const format = { rate: 16_000, width: 2, channels: 1 };
  const chunks: WyomingEvent[] = [];
  const step = CHUNK_SAMPLES * 2;
  for (let at = 0; at < pcm.length; at += step) {
    chunks.push({ type: 'audio-chunk', data: format, payload: pcm.subarray(at, at + step) });
  }
  let text = '';
  await exchange(
    address,
    [
      { type: 'transcribe', data: language ? { language } : {} },
      { type: 'audio-start', data: format },
      ...chunks,
      { type: 'audio-stop', data: {} },
    ],
    (event) => {
      if (event.type !== 'transcript') return false;
      text = typeof event.data['text'] === 'string' ? event.data['text'] : '';
      return true;
    },
    signal,
  );
  return text.trim();
}
