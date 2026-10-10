import { describe, expect, it } from 'vitest';

import type { AssistantSetup } from '../../../shared/assistant';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings';
import { stepStatus } from './quickstart';

const SETUP: AssistantSetup = {
  enabled: true,
  provider: 'openai',
  model: 'gpt-5.6-luna',
  ready: true,
  voiceInput: true,
  voiceOutput: true,
  voiceInputFormat: 'opus',
  kokoro: { kind: 'ready' },
  pushToTalk: ['Ctrl+Alt+Space'],
  holdToTalk: true,
  signedIn: false,
  maxRecordingSeconds: 30,
  keepMicrophoneOpen: true,
  configPath: 'config.yaml',
};

function settings(change: (draft: Settings) => void = () => {}): Settings {
  const copy = structuredClone(DEFAULT_SETTINGS);
  change(copy);
  return copy;
}

describe('stepStatus', () => {
  it('says the assistant is ready, or what it is missing', () => {
    expect(stepStatus('assistant', settings(), SETUP)).toEqual({
      tone: 'good',
      text: 'Ready: gpt-5.6-luna on your API key.',
    });
    expect(
      stepStatus('assistant', settings(), { ...SETUP, ready: false, problem: 'No API key.' }).text,
    ).toMatch(/Paste an OpenAI API key below/);
    const keyed = settings((s) => (s.openai.api_key = 'sk-test'));
    expect(
      stepStatus('assistant', keyed, { ...SETUP, ready: false, problem: 'The key was refused.' }),
    ).toEqual({ tone: 'trouble', text: 'The key was refused.' });
    expect(stepStatus('assistant', settings(), { ...SETUP, provider: 'codex' }).text).toMatch(
      /Sign in to ChatGPT/,
    );
  });

  it('asks for a push-to-talk binding before anything else about hearing', () => {
    const unbound = settings((s) => (s.voice.push_to_talk = []));
    expect(stepStatus('hearing', unbound, SETUP)).toMatchObject({ tone: 'trouble' });
    expect(stepStatus('hearing', settings(), SETUP)).toEqual({
      tone: 'good',
      text: 'Ready: Hold Ctrl+Alt+Space and talk.',
    });
  });

  it('points hearing at the OpenAI key, or at Whisper getting ready', () => {
    const openai = settings((s) => (s.voice.transcription.provider = 'openai'));
    expect(stepStatus('hearing', openai, { ...SETUP, voiceInput: false }).text).toMatch(
      /OpenAI API key, in step 1/,
    );
    expect(
      stepStatus('hearing', settings(), {
        ...SETUP,
        voiceInput: false,
        hearingNote: 'Downloading Whisper base.en for listening: 40% of 148 MB.',
      }),
    ).toEqual({ tone: 'busy', text: 'Downloading Whisper base.en for listening: 40% of 148 MB.' });
  });

  it('names who speaks, and asks for Inworld’s key when it is chosen without one', () => {
    expect(stepStatus('speaking', settings(), SETUP).text).toBe(
      'Ready: answers are spoken by Kokoro (Heart).',
    );
    const inworld = settings((s) => (s.voice.speech.provider = 'inworld'));
    expect(stepStatus('speaking', inworld, { ...SETUP, voiceOutput: false }).text).toMatch(
      /Inworld API key/,
    );
  });

  it('says VR is optional while it is off', () => {
    expect(stepStatus('vr', settings(), SETUP).tone).toBe('off');
    expect(
      stepStatus(
        'vr',
        settings((s) => (s.vr.enabled = true)),
        SETUP,
      ).text,
    ).toMatch(/Control\+Shift\+H/);
  });
});
