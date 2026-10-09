/**
 * Single, double and triple clicks: which of the things bound to one control the commander meant.
 *
 * A stick has fewer buttons than the cockpit has commands, so one button carries more than one —
 * a press hides the panels, two presses pin them where you are looking. The cost is a wait: a
 * press can only be known to be a single click once the moment a second one could have arrived
 * has passed.
 *
 * That wait is why this is per control rather than per binding. A control with nothing but single
 * clicks on it fires them the instant it goes down, which is every push-to-talk binding and almost
 * every key; only a control that actually has a double or triple bound pays for one. Getting that
 * the wrong way round would put a fifth of a second between every press and what it does, which is
 * exactly the sort of thing that feels broken without ever being noticed as a setting.
 *
 * Nothing here reads the clock or sets a timer: the caller passes the time in and asks again, so
 * it can be tested by hand rather than with sleeps.
 */

/** How long after a press a second one still counts as part of the same click. */
export const MULTI_CLICK_MS = 280;

/** One thing bound to this control, and how many presses it wants. */
export interface ClickEntry<T> {
  clicks: number;
  action: T;
}

/** What a press or a tick came to: what to run now, and when to ask again if nothing yet. */
export interface ClickResult<T> {
  fire: T[];
  /** When `tick` should next be called, in the caller's own clock. Absent means nothing pending. */
  due?: number;
}

/**
 * Counts presses of one control and says what they meant.
 *
 * Rebuilt whenever what is bound to the control changes, so it never has to be told about a
 * binding going away.
 */
export class ClickCounter<T> {
  readonly #entries: readonly ClickEntry<T>[];
  readonly #window: number;
  readonly #most: number;
  #count = 0;
  #due: number | undefined;

  constructor(entries: readonly ClickEntry<T>[], windowMs: number = MULTI_CLICK_MS) {
    this.#entries = entries;
    this.#window = windowMs;
    this.#most = entries.reduce((most, entry) => Math.max(most, entry.clicks), 1);
  }

  /** Whether a press on this control has to be waited on at all. */
  get delayed(): boolean {
    return this.#most > 1;
  }

  /** Whether a run of presses is waiting to be settled, so the caller has to tick. */
  get pending(): boolean {
    return this.#due !== undefined;
  }

  /** The control has gone down. */
  press(now: number): ClickResult<T> {
    if (!this.delayed) return { fire: this.#matching(1) };

    // A pause longer than the window ends the run, whatever the caller did about the tick.
    if (this.#due !== undefined && now > this.#due) this.#count = 0;
    this.#count++;

    // As many as anything here asks for: there is nothing left to wait for.
    if (this.#count >= this.#most) {
      const fire = this.#matching(this.#count);
      this.reset();
      return { fire };
    }

    this.#due = now + this.#window;
    return { fire: [], due: this.#due };
  }

  /** Time has passed; whatever the presses so far came to, if the window has now closed. */
  tick(now: number): ClickResult<T> {
    if (this.#due === undefined) return { fire: [] };
    if (now < this.#due) return { fire: [], due: this.#due };
    const fire = this.#matching(this.#count);
    this.reset();
    return { fire };
  }

  reset(): void {
    this.#count = 0;
    this.#due = undefined;
  }

  /**
   * What a run of this many presses runs: whatever asked for exactly that many, or failing that
   * the most demanding thing that asked for fewer.
   *
   * The fallback is what makes a double click on a button that only has a single bound still do
   * the single thing, rather than nothing at all — which, from inside a headset, is
   * indistinguishable from the binding not working.
   */
  #matching(count: number): T[] {
    const exact = this.#entries.filter((entry) => entry.clicks === count);
    if (exact.length > 0) return exact.map((entry) => entry.action);

    const best = this.#entries
      .filter((entry) => entry.clicks < count)
      .reduce((most, entry) => Math.max(most, entry.clicks), 0);
    if (best === 0) return [];
    return this.#entries.filter((entry) => entry.clicks === best).map((entry) => entry.action);
  }
}
