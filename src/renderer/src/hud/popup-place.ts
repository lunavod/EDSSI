import type { CSSProperties } from 'react';

/**
 * Where a `position: fixed` list hangs under (or, short of room, over) the box it belongs to.
 *
 * Fixed is measured from the viewport, except inside an element that makes itself the containing
 * block (a transform does): the mock UI's root does, so several EDSSIs embedded in one page keep
 * their popups inside themselves. Such an element is marked `data-fixed-frame`, and the place is
 * worked out against it — in its own pixels, as a page may draw it scaled down.
 */
export function popupPlace(
  anchor: Element,
  { minWidth, room, maxHeight }: { minWidth: number; room: number; maxHeight: number },
): CSSProperties {
  const box = anchor.getBoundingClientRect();
  const frameElement = anchor.closest('[data-fixed-frame]');
  const frame = frameElement?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    bottom: window.innerHeight,
    width: window.innerWidth,
  };
  const scale =
    frameElement instanceof HTMLElement && frameElement.offsetWidth > 0
      ? frame.width / frameElement.offsetWidth
      : 1;
  const below = (frame.bottom - box.bottom) / scale;
  const above = (box.top - frame.top) / scale;
  const up = below < room && above > below;
  return {
    left: (box.left - frame.left) / scale,
    minWidth: Math.max(box.width / scale, minWidth),
    ...(up
      ? { bottom: (frame.bottom - box.top) / scale + 2, maxHeight: Math.min(maxHeight, above - 8) }
      : { top: (box.bottom - frame.top) / scale + 2, maxHeight: Math.min(maxHeight, below - 8) }),
  };
}
