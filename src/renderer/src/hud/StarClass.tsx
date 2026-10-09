import type { StarBadge } from './system-facts';

/** A star's class in a small box: green where a scoop works, amber where it doesn't. */
export function StarClass({ badge, current = false }: { badge: StarBadge; current?: boolean }) {
  const kind = current
    ? 'star cur'
    : badge.label === 'N'
      ? 'star n'
      : badge.scoopable === undefined
        ? 'star unknown'
        : badge.scoopable
          ? 'star'
          : 'star no';
  return (
    <span className={kind} title={badge.title}>
      {badge.label}
    </span>
  );
}
