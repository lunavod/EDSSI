/**
 * How each step of the Quickstart page stands, in a line: ready (and how to use it), what is still
 * missing, or that it is getting ready. Worked out from the settings as saved — that is what is
 * running — and from what the assistant reports about itself.
 */

import type { AssistantSetup } from '../../../shared/assistant';
import { isKokoroVoice, kokoroVoiceLabel } from '../../../shared/kokoro';
import type { Settings } from '../../../shared/settings';

export type StepKind = 'assistant' | 'hearing' | 'speaking' | 'vr';

export interface StepStatus {
  /** `good` works now; `trouble` needs something from the commander; `busy` is on its way. */
  tone: 'good' | 'trouble' | 'busy' | 'off';
  text: string;
}

/** The key that shows and hides the cockpit, unless `vr-overlay.json` says otherwise. */
export const VR_TOGGLE_KEY = 'Control+Shift+H';

export function stepStatus(
  kind: StepKind,
  settings: Settings,
  setup: AssistantSetup | undefined,
): StepStatus {
  switch (kind) {
    case 'assistant':
      return assistantStatus(settings, setup);
    case 'hearing':
      return hearingStatus(settings, setup);
    case 'speaking':
      return speakingStatus(settings, setup);
    case 'vr':
      return settings.vr.enabled
        ? {
            tone: 'good',
            text: `On. It comes up whenever SteamVR and Elite are both running; ${VR_TOGGLE_KEY} shows or hides it.`,
          }
        : { tone: 'off', text: 'Off. Only worth turning on if you play in VR.' };
    default:
      return { tone: 'off', text: '' };
  }
}

function assistantStatus(settings: Settings, setup: AssistantSetup | undefined): StepStatus {
  if (!setup) return { tone: 'busy', text: 'Asking the assistant how it stands…' };
  if (!setup.enabled) return { tone: 'off', text: 'The assistant is switched off.' };
  if (setup.provider === 'codex' && !setup.signedIn) {
    return { tone: 'trouble', text: 'Sign in to ChatGPT to use your plan.' };
  }
  // The assistant's own words point at the settings file; this page has the field right here.
  if (!setup.ready && setup.provider === 'openai' && settings.openai.api_key === undefined) {
    return {
      tone: 'trouble',
      text: 'Paste an OpenAI API key below, or pick ChatGPT plan to use your subscription.',
    };
  }
  if (!setup.ready) return { tone: 'trouble', text: setup.problem ?? 'Not ready yet.' };
  const on = setup.provider === 'codex' ? 'your ChatGPT plan' : 'your API key';
  return { tone: 'good', text: `Ready: ${setup.model} on ${on}.` };
}

function hearingStatus(settings: Settings, setup: AssistantSetup | undefined): StepStatus {
  const transcription = settings.voice.transcription;
  if (!transcription.enabled) return { tone: 'off', text: 'Hearing you is switched off.' };
  if (settings.voice.push_to_talk.length === 0) {
    return { tone: 'trouble', text: 'Bind a key or stick button to talk with, above.' };
  }
  if (setup?.voiceInput) {
    const key = setup.pushToTalk[0] ?? 'the push-to-talk binding';
    const how = setup.holdToTalk
      ? `Hold ${key} and talk`
      : `Press ${key}, talk, and press it again`;
    return { tone: 'good', text: `Ready: ${how}.` };
  }
  switch (transcription.provider) {
    case 'openai':
      return { tone: 'trouble', text: 'Needs the OpenAI API key, in step 1.' };
    case 'whisper':
      return {
        tone: setup?.hearingNote?.includes('couldn’t') ? 'trouble' : 'busy',
        text: setup?.hearingNote ?? 'Whisper is getting ready to listen.',
      };
    default:
      return { tone: 'trouble', text: 'Not listening yet.' };
  }
}

function speakingStatus(settings: Settings, setup: AssistantSetup | undefined): StepStatus {
  const speech = settings.voice.speech;
  if (!speech.enabled) return { tone: 'off', text: 'Answers are written, not spoken.' };
  const inworldKey = settings.inworld.api_key !== undefined;
  const who =
    speech.provider === 'wyoming'
      ? 'your Wyoming server'
      : speech.provider === 'inworld' || (speech.provider === 'auto' && inworldKey)
        ? `Inworld (${settings.inworld.voice})`
        : `Kokoro (${isKokoroVoice(settings.kokoro.voice) ? kokoroVoiceLabel(settings.kokoro.voice).split(' — ')[0] : settings.kokoro.voice})`;
  if (setup?.voiceOutput) return { tone: 'good', text: `Ready: answers are spoken by ${who}.` };
  if (speech.provider === 'inworld' && !inworldKey) {
    return { tone: 'trouble', text: 'Needs the Inworld API key, above.' };
  }
  if (setup?.speakingNote) {
    return {
      tone: setup.speakingNote.includes('couldn’t') ? 'trouble' : 'busy',
      text: setup.speakingNote,
    };
  }
  return { tone: 'busy', text: `${who} is getting ready.` };
}
