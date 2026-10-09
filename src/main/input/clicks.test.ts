import { describe, expect, it } from 'vitest';

import { ClickCounter, MULTI_CLICK_MS } from './clicks';

describe('ClickCounter', () => {
  it('fires a lone single click the moment the control goes down', () => {
    const counter = new ClickCounter([{ clicks: 1, action: 'talk' }]);
    expect(counter.delayed).toBe(false);
    expect(counter.press(1000)).toEqual({ fire: ['talk'] });
  });

  it('fires everything bound to a single press at once', () => {
    const counter = new ClickCounter([
      { clicks: 1, action: 'talk' },
      { clicks: 1, action: 'note' },
    ]);
    expect(counter.press(1000).fire).toEqual(['talk', 'note']);
  });

  it('waits when a double click is bound to the same control', () => {
    const counter = new ClickCounter([
      { clicks: 1, action: 'show' },
      { clicks: 2, action: 'pin' },
    ]);
    expect(counter.delayed).toBe(true);

    const first = counter.press(1000);
    expect(first.fire).toEqual([]);
    expect(first.due).toBe(1000 + MULTI_CLICK_MS);
    // The second press is all it was waiting for, so it doesn't wait out the rest of the window.
    expect(counter.press(1100)).toEqual({ fire: ['pin'] });
  });

  it('settles for the single click when no second press arrives', () => {
    const counter = new ClickCounter([
      { clicks: 1, action: 'show' },
      { clicks: 2, action: 'pin' },
    ]);
    counter.press(1000);
    expect(counter.tick(1100).fire).toEqual([]);
    expect(counter.tick(1000 + MULTI_CLICK_MS).fire).toEqual(['show']);
    // And nothing more after that: the run is over.
    expect(counter.tick(5000).fire).toEqual([]);
  });

  it('counts up to a triple click', () => {
    const counter = new ClickCounter([
      { clicks: 1, action: 'show' },
      { clicks: 3, action: 'reset' },
    ]);
    expect(counter.press(1000).fire).toEqual([]);
    expect(counter.press(1100).fire).toEqual([]);
    expect(counter.press(1200)).toEqual({ fire: ['reset'] });
  });

  it('falls back to the most presses anything asked for', () => {
    // Two presses on a control with only a single and a triple bound: the single is what was meant
    // far more often than nothing was.
    const counter = new ClickCounter([
      { clicks: 1, action: 'show' },
      { clicks: 3, action: 'reset' },
    ]);
    counter.press(1000);
    counter.press(1100);
    expect(counter.tick(1100 + MULTI_CLICK_MS).fire).toEqual(['show']);
  });

  it('runs nothing when no binding asks for that few', () => {
    const counter = new ClickCounter([{ clicks: 2, action: 'pin' }]);
    counter.press(1000);
    expect(counter.tick(1000 + MULTI_CLICK_MS).fire).toEqual([]);
  });

  it('starts a new run after a long pause, even without a tick', () => {
    const counter = new ClickCounter([
      { clicks: 1, action: 'show' },
      { clicks: 2, action: 'pin' },
    ]);
    counter.press(1000);
    // A second press much later is the start of the next run, not the other half of the last one.
    const late = counter.press(9000);
    expect(late.fire).toEqual([]);
    expect(late.due).toBe(9000 + MULTI_CLICK_MS);
  });

  it('forgets a run when it is reset', () => {
    const counter = new ClickCounter([
      { clicks: 1, action: 'show' },
      { clicks: 2, action: 'pin' },
    ]);
    counter.press(1000);
    counter.reset();
    expect(counter.tick(5000).fire).toEqual([]);
    expect(counter.press(5000).fire).toEqual([]);
  });
});
