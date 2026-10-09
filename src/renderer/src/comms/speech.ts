/**
 * Plays the spoken answer as it arrives. The audio is raw PCM rather than MP3 so there is nothing
 * to decode: each piece is turned into samples and queued straight after the last one.
 */

import { type SpeechChunk, SPEECH_SAMPLE_RATE } from '../../../shared/assistant';
import { playAck } from './ack';
import { Resampler } from './resample';

/**
 * How much audio a reply gathers before it starts playing. This is the jitter the audio can absorb
 * before there is a hole in it: the speech model streams at roughly the speed the words are
 * spoken, so anything it hesitates over has to come out of this. Too little and the answer breaks
 * up; too much and the ship takes that much longer to start talking.
 */
const INITIAL_LEAD_S = 0.35;

/** Past this the ship is just slow to answer, and holding back more is not worth it. */
const MAX_LEAD_S = 1.2;

/** Audio due to start sooner than this from now can no longer be joined on to seamlessly. */
const JOIN_MARGIN_S = 0.005;

/** Where playback resumes after gathering: just far enough ahead to be scheduled cleanly. */
const RESUME_OFFSET_S = 0.03;

/**
 * With no quiet moment in sight, audio is held back no longer than this before it is played
 * anyway: a gap mid-word is better than the ship falling silent for a long time.
 */
const MAX_HOLD_S = 0.4;

/** One window of the search for a quiet moment, and how loud a sample in it may be. */
const QUIET_WINDOW_S = 0.012;
const QUIET_PEAK = 0.03;

/**
 * How far ahead to work after the audio has run dry by `gap`. Widening by what was actually
 * missed means one bad connection settles at the buffer it needs rather than a guess.
 */
export function leadAfterGap(lead: number, gap: number): number {
  return Math.min(MAX_LEAD_S, lead + gap);
}

/**
 * Each reply gives back a little of what earlier ones took, so a single hesitation doesn't leave
 * the ship slow to speak for the rest of the session.
 */
export function leadForNextReply(lead: number): number {
  return Math.max(INITIAL_LEAD_S, lead * 0.8);
}

/**
 * Where the audio could stop without cutting a word: the middle of the last quiet window, or
 * undefined if there is none. What comes before it is safe to play now; what follows waits for
 * more to arrive, so if the stream stalls, the silence falls between words.
 */
export function quietCut(samples: Float32Array, sampleRate: number): number | undefined {
  const window = Math.max(2, Math.round(sampleRate * QUIET_WINDOW_S));
  for (let end = samples.length; end - window >= 0; end -= window >> 1) {
    let peak = 0;
    for (let index = end - window; index < end && peak < QUIET_PEAK; index++) {
      peak = Math.max(peak, Math.abs(samples[index]!));
    }
    if (peak < QUIET_PEAK) {
      const cut = end - (window >> 1);
      return cut > 0 ? cut : undefined;
    }
  }
  return undefined;
}

export interface DecodedPcm {
  /** Backed by a plain ArrayBuffer, which is what an AudioBuffer channel takes. */
  samples: Float32Array<ArrayBuffer>;
  /** A trailing byte that belongs to a sample the next chunk finishes. */
  carry?: number;
}

/**
 * Turns 16-bit little-endian PCM into the floats WebAudio wants. Chunks are split wherever the
 * network happened to break them, so a sample can straddle two of them.
 */
export function decodePcm(bytes: Uint8Array, carry?: number): DecodedPcm {
  const leading = carry === undefined ? 0 : 1;
  const total = bytes.length + leading;
  const count = total >> 1;
  // Backed by a plain ArrayBuffer, which is what an AudioBuffer channel will take.
  const samples = new Float32Array(new ArrayBuffer(count * Float32Array.BYTES_PER_ELEMENT));
  const byteAt = (index: number): number =>
    index < leading ? carry! : (bytes[index - leading] ?? 0);

  for (let index = 0; index < count; index++) {
    const raw = (byteAt(index * 2 + 1) << 8) | byteAt(index * 2);
    samples[index] = (raw >= 0x8000 ? raw - 0x10000 : raw) / 0x8000;
  }
  return { samples, carry: total % 2 === 1 ? byteAt(total - 1) : undefined };
}

function emptySamples(): Float32Array<ArrayBuffer> {
  return new Float32Array(new ArrayBuffer(0));
}

function concat(a: Float32Array, b: Float32Array): Float32Array<ArrayBuffer> {
  const joined = new Float32Array(
    new ArrayBuffer((a.length + b.length) * Float32Array.BYTES_PER_ELEMENT),
  );
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}

