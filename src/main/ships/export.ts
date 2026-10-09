/**
 * A ship out of EDSSI: into EDSY or Coriolis the way EDMC sends one (the journal's `Loadout`,
 * gzipped and base64'd into the URL), or a CSV of its slots.
 */
import { gzipSync } from 'node:zlib';

import type { LoadoutEvent } from '../../shared/journal';
import type { ShipExportTarget, ShipView } from '../../shared/ships';

const IMPORT_URLS: Readonly<Record<Exclude<ShipExportTarget, 'csv'>, string>> = {
  edsy: 'https://edsy.org/#/I=',
  coriolis: 'https://coriolis.io/import?data=',
};

/** The page that opens `loadout` in EDSY or Coriolis. */
export function loadoutUrl(target: 'edsy' | 'coriolis', loadout: LoadoutEvent): string {
  // parse.ts makes unsafe integers bigints; JSON has no such thing, and neither site needs them exact.
  const json = JSON.stringify(loadout, (_key, value: unknown) =>
    typeof value === 'bigint' ? Number(value) : value,
  );
  const encoded = gzipSync(Buffer.from(json, 'utf8')).toString('base64url');
  // EDMC pads, with the padding escaped for the URL; both sites read it so.
  const padding = '='.repeat((4 - (encoded.length % 4)) % 4).replaceAll('=', '%3D');
  return IMPORT_URLS[target] + encoded + padding;
}

const CSV_COLUMNS = [
  'Group',
  'Slot',
  'Size',
  'Module',
  'Class',
  'Mount',
  'Blueprint',
  'Grade',
  'Quality',
  'Experimental',
  'Engineer',
  'Powered',
  'Priority',
  'Health',
  'Value',
  'Item',
];

/** Every slot of `ship`, one row each, the empty ones included. */
export function shipCsv(ship: ShipView): string {
  const rows = ship.slots.map((slot) => {
    const { module } = slot;
    const engineering = module?.engineering;
    return [
      slot.group,
      slot.slot,
      slot.size,
      module ? module.name : '',
      module?.grade,
      module?.mount,
      engineering?.blueprint,
      engineering?.level,
      engineering && Math.round(engineering.quality * 100) / 100,
      engineering?.experimental,
      engineering?.engineer,
      module && (module.on ? 'yes' : 'no'),
      module && module.priority + 1,
      module && Math.round(module.health * 1000) / 1000,
      module?.value,
      module?.item,
    ];
  });
  return `${[CSV_COLUMNS, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

/** A file name for the ship's CSV: its name, or its type, and ident. */
export function shipCsvName(ship: ShipView): string {
  const name = [ship.name?.trim() || ship.type, ship.ident].filter(Boolean).join(' ');
  return `${name.replace(/[<>:"/\\|?*]+/g, '').trim() || 'ship'}.csv`;
}

function csvField(value: string | number | undefined): string {
  if (value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
