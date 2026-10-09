/**
 * Push-to-talk: the keyboard hook and the sticks, resolved against the commander's bindings into
 * one answer — should the microphone be open right now?
 *
 * Both halves are native modules, and either may fail to load on a given machine. Neither is
 * allowed to stop EDSSI: what failed is reported to the settings screen, and whatever still works
 * keeps working.
 */

import { ipcMain } from 'electron';

import { IpcChannel } from '../../shared/api';
import {
  type BindingState,
  bindingKey,
  bindingLabel,
  type BoundAction,
  type CaptureResult,
  type InputBinding,
  type InputDevice,
  type InputSnapshot,
} from '../../shared/input';
import { broadcast } from '../broadcast';
import { ClickCounter, MULTI_CLICK_MS } from './clicks';
import { type JoystickWatcher, startJoystickWatcher } from './joystick';
import {
  chordHeld,
  chordOf,
  formatChord,
  type KeyboardHook,
  parseAccelerator,
  startKeyboardHook,
} from './keyboard';
import { type KeySender, loadKeySender } from './send-keys';

/**
 * A button that chatters, or a key the hook reports twice, shouldn't chop a question in half. A
 * release only counts once the binding has stayed up this long.
 */
const RELEASE_GRACE_MS = 120;

/**
 * How long a repeating action waits before it starts repeating, and how often it fires after that.
 *
 * The delay is what makes one press mean one step: without it a control that repeats would fire
 * twice for the shortest press anyone can make. The interval is a little quicker than a keyboard's
 * own repeat, because the things that repeat here are scrolling, where the commander is watching
 * the panel move and stops when it has gone far enough.
 */
const REPEAT_DELAY_MS = 350;
const REPEAT_EVERY_MS = 60;

/**
 * A press this soon after the same control was let go is the same press, not another one.
 *
 * Stick buttons bounce, and a stick that sends more than one kind of report can drop a held button
 * out of one of them for an instant. Either way what reaches here is a release and a press a few
 * milliseconds apart, which is one press counted twice: a command run twice, and two taps counted
 * as the three a triple click wants. Nobody taps twice in 25 ms, so nothing real is lost.
 */
const BOUNCE_MS = 25;

/**
 * `EDSSI_INPUT_LOG=1` prints every edge of every watched control and every action it runs, with
 * the time since the last edge of that control.
 *
 * Two presses where the commander made one is the kind of thing that can only be argued about
 * from the outside; this is what settles it. The gap it prints is the whole answer — a few
 * milliseconds is a control bouncing or a report that doesn't carry it, and a hundred is the
 * commander pressing twice.
 */
const logging = process.env['EDSSI_INPUT_LOG'] === '1';

/**
 * How often the clock is looked at while something is waiting to be resolved — a click that may
 * yet be a double, or a control being held down to repeat. Nothing runs at all when neither is
 * true, which is almost always.
 */
const PUMP_MS = 20;

export interface InputServiceOptions {
  /** What the commander bound; replaced whenever the settings file is saved. */
  bindings: InputBinding[];
  /** Hold the binding to talk. When false a press toggles, the way EDSSI used to work. */
  holdToTalk: boolean;
  /**
   * How long a control with two or three presses bound waits to see whether another is coming.
   * `input.multi_click_ms` in the settings file; the commander's, because how quickly a stick
   * button can be tapped twice is a fact about their hand and their stick, not about EDSSI.
   */
  multiClickMs?: number;
  /** The microphone should open or close. */
  onListen(action: 'start' | 'stop'): void;
  /** The native halves, so the press-and-release logic can be tested without a keyboard. */
  hooks?: {
    keyboard?: typeof startKeyboardHook;
    joystick?: typeof startJoystickWatcher;
    keys?: typeof loadKeySender;
  };
}

