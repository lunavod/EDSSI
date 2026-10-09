import { describe, expect, it } from 'vitest';

import {
  GLIDE_AFTER_MS,
  HOLD_TIMEOUT_MS,
  SCROLL_NOTCH_REM,
  SCROLL_SPEED_REM,
  Scroller,
  speed,
} from './scroll';

const FRAME_MS = 1000 / 60;
/** A rem of 10 px, so distances read easily. */
const REM = 10;

/** Steps the scroller frame by frame from `from` to `to`, answering each frame's pixels. */
function run(scroller: Scroller, from: number, to: number): number[] {
  const frames: number[] = [];
  for (let now = from; now <= to; now += FRAME_MS) frames.push(scroller.step(now, REM));
  return frames;
}

const sum = (frames: number[]) => frames.reduce((total, pixels) => total + pixels, 0);

describe('Scroller', () => {
  it('scrolls one notch for a tap, spread over several frames rather than at once', () => {
    const scroller = new Scroller();
    scroller.hold(-1, 1, 0);
    scroller.release();

    const frames = run(scroller, 0, 1000);
    expect(sum(frames)).toBeCloseTo(-SCROLL_NOTCH_REM * REM, -1);
    // Eased out: no single frame carries the whole notch, and it starts with the biggest move.
    const moving = frames.filter((pixels) => pixels !== 0);
    expect(moving.length).toBeGreaterThan(4);
    expect(Math.max(...moving.map(Math.abs))).toBeLessThan((SCROLL_NOTCH_REM * REM) / 2);
    expect(scroller.active(1000)).toBe(false);
  });

  it('glides while held, at the speed the control asks for', () => {
    const scroller = new Scroller();
    for (let now = 0; now <= 3000; now += 20) scroller.hold(-1, 1, now);

    // Well into the glide, a second covers the full speed and no more.
    const frames: number[] = [];
    for (let now = 0; now <= 3000; now += FRAME_MS) frames.push(scroller.step(now, REM));
    const lastSecond = frames.slice(-60);
    expect(-sum(lastSecond)).toBeGreaterThan(SCROLL_SPEED_REM.max * REM * 0.95);
    expect(-sum(lastSecond)).toBeLessThan(SCROLL_SPEED_REM.max * REM * 1.05);
  });

  it('never stalls between the notch and the glide', () => {
    const scroller = new Scroller();
    const frames: number[] = [];
    for (let now = 0; now <= 1000; now += FRAME_MS) {
      scroller.hold(1, 1, now);
      // The main panel's own line height, which is what the stall was seen at.
      frames.push(scroller.step(now, 26));
    }

    // After the first frame (which has no time behind it) every frame moves the page.
    expect(frames.slice(1).every((pixels) => pixels > 0)).toBe(true);
  });

  it('goes slower the less a ministick is pushed', () => {
    const distance = (strength: number) => {
      const scroller = new Scroller();
      const frames: number[] = [];
      for (let now = 0; now <= 2000; now += FRAME_MS) {
        scroller.hold(1, strength, now);
        frames.push(scroller.step(now, REM));
      }
      return sum(frames);
    };

    expect(distance(0.2)).toBeLessThan(distance(0.6));
    expect(distance(0.6)).toBeLessThan(distance(1));
    expect(speed(0)).toBe(SCROLL_SPEED_REM.min);
    expect(speed(1)).toBe(SCROLL_SPEED_REM.max);
  });

  it('comes to a stop soon after being let go', () => {
    const scroller = new Scroller();
    let now = 0;
    for (; now <= 1500; now += FRAME_MS) {
      scroller.hold(-1, 1, now);
      scroller.step(now, REM);
    }

    scroller.release();
    const after = run(scroller, now, now + 1000);
    // A short coast, not a run on: well under a notch's worth of seconds at full speed.
    expect(-sum(after)).toBeLessThan(SCROLL_SPEED_REM.max * REM * 0.2);
    expect(scroller.active(now + 1000)).toBe(false);
  });

  it('stops by itself if it is never told the control was let go', () => {
    const scroller = new Scroller();
    for (let now = 0; now <= 1000; now += 20) scroller.hold(-1, 1, now);
    run(scroller, 0, 1000);

    run(scroller, 1000, 1000 + HOLD_TIMEOUT_MS + 1000);
    expect(scroller.active(1000 + HOLD_TIMEOUT_MS + 1000)).toBe(false);
  });

  it('is about one notch per press when the binding does not repeat', () => {
    const scroller = new Scroller();
    // Pressed once and held, with nothing heard after the press: a notch and a moment's creep,
    // never a glide.
    scroller.hold(-1, 1, 0);
    const frames = run(scroller, 0, GLIDE_AFTER_MS + 1000);
    expect(-sum(frames)).toBeGreaterThan(SCROLL_NOTCH_REM * REM);
    expect(-sum(frames)).toBeLessThan(SCROLL_NOTCH_REM * REM * 1.25);
  });

  it('adds up quick taps rather than dropping them', () => {
    const scroller = new Scroller();
    for (const at of [0, 120, 240]) {
      scroller.hold(-1, 1, at);
      scroller.release();
    }

    const frames = run(scroller, 0, 1500);
    expect(sum(frames)).toBeCloseTo(-3 * SCROLL_NOTCH_REM * REM, -1);
  });

  it('turns round at once when pressed the other way', () => {
    const scroller = new Scroller();
    let now = 0;
    for (; now <= 1000; now += FRAME_MS) {
      scroller.hold(-1, 1, now);
      scroller.step(now, REM);
    }

    scroller.release();
    scroller.hold(1, 1, now);
    scroller.release();
    const after = run(scroller, now + FRAME_MS, now + 1000);
    expect(after.every((pixels) => pixels >= 0)).toBe(true);
    expect(sum(after)).toBeGreaterThan(0);
  });
});
