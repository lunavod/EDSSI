import { describe, expect, it } from 'vitest';

import { takeSpeech } from './sentences';

describe('takeSpeech', () => {
  it('takes a finished sentence and keeps the rest back', () => {
    expect(takeSpeech('Route is up. Twelve jumps to go')).toEqual({
      ready: ['Route is up.'],
      rest: ' Twelve jumps to go',
    });
  });

  it('waits before speaking a sentence that may not have ended', () => {
    // Still streaming: this could be the end of a sentence, or the start of "2.4 million".
    expect(takeSpeech('You are owed 2.')).toEqual({ ready: [], rest: 'You are owed 2.' });
  });

  it('does not break a number in half', () => {
    expect(takeSpeech('It is 38.5 light years. Scoopable.').ready).toEqual([
      'It is 38.5 light years.',
    ]);
  });

  it('treats a line break as the end of a piece', () => {
    expect(takeSpeech('Fuel is low\nDocking now. ').ready).toEqual(['Fuel is low', 'Docking now.']);
  });

  it('gathers short sentences up rather than asking for each one', () => {
    const { ready, rest } = takeSpeech('Done. Sure. The route is plotted to Colonia. ', 20);
    expect(ready).toEqual(['Done. Sure. The route is plotted to Colonia.']);
    expect(rest).toBe(' ');
  });

  it('has nothing to say about text with no end in sight', () => {
    expect(takeSpeech('checking the route')).toEqual({ ready: [], rest: 'checking the route' });
  });
});