export interface InputService {
  configure(bindings: InputBinding[], holdToTalk: boolean, multiClickMs?: number): void;
  /**
   * Watches bindings for the things that aren't push-to-talk — at the moment the VR cockpit's
   * commands. The keyboard hook and the sticks are singletons, so everything that wants a global
   * input has to come through here.
   *
   * One action per name, each with whatever the commander bound to it: key chords, stick buttons,
   * a hat direction, a ministick pushed past its threshold. A press runs it; `clicks` on a binding
   * asks for two or three in quick succession instead, and `repeat` keeps it running while the
   * control is held. Answers a function that stops watching.
   */
  actions(actions: Readonly<Record<string, InputAction>>): () => void;
  /**
   * Types a key chord into whatever has focus, such as `Control+V`, by scan code so the game takes
   * it. Rejects when it couldn't: a chord EDSSI doesn't understand, or Windows refusing it.
   */
  tap(accelerator: string): Promise<void>;
  snapshot(): InputSnapshot;
  /** Waits for the commander to press a key or a button. Answers nothing if it is cancelled. */
  capture(): Promise<CaptureResult | undefined>;
  cancelCapture(): void;
  stop(): void;
}

/** Something bound to an input, for anything that isn't push-to-talk. */
export interface InputAction {
  /** What the commander bound to it; any of them runs it. */
  bindings: readonly BoundAction[];
  /** Keep running it while the control is held, unless a binding says otherwise. */
  repeat?: boolean;
  /**
   * How long a repeating action waits before it starts repeating, and how often after that;
   * `REPEAT_DELAY_MS` and `REPEAT_EVERY_MS` unless it says otherwise. Scrolling asks for both to be
   * short: it doesn't step, it glides, and needs to hear how hard a ministick is pushed as it moves.
   */
  repeatDelayMs?: number;
  repeatEveryMs?: number;
  /**
   * `strength` is how hard the control is being held: 1 for a key or a button, and how far past
   * its threshold an axis has been pushed — so a ministick can scroll faster the further it goes.
   */
  run(strength: number): void;
  /**
   * The control that ran it has been let go. Only for an action that keeps something going while
   * it is held, and said on every release — whether or not the press got as far as running it.
   */
  release?(): void;
}

/** One binding of one action, as the service watches it. */
interface Watched {
  /** What it is bound to, for the log. */
  name: string;
  /** The control it is on; everything bound to the same control shares a click counter. */
  key: string;
  binding: InputBinding;
  clicks: number;
  repeat: boolean;
  repeatDelayMs: number;
  repeatEveryMs: number;
  run(strength: number): void;
  release?(): void;
  /** When it next repeats, while it is still held. */
  repeatAt?: number;
}

/**
 * Everything bound to one control, and how far through pressing it the commander is.
 *
 * Kept by control rather than rebuilt with the bindings, because a rebind is not an input: saving
 * the settings, or editing the cockpit's layout, unbinds everything and binds it again, and a tap
 * already made and waiting to find out whether it is a double has to live across that.
 */
interface Control {
  key: string;
  /** What is bound to it now. Empty means nothing is any more; see `pollActions`. */
  entries: Watched[];
  /** What was bound when the counter was made, so an actual change starts the count over. */
  signature: string;
  counter: ClickCounter<Watched>;
  /** Whether the control was down last time it was looked at. */
  held: boolean;
  /** When it was last let go, so a press that follows too closely can be seen for what it is. */
  releasedAt?: number;
}

/** A capture in progress: the settings screen is waiting for the commander to press something. */
interface Capture {
  finish(binding: InputBinding | undefined): void;
  stopJoystick?: () => void;
}

