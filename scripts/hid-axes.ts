/**
 * Watches what a stick actually sends, so an axis can be found without parsing a report descriptor.
 *
 * EDSSI learns a *button* by noticing which bit turned on (`src/main/input/buttons.ts`). An axis
 * needs the opposite: which byte, or pair of bytes, sweeps through a range as the stick is moved.
 * Nothing in the report says which — VKB's thumbsticks sit wherever the firmware put them — so the
 * only way to know is to move one and look.
 *
 *   npm run hid -- --list                  every stick EDSSI can see
 *   npm run hid                            watch them all, by control name
 *   npm run hid -- --presses               one line per press and release, with the report id
 *   npm run hid -- --device 231d:0200      watch one, by vendor:product
 *   npm run hid -- --bytes                 the raw byte view, if the addon can't load
 *   npm run hid -- --seconds 30
 *
 * Move ONE axis through its whole travel and leave everything else alone. The byte with much the
 * largest range is that axis. A 16-bit axis shows up as two neighbouring bytes moving together,
 * the higher one with a far smaller range.
 *
 * hidapi opens shared on Windows, so this can be run while EDSSI and the game are both reading the
 * same stick.
 */

import type { Device, HID } from 'node-hid';

/** What `native/hid-usages` answers with; see that folder for why it exists. */
interface UsageValue {
  usagePage: number;
  usage: number;
  value: number;
}
interface OpenDevice {
  device: unknown;
  reportLength: number;
  values: { usagePage: number; usage: number; logicalMin: number; logicalMax: number }[];
}
interface HidUsages {
  open(path: string): OpenDevice;
  decode(device: unknown, report: Buffer): { values: UsageValue[]; buttons: UsageValue[] };
}

/** Generic Desktop usages, by the names the HID tables give them. `R` means "rotation about". */
const USAGE_NAMES: Readonly<Record<number, string>> = {
  0x30: 'X',
  0x31: 'Y',
  0x32: 'Z',
  0x33: 'Rx',
  0x34: 'Ry',
  0x35: 'Rz (twist)',
  0x36: 'Slider',
  0x37: 'Dial',
  0x38: 'Wheel',
  0x39: 'Hat switch',
};

/** Whether one line per edge is wanted instead of the table. */
const presses = process.argv.includes('--presses');
/** How often the table is redrawn. */
const REDRAW_MS = 250;
/** Generic Desktop, joystick or gamepad — the same filter the input service uses. */
const USAGE_PAGE = 1;
const JOYSTICK_USAGES = new Set([4, 5]);
/**
 * A byte has to move at least this much to be listed. One, not two: a byte that only ever shifts by
 * a single step still matters, and hiding it once cost us a round trip.
 */
const NOISE = 1;

interface ByteLog {
  min: number;
  max: number;
  changes: number;
  last: number;
}

/** One named control, and how far it has been seen to move. */
interface ControlLog {
  name: string;
  min: number;
  max: number;
  logicalMin: number;
  logicalMax: number;
  changes: number;
  last: number;
}

interface Watched {
  label: string;
  handle: HID;
  /** Present when the addon could describe this device; absent falls back to the byte view. */
  opened?: OpenDevice;
  controls: Map<number, ControlLog>;
  down: Set<number>;
  /** Keyed by `${reportId}:${index}`, so a stick sending several report kinds stays legible. */
  bytes: Map<string, ByteLog>;
  /**
   * `--presses`: which buttons each report id says are down, and what that came to across all of
   * them. Per report id because a report can only speak for its own controls — decoding report 2
   * answers "nothing is down" about report 1's buttons, and taking that for a release is what
   * turned one press of a button into two.
   */
  downBy: Map<number, Set<number>>;
  wasDown: Set<number>;
  reports: Set<number>;
  /** How many reports have arrived, and the latest one, for the hex dump. */
  received: number;
  latest?: Buffer;
  started: number;
}

/**
 * The addon, if it has been built (`npm run hid:build`). Without it this falls back to the raw byte
 * view, which is guesswork but needs nothing compiled.
 */
let usages: HidUsages | undefined;
try {
  /* oxlint-disable-next-line typescript/no-require-imports, typescript/no-unsafe-type-assertion --
     an optional native addon, loaded by path */
  usages = require('../native/hid-usages') as HidUsages;
} catch {
  usages = undefined;
}

