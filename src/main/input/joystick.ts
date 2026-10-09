/**
 * Reads the commander's sticks over raw HID, so a button held while the game has focus holds the
 * microphone open.
 *
 * Chromium's Gamepad API can't do this: it only delivers input to a focused document, which is
 * exactly what EDSSI isn't while the commander is flying. So the devices are opened in the main
 * process instead, and read report by report.
 *
 * A binding is learnt by moving the control: the commander presses the button or pushes the stick
 * and EDSSI notes which control it was, by the name the device's own descriptor gives it
 * (`usages.ts`, over `native/hid-usages`). That binding means the same thing on any stick, and an
 * axis's real range is known before it has ever been moved.
 *
 * Where that addon can't be loaded — it has to be compiled, and a packaged build may not carry it
 * — the old byte-watching detector in `buttons.ts` still learns buttons by how their bits behave,
 * so push-to-talk can always be bound. That path knows nothing of axes or hats.
 */

import type { Device } from 'node-hid';

import type { DeviceBinding, InputDevice } from '../../shared/input';
import { bindingMatchesDevice } from '../../shared/input';
import { ButtonDetector } from './buttons';
import {
  type ControlPress,
  type ControlState,
  controlHeld,
  controlStrength,
  decodeReport,
  describeDevice,
  type DescribedDevice,
  pressedControls,
} from './usages';

/** Generic Desktop; a joystick or a gamepad. Nothing else is opened. */
const USAGE_PAGE = 1;
const JOYSTICK_USAGES = new Set([4, 5]);

/**
 * Sticks are plugged in and out while EDSSI runs, so the list is checked again this often. The
 * check is asynchronous on purpose: enumerating HID devices takes about 200 ms on Windows, and
 * doing that on the main thread every couple of seconds chopped holes in the spoken answers.
 */
const RESCAN_MS = 2000;

/**
 * How often a capture checks whether a candidate button has proved itself. A press is believed
 * once its byte has been quiet for a moment, which cannot be judged from the report alone.
 */
const CAPTURE_TICK_MS = 30;

/**
 * How long a named control has to stay held before it is taken as the binding. Short — the device
 * has already said what the control is, so this is only guarding against a ministick flicking past
 * its threshold on the way back to centre, not working out what kind of control it was.
 */
const CAPTURE_HOLD_MS = 120;

/** One open device. */
interface OpenDevice {
  info: InputDevice;
  path: string;
  device: { close(): void };
  /** The latest report of each report id; a device may send more than one kind. */
  reports: Map<number, Buffer>;
  /** What Windows says this device's controls are, when the addon could be loaded. */
  described?: DescribedDevice;
  /**
   * The latest named values and buttons, decoded per report id.
   *
   * Per report id, and not one state for the device, because a report says nothing at all about
   * the controls that live in another one: `HidP_GetUsages` refuses a report whose id isn't the
   * caps' id, so decoding report 2 answers "no buttons are down" about report 1's buttons. Held in
   * one state, a stick that sends more than one kind of report dropped every button for as long as
   * it took the next report to arrive — which turned one press into two, and made a double click
   * out of a single tap.
   */
  controls: Map<number, ControlState>;
}

/** A capture in progress: what each device was doing when it began, and what to call back. */
interface Capture {
  /**
   * What each device's controls were at rest, so only a change counts. Keyed by device path and
   * then by report id, the same way the live state is.
   */
  baselines: Map<string, Map<number, ControlState>>;
  /** The control found moving on each device, and when, until it has been held long enough. */
  pending: Map<string, { press: ControlPress; at: number }>;
  /** Only for devices Windows couldn't describe for us; see `ButtonDetector`. */
  detectors: Map<string, ButtonDetector>;
  timer: NodeJS.Timeout;
  onPress: (binding: DeviceBinding) => void;
}

export interface JoystickHandlers {
  /** A report changed, so anything bound to a bit may have gone down or up. */
  onChange(): void;
  /** The devices EDSSI can see, whenever that list changes. */
  onDevices(devices: InputDevice[]): void;
}