export function startInputService(options: InputServiceOptions): InputService {
  const problems: string[] = [];

  let bindings = options.bindings;
  let holdToTalk = options.holdToTalk;
  let multiClick = options.multiClickMs ?? MULTI_CLICK_MS;
  let devices: InputDevice[] = [];
  let keys: ReadonlySet<number> = new Set();
  let down = false;
  let toggled = false;
  let releaseTimer: NodeJS.Timeout | undefined;
  let capture: Capture | undefined;
  let watched: readonly Watched[] = [];
  const controls = new Map<string, Control>();
  let pump: NodeJS.Timeout | undefined;
  /** Which watched controls were lit last time, so a snapshot only goes out when that changes. */
  let litKeys = '';
  let version = 0;

  let keyboard: KeyboardHook | undefined;
  let joystick: JoystickWatcher | undefined;
  /** Loaded the first time a chord is typed; most commanders never bind anything that does. */
  let sender: KeySender | undefined;

  function isHeld(binding: InputBinding): boolean {
    if (binding.kind !== 'key') return joystick?.held(binding) ?? false;
    const chord = parseAccelerator(binding.accelerator);
    return chord !== undefined && chordHeld(chord, keys);
  }

  function anyHeld(): boolean {
    return bindings.some(isHeld);
  }

  /**
   * Which bindings are down, for the settings screen's lights. Everything watched, not only
   * push-to-talk: a cockpit command bound to a stick button is exactly as hard to be sure of, and
   * the light is how the commander knows they bound the button they meant.
   */
  function bindingState(): BindingState {
    const state: BindingState = {};
    for (const binding of bindings) state[bindingKey(binding)] = isHeld(binding);
    for (const entry of watched) state[entry.key] ??= isHeld(entry.binding);
    return state;
  }

  function snapshot(): InputSnapshot {
    return {
      version,
      devices,
      state: bindingState(),
      capturing: capture !== undefined,
      talking: down,
      problem: problems.length > 0 ? problems.join(' ') : undefined,
    };
  }

  function publish(): void {
    version++;
    broadcast(IpcChannel.InputChanged, snapshot());
  }

  /**
   * Whether a binding is being held to talk. While the settings screen waits for a press, a bound
   * key is being rebound rather than held to talk, so the same press must not open the microphone.
   */
  function talking(): boolean {
    return capture === undefined && anyHeld();
  }

  /** Turns "a binding went down or up" into "open the microphone" or "close it". */
  function evaluate(): void {
    const now = talking();
    if (now === down) {
      // Coming back within the grace period means it never really let go.
      if (now && releaseTimer) {
        clearTimeout(releaseTimer);
        releaseTimer = undefined;
      }
      return;
    }

    if (now) {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
      down = true;
      publish();
      if (holdToTalk) {
        options.onListen('start');
      } else {
        toggled = !toggled;
        options.onListen(toggled ? 'start' : 'stop');
      }
      return;
    }

    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      releaseTimer = undefined;
      // It came back while we waited: still talking.
      if (talking()) return;
      down = false;
      publish();
      if (holdToTalk) options.onListen('stop');
    }, RELEASE_GRACE_MS);
  }

  /** How hard a binding is being held: all or nothing for a key, how far pushed for an axis. */
  function strengthOf(binding: InputBinding): number {
    if (binding.kind === 'key') return isHeld(binding) ? 1 : 0;
    return joystick?.strength(binding) ?? (isHeld(binding) ? 1 : 0);
  }

  function run(entry: Watched): void {
    if (logging) console.log(`[input] ${entry.name} ran (${bindingLabel(entry.binding)})`);
    try {
      // Never nothing: a key or a button is all of it, and an axis that has come back under its
      // threshold between the press and this moment still meant the press.
      entry.run(Math.max(strengthOf(entry.binding), 0.001));
    } catch (error) {
      console.error('[input] an action failed', error);
    }
  }

  function release(entry: Watched): void {
    try {
      entry.release?.();
    } catch (error) {
      console.error('[input] an action failed to let go', error);
    }
  }

  /** Runs it, and — if it repeats — says when it should run again while it is still held. */
  function fire(entry: Watched, now: number): void {
    run(entry);
    if (entry.repeat) entry.repeatAt = now + entry.repeatDelayMs;
  }

  /**
   * Gathers what is bound by the control it is on, so the presses of one control are counted once.
   *
   * A control that has nothing bound to it any more keeps its record with no entries rather than
   * being dropped here: rebinding unbinds and binds in the same breath, and dropping it in between
   * is what threw away a press that was halfway counted. `pollActions` clears out the ones that
   * really have gone.
   */
  function regroup(): void {
    const byKey = new Map<string, Watched[]>();
    for (const entry of watched) {
      const existing = byKey.get(entry.key);
      if (existing) existing.push(entry);
      else byKey.set(entry.key, [entry]);
    }

    for (const [key, entries] of byKey) {
      const signature = `${multiClick}|${entries.map((entry) => `${entry.name}#${entry.clicks}`).join(' ')}`;
      const control = controls.get(key);
      if (control === undefined) {
        controls.set(key, {
          key,
          entries,
          signature,
          counter: counterFor(entries),
          // A control that is already down stays down: registering under one that happens to be
          // held must not fire it, which is the same rule capture follows.
          held: entries.some((entry) => isHeld(entry.binding)),
        });
        continue;
      }

      control.entries = entries;
      // The same things, pressed the same ways: the counter carries on. The entries themselves are
      // new objects every time, so it is the shape of what is bound that decides, not identity.
      if (control.signature !== signature) {
        control.signature = signature;
        control.counter = counterFor(entries);
      }
    }

    for (const [key, control] of controls) if (!byKey.has(key)) control.entries = [];
  }

  function counterFor(entries: readonly Watched[]): ClickCounter<Watched> {
    return new ClickCounter(
      entries.map((entry) => ({ clicks: entry.clicks, action: entry })),
      multiClick,
    );
  }

  /**
   * What the bound controls are doing now: presses counted, and anything held down repeated. A
   * control being rebound in the settings screen is being captured rather than pressed, the same
   * rule push-to-talk follows.
   */
  function pollActions(): void {
    const now = Date.now();
    let lit = '';
    for (const group of controls.values()) {
      // Nothing is bound to it any more — not for an instant mid-rebind, but really — so whatever
      // was being counted on it is cancelled along with the binding.
      if (group.entries.length === 0) {
        group.counter.reset();
        controls.delete(group.key);
        continue;
      }

      const first = group.entries[0];
      const held = capture === undefined && first !== undefined && isHeld(first.binding);
      if (held) lit += `${group.key} `;
      if (held && !group.held) {
        // A press that follows its own release too closely is that same press, bouncing.
        const since = group.releasedAt === undefined ? undefined : now - group.releasedAt;
        const bouncing = since !== undefined && since < BOUNCE_MS;
        if (logging) {
          const gap = since === undefined ? 'first' : `${since}ms since it was let go`;
          console.log(`[input] ${group.key} down — ${gap}${bouncing ? ', taken as a bounce' : ''}`);
        }
        if (!bouncing) for (const entry of group.counter.press(now).fire) fire(entry, now);
      }
      if (!held && group.held) {
        group.releasedAt = now;
        if (logging) console.log(`[input] ${group.key} up`);
        for (const entry of group.entries) release(entry);
      }
      group.held = held;

      if (!held) {
        // Let go: whatever was repeating stops, though a click may still be waiting to settle.
        for (const entry of group.entries) entry.repeatAt = undefined;
        continue;
      }

      for (const entry of group.entries) {
        if (entry.repeatAt === undefined || now < entry.repeatAt) continue;
        entry.repeatAt = now + entry.repeatEveryMs;
        run(entry);
      }
    }

    // The settings screen lights a binding while it is held, so an edge is worth a snapshot —
    // and only an edge: an axis being swept says so fifteen times a second.
    if (lit !== litKeys) {
      litKeys = lit;
      publish();
    }

    settlePump();
  }

  /** A click whose window has closed now counts for however many presses it came to. */
  function tickActions(): void {
    const now = Date.now();
    for (const group of controls.values()) {
      for (const entry of group.counter.tick(now).fire) fire(entry, now);
    }
    pollActions();
  }

  /**
   * The pump runs only while something is actually waiting — a click that may yet turn into a
   * double, or a control being held down to repeat — which is why an idle EDSSI has no timer for
   * this at all.
   */
  function settlePump(): void {
    const waiting = [...controls.values()].some(
      (group) =>
        group.counter.pending || group.entries.some((entry) => entry.repeatAt !== undefined),
    );
    if (waiting) pump ??= setInterval(tickActions, PUMP_MS);
    else stopPump();
  }

  function stopPump(): void {
    if (pump === undefined) return;
    clearInterval(pump);
    pump = undefined;
  }

  function watchActions(actions: Readonly<Record<string, InputAction>>): () => void {
    const added: Watched[] = [];
    for (const [name, action] of Object.entries(actions)) {
      for (const bound of action.bindings) {
        const { binding } = bound;
        if (binding.kind === 'key' && parseAccelerator(binding.accelerator) === undefined) {
          console.error(`[input] ${binding.accelerator} is not a chord EDSSI understands`);
          continue;
        }
        added.push({
          name,
          key: bindingKey(binding),
          binding,
          clicks: Math.max(1, Math.round(bound.clicks ?? 1)),
          repeat: bound.repeat ?? action.repeat ?? false,
          repeatDelayMs: action.repeatDelayMs ?? REPEAT_DELAY_MS,
          repeatEveryMs: action.repeatEveryMs ?? REPEAT_EVERY_MS,
          run: (strength) => action.run(strength),
          ...(action.release && { release: () => action.release?.() }),
        });
      }
    }

    watched = [...watched, ...added];
    regroup();
    return () => {
      watched = watched.filter((entry) => !added.includes(entry));
      regroup();
    };
  }

  try {
    keyboard = (options.hooks?.keyboard ?? startKeyboardHook)({
      onChange(held) {
        keys = held;
        evaluate();
        pollActions();
        if (capture) publish();
      },
      onPress(keycode, held) {
        if (!capture) return;
        const chord = chordOf(keycode, held);
        if (chord) capture.finish({ kind: 'key', accelerator: formatChord(chord) });
      },
    });
  } catch (error) {
    problems.push(`Keyboard bindings are off: ${message(error)}.`);
    console.error('[input] the keyboard hook could not start', error);
  }

  try {
    joystick = (options.hooks?.joystick ?? startJoystickWatcher)({
      onChange() {
        evaluate();
        pollActions();
        if (capture) publish();
      },
      onDevices(found) {
        devices = found;
        publish();
      },
    });
    devices = joystick.devices();
  } catch (error) {
    problems.push(`Joystick bindings are off: ${message(error)}.`);
    console.error('[input] the joystick watcher could not start', error);
  }

  /** Waits for a key or a button, and answers with what it was. Cancelling answers nothing. */
  function beginCapture(): Promise<CaptureResult | undefined> {
    capture?.finish(undefined);
    return new Promise<CaptureResult | undefined>((resolve) => {
      const session: Capture = {
        finish(binding) {
          if (capture !== session) return;
          capture = undefined;
          session.stopJoystick?.();
          publish();
          resolve(binding === undefined ? undefined : { binding, label: bindingLabel(binding) });
        },
      };
      capture = session;
      // Anything held right now stops counting as push-to-talk.
      evaluate();
      session.stopJoystick = joystick?.capture((binding) => session.finish(binding));
      publish();
    });
  }

  function cancelCapture(): void {
    capture?.finish(undefined);
  }

  ipcMain.handle(IpcChannel.InputSnapshot, (): InputSnapshot => snapshot());
  ipcMain.handle(IpcChannel.InputCapture, () => beginCapture());
  ipcMain.handle(IpcChannel.InputCaptureCancel, () => cancelCapture());

  return {
    configure(next, hold, multiClickMs) {
      bindings = next;
      holdToTalk = hold;
      const window = multiClickMs ?? MULTI_CLICK_MS;
      if (window !== multiClick) {
        multiClick = window;
        // The counters carry the window, so they are the thing that has to be made again.
        regroup();
      }
      toggled = false;
      // Whatever was held under the old bindings isn't held under the new ones.
      if (down && !talking()) {
        down = false;
        if (hold) options.onListen('stop');
      }
      publish();
    },
    actions: watchActions,
    async tap(accelerator) {
      const chord = parseAccelerator(accelerator);
      if (chord === undefined) throw new Error(`${accelerator} is not a chord EDSSI understands`);
      sender ??= (options.hooks?.keys ?? loadKeySender)();
      await sender.tap(chord);
    },
    snapshot,
    capture: beginCapture,
    cancelCapture,
    stop() {
      clearTimeout(releaseTimer);
      stopPump();
      cancelCapture();
      watched = [];
      controls.clear();
      keyboard?.stop();
      joystick?.stop();
    },
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
