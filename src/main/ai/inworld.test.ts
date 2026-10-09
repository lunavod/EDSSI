import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../shared/settings';
import { audioOf, inworldRequest, PcmStream } from './inworld';

const speech = DEFAULT_SETTINGS.voice.speech;
const inworld = DEFAULT_SETTINGS.inworld;

function collect(): { stream: PcmStream; out: number[][] } {
  const out: number[][] = [];
  return { stream: new PcmStream((pcm) => out.push([...pcm])), out };
}

function wav(samples: number[]): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  header.set(Buffer.from('RIFF', 'ascii'), 0);
  header.set(Buffer.from('WAVE', 'ascii'), 8);
  header.set(Buffer.from('fmt ', 'ascii'), 12);
  view.setUint32(16, 16, true);
  header.set(Buffer.from('data', 'ascii'), 36);
  view.setUint32(40, samples.length, true);
  return new Uint8Array([...header, ...samples]);
}

describe('inworldRequest', () => {
  it('asks for the raw 24 kHz samples the windows already play', () => {
    const body = inworldRequest('Jump complete.', inworld, speech);
    expect(body).toMatchObject({
      text: 'Jump complete.',
      voiceId: 'Ashley',
      modelId: 'inworld-tts-2',
      audioConfig: { audioEncoding: 'PCM', sampleRateHertz: 24_000 },
    });
  });

  it('passes the delivery instructions to the model that follows them', () => {
    expect(inworldRequest('Hi.', inworld, speech)).toHaveProperty(
      'instruction',
      speech.instructions,
    );
  });

  it('leaves them out for the flash model, which refuses them', () => {
    const flash = { ...inworld, model: 'inworld-tts-2-flash' };
    expect(inworldRequest('Hi.', flash, speech)).not.toHaveProperty('instruction');
  });

  it("keeps the speed inside Inworld's narrower range", () => {
    const fast = inworldRequest('Hi.', inworld, { ...speech, speed: 3 });
    expect(fast['audioConfig']).toMatchObject({ speakingRate: 1.5 });
    const slow = inworldRequest('Hi.', inworld, { ...speech, speed: 0.25 });
    expect(slow['audioConfig']).toMatchObject({ speakingRate: 0.5 });
  });
});

describe('audioOf', () => {
  it('decodes the audio in a line of the stream', () => {
    const line = JSON.stringify({
      result: { audioContent: Buffer.from([1, 2]).toString('base64') },
    });
    expect([...(audioOf(line) ?? [])]).toEqual([1, 2]);
  });

  it('skips blank lines and lines without audio', () => {
    expect(audioOf('   ')).toBeUndefined();
    expect(audioOf(JSON.stringify({ result: { usage: {} } }))).toBeUndefined();
  });

  it('throws the error a stream can carry after it has started', () => {
    expect(() => audioOf(JSON.stringify({ error: { message: 'voice not found' } }))).toThrow(
      'voice not found',
    );
  });
});

describe('PcmStream', () => {
  it('drops a WAV header leading the stream', () => {
    const { stream, out } = collect();
    stream.push(wav([1, 2, 3, 4]));
    expect(out).toEqual([[1, 2, 3, 4]]);
  });

  it('passes raw samples through untouched', () => {
    const { stream, out } = collect();
    stream.push(new Uint8Array([1, 2]));
    stream.push(new Uint8Array([3, 4]));
    expect(out).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('holds half a sample until its other half arrives', () => {
    const { stream, out } = collect();
    stream.push(new Uint8Array([1, 2, 3]));
    stream.push(new Uint8Array([4, 5, 6]));
    expect(out).toEqual([
      [1, 2],
      [3, 4, 5, 6],
    ]);
  });
});
