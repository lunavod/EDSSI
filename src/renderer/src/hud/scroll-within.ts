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
