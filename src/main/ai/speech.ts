/**
 * Voice in and out. What the commander says goes to OpenAI's `gpt-transcribe`, to whisper.cpp on
 * this machine (`whisper/`) or to a Wyoming server (`wyoming.ts`); the answer is read by Inworld
 * (`inworld.ts`), by Kokoro on this machine (`kokoro/`) or by a Wyoming server. Speech arrives as
 * raw PCM so a window can start playing it while the rest is still being generated.
 */

import type OpenAI from 'openai';
import { toFile } from 'openai';

import type { RecordedAudio } from '../../shared/assistant';
import type { Settings, VoiceSettings } from '../../shared/settings';
import { pcmFromWav } from '../../shared/wav';
import { speakInworld } from './inworld';
import type { KokoroClient } from './kokoro/client';
import { ULTRATHINK } from './ultrathink';
import type { LocalWhisper } from './whisper/whisper';
import { parseWyomingUri, wyomingSpeak, wyomingTranscribe } from './wyoming';

/** Only `gpt-transcribe` takes keyword hints; older models take a prompt instead. */
const KEYWORD_MODEL = 'gpt-transcribe';

/** Hints are capped so an unlucky route doesn't fill the request with system names. */
const MAX_KEYWORDS = 40;

/** What the commander is answering, so a one-word reply has something to sit against. */
export interface TranscriptionContext {
  /** Names in play: the system, the station, what's on the route. */
  names: readonly string[];
  /** The last thing the ship said, if it was a moment ago. */
  said?: string;
}

/** Only so much of the ship's last line is worth repeating; the end of it is the question. */
const MAX_SAID_CHARS = 200;

/**
 * What the transcriber is told before it hears anything.
 *
 * Most of what the commander says is a few words — a number, a system name, an order — and a
 * second of audio on its own is thin evidence. Telling the model what it is listening to, and what
 * the ship just asked, is what stops "nine" coming back as "okay".
 */
export function transcriptionPrompt(
  keywords: readonly string[],
  context: TranscriptionContext,
): string {
  const lines = [
    'Audio from a commander talking to their ship in Elite Dangerous, over a headset while flying.',
    'Usually only a few words: a number, a system or station name, a yes or no, or a short order.',
    'Write what was said and nothing else. Never answer it, and never write "okay" for a number.',
  ];
  if (context.said) {
    lines.push(`The ship has just said: "${tail(context.said, MAX_SAID_CHARS)}"`);
  }
  if (keywords.length > 0) lines.push(`Names that may come up: ${keywords.join(', ')}.`);
  return lines.join('\n');
}
/**
 * Turns recorded audio into text. The names in `context` are the ones the model would otherwise
 * mangle — the system the ship is in, the station it's docked at, what's on the route.
 */
export async function transcribe(
  client: OpenAI,
  audio: RecordedAudio,
  settings: VoiceSettings['transcription'],
  context: TranscriptionContext,
  signal: AbortSignal,
): Promise<string> {
  const keywords = hintWords(settings, context);
  const file = await toFile(audio.data, `speech.${extension(audio.mimeType)}`, {
    type: audio.mimeType,
  });

  const transcription = await client.audio.transcriptions.create(
    {
      file,
      model: settings.model,
      language: settings.language,
      // The names go in `keywords` where the model takes them, and in the prompt where it doesn't.
      prompt: transcriptionPrompt(settings.model === KEYWORD_MODEL ? [] : keywords, context),
      ...(settings.model === KEYWORD_MODEL ? { keywords } : {}),
      // Guessing wildly at thin audio is exactly what we don't want.
      temperature: 0,
    },
    { signal },
  );
  return transcription.text.trim();
}

/** Words to listen out for: the ultrathink word first, so a long list never pushes it off. */
function hintWords(settings: VoiceSettings['transcription'], context: TranscriptionContext) {
  return [...new Set([ULTRATHINK, ...settings.keywords, ...context.names])].slice(0, MAX_KEYWORDS);
}

/** Turns what the commander said into text. */
export type Transcriber = (
  audio: RecordedAudio,
  context: TranscriptionContext,
  signal: AbortSignal,
) => Promise<string>;