export interface JoystickWatcher {
  /** Whether the bound button is down right now. False when its device isn't plugged in. */
  /** Whether a binding is down: a named control when the addon loaded, else a raw bit. */
  held(binding: DeviceBinding): boolean;
  /**
   * How hard it is being held, from 0 to 1. A button is 1 or 0; an axis says how far it has been
   * pushed, which is what lets scrolling on a ministick go faster the further it goes.
   */
  strength(binding: DeviceBinding): number;
  devices(): InputDevice[];
  /**
   * Watches for a control being moved, for the settings screen: the commander presses the button
   * or pushes the stick, and EDSSI learns which control it was. Returns a function that stops.
   */
  capture(onPress: (binding: DeviceBinding) => void): () => void;
  stop(): void;
}

/** Closing a handle that is already gone is fine; there is nothing to do about it either way. */
/** Each stick gets its own detector, made the first time it sends a report during a capture. */
function detectorFor(capture: Capture, entry: OpenDevice): ButtonDetector {
  let detector = capture.detectors.get(entry.path);
  if (!detector) {
    detector = new ButtonDetector();
    capture.detectors.set(entry.path, detector);
  }
  return detector;
}

/** A copy of what a device is reporting, so the live state can go on changing under it. */
function snapshot(controls: Map<number, ControlState>): Map<number, ControlState> {
  return new Map(
    [...controls].map(([id, state]) => [
      id,
      { values: new Map(state.values), down: new Set(state.down) },
    ]),
  );
}

/** Whether two candidates are the same control pushed the same way. */
function same(a: ControlPress, b: ControlPress): boolean {
  return (
    a.usagePage === b.usagePage &&
    a.usage === b.usage &&
    a.mode === b.mode &&
    a.value === b.value &&
    a.direction === b.direction
  );
}

function closeDevice(entry: OpenDevice): void {
  try {
    entry.device.close();
  } catch {
    // Already gone; there is nothing to do about it.
  }
}

/**
 * Opens every joystick and keeps them open. `node-hid` is loaded here rather than at the top of
 * the file so that a machine which can't load it still starts the rest of EDSSI.
 */
