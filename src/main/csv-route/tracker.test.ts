import { describe, expect, it } from 'vitest';

import type { CsvRoute } from '../../shared/csv-route';
import { CsvRouteTracker } from './tracker';

const route: CsvRoute = {
  fileName: 'route.csv',
  loadedAt: '2026-09-23T20:00:00Z',
  columns: [],
  systems: ['Sol', 'Barnard', 'Ross'].map((name) => ({ name, values: [] })),
};
const later = '2026-09-23T21:00:00Z';

describe('CsvRouteTracker', () => {
  it('moves along the route and says what comes next', () => {
    const tracker = new CsvRouteTracker({ route, position: undefined });
    expect(tracker.arrive('Sol', later)).toEqual({ moved: true, next: 'Barnard' });
    expect(tracker.arrive('Barnard', later)).toEqual({ moved: true, next: 'Ross' });
    expect(tracker.state()).toMatchObject({ position: 1, here: true });
    expect(tracker.arrive('Ross', later)).toEqual({ moved: true });
  });

  it('remembers the last route system after leaving the route', () => {
    const tracker = new CsvRouteTracker({ route, position: undefined });
    tracker.arrive('Barnard', later);
    expect(tracker.arrive('Nowhere', later)).toEqual({ moved: false });
    expect(tracker.state()).toMatchObject({ position: 1, here: false });
  });

  it('does not move for jumps from before the route was loaded', () => {
    const tracker = new CsvRouteTracker({ route, position: undefined });
    expect(tracker.arrive('Barnard', '2026-09-23T19:00:00Z')).toEqual({ moved: false });
    expect(tracker.state().position).toBeUndefined();
  });

  it('starts from where the commander is when a route is loaded', () => {
    const tracker = new CsvRouteTracker();
    tracker.arrive('Barnard', later);
    expect(tracker.load(route)).toBe('Ross');
    expect(tracker.state()).toMatchObject({ position: 1, here: true });

    const elsewhere = new CsvRouteTracker();
    elsewhere.arrive('Nowhere', later);
    expect(elsewhere.load(route)).toBe('Sol');
    expect(elsewhere.state().position).toBeUndefined();
  });

  it('picks a saved route up where it was left, unless the commander is on it elsewhere', () => {
    const away = new CsvRouteTracker();
    away.arrive('Nowhere', later);
    expect(away.load(route, 1)).toBe('Ross');
    expect(away.state()).toMatchObject({ position: 1, here: false });

    const on = new CsvRouteTracker();
    on.arrive('Ross', later);
    on.load(route, 0);
    expect(on.state()).toMatchObject({ position: 2, here: true });

    const unknown = new CsvRouteTracker();
    expect(unknown.load(route, 9)).toBe('Sol');
    expect(unknown.position).toBeUndefined();
  });

  it('marks the route saved, and unsaved again', () => {
    const tracker = new CsvRouteTracker({ route, position: undefined });
    tracker.keepAs(4);
    expect(tracker.route?.savedId).toBe(4);
    tracker.keepAs(undefined);
    expect(tracker.route).toEqual(route);
  });

  it('takes a position set by hand, and forgets everything on clear', () => {
    const tracker = new CsvRouteTracker({ route, position: undefined });
    tracker.setPosition(2);
    expect(tracker.position).toBe(2);
    tracker.setPosition(7);
    expect(tracker.position).toBeUndefined();
    tracker.copied('Ross');
    tracker.clear();
    expect(tracker.state()).toEqual({ here: false });
  });
});