function describe(device: Device): OpenDevice | undefined {
  if (usages === undefined || process.argv.includes('--bytes')) return undefined;
  try {
    return usages.open(device.path!);
  } catch (error) {
    console.error(`Could not describe ${(device.product ?? '').trim()}: ${String(error)}`);
    return undefined;
  }
}

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(`--${flag}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main(): void {
  // Loaded late, the way the input service does, so a machine that can't load it says so plainly.
  /* oxlint-disable-next-line typescript/no-require-imports, typescript/no-unsafe-type-assertion --
     the native module has no types of its own to narrow from */
  const hid = require('node-hid') as typeof import('node-hid');

  const sticks = hid
    .devices()
    .filter(
      (device: Device) =>
        device.usagePage === USAGE_PAGE &&
        device.usage !== undefined &&
        JOYSTICK_USAGES.has(device.usage) &&
        device.path !== undefined,
    );

  if (sticks.length === 0) {
    console.error('No joystick or gamepad found. Is it plugged in?');
    process.exit(1);
  }

  const wanted = argument('device')?.toLowerCase();
  const chosen = wanted ? sticks.filter((device) => identity(device).includes(wanted)) : sticks;

  if (process.argv.includes('--list') || chosen.length === 0) {
    if (chosen.length === 0) console.error(`Nothing matched --device ${wanted ?? ''}.\n`);
    for (const device of sticks) {
      console.log(`${identity(device)}  ${name(device)}`);
    }
    process.exit(chosen.length === 0 ? 1 : 0);
  }

  const seconds = Number(argument('seconds') ?? 15);
  const watched: Watched[] = [];
  for (const device of chosen) {
    try {
      const handle = new hid.HID(device.path!);
      const entry: Watched = {
        label: name(device),
        handle,
        opened: describe(device),
        controls: new Map(),
        down: new Set(),
        bytes: new Map(),
        downBy: new Map(),
        wasDown: new Set(),
        reports: new Set(),
        received: 0,
        started: Date.now(),
      };
      handle.on('data', (data: Buffer) => receive(entry, data));
      handle.on('error', (error: unknown) => console.error(`${entry.label}: ${String(error)}`));
      watched.push(entry);
    } catch (error) {
      console.error(`Could not open ${name(device)}: ${String(error)}`);
    }
  }

  if (watched.length === 0) process.exit(1);

  console.log(
    `Watching ${watched.length === 1 ? watched[0]!.label : `${watched.length} sticks`} for ${seconds}s.\n` +
      (presses
        ? 'Press the button you are binding a few times, at the speed you would use it.\n'
        : 'Move ONE axis through its whole travel; leave every other control alone.\n'),
  );

  const redraw = setInterval(() => draw(watched), REDRAW_MS);
  setTimeout(() => {
    clearInterval(redraw);
    draw(watched);
    if (usages === undefined || process.argv.includes('--bytes')) {
      console.log('\nThe byte with much the largest range is the axis. Two neighbouring bytes');
      console.log('moving together — the second with a far smaller range — are one 16-bit axis.');
    } else {
      console.log('\nWhichever line moved is the control. `seen` is how far it actually went,');
      console.log('against the range the device declares. A hat resting outside its declared');
      console.log('range is centred — that is what "has null" means.');
    }
    for (const entry of watched) entry.handle.close();
    process.exit(0);
  }, seconds * 1000);
}

/**
 * Every byte of every report kind, and how far it has moved.
 *
 * Indexed exactly the way `src/main/input/joystick.ts` indexes a binding: the report id is the
 * first byte, and byte numbers count from the start of the whole buffer — so byte 0 is that id.
 * Any other numbering here would send us hunting for the wrong byte later.
 */
function receive(entry: Watched, data: Buffer): void {
  const reportId = data[0] ?? 0;
  entry.reports.add(reportId);
  entry.received++;
  entry.latest = Buffer.from(data);

  if (entry.opened !== undefined && usages !== undefined) {
    try {
      const decoded = usages.decode(entry.opened.device, data);
      for (const { usage, value } of decoded.values) {
        const cap = entry.opened.values.find((v) => v.usage === usage);
        const log = entry.controls.get(usage);
        if (log === undefined) {
          entry.controls.set(usage, {
            name: USAGE_NAMES[usage] ?? `usage 0x${usage.toString(16)}`,
            min: value,
            max: value,
            logicalMin: cap?.logicalMin ?? 0,
            logicalMax: cap?.logicalMax ?? 0,
            changes: 0,
            last: value,
          });
          continue;
        }

        if (value !== log.last) log.changes++;
        log.last = value;
        log.min = Math.min(log.min, value);
        log.max = Math.max(log.max, value);
      }

      entry.down = new Set(decoded.buttons.map((button) => button.usage));
      if (presses) reportPresses(entry, reportId);
    } catch {
      // A device that won't decode simply falls back to the byte view below.
      entry.opened = undefined;
    }
  }

  for (let index = 0; index < data.length; index++) {
    const value = data[index]!;
    const key = `${reportId}:${index}`;
    const log = entry.bytes.get(key);
    if (log === undefined) {
      entry.bytes.set(key, { min: value, max: value, changes: 0, last: value });
      continue;
    }

    if (value !== log.last) log.changes++;
    log.last = value;
    log.min = Math.min(log.min, value);
    log.max = Math.max(log.max, value);
  }
}

/**
 * One line per press and release, said as soon as it happens.
 *
 * What this is for: a press that shows up as two, which is what a stick sending more than one kind
 * of report looks like when its buttons are read as though it sent only one. Each line names the
 * report id it came from, so a release that is really "report 2 doesn't know about report 1's
 * buttons" can be told from the commander actually letting go.
 */
function reportPresses(entry: Watched, reportId: number): void {
  entry.downBy.set(reportId, new Set(entry.down));
  const union = new Set<number>();
  for (const set of entry.downBy.values()) for (const usage of set) union.add(usage);

  const at = ((Date.now() - entry.started) / 1000).toFixed(3).padStart(7);
  const say = (what: string) => console.log(`${at}s  ${entry.label}  ${what} (report ${reportId})`);
  for (const usage of union) if (!entry.wasDown.has(usage)) say(`button ${usage} DOWN`);
  for (const usage of entry.wasDown) if (!union.has(usage)) say(`button ${usage} up  `);

  // The bug this mode was written for, said plainly: a report carrying none of the buttons that
  // are held. Read as though the stick sent only one kind of report, that looks exactly like the
  // commander letting go — and the press still going on then looks like a second press.
  if (entry.down.size === 0 && union.size > 0) {
    say(`carries nothing about ${[...union].join(', ')}, which is held`);
  }
  entry.wasDown = union;
}

function draw(watched: Watched[]): void {
  if (presses) return;
  const lines: string[] = [];
  for (const entry of watched) {
    const moving = [...entry.bytes.entries()]
      .map(([key, log]) => {
        const [report, index] = key.split(':');
        return { report: Number(report), index: Number(index), log, range: log.max - log.min };
      })
      .filter((moved) => moved.range >= NOISE)
      .toSorted((a, b) => b.range - a.range);

    const ids = [...entry.reports].toSorted((a, b) => a - b).join(', ');
    const rate = entry.received / Math.max(1, (Date.now() - entry.started) / 1000);
    lines.push(
      `${entry.label}${ids === '' ? '' : `  report id ${ids}`}` +
        `  —  ${entry.received} reports (${rate.toFixed(1)}/s)`,
    );
    // A stick that sends almost nothing is the thing worth noticing: an analogue axis being swept
    // by hand reports constantly, while a hat only speaks when it clicks over.
    if (entry.received < 40) {
      lines.push('  (very few reports — this control may be digital rather than analogue)');
    }

    if (entry.opened !== undefined) {
      lines.push('  control        value    of range      seen           changes');
      for (const log of entry.controls.values()) {
        const span = Math.max(1, log.logicalMax - log.logicalMin);
        const share = (log.last - log.logicalMin) / span;
        const filled = Math.max(0, Math.min(20, Math.round(share * 20)));
        const moved = log.max - log.min;
        lines.push(
          `  ${log.name.padEnd(13)}${String(log.last).padStart(6)}` +
            `  ${String(log.logicalMin).padStart(5)}..${String(log.logicalMax).padEnd(5)}` +
            ` ${String(log.min).padStart(5)}..${String(log.max).padEnd(5)}` +
            ` ${String(log.changes).padStart(7)}  ` +
            (moved > 0 ? '#'.repeat(filled) + '.'.repeat(20 - filled) : '(still)'),
        );
      }

      const pressed = [...entry.down].toSorted((a, b) => a - b);
      lines.push(`  buttons down: ${pressed.length === 0 ? '(none)' : pressed.join(' ')}`);
      lines.push('');
      continue;
    }

    if (entry.latest !== undefined) lines.push(...hexDump(entry.latest));

    if (moving.length === 0) {
      lines.push('  (nothing has moved yet)');
    } else {
      lines.push('  rpt  byte   range        now   changes   bar');
      for (const { report, index, log, range } of moving.slice(0, 12)) {
        const filled = Math.round((range / 255) * 24);
        lines.push(
          `  ${String(report).padStart(3)}  ${String(index).padStart(4)}   ` +
            `${String(log.min).padStart(3)}-${String(log.max).padEnd(3)}  ` +
            `${String(log.last).padStart(5)}   ${String(log.changes).padStart(7)}   ` +
            `${'#'.repeat(filled)}${'.'.repeat(24 - filled)}`,
        );
      }
    }
    lines.push('');
  }

  process.stdout.write(`[2J[H${lines.join('\n')}`);
}

/** The latest report as hex, with a ruler, so the bytes can simply be read off. */
function hexDump(report: Buffer): string[] {
  const lines: string[] = ['  latest report:'];
  for (let start = 0; start < report.length; start += 16) {
    const slice = report.subarray(start, start + 16);
    const ruler = [...slice.keys()].map((i) => String(start + i).padStart(3)).join('');
    const bytes = [...slice].map((b) => b.toString(16).padStart(2, '0').padStart(3)).join('');
    lines.push(`   byte ${ruler}`);
    lines.push(`    hex ${bytes}`);
  }

  return lines;
}

function identity(device: Device): string {
  return `${hex(device.vendorId)}:${hex(device.productId)}`;
}

function name(device: Device): string {
  const product = (device.product ?? '').trim() || identity(device);
  return `${product} (${identity(device)})`;
}

function hex(value: number): string {
  return value.toString(16).padStart(4, '0');
}

main();
