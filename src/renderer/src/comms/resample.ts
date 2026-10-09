/**
 * Resamples the spoken answer to whatever rate the sound card runs at, keeping its place between
 * one piece of audio and the next.
 *
 * Web Audio will resample an `AudioBuffer` on its own, but it does it to each buffer separately:
 * with the answer arriving as a few dozen pieces a second, every join is a discontinuity, and the
 * result is a crackle over the whole reply. Doing it here, once, across the join, is what makes
 * that go away — a buffer that is already at the device's rate is passed straight through.
 */

export class Resampler {
  /** The last sample handed over, so the first output of the next piece interpolates from it. */
  #last = 0;
  /** Where the next output sample falls, measured from the start of the next piece. */
  #position = 0;

  /** Forgets where it was; the next piece starts a new sound. */
  reset(): void {
    this.#last = 0;
    this.#position = 0;
  }

  /**
   * Converts `input` from `inRate` to `outRate`. The last sample of each call is held back to
   * interpolate against the first sample of the next, so nothing clicks at the join.
   */
  resample(input: Float32Array, inRate: number, outRate: number): Float32Array<ArrayBuffer> {
    if (inRate === outRate) return copy(input);

    // The sample held back last time sits in front of this piece, so the join is interpolated.
    const data = new Float32Array(input.length + 1);
    data[0] = this.#last;
    data.set(input, 1);

    const step = inRate / outRate;
    const end = data.length - 1;
    let position = this.#position;
    const count = Math.max(0, Math.ceil((end - position) / step));
    const output = new Float32Array(new ArrayBuffer(count * Float32Array.BYTES_PER_ELEMENT));

    for (let index = 0; index < count; index++) {
      const at = Math.floor(position);
      const fraction = position - at;
      const before = data[at] ?? this.#last;
      const after = data[at + 1] ?? before;
      output[index] = before + (after - before) * fraction;
      position += step;
    }

    this.#last = data[end]!;
    // Carry the overshoot, measured from the sample now sitting in front of the next piece.
    this.#position = position - end;
    return output;
  }
}

function copy(input: Float32Array): Float32Array<ArrayBuffer> {
  const output = new Float32Array(new ArrayBuffer(input.length * Float32Array.BYTES_PER_ELEMENT));
  output.set(input);
  return output;
}
