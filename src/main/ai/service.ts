/**
 * Wires the assistant into the app: settings, the provider they choose, the push-to-talk key,
 * transcription on the way in and speech on the way out, and the IPC every window talks to.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BrowserWindow, ipcMain, shell } from 'electron';
import type OpenAI from 'openai';

import { IpcChannel } from '../../shared/api';
import {
  type AssistantSetup,
  type AssistantSnapshot,
  type RecordedAudio,
  SPEECH_SAMPLE_RATE,
  type VoicePreview,
} from '../../shared/assistant';
import { bindingLabel } from '../../shared/input';
import { isKokoroVoice } from '../../shared/kokoro';
import { activeRoute } from '../../shared/nav-routes';
import {
  type CommanderPrompt,
  interpretReply,
  type PromptAnswer,
  type PromptRequest,
  spokenPrompt,
} from '../../shared/prompts';
import type { Settings } from '../../shared/settings';
import { broadcast } from '../broadcast';
import type { SettingsStore } from '../config/store';
import type { InputService } from '../input/service';
import type { AppControl } from './app-control';
import { Assistant } from './assistant';
import type { BrowserControl } from './browser-control';
import { startOverCommand, surfaceCommand, tabCommand } from './commands';
import type { GameData } from './game-data';
import { speakInworld } from './inworld';
import { KokoroClient } from './kokoro/client';
import { createChatGptProvider } from './model/chatgpt';
import { ChatGptAuth } from './model/chatgpt-auth';
import { createAudioClient, createOpenAiProvider } from './model/openai';
import { type ModelProvider, readTurn, spokenText } from './model/provider';
import { readVoicePreview } from './preview';
import { forSpeech } from './pronounce';
import { takeSpeech } from './sentences';
import {
  createSpeaker,
  createTranscriber,
  type Speaker,
  speechProvider,
  type TranscriptionContext,
  transcriptionFormat,
  transcriptionPrompt,
} from './speech';
import type { Toolset } from './tools/define';
import { ToolRegistry } from './tools/registry';
import { TOOLSETS } from './toolsets';
import { LocalWhisper } from './whisper/whisper';
import { parseWyomingUri, wyomingSpeak } from './wyoming';

/** Names worth feeding the transcriber, so it doesn't turn "Deciat" into "the seat". */
const MAX_HINTS = 10;

/**
 * How long the ship's last answer stays worth quoting to the transcriber. Long enough to cover
 * answering a question, short enough that a question from ten minutes ago doesn't steer it.
 */
const RECENT_REPLY_MS = 90_000;

/**
 * The first sentence is spoken the moment it is finished. After that, pieces are gathered up to
 * about this length: each one is another request, and one that arrives late leaves a gap in the
 * middle of the answer, which sounds worse than starting a moment later.
 */
const FOLLOW_UP_CHARS = 120;

/** One spoken reply, sent to the speech model a piece at a time while the model is still writing. */
interface Utterance {
  id: number;
  speak: Speaker;
  controller: AbortController;
  /** Written by the model but not yet sent to be spoken. */
  pending: string;
  /** The pieces are sent on one after another, so the audio reaches the window in order. */
  queue: Promise<void>;
  /** Something has been sent to be spoken. */
  started: boolean;
  /** Waits for what the window is still playing, rather than cutting it off. */
  queued: boolean;
}

export interface AssistantServiceOptions {
  settings: SettingsStore;
  game: GameData;
  app: AppControl;
  browser: BrowserControl;
  /** Tools the extensions add, after EDSSI's own. */
  toolsets?: readonly Toolset[];
  /** Push-to-talk. Owned by the caller, because it starts before the assistant does. */
  input: InputService;
  /** Where Kokoro's model is kept once downloaded. */
  dataDir: string;
  /** The built entry of Kokoro's utility process (`kokoro/worker.ts`), which runs its model. */
  kokoroWorker: string;
}

