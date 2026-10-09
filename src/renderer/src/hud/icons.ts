import bio from '../assets/icons/bio.svg';
import combat from '../assets/icons/combat.svg';
import comms from '../assets/icons/comms.svg';
import copy from '../assets/icons/copy.svg';
import engineering from '../assets/icons/engineering.svg';
import galaxyMap from '../assets/icons/galaxy-map.svg';
import marker from '../assets/icons/marker.svg';
import missions from '../assets/icons/missions.svg';
import orrery from '../assets/icons/orrery_map.svg';
import other from '../assets/icons/other.svg';
import planet from '../assets/icons/planet.svg';
import session from '../assets/icons/session.svg';
import station from '../assets/icons/station.svg';
import tick from '../assets/icons/tick.svg';
import trade from '../assets/icons/trade.svg';
import type { Category } from '../journal/summaries';

export const ICONS = {
  bio,
  combat,
  comms,
  copy,
  engineering,
  galaxyMap,
  marker,
  missions,
  orrery,
  other,
  planet,
  session,
  station,
  tick,
  trade,
} as const;

const CATEGORY_ICONS: Readonly<Record<Category, string>> = {
  travel: orrery,
  station,
  exploration: planet,
  trade,
  missions,
  combat,
  engineering,
  social: comms,
  session,
  background: other,
  other,
};

/** The icon for an event: exobiology and hyperspace get their own, the rest go by category. */
export function iconFor(eventName: string, category: Category): string {
  if (/Organic|^Codex/.test(eventName)) return bio;
  if (/^(FSDJump|FSDTarget|NavRoute|CarrierJump)/.test(eventName)) return galaxyMap;
  return CATEGORY_ICONS[category];
}
