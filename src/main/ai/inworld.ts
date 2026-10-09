/**
 * Speech from Inworld's Realtime TTS (`inworld-tts-2`), streamed over plain HTTP. The endpoint
 * answers with one JSON object per line, each carrying a piece of audio in base64; asking for
 * `PCM` at 24 kHz gives raw 16-bit mono samples the window plays without decoding.
 */

import type { InworldSettings, VoiceSettings } from '../../shared/settings';

const STREAM_URL = 'https://api.inworld.ai/tts/v1/voice:stream';

/** The endpoint takes at most this much text; a spoken answer is never near it. */
const MAX_SPEECH_CHARS = 4000;

/** What the windows play. */
const SAMPLE_RATE = 24_000;

/** Inworld's `speakingRate` is narrower than the settings' `speed`. */
const MIN_RATE = 0.5;
const MAX_RATE = 1.5;

/** Only `inworld-tts-2` takes a spoken-style instruction; Flash and the older models refuse it. */
const INSTRUCTED_MODEL = 'inworld-tts-2';

export function inworldRequest(
  text: string,
  inworld: InworldSettings,
  speech: VoiceSettings['speech'],
): Record<string, unknown> {
  return {
    text: text.slice(0, MAX_SPEECH_CHARS),
    voiceId: inworld.voice,
    modelId: inworld.model,
    audioConfig: {
      audioEncoding: 'PCM',
      sampleRateHertz: SAMPLE_RATE,
      speakingRate: Math.min(MAX_RATE, Math.max(MIN_RATE, speech.speed)),
    },
    ...(inworld.model === INSTRUCTED_MODEL && speech.instructions
      ? { instruction: speech.instructions }
      : {}),
  };
}

export async function speakInworld(
  text: string,
  inworld: InworldSettings & { api_key: string },
  speech: VoiceSettings['speech'],
  onAudio: (pcm: Uint8Array) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(STREAM_URL, {
    method: 'POST',
    headers: {
      // The portal hands out the key already Base64-encoded, ready for Basic auth.
      Authorization: `Basic ${inworld.api_key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(inworldRequest(text, inworld, speech)),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Inworld answered ${response.status}: ${errorText(await response.text())}`);
  }
  if (!response.body) throw new Error('Inworld sent no audio.');

  const audio = new PcmStream(onAudio);
  const decoder = new TextDecoder();
  let buffered = '';
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) audio.push(audioOf(line));
    }
    buffered += decoder.decode();
    audio.push(audioOf(buffered));
  } finally {
    reader.releaseLock();
  }
}

/**
 * The audio in one line of the stream, if it has any. A line may instead carry an error, which
 * arrives with a 200 once the stream has started.
 */
export function audioOf(line: string): Uint8Array | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  // Parsed JSON is untyped; every field read below is checked before use.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const message = JSON.parse(trimmed) as {
    result?: { audioContent?: unknown };
    error?: { message?: unknown };
  };
  if (message.error) {
    const text = typeof message.error.message === 'string' ? message.error.message : trimmed;
    throw new Error(`Inworld: ${text}`);
  }
  const content = message.result?.audioContent;
  return typeof content === 'string' && content ? Buffer.from(content, 'base64') : undefined;
}

/**
 * Passes samples on whole. A WAV header is dropped should one lead the stream (which `LINEAR16`
 * does, and `PCM` shouldn't), and a byte left over from a split sample waits for its other half,
 * since a window that got half a sample would play the rest of the answer as noise.
 */
export class PcmStream {
  private first = true;
  private carry: Uint8Array | undefined;

  constructor(private readonly onAudio: (pcm: Uint8Array) => void) {}

  push(chunk: Uint8Array | undefined): void {
    if (!chunk || chunk.byteLength === 0) return;
    let bytes = chunk;
    if (this.first) {
      this.first = false;
      bytes = stripWavHeader(bytes);
    }
    if (this.carry) {
      const joined = new Uint8Array(this.carry.byteLength + bytes.byteLength);
      joined.set(this.carry);
      joined.set(bytes, this.carry.byteLength);
      bytes = joined;
      this.carry = undefined;
    }
    if (bytes.byteLength % 2 === 1) {
      this.carry = bytes.slice(bytes.byteLength - 1);
      bytes = bytes.subarray(0, bytes.byteLength - 1);
    }
    if (bytes.byteLength > 0) this.onAudio(bytes);
  }
}

/** A RIFF/WAVE header, up to the start of its `data` chunk. */
function stripWavHeader(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength < 12 || ascii(bytes, 0) !== 'RIFF' || ascii(bytes, 8) !== 'WAVE') {
    return bytes;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const size = view.getUint32(offset + 4, true);
    if (ascii(bytes, offset) === 'data') return bytes.subarray(offset + 8);
    offset += 8 + size + (size % 2);
  }
  return new Uint8Array(0);
}

function ascii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

/** Inworld's error bodies are JSON with a message; anything else is shown as it came. */
function errorText(body: string): string {
  try {
    // Parsed JSON is untyped; the field is checked before use.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const parsed = JSON.parse(body) as { message?: unknown; error?: { message?: unknown } };
    const text = parsed.message ?? parsed.error?.message;
    if (typeof text === 'string') return text;
  } catch {
    // Not JSON.
  }
  return body.slice(0, 300) || 'no details';
}
