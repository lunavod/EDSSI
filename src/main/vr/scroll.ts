/**
 * Smooth scrolling for the VR panels, which have no wheel and no pointer.
 *
 * Scrolling used to be a wheel event of 120 px per press and one more every 60 ms while held, on a
 * panel painting at most 15 times a second: the page moved in jumps, stopped for a third of a
 * second before a held control began repeating, and then lurched along. From inside a headset that
 * reads as a stutter, and text that jumps can't be read while it moves.
 *
 * This is a small piece of physics instead, stepped every frame. A press starts one notch that
 * eases out over a few frames rather than landing all at once. Held past `GLIDE_AFTER_MS`, it
 * glides: the speed rises smoothly to one set by how hard the control is held — a ministick pushed
 * a little creeps, shoved over it runs — and let go, it comes to a stop over a few frames rather
 * than dead. A tap is therefore one notch.
 *
 * Held, it never pauses between the notch and the glide. The notch has almost finished easing out
 * by the time a hold is long enough to be one, so from the press it creeps along at the slowest
 * glide instead of coming to rest, and the glide rises out of that. Without the creep the page
 * stopped for a moment and then set off, which is the very lurch this is here to take away.
 *
 * Distances are in `rem`, the panel's line height, so a notch is the same number of lines on
 * every panel whatever density it happens to be drawn at; the service turns them into pixels.
 * Pure and driven by the clock it is given, so it is tested rather than tuned in a headset.
 */

/** How far one press scrolls, in lines of type. */
export const SCROLL_NOTCH_REM = 4;

/** How fast a held scroll goes, in lines a second: barely pushed, and all the way. */
export const SCROLL_SPEED_REM = { min: 4, max: 30 } as const;

/**
 * How long a control has to be held before the notch becomes a glide. Longer than a tap, so a tap
 * is one notch and nothing more; short enough to begin while the notch is still easing out.
 */
export const GLIDE_AFTER_MS = 220;

/**
 * How long a hold is believed without hearing from the control again. The input service repeats a
 * held scroll far more often than this and says when it is let go, so this only matters if that
 * word never comes — a binding removed mid-scroll — and must not leave the page running away.
 * Shorter than `GLIDE_AFTER_MS`, so a binding that doesn't repeat is one notch per press.
 */
export const HOLD_TIMEOUT_MS = 200;

/** How quickly a notch eases out: most of it within three of these. */
const NOTCH_TAU_MS = 60;
/** How quickly a glide comes up to speed, and how quickly it stops once let go. */
const ACCELERATE_TAU_MS = 140;
const STOP_TAU_MS = 80;

/** A frame longer than this is taken as this: a stalled timer mustn't turn into one big jump. */
const MAX_STEP_MS = 50;

/** Below these, what is left of a notch or a glide is nothing worth drawing. */
const REST_REM = 0.01;
const REST_SPEED_REM = 0.05;

export class Scroller {
  /** Which way: 1 up the page, -1 down it. */
  private direction: 1 | -1 = 1;
  /** What is left of the notches pressed, still to be scrolled, in rem. Signed. */
  private pending = 0;
  /** How fast it is gliding now, in rem a second. Signed. */
  private velocity = 0;
  /** How hard the control is held, from the last time it was heard from. */
  private strength = 0;
  /** When it was pressed and last heard from, while it is held; undefined once let go. */
  private pressedAt: number | undefined;
  private heardAt = 0;
  private steppedAt: number | undefined;
  /** The fraction of a pixel not yet scrolled, carried so small steps add up exactly. */
  private carry = 0;

  /**
   * The control is down: pressed just now, or still held and repeating. A press in the other
   * direction turns round at once rather than first spending what is left of the last one.
   */
  hold(direction: 1 | -1, strength: number, now: number): void {
    const pressed = !this.held(now) || direction !== this.direction;
    if (direction !== this.direction) {
      this.pending = 0;
      this.velocity = 0;
      this.carry = 0;
    }

    this.direction = direction;
    this.strength = Math.min(1, Math.max(0, strength));
    this.heardAt = now;
    if (!pressed) return;

    this.pressedAt = now;
    // Never less than a quarter of a notch: a press that registered at all has to do something,
    // however little past its threshold a ministick went.
    this.pending += direction * SCROLL_NOTCH_REM * Math.max(0.25, this.strength);
    this.steppedAt ??= now;
  }

  /** The control has been let go: whatever is gliding comes to a stop. */
  release(): void {
    this.pressedAt = undefined;
  }

  /** Whether there is anything left to scroll, so the frame timer can stop when there isn't. */
  active(now: number): boolean {
    return this.held(now) || Math.abs(this.pending) > REST_REM || this.velocity !== 0;
  }

  /**
   * How many whole pixels to scroll now, given how many pixels a rem is on the panel being
   * scrolled. Positive is up the page. The fraction left over is carried to the next frame.
   */
  step(now: number, pixelsPerRem: number): number {
    const dt = Math.min(MAX_STEP_MS, Math.max(0, now - (this.steppedAt ?? now)));
    this.steppedAt = now;

    let rem = 0;

    // The notch, easing out.
    if (this.pending !== 0) {
      const taken =
        Math.abs(this.pending) <= REST_REM ? this.pending : this.pending * ease(dt, NOTCH_TAU_MS);
      this.pending -= taken;
      rem += taken;
    }

    // The glide: creeping while held, rising towards the speed the control asks for once it is
    // held long enough, and falling back to rest when let go.
    const holding = this.held(now);
    const gliding = holding && now - (this.pressedAt ?? now) >= GLIDE_AFTER_MS;
    const target = holding ? this.direction * (gliding ? speed(this.strength) : speed(0)) : 0;
    const before = this.velocity;
    this.velocity += (target - this.velocity) * ease(dt, holding ? ACCELERATE_TAU_MS : STOP_TAU_MS);
    if (!holding && Math.abs(this.velocity) < REST_SPEED_REM) this.velocity = 0;
    // Trapezoidal, so the distance covered doesn't depend on how often this is called.
    rem += ((before + this.velocity) / 2) * (dt / 1000);

    const pixels = rem * pixelsPerRem + this.carry;
    const whole = Math.trunc(pixels);
    this.carry = pixels - whole;
    if (!this.active(now)) this.rest();
    return whole;
  }

  /** Nothing left to do: forget the clock and the fraction, so the next press starts clean. */
  private rest(): void {
    this.pending = 0;
    this.velocity = 0;
    this.carry = 0;
    this.steppedAt = undefined;
  }

  private held(now: number): boolean {
    if (this.pressedAt === undefined) return false;
    if (now - this.heardAt <= HOLD_TIMEOUT_MS) return true;
    this.pressedAt = undefined;
    return false;
  }
}

/**
 * How fast a glide goes for a control held this hard. Curved, so the first half of a ministick's
 * travel is fine control for reading along and only the last of it runs.
 */
export function speed(strength: number): number {
  const { min, max } = SCROLL_SPEED_REM;
  return min + (max - min) * Math.min(1, Math.max(0, strength)) ** 1.5;
}

/** The share of the way to a target covered in `dt`, easing exponentially with time constant `tau`. */
function ease(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}
