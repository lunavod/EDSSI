import { describe, expect, it } from 'vitest';

import { popupPlace } from './popup-place';

/** Just enough of an element for popupPlace: its box, and the frame it's in (or none). */
function element(box: Partial<DOMRect>, frame?: { box: Partial<DOMRect>; offsetWidth: number }) {
  const frameElement = frame && {
    getBoundingClientRect: () => frame.box,
    offsetWidth: frame.offsetWidth,
  };
  if (frameElement) Object.setPrototypeOf(frameElement, FakeHTMLElement.prototype);
  return {
    getBoundingClientRect: () => box,
    closest: () => frameElement ?? null,
  } as unknown as Element;
}

class FakeHTMLElement {}
Object.assign(globalThis, {
  HTMLElement: FakeHTMLElement,
  window: { innerHeight: 800, innerWidth: 1200 },
});

const options = { minWidth: 160, room: 240, maxHeight: 360 };

describe('popupPlace', () => {
  it('hangs under its box, in the viewport', () => {
    expect(popupPlace(element({ left: 100, top: 50, bottom: 80, width: 200 }), options)).toEqual({
      left: 100,
      minWidth: 200,
      top: 82,
      maxHeight: 360,
    });
  });

  it('goes over its box when there is more room above', () => {
    expect(popupPlace(element({ left: 10, top: 700, bottom: 730, width: 100 }), options)).toEqual({
      left: 10,
      minWidth: 160,
      bottom: 102,
      maxHeight: 360,
    });
  });

  it('is placed in the frame’s own pixels when a page draws it scaled', () => {
    // A 1000 px wide frame drawn at half size, 300 px down the page.
    const frame = { box: { left: 40, top: 300, bottom: 750, width: 500 }, offsetWidth: 1000 };
    expect(
      popupPlace(element({ left: 140, top: 340, bottom: 350, width: 100 }, frame), options),
    ).toEqual({ left: 200, minWidth: 200, top: 102, maxHeight: 360 });
  });
});
