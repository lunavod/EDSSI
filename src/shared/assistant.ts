/** Types both sides use to talk about the assistant: what it's doing, and what it has said. */

import type { KokoroState } from './kokoro';
import type { CommanderPrompt } from './prompts';

/** What the assistant is busy with. The renderer adds its own listening state while recording. */
export type AssistantPhase = 'idle' | 'transcribing' | 'thinking' | 'waiting' | 'speaking';

export type TranscriptRole = 'commander' | 'assistant' | 'tool' | 'error';

export interface TranscriptEntry {
  id: number;
  role: TranscriptRole;
  text: string;
  /** ISO timestamp, for the UI. */
  at: string;
  /** Still being spoken or streamed in. */
  pending?: boolean;
  /** Spoken rather than typed (`commander`), or the tool's arguments (`tool`). */
  detail?: string;
  /** What a tool was called with and what it answered, for a `tool` line opened in the UI. */
  call?: ToolCallRecord;
  /** The web pages an answer drew on, shown beside it rather than spoken. */
  sources?: AnswerSource[];
}

export interface AnswerSource {
  /** The page's title, or its site when the search gave none. */
  title: string;
  url: string;
  /** The host, without `www.`. */
  site: string;
}

export interface ToolCallRecord {
  /** The arguments, as the model wrote them (JSON). */
  input?: string;
  /** The answer as the model received it: JSON, or plain text. */
  output?: string;
  failed?: boolean;
  /** Images the tool showed the model, which aren't kept here. */
  images?: number;
}

/** Whether the assistant can actually run, and what the commander must fix if not. */
export interface AssistantSetup {
  enabled: boolean;
  provider: string;
  model: string;
  /** Ready to answer: a provider with credentials. */
  ready: boolean;
  /** Why it isn't ready, or why voice is off. */
  problem?: string;
  voiceInput: boolean;
  voiceOutput: boolean;
  /** How far Kokoro's voice is in getting ready, for the Settings tab's try-it panel. */
  kokoro: KokoroState;
  /** What the window sends a recording as: Opus for OpenAI, 16 kHz WAV for the local listeners. */
  voiceInputFormat: 'opus' | 'wav';
  /**
   * Why voice isn't working yet though it is on: Kokoro's voice or Whisper's model still
   * downloading, or failing to set up.
   */
  voiceNote?: string;
  /** The listening half of `voiceNote`: Whisper getting ready, for the Quickstart page. */
  hearingNote?: string;
  /** The speaking half of `voiceNote`: Kokoro getting ready. */
  speakingNote?: string;
  /** What push-to-talk is bound to, ready to be read out; empty when nothing is bound. */
  pushToTalk: string[];
  /** Hold the binding to talk, rather than pressing once to start and again to send. */
  holdToTalk: boolean;
  /** A ChatGPT sign-in is on file (the `codex` provider). */
  signedIn: boolean;
  /** Recording stops itself after this long. */
  maxRecordingSeconds: number;
  /** The microphone is held open between questions. */
  keepMicrophoneOpen: boolean;
  /** Which microphone to record from, by name; unset means the system's default. */
  microphone?: string;
  configPath: string;
  /** The settings file was rejected; EDSSI is running on defaults. */
  configProblem?: string;
}

/** Pushed to windows whenever anything changes; `version` lets a late one be ignored. */
export interface AssistantSnapshot {
  version: number;
  phase: AssistantPhase;
  transcript: TranscriptEntry[];
  setup: AssistantSetup;
  /** What the assistant is waiting for the commander to answer. */
  prompt?: CommanderPrompt;
}

/** Speech audio as it arrives from the model: raw 24 kHz mono 16-bit PCM, little-endian. */
export interface SpeechChunk {
  /** All the chunks of one spoken reply share this; a new one means the last was cut short. */
  utterance: number;
  /** Absent on the last message of an utterance. */
  pcm?: Uint8Array;
  /** Samples a second, when not `SPEECH_SAMPLE_RATE`: Piper's voices are mostly 22,050 Hz. */
  rate?: number;
  done?: boolean;
  /** The reply was cut short rather than finished: drop anything not yet played. */
  stopped?: boolean;
  /**
   * Plays after whatever is still coming out of the speakers instead of cutting it off: a callout,
   * which is finished sending long before it is finished playing.
   */
  queued?: boolean;
}

export const SPEECH_SAMPLE_RATE = 24_000;

/**
 * A line to hear from the Settings tab, in the voice the settings on screen pick — saved or not —
 * so a voice can be tried before it is kept.
 */
export type VoicePreview = {
  text: string;
  /** 1 is the voice's own pace; Wyoming's servers set their own. */
  speed: number;
  /** How to deliver it; only Inworld's `inworld-tts-2` follows it. */
  instructions?: string;
} & (
  | { provider: 'kokoro'; voice: string }
  /** No key means the saved one, or `INWORLD_API_KEY`. */
  | { provider: 'inworld'; model: string; voice: string; apiKey?: string }
  | { provider: 'wyoming'; uri: string; voice?: string }
);

/** The audio a window records, on its way to be transcribed. */
export interface RecordedAudio {
  data: Uint8Array;
  /** MIME type as the browser recorded it, e.g. `audio/webm;codecs=opus`. */
  mimeType: string;
}
