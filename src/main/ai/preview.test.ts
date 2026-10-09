import { describe, expect, it } from 'vitest';

import { MAX_PREVIEW_CHARS, readVoicePreview } from './preview';

describe('readVoicePreview', () => {
  it('reads a line for each provider, with what that provider needs', () => {
    expect(
      readVoicePreview({ provider: 'kokoro', text: ' Hi. ', speed: 1, voice: 'af_heart' }),
    ).toEqual({ provider: 'kokoro', text: 'Hi.', speed: 1, voice: 'af_heart' });
    expect(
      readVoicePreview({
        provider: 'inworld',
        text: 'Hi.',
        speed: 1.2,
        model: 'inworld-tts-2',
        voice: 'Ashley',
        apiKey: 'key',
        instructions: 'Calm.',
      }),
    ).toEqual({
      provider: 'inworld',
      text: 'Hi.',
      speed: 1.2,
      model: 'inworld-tts-2',
      voice: 'Ashley',
      apiKey: 'key',
      instructions: 'Calm.',
    });
    expect(
      readVoicePreview({
        provider: 'wyoming',
        text: 'Hi.',
        speed: 1,
        uri: 'tcp://h:10200',
        voice: '',
      }),
    ).toEqual({ provider: 'wyoming', text: 'Hi.', speed: 1, uri: 'tcp://h:10200' });
  });

  it('refuses what a provider can’t speak with, and anything else', () => {
    expect(readVoicePreview({ provider: 'kokoro', text: 'Hi.', speed: 1 })).toBeUndefined();
    expect(readVoicePreview({ provider: 'wyoming', text: 'Hi.', speed: 1 })).toBeUndefined();
    expect(
      readVoicePreview({ provider: 'openai', text: 'Hi.', speed: 1, voice: 'x' }),
    ).toBeUndefined();
    expect(
      readVoicePreview({ provider: 'kokoro', text: '  ', speed: 1, voice: 'x' }),
    ).toBeUndefined();
    expect(readVoicePreview('kokoro')).toBeUndefined();
  });

  it('keeps a line short', () => {
    const long = readVoicePreview({
      provider: 'kokoro',
      text: 'a'.repeat(2000),
      speed: 1,
      voice: 'x',
    });
    expect(long?.text).toHaveLength(MAX_PREVIEW_CHARS);
  });
});
