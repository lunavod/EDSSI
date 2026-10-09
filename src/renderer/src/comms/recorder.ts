/**
 * Records what the commander says. The microphone lives in the window — the main process has no
 * way to reach one without a native module — and the audio goes to main to be transcribed.
 */

import type { RecordedAudio } from '../../../shared/assistant';

/** Anything shorter than this is a key press, not a sentence. */
const MIN_BYTES = 1500;

/** What a hold produced: something to send, or a reason there is nothing. */
export interface Recording {
  audio?: RecordedAudio;
  /**
   * Why nothing is being sent, when that is a fault rather than the commander brushing the key.
   * A recording that is merely short says nothing: tapping a binding by accident is not an error
   * and should not put a message on the screen.
   */
  problem?: string;
}

/**
 * Opening the microphone takes about 200 ms cold and 60 ms warm, measured on Windows, and none of
 * that audio exists — so with push-to-talk the start of the first word is simply missing. Holding
 * the device open between questions is what removes it. The cost is the microphone indicator
 * staying lit, which is why `voice.keep_microphone_open` can turn it off.
 */
export interface VoiceRecorderOptions {
  keepOpen?: boolean;
  /**
   * Which microphone to record from, by the name the system gives it. Unset records from the
   * default. A name rather than a `deviceId` because that is what `voice.microphone` holds — see
   * the note there — so it is looked up against the device list each time one is opened.
   */
  device?: string;
}

/**
 * The tail is cut the moment the key comes up, and commanders let go as they finish the last
 * word — often just before it. Carrying on for a moment costs that much delay before the question
 * is sent, and saves the end of it.
 */
const TAIL_MS = 200;

export class VoiceRecorder {
  #recorder: MediaRecorder | undefined;
  #stream: MediaStream | undefined;
  #chunks: Blob[] = [];
  #keepOpen: boolean;
  #device: string | undefined;

  constructor(options: VoiceRecorderOptions = {}) {
    this.#keepOpen = options.keepOpen ?? true;
    this.#device = options.device;
  }

  get recording(): boolean {
    return this.#recorder?.state === 'recording';
  }

  /** Whether the device is open, for the setting to be honest about the indicator light. */
  get open(): boolean {
    return this.#stream !== undefined;
  }

  configure(options: VoiceRecorderOptions): void {
    const keepOpen = options.keepOpen ?? true;
    this.#keepOpen = keepOpen;
    // A device held open is the old one; let go of it so the next question uses the new choice.
    // Not while recording, which would cut the question in half for the sake of the next one.
    const swapped = options.device !== this.#device;
    this.#device = options.device;
    if ((!keepOpen || swapped) && !this.recording) this.#release();
  }

  /**
   * Opens the microphone before there is anything to record, so the first word of the first
   * question isn't lost to the device starting up.
   */
  async warmUp(): Promise<void> {
    if (!this.#keepOpen || this.#stream) return;
    try {
      this.#stream = await open(this.#device);
    } catch (error) {
      // Nothing is being recorded yet, so this is not worth bothering the commander with; the
      // real attempt will report it.
      console.warn('[voice] could not open the microphone ahead of time', error);
    }
  }

  async start(): Promise<void> {
    if (this.recording) return;
    // A stream held open from last time starts recording immediately; a fresh one costs the wait.
    this.#stream ??= await open(this.#device);
    this.#chunks = [];
    const recorder = new MediaRecorder(this.#stream, { mimeType: pickMimeType() });
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.#chunks.push(event.data);
    });
    recorder.start();
    this.#recorder = recorder;
  }