/**
 * Plays the pieces of one reply one after another, and drops them all when interrupted.
 *
 * Audio waits here until it can play without a hole. At the start of a reply, and again whenever
 * the stream falls behind, `lead` seconds are gathered before playing, so a stall costs one pause
 * rather than a stutter at every late piece. While it plays, the tail after the last quiet moment
 * is held back until more arrives, so that if the stream does stall, the pause lands between words.
 */
export interface SpeechPlayerOptions {
  /**
   * Called when this window starts and stops actually making a sound. The main process generates
   * speech faster than it is spoken, so without this it can only know when it sent the last of an
   * answer — which is a second or two before the commander has finished hearing it.
   */
  onPlayback?: (utterance: number, playing: boolean) => void;
}

export class SpeechPlayer {
  #context: AudioContext | undefined;
  #sources = new Set<AudioBufferSourceNode>();
  #resampler = new Resampler();
  /** Learnt over the session: how much has to be gathered to keep the answer in one piece. */
  #lead = INITIAL_LEAD_S;
  #utterance: number | undefined;
  #carry: number | undefined;
  /** When the audio scheduled so far runs out, on the context's clock; 0 before a reply plays. */
  #playUntil = 0;
  /** Arrived, at the device's rate, and not scheduled yet. */
  #pending = emptySamples();
  /** The reply has sent everything it is going to. */
  #finished = false;
  /** Ran dry mid-reply, and gathering audio before carrying on. */
  #gathering = false;
  /** For the note at the end of a reply that ran dry: how fast the audio really arrived. */
  #stats = { began: 0, audioS: 0, dry: 0 };
  /** Whether the main process has been told this window is making a sound. */
  #announced: number | undefined;
  readonly #onPlayback: SpeechPlayerOptions['onPlayback'];

  constructor(options: SpeechPlayerOptions = {}) {
    this.#onPlayback = options.onPlayback;
  }

