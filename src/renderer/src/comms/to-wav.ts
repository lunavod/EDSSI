/**
 * A recording as 16 kHz mono WAV, for the listeners that run locally (whisper.cpp, Wyoming), which
 * want samples rather than the Opus the browser records. Chromium decodes the Opus itself, and
 * `decodeAudioData` on a 16 kHz context resamples it on the way, so nothing here touches a codec.
 */

import type { RecordedAudio } from '../../../shared/assistant';
import { encodeWav } from '../../../shared/wav';

const RATE = 16_000;

export async function toWav16k(audio: RecordedAudio): Promise<RecordedAudio> {
  const context = new OfflineAudioContext(1, 1, RATE);
  const decoded = await context.decodeAudioData(Uint8Array.from(audio.data).buffer);
  return { data: encodeWav(mixDown(decoded), RATE), mimeType: 'audio/wav' };
}

/** One channel, averaged from however many the microphone gave. */
function mixDown(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mixed = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < mixed.length; index++) mixed[index]! += data[index]!;
  }
  for (let index = 0; index < mixed.length; index++) mixed[index]! /= buffer.numberOfChannels;
  return mixed;
}
