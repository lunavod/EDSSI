import { describe, expect, it } from 'vitest';

import { ButtonDetector } from './buttons';
import recording from './fixtures/vkb-gladiator-evo-r.json' with { type: 'json' };

/**
 * A recording of a real VKB Gladiator EVO, made through four prompted phases: hands off, then
 * buttons with the stick still, then axes only, then buttons while an axis is held deflected.
 *
 * It is here because every simpler rule passed in theory and failed on the actual device — the
 * axes jitter at rest, the axis high bytes creep and then sit still, and a press is mirrored into
 * two blocks at once. A change that breaks any of those cases fails here.
 */
type Phase = 'idle' | 'buttons' | 'axes' | 'both';

interface Frame {
  t: number;
  p: Phase;
  r: number;
  d: [number, number][];
}

interface Found {
  reportId: number;
  /** EDSSI's own button number: the bit's position in the report. */
  button: number;
}

/**
 * The stick sends two kinds of report: report 1 carries the axes (bytes 1-12 and 33) with the
 * buttons mirrored into bytes 17-19 and 49-52, and report 12 carries buttons alone.
 */
const AXIS_BYTES = (found: Found) => found.reportId === 1 && Math.floor(found.button / 8) <= 12;

/** Replays the recording, returning what the detector found in each phase. */
function replay(): Record<Phase, Found[]> {
  const detector = new ButtonDetector();
  const reports = new Map<number, Uint8Array>();
  for (const [id, hex] of Object.entries(recording.base)) {
    reports.set(Number(id), bytes(hex));
  }
  const found: Record<Phase, Found[]> = { idle: [], buttons: [], axes: [], both: [] };

  // Seed each report so the first real frame is a change rather than a first sighting.
  for (const [id, seed] of reports) detector.observe(id, seed, 0);

  for (const frame of recording.frames as Frame[]) {
    const current = reports.get(frame.r);
    if (!current) continue;
    for (const [index, value] of frame.d) current[index] = value;
    detector.observe(frame.r, current, frame.t);

    const hit = detector.take(frame.t);
    if (hit) found[frame.p].push({ reportId: hit.reportId, button: hit.byte * 8 + hit.bit });
  }
  return found;
}

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index++) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

describe('ButtonDetector, against a recording of a real stick', () => {
  const found = replay();

  it('binds nothing while the commander is not touching the stick', () => {
    // The axes jitter at rest on these sticks, which is what broke the first two attempts.
    expect(found.idle).toEqual([]);
  });

  it('binds nothing from the axes while they are being swept', () => {
    // The hat and the mini-stick presses in this phase are buttons, and finding them is right;
    // nothing may come from the bytes carrying the analogue axes.
    expect(found.axes.filter(AXIS_BYTES)).toEqual([]);
  });

  it('finds buttons pressed with the stick still', () => {
    expect(found.buttons.length).toBeGreaterThan(0);
    expect(found.buttons.filter(AXIS_BYTES)).toEqual([]);
  });

  it('still finds a button pressed while an axis is held deflected', () => {
    // The case that defeated the "quiet byte" rule on its own: a held axis is as still as a
    // held button.
    expect(found.both.length).toBeGreaterThan(0);
    expect(found.both.filter(AXIS_BYTES)).toEqual([]);
  });
});

function report(id: number, ...values: number[]): Uint8Array {
  return Uint8Array.from([id, ...values]);
}

describe('ButtonDetector', () => {
  it('takes a single bit that goes down and stays down', () => {
    const detector = new ButtonDetector();
    detector.observe(1, report(1, 0, 0, 0), 0);
    detector.observe(1, report(1, 0, 0, 0), 300);
    detector.observe(1, report(1, 0, 0, 0b1000), 400);
    expect(detector.take(450)).toBeUndefined(); // too soon to tell
    expect(detector.take(600)).toEqual({ reportId: 1, byte: 3, bit: 3 });
  });

  it('ignores a bit that is let go before it can be believed', () => {
    const detector = new ButtonDetector();
    detector.observe(1, report(1, 0, 0, 0), 0);
    detector.observe(1, report(1, 0, 0, 0b1000), 400);
    detector.observe(1, report(1, 0, 0, 0), 450);
    expect(detector.take(600)).toBeUndefined();
  });

  it('ignores a byte carrying several bits at once: that is a number, not a button', () => {
    const detector = new ButtonDetector();
    detector.observe(1, report(1, 0, 0, 0), 0);
    detector.observe(1, report(1, 0, 0, 0b1100), 400);
    expect(detector.take(600)).toBeUndefined();
  });

  it('ignores a bit whose neighbouring byte was moving at the same moment', () => {
    const detector = new ButtonDetector();
    detector.observe(1, report(1, 0, 0, 0), 0);
    // The low byte of an axis moves, and its high byte carries — one bit, but not a button.
    detector.observe(1, report(1, 0, 0b1, 0), 390);
    detector.observe(1, report(1, 0, 0b1, 0b1), 400);
    expect(detector.take(600)).toBeUndefined();
  });

  it('gives up on a byte that keeps moving', () => {
    const detector = new ButtonDetector();
    detector.observe(1, report(1, 0, 0, 0), 0);
    let at = 300;
    // An axis being swept: the same byte, over and over.
    for (let value = 1; value <= 12; value++) {
      detector.observe(1, report(1, 0, 0, value % 2 === 0 ? 0 : 0b10000), (at += 10));
    }
    detector.observe(1, report(1, 0, 0, 0b10000), (at += 10));
    expect(detector.take(at + 300)).toBeUndefined();
  });

  it('ignores everything in the moment the capture is armed', () => {
    const detector = new ButtonDetector();
    detector.observe(1, report(1, 0, 0, 0), 0);
    detector.observe(1, report(1, 0, 0, 0b1000), 100);
    expect(detector.take(400)).toBeUndefined();
  });
});