export interface AssistantService {
  /**
   * Says something nobody asked for, such as a callout from the game, if speech is on. It waits
   * for the ship to finish what it is doing and saying, callouts included, and a question cuts it
   * off like any other speech.
   */
  announce(text: string): void;
  /**
   * Tells the commander something nobody asked for: spoken as `announce` does when speech is on,
   * otherwise only written into the Comms transcript.
   */
  notify(text: string): void;
  /**
   * One question about some images (data URLs), put to the assistant's model outside the
   * conversation: no tools, no transcript, nothing spoken. Answers what the model wrote.
   */
  look: (
    request: { instructions: string; text: string; images: string[] },
    signal: AbortSignal,
  ) => Promise<string>;
  stop(): void;
}

export function startAssistantService(options: AssistantServiceOptions): AssistantService {
  const { settings: store, game, app, browser, input } = options;
  const registry = new ToolRegistry([...TOOLSETS, ...(options.toolsets ?? [])]);
  const auth = new ChatGptAuth();
  // Its model takes a while to load, and longer to download, so it outlives a change of settings.
  const kokoro = new KokoroClient(options.kokoroWorker, options.dataDir, () => {
    speaker = createSpeaker(settings, kokoro);
    publish();
  });
  // whisper.cpp's server, likewise kept running with its model loaded.
  const whisper = new LocalWhisper(options.dataDir, () => {
    transcriber = createTranscriber(settings, audio, whisper);
    publish();
  });

  let settings = store.current();
  let provider = buildProvider(settings, auth);
  let audio = buildAudioClient(settings);
  let speaker = createSpeaker(settings, kokoro);
  let transcriber = createTranscriber(settings, audio, whisper);
  let version = 0;
  let speaking: Utterance | undefined;
  /**
   * The utterance a window is still playing out loud, if any. The generating side and the playing
   * side both have to be done before the ship has stopped speaking, and they finish seconds apart.
   */
  let playing: number | undefined;
  let listening: AbortController | undefined;
  let utterances = 0;
  /** What the assistant is waiting on the commander for, and how to hand it the answer. */
  let waiting: { prompt: CommanderPrompt; answer: (answer: PromptAnswer) => void } | undefined;
  let prompts = 0;
  /** Callouts waiting for the assistant to fall quiet. */
  let announcements: string[] = [];

  const publish = (): void => {
    version++;
    broadcast(IpcChannel.AssistantChanged, snapshot());
    if (announcements.length > 0 && assistant.phase === 'idle' && !speaking) {
      queueMicrotask(flushAnnouncements);
    }
  };

  const assistant = new Assistant({
    provider,
    registry,
    settings: settings.assistant,
    context: { game, app, browser, askCommander },
    onChange: publish,
  });

  function snapshot(): AssistantSnapshot {
    return {
      version,
      phase: assistant.phase,
      transcript: assistant.transcript,
      setup: setup(),
      prompt: waiting?.prompt,
    };
  }

  function setup(): AssistantSetup {
    const problem = !settings.assistant.enabled
      ? 'The assistant is switched off.'
      : provider.problem();
    const speakingNote = speechProvider(settings) === 'kokoro' ? kokoro.note() : undefined;
    const hearingNote = listensLocally(settings) ? whisper.note() : undefined;
    const notes = [speakingNote, hearingNote].filter((note) => note !== undefined);
    return {
      enabled: settings.assistant.enabled,
      provider: settings.assistant.provider,
      model: settings.assistant.model,
      ready: problem === undefined,
      problem: problem ?? input.snapshot().problem,
      voiceInput: transcriber !== undefined,
      voiceOutput: speaker !== undefined,
      voiceInputFormat: transcriptionFormat(settings),
      kokoro: kokoro.state(),
      ...(notes.length > 0 ? { voiceNote: notes.join(' ') } : {}),
      ...(hearingNote ? { hearingNote } : {}),
      ...(speakingNote ? { speakingNote } : {}),
      pushToTalk: settings.voice.push_to_talk.map(bindingLabel),
      holdToTalk: settings.voice.hold_to_talk,
      signedIn: auth.signedIn(),
      maxRecordingSeconds: settings.voice.max_recording_seconds,
      keepMicrophoneOpen: settings.voice.keep_microphone_open,
      ...(settings.voice.microphone ? { microphone: settings.voice.microphone } : {}),
      configPath: store.path,
      configProblem: store.problem(),
    };
  }

  /** Everything that depends on the settings file, rebuilt whenever it is saved. */
  function apply(next: Settings): void {
    settings = next;
    provider = buildProvider(next, auth);
    audio = buildAudioClient(next);
    speaker = createSpeaker(next, kokoro);
    transcriber = createTranscriber(next, audio, whisper);
    prepareLocalVoices(next);
    assistant.configure(provider, next.assistant);
    input.configure(next.voice.push_to_talk, next.voice.hold_to_talk, next.input.multi_click_ms);
    publish();
  }

  /** Starts what runs on this machine when the settings want it, and stops Whisper when not. */
  function prepareLocalVoices(next: Settings): void {
    if (speechProvider(next) === 'kokoro') kokoro.prepare();
    if (listensLocally(next)) {
      whisper.prepare({ model: next.whisper.model, threads: next.whisper.threads });
    } else {
      // It holds its model in memory, which is worth handing back.
      whisper.stop();
    }
  }

  /**
   * Puts a prompt in front of the commander (on screen, and spoken if speech is on) and waits for
   * the answer. Only one at a time: the assistant works through one question at a time anyway.
   */
  function askCommander(request: PromptRequest, signal: AbortSignal): Promise<PromptAnswer> {
    signal.throwIfAborted();
    const prompt: CommanderPrompt = { ...request, id: ++prompts };
    return new Promise<PromptAnswer>((resolve, reject) => {
      const finish = (): void => {
        signal.removeEventListener('abort', aborted);
        if (waiting?.prompt.id === prompt.id) waiting = undefined;
        if (assistant.phase === 'waiting') assistant.setPhase('thinking');
        for (const window of BrowserWindow.getAllWindows()) window.flashFrame(false);
        publish();
      };
      const aborted = (): void => {
        finish();
        reject(signal.reason);
      };
      waiting = {
        prompt,
        answer: (answer) => {
          assistant.say('tool', prompt.kind === 'help' ? 'help' : 'confirm', answer);
          finish();
          resolve(answer);
        },
      };
      signal.addEventListener('abort', aborted, { once: true });
      assistant.setPhase('waiting');
      publish();
      // The commander may be in the game with EDSSI behind it: a flash in the taskbar and the
      // question read out, rather than stealing focus from the game.
      for (const window of BrowserWindow.getAllWindows()) window.flashFrame(true);
      if (speaking) {
        const tail = speaking.pending.trim();
        speaking.pending = '';
        if (tail) enqueue(speaking, tail);
        enqueue(speaking, spokenPrompt(request));
      }
    });
  }

  /** Answers a typed or transcribed question, speaking it as it is written if speech is on. */
  async function ask(question: string): Promise<void> {
    // While a prompt is up, "yes", "no" or "done" answers it rather than starting over.
    const pending = waiting;
    if (pending) {
      const answer = interpretReply(pending.prompt.kind, question);
      if (answer) {
        assistant.say('commander', question);
        pending.answer(answer);
        return;
      }
    }
    // "New conversation" is answered by the Comms log emptying: the chirp says it was heard.
    if (startOverCommand(question)) {
      stopSpeaking();
      assistant.reset();
      app.acknowledge();
      return;
    }
    // "Surface the app" is answered by the window itself coming up, with nothing left to say.
    if (surfaceCommand(question)) {
      assistant.say('commander', question);
      app.surface();
      app.acknowledge();
      assistant.say('tool', 'surface_app');
      return;
    }
    // "Open the route tab" needs no model; it leaves whatever the ship is doing or saying alone.
    const tab = tabCommand(question);
    if (tab) {
      assistant.say('commander', question);
      app.openTab(tab);
      app.acknowledge();
      assistant.say('tool', 'open_tab', undefined, { input: JSON.stringify({ tab }) });
      return;
    }
    stopSpeaking();
    const problem = setup().ready ? undefined : setup().problem;
    if (problem !== undefined) {
      assistant.say('commander', question);
      assistant.say('error', problem);
      return;
    }

    const utterance = beginUtterance();
    await assistant.ask(question, utterance && ((delta: string) => speakOn(utterance, delta)));
    if (utterance) endUtterance(utterance);
  }

  /** Transcribes what the commander said, then answers it. */
  async function askByVoice(recorded: RecordedAudio): Promise<void> {
    const listen = transcriber;
    if (!listen) {
      assistant.say('error', notListening(settings) ?? 'Voice input is switched off.');
      return;
    }

    // Speech is left alone while a prompt waits: the reply may be its answer, and the answer to the
    // question still to be spoken belongs to the same utterance.
    if (!waiting) stopSpeaking();
    listening?.abort(new Error('superseded'));
    const controller = new AbortController();
    listening = controller;
    assistant.setPhase('transcribing');
    const context = { names: hints(), said: lastSpoken() };
    let text: string;
    try {
      text = await listen(recorded, context, controller.signal);
      keepRecording(recorded, context, text);
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error('[ai] transcription failed', error);
        assistant.say('error', `Couldn't make that out: ${message(error)}`);
      }
      return;
    } finally {
      if (listening === controller) {
        listening = undefined;
        assistant.setPhase('idle');
      }
    }

    // Silence, or a cough: nothing worth sending to the model.
    if (text) await ask(text);
  }

  /** Starts a reply, unless there's nothing to speak with. */
  function beginUtterance(queued = false, voice = speaker): Utterance | undefined {
    const speak = voice;
    if (!speak) return undefined;
    const utterance: Utterance = {
      id: ++utterances,
      speak,
      controller: new AbortController(),
      pending: '',
      queue: Promise.resolve(),
      started: false,
      queued,
    };
    speaking = utterance;
    return utterance;
  }

  /** Sends each sentence off to be spoken as the model finishes writing it. */
  function speakOn(utterance: Utterance, delta: string): void {
    utterance.pending += delta;
    const { ready, rest } = takeSpeech(utterance.pending, utterance.started ? FOLLOW_UP_CHARS : 1);
    utterance.pending = rest;
    for (const piece of ready) enqueue(utterance, piece);
  }

  /**
   * Starts making the audio for one piece now, and sends it on when the pieces before it are
   * done. Waiting for the previous request to finish before starting the next put a whole round
   * trip of silence at every sentence boundary, which is what made a long answer stutter.
   */
  function enqueue(utterance: Utterance, text: string): void {
    utterance.started = true;
    const play = beginSpeech(utterance, text);
    utterance.queue = utterance.queue.then(play).catch((error: unknown) => {
      if (utterance.controller.signal.aborted) return;
      console.error('[ai] speech failed', error);
      assistant.say('error', `Couldn't speak that: ${message(error)}`);
      // Stop here rather than complain once per sentence.
      utterance.controller.abort(new Error('speech failed'));
    });
  }

  /**
   * Asks for one piece of speech straight away. What comes back is held until this piece's turn,
   * and streamed from then on, so the request happens while the piece before it is still playing.
   */
  function beginSpeech(utterance: Utterance, text: string): () => Promise<void> {
    const held: { pcm: Uint8Array; rate: number | undefined }[] = [];
    let forward: ((pcm: Uint8Array, rate: number | undefined) => void) | undefined;
    const send = (pcm: Uint8Array, rate: number | undefined): void => {
      broadcast(IpcChannel.AssistantSpeech, {
        utterance: utterance.id,
        pcm,
        ...(rate !== undefined && rate !== SPEECH_SAMPLE_RATE && { rate }),
        ...(utterance.queued && { queued: true }),
      });
    };

    const request = utterance.speak(
      forSpeech(text),
      (pcm, rate) => (forward ? forward(pcm, rate) : held.push({ pcm, rate })),
      utterance.controller.signal,
    );
    // Whatever goes wrong is dealt with when this piece's turn comes; this only stops a rejection
    // nobody is waiting on yet from being reported as unhandled.
    request.catch(() => undefined);

    return async () => {
      if (utterance.controller.signal.aborted) return;
      // Everything that arrived while the piece before this one was playing, in order.
      for (const { pcm, rate } of held) send(pcm, rate);
      held.length = 0;
      forward = send;
      await request;
    };
  }

  /** The answer is finished: speak what's left, and mark the reply over once it has all gone out. */
  function endUtterance(utterance: Utterance): void {
    const tail = utterance.pending.trim();
    utterance.pending = '';
    if (tail) enqueue(utterance, tail);
    // An error, or a turn the commander interrupted: there was never anything to say.
    if (!utterance.started) {
      if (speaking === utterance) speaking = undefined;
      return;
    }

    assistant.setPhase('speaking');
    utterance.queue = utterance.queue.finally(() => {
      if (utterance.controller.signal.aborted) return;
      broadcast(IpcChannel.AssistantSpeech, { utterance: utterance.id, done: true });
      if (speaking !== utterance) return;
      speaking = undefined;
      // The words have all been generated and sent, which is not the same as having been heard:
      // speech is made faster than it is spoken. If a window is still playing this one, it is
      // still being said, and that window will report when it stops. With speech off, or no
      // window playing, nothing will report and this is the end of it.
      if (playing !== utterance.id) assistant.setPhase('idle');
    });
  }

  /**
   * What the window that owns the audio says about whether a sound is still coming out. Nothing
   * else can tell: the words are generated faster than they are spoken.
   */
  function playback(utterance: number, isPlaying: boolean): void {
    if (isPlaying) {
      playing = utterance;
      return;
    }

    if (playing !== utterance) return;
    playing = undefined;
    // Only if the generating side has finished too; otherwise there is more to come.
    if (speaking === undefined && assistant.phase === 'speaking') assistant.setPhase('idle');
  }

  function announce(text: string): void {
    if (!speaker) return;
    announcements.push(text);
    if (assistant.phase === 'idle' && !speaking) flushAnnouncements();
  }

  /** Speaks every waiting callout as one utterance, if nothing else has started meanwhile. */
  function flushAnnouncements(): void {
    if (announcements.length === 0 || assistant.phase !== 'idle' || speaking) return;
    const text = announcements.join(' ');
    announcements = [];
    const utterance = beginUtterance(true);
    if (!utterance) return;
    assistant.say('assistant', text);
    enqueue(utterance, text);
    endUtterance(utterance);
  }

  function stopSpeaking(): void {
    const utterance = speaking;
    // Speech is made faster than it is spoken: an answer can be all sent, and forgotten here,
    // while a window is still playing it. That one is stopped too.
    const id = utterance?.id ?? playing;
    playing = undefined;
    speaking = undefined;
    utterance?.controller.abort(new Error('interrupted'));
    if (id === undefined) return;
    // Tell the windows to drop what they haven't played yet.
    broadcast(IpcChannel.AssistantSpeech, { utterance: id, done: true, stopped: true });
    if (assistant.phase === 'speaking') assistant.setPhase('idle');
  }

  /**
   * Writes what was heard and what came back, for working out why a question was misheard. Off
   * unless `EDSSI_VOICE_DEBUG_DIR` is set, and never on in an ordinary run.
   */
  function keepRecording(
    recorded: RecordedAudio,
    context: TranscriptionContext,
    text: string,
  ): void {
    const directory = process.env['EDSSI_VOICE_DEBUG_DIR'];
    if (!directory) return;
    try {
      mkdirSync(directory, { recursive: true });
      const stamp = new Date().toISOString().replaceAll(/[:.]/gu, '-');
      const extension = recorded.mimeType.includes('wav')
        ? 'wav'
        : recorded.mimeType.includes('ogg')
          ? 'ogg'
          : 'webm';
      writeFileSync(join(directory, `${stamp}.${extension}`), recorded.data);
      writeFileSync(
        join(directory, `${stamp}.json`),
        JSON.stringify(
          {
            heard: text,
            bytes: recorded.data.byteLength,
            mimeType: recorded.mimeType,
            provider: settings.voice.transcription.provider,
            model:
              settings.voice.transcription.provider === 'whisper'
                ? settings.whisper.model
                : settings.voice.transcription.model,
            language: settings.voice.transcription.language,
            prompt: transcriptionPrompt(settings.voice.transcription.keywords, context),
            context,
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch (error) {
      console.error('[ai] could not save the recording', error);
    }
  }

  /**
   * What the ship said last, if it was recent enough to be what the commander is answering. Most
   * questions are a few words, and an answer of one word needs something to sit against.
   */
  function lastSpoken(): string | undefined {
    const entry = assistant.transcript.findLast((line) => line.role === 'assistant');
    if (!entry) return undefined;
    const age = Date.now() - Date.parse(entry.at);
    return Number.isFinite(age) && age <= RECENT_REPLY_MS ? entry.text : undefined;
  }

  /** Names in play right now, so the transcriber spells them the way the game does. */
  function hints(): string[] {
    const overview = game.overview();
    const names = [
      overview.commander,
      overview.shipName,
      overview.system,
      overview.station,
      overview.charging?.system,
      ...(activeRoute(game.routes())
        ?.systems?.slice(0, MAX_HINTS)
        .map((system) => system.StarSystem) ?? []),
      ...(game
        .history()
        .survey?.bodies.slice(0, MAX_HINTS)
        .map((body) => body.name) ?? []),
    ];
    return names.filter((name): name is string => Boolean(name));
  }

  async function signIn(): Promise<void> {
    try {
      await auth.signIn((url) => shell.openExternal(url));
      apply(settings);
    } catch (error) {
      assistant.say('error', `ChatGPT sign-in failed: ${message(error)}`);
      publish();
      throw error;
    }
  }

  const unsubscribe = store.onChange(apply);
  // Only now: Kokoro and Whisper report back through `publish` and the rest, all defined above.
  prepareLocalVoices(settings);

  ipcMain.handle(IpcChannel.AssistantSnapshot, (): AssistantSnapshot => snapshot());
  ipcMain.handle(IpcChannel.AssistantAsk, (_event, text: unknown) => {
    // Answering takes seconds; the window follows the transcript rather than waiting here.
    if (typeof text === 'string' && text.trim()) void ask(text.trim());
  });
  ipcMain.handle(IpcChannel.AssistantVoice, (_event, recorded: RecordedAudio) => {
    void askByVoice(recorded);
  });
  ipcMain.on(IpcChannel.AssistantPlayback, (_event, utterance: number, isPlaying: boolean) =>
    playback(utterance, isPlaying),
  );
  ipcMain.handle(IpcChannel.AssistantCancel, () => {
    assistant.cancel();
    listening?.abort(new Error('cancelled'));
    stopSpeaking();
  });
  ipcMain.handle(IpcChannel.AssistantReset, () => {
    stopSpeaking();
    assistant.reset();
  });
  ipcMain.handle(IpcChannel.AssistantSignIn, () => signIn());
  ipcMain.handle(IpcChannel.AssistantPreviewVoice, (_event, preview: unknown) =>
    previewVoice(preview),
  );

  /**
   * One line in the voice the Settings tab describes, saved or not, so a voice can be heard before
   * it is kept. It goes out like any answer, cutting off whatever was being said.
   */
  function previewVoice(value: unknown): string | undefined {
    const preview = readVoicePreview(value);
    if (!preview) return 'Write something to read out first.';
    const speak = previewSpeaker(preview);
    if (typeof speak === 'string') return speak;
    stopSpeaking();
    const utterance = beginUtterance(false, speak);
    if (!utterance) return undefined;
    speakOn(utterance, preview.text);
    endUtterance(utterance);
    return undefined;
  }

  /** The speaker a preview asks for, or why there isn't one yet. */
  function previewSpeaker(preview: VoicePreview): Speaker | string {
    const speech = {
      ...settings.voice.speech,
      speed: preview.speed,
      instructions: preview.instructions ?? '',
    };
    switch (preview.provider) {
      case 'kokoro': {
        const { voice } = preview;
        if (!isKokoroVoice(voice)) return `Kokoro has no voice called ${voice}.`;
        if (kokoro.state().kind !== 'ready') {
          // Asked for, so it's wanted: fetch it now even if the settings don't use it yet.
          kokoro.prepare();
          return kokoro.note() ?? 'Kokoro’s voice is getting ready.';
        }
        return (line, onAudio, signal) => kokoro.speak(line, voice, preview.speed, onAudio, signal);
      }
      case 'inworld': {
        const apiKey = preview.apiKey ?? settings.inworld.api_key ?? process.env['INWORLD_API_KEY'];
        if (!apiKey) return 'Needs the Inworld API key.';
        const inworld = { api_key: apiKey, model: preview.model, voice: preview.voice };
        return (line, onAudio, signal) => speakInworld(line, inworld, speech, onAudio, signal);
      }
      case 'wyoming': {
        let address;
        try {
          address = parseWyomingUri(preview.uri);
        } catch (error) {
          return message(error);
        }
        return (line, onAudio, signal) =>
          wyomingSpeak(address, line, preview.voice, onAudio, signal);
      }
      default:
        return 'That isn’t a voice EDSSI can try.';
    }
  }

  function notify(text: string): void {
    if (speaker) announce(text);
    else assistant.say('assistant', text);
  }

  ipcMain.handle(IpcChannel.AssistantAnswer, (_event, promptId: unknown, answer: unknown) => {
    const current = waiting;
    if (!current || current.prompt.id !== promptId || !isAnswer(answer)) return;
    current.answer(answer);
  });

  async function look(
    request: { instructions: string; text: string; images: string[] },
    signal: AbortSignal,
  ): Promise<string> {
    const { ready, problem } = setup();
    if (!ready) throw new Error(problem ?? 'The assistant is not ready.');
    const stream = await provider.stream(
      {
        model: settings.assistant.model,
        instructions: request.instructions,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: request.text },
              ...request.images.map((url) => ({
                type: 'input_image' as const,
                image_url: url,
                detail: 'high' as const,
              })),
            ],
          },
        ],
        tools: [],
        webSearch: false,
        reasoningEffort: settings.assistant.reasoning_effort,
        cacheKey: randomUUID(),
      },
      signal,
    );
    const turn = await readTurn(stream, () => {});
    if (turn.error !== undefined) throw new Error(turn.error);
    return spokenText(turn.output);
  }

  return {
    announce,
    notify,
    look,
    stop() {
      unsubscribe();
      assistant.cancel();
      stopSpeaking();
      kokoro.stop();
      whisper.stop();
    },
  };
}

