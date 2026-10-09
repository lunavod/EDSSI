/** The carrier view's wording: titles and docking access. */
import type { CarrierKind, CarrierView } from '../../../shared/carriers';

/** Its name, else its callsign. */
export function carrierTitle(carrier: CarrierView): string {
  return carrier.name?.trim() || carrier.callsign || 'Carrier';
}

export function carrierKindLabel(kind: CarrierKind): string {
  return kind === 'own' ? 'Fleet carrier' : 'Squadron carrier';
}

const DOCKING: Readonly<Record<string, string>> = {
  all: 'Everyone',
  none: 'Nobody',
  friends: 'Friends',
  squadron: 'Squadron',
  squadronfriends: 'Squadron and friends',
};

export function dockingAccessLabel(access: string): string {
  return DOCKING[access.toLowerCase()] ?? access;
}