/**
 * What the window should send: the browser's own Opus, which is small, for OpenAI; 16 kHz WAV for
 * the local listeners, which want samples and can't decode Opus.
 */
export function transcriptionFormat(settings: Settings): 'opus' | 'wav' {
  return settings.voice.transcription.provider === 'openai' ? 'opus' : 'wav';
}

/**
 * The listener the settings choose, or undefined when there is none yet: transcription is off,
 * OpenAI is chosen with no key, or whisper.cpp isn't running. `openai` is the client made from the
 * OpenAI key, if there is one; `whisper` is kept by the caller, like Kokoro.
 */
export function createTranscriber(
  settings: Settings,
  openai: OpenAI | undefined,
  whisper: LocalWhisper,
): Transcriber | undefined {
  const transcription = settings.voice.transcription;
  if (!transcription.enabled) return undefined;
  switch (transcription.provider) {
    case 'openai':
      if (!openai) return undefined;
      return (audio, context, signal) => transcribe(openai, audio, transcription, context, signal);
    case 'whisper':
      if (whisper.state().kind !== 'ready') return undefined;
      return (audio, context, signal) =>
        whisper.transcribe(
          audio.data,
          transcriptionPrompt(hintWords(transcription, context), context),
          transcription.language,
          signal,
        );
    case 'wyoming': {
      const uri = settings.wyoming.transcription_uri;
      return (audio, _context, signal) =>
        wyomingTranscribe(
          parseWyomingUri(uri),
          pcmFromWav(audio.data, 16_000),
          transcription.language,
          signal,
        );
    }
    default:
      return undefined;
  }
}

/** The end of a line, which is where a question is. */
function tail(text: string, limit: number): string {
  const clean = text.replaceAll(/\s+/gu, ' ').trim();
  return clean.length <= limit ? clean : `…${clean.slice(clean.length - limit)}`;
}

/**
 * Reads one piece of text aloud, handing on mono 16-bit PCM as it arrives, at `rate` samples a
 * second (24 kHz, `SPEECH_SAMPLE_RATE`, when it doesn't say).
 */
export type Speaker = (
  text: string,
  onAudio: (pcm: Uint8Array, rate?: number) => void,
  signal: AbortSignal,
) => Promise<void>;

/** Who will speak, as the settings have it: `auto` is Inworld once it has a key. */
export function speechProvider(settings: Settings): 'inworld' | 'kokoro' | 'wyoming' | undefined {
  const speech = settings.voice.speech;
  if (!speech.enabled) return undefined;
  if (speech.provider !== 'auto') return speech.provider;
  return inworldKey(settings) ? 'inworld' : 'kokoro';
}

function inworldKey(settings: Settings): string | undefined {
  return settings.inworld.api_key ?? process.env['INWORLD_API_KEY'];
}

/**
 * The voice the settings choose, or undefined when it can't speak yet: speech is off, Inworld is
 * chosen with no key, or Kokoro's model isn't loaded. `kokoro` is kept by the caller, so the model
 * outlives a change of settings.
 */
export function createSpeaker(settings: Settings, kokoro: KokoroClient): Speaker | undefined {
  const speech = settings.voice.speech;
  const provider = speechProvider(settings);
  if (provider === 'inworld') {
    const apiKey = inworldKey(settings);
    if (!apiKey) return undefined;
    const inworld = { ...settings.inworld, api_key: apiKey };
    return (text, onAudio, signal) => speakInworld(text, inworld, speech, onAudio, signal);
  }
  if (provider === 'wyoming') {
    const { speech_uri: uri, voice } = settings.wyoming;
    return (text, onAudio, signal) =>
      wyomingSpeak(parseWyomingUri(uri), text, voice, onAudio, signal);
  }
  if (provider !== 'kokoro' || kokoro.state().kind !== 'ready') return undefined;
  const voice = settings.kokoro.voice;
  return (text, onAudio, signal) => kokoro.speak(text, voice, speech.speed, onAudio, signal);
}

/** The transcription endpoint works out the format from the file name. */
function extension(mimeType: string): string {
  const type = mimeType.split(';')[0]?.trim().toLowerCase();
  switch (type) {
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    default:
      return 'webm';
  }
}