export function startJoystickWatcher(handlers: JoystickHandlers): JoystickWatcher {
  /* oxlint-disable-next-line typescript/no-require-imports, typescript/no-unsafe-type-assertion --
     loaded late on purpose; `require` has no types of its own to narrow from */
  const hid = require('node-hid') as typeof import('node-hid');
  const open = new Map<string, OpenDevice>();
  let capturing: Capture | undefined;
  let stopped = false;
  let scanning = false;

  async function scan(): Promise<void> {
    // An overlapping scan would enumerate twice for nothing; one at a time is plenty.
    if (stopped || scanning) return;
    scanning = true;
    let found: Device[];
    try {
      // Off the main thread: see RESCAN_MS.
      found = await hid.devicesAsync();
    } catch (error) {
      console.error('[input] could not list HID devices', error);
      return;
    } finally {
      scanning = false;
    }
    if (stopped) return;

    const sticks = found.filter(
      (device) =>
        device.usagePage === USAGE_PAGE &&
        device.usage !== undefined &&
        JOYSTICK_USAGES.has(device.usage) &&
        device.path !== undefined,
    );
    const paths = new Set(sticks.map((device) => device.path!));

    let changed = false;
    for (const [path, entry] of open) {
      if (paths.has(path)) continue;
      // Unplugged: the read thread is already finished, but the handle still needs closing.
      closeDevice(entry);
      open.delete(path);
      changed = true;
    }
    for (const device of sticks) {
      if (open.has(device.path!)) continue;
      if (openDevice(device)) changed = true;
    }
    if (changed) handlers.onDevices(devicesNow());
  }

  function openDevice(found: Device): boolean {
    const path = found.path!;
    let device;
    try {
      // hidapi opens shared on Windows, so the game keeps reading the stick as usual.
      device = new hid.HID(path);
    } catch (error) {
      // Something else may hold it exclusively; try again on the next scan rather than give up.
      console.error(`[input] could not open ${found.product ?? path}`, error);
      return false;
    }

    const entry: OpenDevice = {
      path,
      device,
      reports: new Map(),
      described: describeDevice(path),
      controls: new Map(),
      info: {
        vendorId: found.vendorId,
        productId: found.productId,
        serial: found.serialNumber || undefined,
        // VKB pads its product names with spaces.
        product: (found.product ?? '').trim() || `${found.vendorId}:${found.productId}`,
        manufacturer: found.manufacturer?.trim() || undefined,
        connected: true,
      },
    };
    device.on('data', (data: Buffer) => receive(entry, data));
    device.on('error', (error: unknown) => {
      console.error(`[input] ${entry.info.product} stopped`, error);
      closeDevice(entry);
      open.delete(path);
      handlers.onDevices(devicesNow());
    });
    open.set(path, entry);
    return true;
  }

  /** One report from one stick: note it, tell the service, and feed any capture. */
  function receive(entry: OpenDevice, data: Buffer): void {
    const reportId = data[0] ?? 0;
    const previous = entry.reports.get(reportId);
    const report = Buffer.from(data);
    entry.reports.set(reportId, report);
    // Named controls, when this device could be described; a device that stops decoding falls back
    // to the byte view rather than going silent.
    if (entry.described) {
      const controls = entry.controls.get(reportId) ?? { values: new Map(), down: new Set() };
      entry.controls.set(reportId, controls);
      if (!decodeReport(entry.described, report, controls)) entry.described = undefined;
    }
    if (capturing) {
      // A described device is asked what moved; only one that Windows couldn't parse falls back to
      // watching bytes, where the detector wants every report — silence is what proves a press.
      if (entry.described) watchControls(capturing, entry);
      else detectorFor(capturing, entry).observe(reportId, report, Date.now());
    }
    if (previous === undefined || previous.equals(report)) {
      if (previous === undefined) handlers.onChange();
      return;
    }
    handlers.onChange();
  }

  /**
   * Notes what a described device is doing during a capture: the first report is what it looks
   * like at rest, and anything that has moved since is a candidate for the binding.
   *
   * A candidate is not taken at once. A ministick flicks past its threshold on the way back to
   * centre, and a commander reaching for a button brushes others on the way; holding the control
   * for `CAPTURE_HOLD_MS` is the difference between binding what was meant and binding what was
   * passed over. The newest candidate wins, so changing your mind mid-capture works.
   */
  function watchControls(capture: Capture, entry: OpenDevice): void {
    const described = entry.described;
    if (described === undefined) return;
    // A device plugged in mid-capture has no baseline yet; its first report is what it is at rest.
    const baseline = capture.baselines.get(entry.path);
    if (baseline === undefined) {
      capture.baselines.set(entry.path, snapshot(entry.controls));
      return;
    }

    // Each report id against what that same report said at rest. A report id that hadn't arrived
    // when the capture began is skipped rather than taken as all-new: a stick can send a kind of
    // report only occasionally — the EVO L sends ids 1 and 12 — and with nothing to compare it
    // against, whatever it carries would look like the commander having just moved it.
    const [press] = [...entry.controls].flatMap(([id, controls]) => {
      const before = baseline.get(id);
      if (before === undefined) {
        // First sighting of this kind of report: what it says now is what it says at rest, and a
        // change to it from here on counts. So a control that lives in a report EDSSI hadn't seen
        // when the capture began is bindable a moment later, rather than not at all.
        baseline.set(id, { values: new Map(controls.values), down: new Set(controls.down) });
        return [];
      }

      return pressedControls(described.values, controls, before);
    });
    const pending = capture.pending.get(entry.path);
    if (press === undefined) {
      // Let go before it counted: forget it rather than bind it when the next one is held.
      if (pending !== undefined) capture.pending.delete(entry.path);
      return;
    }

    if (pending === undefined || !same(pending.press, press)) {
      capture.pending.set(entry.path, { press, at: Date.now() });
    }
  }

  /** Asks each stick whether the commander has now held something long enough to bind it. */
  function pollCapture(): void {
    const capture = capturing;
    if (!capture) return;
    const now = Date.now();

    for (const [path, pending] of capture.pending) {
      if (now - pending.at < CAPTURE_HOLD_MS) continue;
      const entry = open.get(path);
      if (!entry || entry.described === undefined) {
        capture.pending.delete(path);
        continue;
      }
      const binding: DeviceBinding = {
        kind: 'control',
        vendorId: entry.info.vendorId,
        productId: entry.info.productId,
        serial: entry.info.serial,
        product: entry.info.product,
        usagePage: pending.press.usagePage,
        usage: pending.press.usage,
        mode: pending.press.mode,
        ...(pending.press.value === undefined ? {} : { value: pending.press.value }),
        ...(pending.press.direction ? { direction: pending.press.direction } : {}),
      };
      // Still held now, not only when it was first seen.
      const caps = entry.described.values;
      const stillHeld = [...entry.controls.values()].some((controls) =>
        controlHeld(binding, controls, caps),
      );
      if (!stillHeld) {
        capture.pending.delete(path);
        continue;
      }
      capture.onPress(binding);
      return;
    }

    // Nothing named has moved, so ask the byte-watchers: a device Windows could not describe.
    for (const [path, detector] of capture.detectors) {
      const found = detector.take(now);
      if (!found) continue;
      const entry = open.get(path);
      if (!entry) continue;
      capture.onPress({
        kind: 'button',
        vendorId: entry.info.vendorId,
        productId: entry.info.productId,
        serial: entry.info.serial,
        product: entry.info.product,
        reportId: found.reportId,
        byte: found.byte,
        bit: found.bit,
      });
      return;
    }
  }

  function devicesNow(): InputDevice[] {
    return [...open.values()].map((entry) => entry.info);
  }

  void scan();
  const timer = setInterval(() => void scan(), RESCAN_MS);

  return {
    held(binding) {
      for (const entry of open.values()) {
        if (!bindingMatchesDevice(binding, entry.info)) continue;

        if (binding.kind === 'control') {
          // Only a described device can answer this; an undescribed one simply isn't a match.
          if (entry.described === undefined) continue;
          const caps = entry.described.values;
          for (const controls of entry.controls.values()) {
            if (controlHeld(binding, controls, caps)) return true;
          }
          continue;
        }

        const report = entry.reports.get(binding.reportId);
        const byte = report?.[binding.byte];
        if (byte !== undefined && (byte & (1 << binding.bit)) !== 0) return true;
      }
      return false;
    },
    devices: devicesNow,
    strength(binding) {
      let most = 0;
      for (const entry of open.values()) {
        if (!bindingMatchesDevice(binding, entry.info)) continue;
        if (binding.kind === 'control') {
          if (entry.described === undefined) continue;
          for (const controls of entry.controls.values()) {
            most = Math.max(most, controlStrength(binding, controls, entry.described.values));
          }
          continue;
        }
        const report = entry.reports.get(binding.reportId);
        const byte = report?.[binding.byte];
        if (byte !== undefined && (byte & (1 << binding.bit)) !== 0) return 1;
      }
      return most;
    },
    capture(onPress) {
      const started: Capture = {
        // What every stick is doing right now, taken before a single report has come in. A stick
        // at rest sends about four reports a second, so waiting for one would mean a quarter of a
        // second in which the commander's first press became the baseline and so bound nothing.
        baselines: new Map(
          [...open.values()]
            .filter((entry) => entry.described !== undefined)
            .map((entry) => [entry.path, snapshot(entry.controls)]),
        ),
        pending: new Map(),
        detectors: new Map(),
        timer: setInterval(pollCapture, CAPTURE_TICK_MS),
        onPress,
      };
      capturing = started;
      return () => {
        clearInterval(started.timer);
        if (capturing === started) capturing = undefined;
      };
    },
    stop() {
      stopped = true;
      if (capturing) clearInterval(capturing.timer);
      capturing = undefined;
      clearInterval(timer);
      for (const entry of open.values()) closeDevice(entry);
      open.clear();
    },
  };
}
