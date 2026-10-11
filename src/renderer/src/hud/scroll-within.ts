/**
 * Scrolls `list` just far enough to show `item`, and nothing else. `scrollIntoView` would do it too,
 * but it also scrolls every scrolling ancestor — and a list hung `position: fixed` under an input
 * has the whole page behind it, which jumped under the pointer each time the list opened.
 */
export function scrollWithin(list: HTMLElement, item: HTMLElement): void {
  // A fixed list is its items' offset parent, so their offsets are within it.
  const top = item.offsetTop;
  const bottom = top + item.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

/**
 * Scrolls the box `item` scrolls in, and only that one, to put it at the box's end or centre.
 * `scrollIntoView` would scroll every scrolling ancestor too: harmless in the window, but an EDSSI
 * embedded in a page (the mock UI) would drag the page along with it.
 */
export function scrollNearest(item: HTMLElement, block: 'center' | 'end'): void {
  const box = scrollingParent(item);
  if (!box) return;
  const itemBox = item.getBoundingClientRect();
  const boxBox = box.getBoundingClientRect();
  // Measured on screen, scrolled in the box's own pixels: a page may draw it scaled.
  const scale = box.offsetHeight > 0 ? boxBox.height / box.offsetHeight : 1;
  const top = (itemBox.top - boxBox.top) / scale - box.clientTop + box.scrollTop;
  const height = itemBox.height / scale;
  box.scrollTop =
    block === 'end' ? top + height - box.clientHeight : top + height / 2 - box.clientHeight / 2;
}

function scrollingParent(element: HTMLElement): HTMLElement | undefined {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') return parent;
  }
  return undefined;
}
