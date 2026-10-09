/**
 * Plain 16-bit PCM WAV files: the window writes one from the recording for the local listeners,
 * which take samples rather than Opus, and the main process reads the samples back out for Wyoming.
 */

/** A mono 16-bit WAV from float samples at `rate`. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string): void => {
    for (let index = 0; index < text.length; index++)
      view.setUint8(at + index, text.charCodeAt(index));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(44 + index * 2, Math.round(sample * 0x7fff), true);
  }
  return bytes;
}

/**
 * The samples of a mono 16-bit WAV at `rate`, walking its chunks rather than assuming the 44-byte
 * header, and refusing any other format rather than playing it at the wrong speed.
 */
export function pcmFromWav(bytes: Uint8Array, rate: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number): string =>
    String.fromCharCode(...bytes.subarray(at, Math.min(at + 4, bytes.length)));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('The recording isn’t a WAV file.');
  }
  let format: { channels: number; rate: number; bits: number } | undefined;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ' && size >= 16) {
      format = {
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!format || format.channels !== 1 || format.bits !== 16 || format.rate !== rate) {
        throw new Error(`The recording isn’t ${rate / 1000} kHz mono 16-bit audio.`);
      }
      return bytes.subarray(body, Math.min(body + size, bytes.length));
    }
    // Chunks are padded to an even length.
    at = body + size + (size % 2);
  }
  throw new Error('The recording has no audio in it.');
}