  /**
   * Says whether a sound is coming out, when the answer to that has changed.
   *
   * Going quiet is not the same as having finished: a reply whose audio arrives slower than it is
   * spoken runs dry in the middle and carries on a moment later, and reporting that as the end
   * would drop the ship out of "speaking" halfway through what it is saying. So a stop is only
   * reported once the reply has sent everything — or when `stopped`, because the commander has cut
   * it off and nothing more is coming whatever the stream thinks.
   */
  #announce(stopped = false): void {
    const utterance = this.#utterance;
    if (!stopped && this.speaking && utterance !== undefined) {
      if (this.#announced === utterance) return;
      this.#announced = utterance;
      this.#onPlayback?.(utterance, true);
      return;
    }

    if (!stopped && !this.#finished) return;
    if (this.#announced === undefined) return;
    const was = this.#announced;
    this.#announced = undefined;
    this.#onPlayback?.(was, false);
  }

  /** True while there is audio still to come out of the speakers. */
  get speaking(): boolean {
    return this.#sources.size > 0 || this.#pending.length > 0;
  }

  /**
   * Opens the audio device before there is anything to play. Windows takes seconds to start one,
   * and the context's clock doesn't move until it has, so a context opened on the first chunk of
   * an answer holds that answer back by the whole of that wait.
   */
  warmUp(): void {
    const context = this.#open();
    // A moment of silence: some drivers only start the device once something is played through it.
    const silence = context.createBufferSource();
    silence.buffer = context.createBuffer(
      1,
      Math.ceil(context.sampleRate * 0.05),
      context.sampleRate,
    );
    silence.connect(context.destination);
    silence.start();
  }

  play(chunk: SpeechChunk): void {
    if (chunk.utterance !== this.#utterance && chunk.queued) {
      // A callout waits its turn: it joins on where the audio already scheduled runs out.
      this.#utterance = chunk.utterance;
      this.#carry = undefined;
      this.#resampler.reset();
      this.#finished = false;
      this.#gathering = false;
      this.#stats = { began: performance.now(), audioS: 0, dry: 0 };
      // Nothing left playing: a fresh start, not the stream running dry.
      if (this.#context && this.#playUntil < this.#context.currentTime) this.#playUntil = 0;
    } else if (chunk.utterance !== this.#utterance) {
      // A new reply replaces whatever was being said: the commander has moved on.
      this.stop();
      this.#utterance = chunk.utterance;
      this.#lead = leadForNextReply(this.#lead);
      this.#stats = { began: performance.now(), audioS: 0, dry: 0 };
    }
    // Interrupted rather than finished: drop what hasn't been played. A reply that simply ended
    // says `done` without `stopped`, and is left to play itself out.
    if (chunk.stopped) {
      this.stop();
      return;
    }

    const context = this.#open();
    if (chunk.pcm?.length) {
      const { samples, carry } = decodePcm(chunk.pcm, this.#carry);
      this.#carry = carry;
      // Resampled here, across the join, rather than one buffer at a time by Web Audio.
      const rate = chunk.rate ?? SPEECH_SAMPLE_RATE;
      const output = this.#resampler.resample(samples, rate, context.sampleRate);
      this.#pending = concat(this.#pending, output);
      this.#stats.audioS += output.length / context.sampleRate;
    }
    if (chunk.done) this.#finished = true;
    this.#pump(context);
    // Every time, not only when a source ends. The reply's last message says `done` and carries no
    // audio at all, so by the time it arrives the last sound has usually already finished and its
    // `ended` fired while there was still, as far as this knew, more to come. Without this the
    // stopping is never reported and the ship is left speaking for ever.
    this.#announce();

    if (chunk.done && this.#stats.dry > 0) {
      const { began, audioS, dry } = this.#stats;
      const seconds = (performance.now() - began) / 1000;
      console.info(
        `[speech] ${audioS.toFixed(1)} s of audio arrived over ${seconds.toFixed(1)} s; ` +
          `ran dry ${dry} ${dry === 1 ? 'time' : 'times'}`,
      );
    }
  }

  /** Schedules what can be played now, and holds back the rest. */
  #pump(context: AudioContext): void {
    if (this.#pending.length === 0) return;
    const now = context.currentTime;
    const rate = context.sampleRate;

    let startAt = this.#playUntil;
    if (this.#playUntil < now + JOIN_MARGIN_S) {
      // Nothing left to join on to: the start of a reply, or the stream fell behind.
      if (this.#playUntil > 0 && !this.#gathering) {
        const gap = Math.max(0, now - this.#playUntil);
        this.#lead = leadAfterGap(this.#lead, gap);
        this.#stats.dry++;
        // The size of it says where to look: the network, the speech model, or this window.
        console.warn(
          `[speech] ran dry ${Math.round(gap * 1000)} ms after the last sound; gathering ` +
            `${Math.round(this.#lead * 1000)} ms before carrying on`,
        );
      }
      this.#gathering = true;
      if (!this.#finished && this.#pending.length / rate < this.#lead) return;
      this.#gathering = false;
      startAt = now + RESUME_OFFSET_S;
    }

    const cut = this.#finished
      ? this.#pending.length
      : (quietCut(this.#pending, rate) ??
        (this.#pending.length / rate > MAX_HOLD_S ? this.#pending.length : 0));
    if (cut === 0) return;

    const buffer = context.createBuffer(1, cut, rate);
    buffer.copyToChannel(this.#pending.subarray(0, cut), 0);
    this.#pending = this.#pending.slice(cut);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(startAt);
    this.#playUntil = startAt + buffer.duration;
    this.#sources.add(source);
    source.addEventListener(
      'ended',
      () => {
        this.#sources.delete(source);
        // The last of the answer has come out of the speakers, and only now is it not speaking.
        this.#announce();
      },
      { once: true },
    );
    this.#announce();
  }

  stop(): void {
    for (const source of this.#sources) {
      // A source that has already finished throws rather than complaining quietly.
      try {
        source.stop();
      } catch {
        // Already done; nothing to stop.
      }
    }
    this.#sources.clear();
    this.#resampler.reset();
    this.#carry = undefined;
    this.#playUntil = 0;
    this.#pending = emptySamples();
    this.#finished = false;
    this.#gathering = false;
    this.#utterance = undefined;
    // Cut off rather than finished, but either way nothing is coming out any more.
    this.#announce(true);
  }

  /** The acknowledgement chirp, through the same already-open device, so it plays at once. */
  acknowledge(): void {
    const context = this.#open();
    playAck(context, context.currentTime + 0.01);
  }

  close(): void {
    this.stop();
    void this.#context?.close();
    this.#context = undefined;
  }

  #open(): AudioContext {
    // At the device's own rate: forcing 24 kHz makes Windows open a resampled stream, which is
    // slower to start. The buffers stay at 24 kHz and Web Audio resamples them on the way out.
    this.#context ??= new AudioContext();
    // Chromium suspends a context created without a click; nothing here needs one.
    if (this.#context.state === 'suspended') void this.#context.resume();
    return this.#context;
  }
}
