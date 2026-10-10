import { describe, expect, it } from 'vitest';

import { previewFor, whileWaiting } from './VoiceTestPanel';

/** Settings as a getter reads them, by dotted path. */
const at =
  (values: Record<string, unknown>) =>
  (path: readonly string[]): unknown =>
    values[path.join('.')];

describe('whileWaiting', () => {
  it('plays a waiting line once the voice is ready, and drops it if getting ready failed', () => {
    expect(whileWaiting(true, { kind: 'ready' })).toBe('play');
    expect(whileWaiting(true, { kind: 'failed', message: 'no network' })).toBe('drop');
  });

  it('keeps waiting while the voice downloads or loads', () => {
    for (const state of [
      { kind: 'idle' },
      { kind: 'missing' },
      { kind: 'loading' },
      { kind: 'downloading', received: 1, total: 2 },
    ] as const) {
      expect(whileWaiting(true, state)).toBe('wait');
    }
  });

  it('does nothing when nothing is waiting', () => {
    expect(whileWaiting(false, { kind: 'ready' })).toBe('wait');
  });
});

describe('previewFor', () => {
  it('asks for the voice the settings pick, with that provider’s settings as on screen', () => {
    expect(
      previewFor(at({ 'voice.speech.provider': 'kokoro', 'kokoro.voice': 'bf_emma' }), 'Hi.'),
    ).toEqual({ provider: 'kokoro', text: 'Hi.', speed: 1, voice: 'bf_emma' });
    expect(
      previewFor(
        at({
          'voice.speech.provider': 'inworld',
          'inworld.api_key': 'key',
          'inworld.voice': 'Craig',
          'voice.speech.speed': 1.2,
        }),
        'Hi.',
      ),
    ).toEqual({
      provider: 'inworld',
      text: 'Hi.',
      speed: 1.2,
      model: 'inworld-tts-2',
      voice: 'Craig',
      apiKey: 'key',
    });
    expect(
      previewFor(
        at({ 'voice.speech.provider': 'wyoming', 'wyoming.voice': 'en_GB-alan-medium' }),
        'Hi.',
      ),
    ).toEqual({
      provider: 'wyoming',
      text: 'Hi.',
      speed: 1,
      uri: 'tcp://127.0.0.1:10200',
      voice: 'en_GB-alan-medium',
    });
  });
});