function buildProvider(settings: Settings, auth: ChatGptAuth): ModelProvider {
  return settings.assistant.provider === 'codex'
    ? createChatGptProvider(auth)
    : createOpenAiProvider({
        apiKey: settings.openai.api_key ?? process.env['OPENAI_API_KEY'],
        baseUrl: settings.openai.base_url,
      });
}

/** Listening always goes through the API key: the ChatGPT backend has no audio endpoints. */
function buildAudioClient(settings: Settings): OpenAI | undefined {
  return createAudioClient({
    apiKey: settings.openai.api_key ?? process.env['OPENAI_API_KEY'],
    baseUrl: settings.openai.base_url,
  });
}

function isAnswer(value: unknown): value is PromptAnswer {
  return value === 'allow' || value === 'deny' || value === 'done' || value === 'give-up';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function listensLocally(settings: Settings): boolean {
  return (
    settings.voice.transcription.enabled && settings.voice.transcription.provider === 'whisper'
  );
}

/** Why there is nothing to listen with, when the settings want something. */
function notListening(settings: Settings): string | undefined {
  const transcription = settings.voice.transcription;
  if (!transcription.enabled) return undefined;
  switch (transcription.provider) {
    case 'openai':
      return 'Voice input needs an OpenAI API key.';
    case 'whisper':
      return 'Whisper isn’t ready to listen yet.';
    default:
      return undefined;
  }
}