  /** Stops and hands back what was said, or says why there is nothing to hand back. */
  async stop(): Promise<Recording> {
    const recorder = this.#recorder;
    this.#recorder = undefined;
    if (!recorder || recorder.state === 'inactive') {
      this.#done();
      return {};
    }

    // Keep listening for a moment: the last word is often still being said as the key comes up.
    await wait(TAIL_MS);

    const finished = new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    recorder.stop();
    await finished;
    this.#done();

    const blob = new Blob(this.#chunks, { type: recorder.mimeType });
    this.#chunks = [];
    // Logged every time: the size is what tells a silent device from a short question, and it is
    // the first thing worth knowing when a commander says nothing happened.
    console.log(`[voice] recorded ${blob.size} bytes from ${this.#device ?? 'the default device'}`);

    // Not one byte. The encoder writes a container header for any live track, however quiet, so
    // this is a track that ended or never carried anything — a device that is not really there.
    if (blob.size === 0) {
      const named = this.#device === undefined ? 'The microphone' : `"${this.#device}"`;
      return { problem: `${named} recorded nothing. Pick another under Voice in Settings.` };
    }

    if (blob.size < MIN_BYTES) return {};
    return {
      audio: { data: new Uint8Array(await blob.arrayBuffer()), mimeType: recorder.mimeType },
    };
  }

  /** Throws away the recording without sending it. */
  cancel(): void {
    if (this.#recorder?.state === 'recording') this.#recorder.stop();
    this.#recorder = undefined;
    this.#chunks = [];
    this.#done();
  }

  /** Lets go of the device for good. */
  close(): void {
    this.cancel();
    this.#release();
  }

  /** After a question: the device is kept open only if it is meant to be. */
  #done(): void {
    if (!this.#keepOpen) this.#release();
  }

  #release(): void {
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = undefined;
  }
}

/**
 * What to ask the device for, once it has been chosen.
 *
 * Echo cancellation is the odd one out. On the default device it is worth having — the answer is
 * played back through whatever the commander is listening on, and without it the ship hears
 * itself. On a device the commander has named it is switched off, because Chromium on Windows
 * runs the canceller against the *default* capture and render pair: point it at any other input
 * and the processed stream can come back live but completely silent, which is exactly "it listens
 * and then nothing happens". Someone who has gone to the trouble of naming a microphone is
 * wearing a headset, where there is no echo to cancel anyway.
 */
function constraintsFor(id: string | undefined): MediaTrackConstraints {
  const processing = { noiseSuppression: true, autoGainControl: true };
  if (id === undefined) return { ...processing, echoCancellation: true };
  // `exact`, so this either records from the microphone that was asked for or fails loudly. An
  // ideal constraint would quietly hand back a different device, which is the same silence again.
  return { ...processing, echoCancellation: false, deviceId: { exact: id } };
}

/**
 * Opens the microphone, the named one when it is plugged in.
 *
 * A name that matches nothing falls back to the default rather than refusing: losing a question
 * is worse than recording it from the wrong device, and the settings screen is where a microphone
 * that has been unplugged gets noticed. A name that *does* match is then insisted on.
 */
async function open(device?: string): Promise<MediaStream> {
  const id = device === undefined ? undefined : await deviceIdFor(device);
  if (device !== undefined && id === undefined) {
    console.warn(`[voice] no microphone called "${device}"; using the default`);
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: constraintsFor(id) });
  // What was actually opened, which is not always what was asked for.
  const [track] = stream.getAudioTracks();
  console.log(`[voice] opened "${track?.label ?? 'nothing'}"`, track?.getSettings());
  return stream;
}

/**
 * The id of the microphone with this name. Labels are only given out once the commander has
 * allowed a microphone at least once; before that every label is empty and there is nothing to
 * match, which is the same answer as the device not being there.
 */
async function deviceIdFor(name: string): Promise<string | undefined> {
  const wanted = name.trim().toLowerCase();
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.find(
    (candidate) =>
      candidate.kind === 'audioinput' && candidate.label.trim().toLowerCase() === wanted,
  )?.deviceId;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Opus in WebM is what Chromium records best, and the transcription endpoint takes it. */
function pickMimeType(): string {
  const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return preferred.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}
