import { describe, expect, it } from 'vitest';

import { startOverCommand, surfaceCommand, tabCommand } from './commands';

describe('tabCommand', () => {
  it('recognises a tab however the request is put', () => {
    expect(tabCommand('Open mission')).toBe('mission');
    expect(tabCommand('Open the route tab.')).toBe('route');
    expect(tabCommand('show me the journal, please')).toBe('journal');
    expect(tabCommand('Switch to settings!')).toBe('settings');
    expect(tabCommand('  go to   comms ')).toBe('comms');
  });

  it('takes the names a transcriber might write instead', () => {
    expect(tabCommand('Open coms.')).toBe('comms');
    expect(tabCommand('Open missions')).toBe('mission');
  });

  it('leaves anything more to the assistant', () => {
    expect(tabCommand('Open the route and tell me how far')).toBeUndefined();
    expect(tabCommand('Open inara')).toBeUndefined();
    expect(tabCommand('show me the dearest bacterium')).toBeUndefined();
    expect(tabCommand('What is on the route tab?')).toBeUndefined();
  });
});

describe('surfaceCommand', () => {
  it('recognises a request for the window itself', () => {
    expect(surfaceCommand('Surface app')).toBe(true);
    expect(surfaceCommand('surface the app')).toBe(true);
    expect(surfaceCommand('Surface.')).toBe(true);
    expect(surfaceCommand('bring EDSSI up')).toBe(true);
    expect(surfaceCommand('Bring the window to the front, please')).toBe(true);
    expect(surfaceCommand('raise the interface')).toBe(true);
    expect(surfaceCommand('show the app')).toBe(true);
    expect(surfaceCommand('  the   app to the foreground ')).toBe(true);
  });

  it('leaves anything more to the assistant', () => {
    expect(surfaceCommand('Surface the app and plot me a route')).toBe(false);
    expect(surfaceCommand('What surfaces has this body got?')).toBe(false);
    expect(surfaceCommand('open the mission tab')).toBe(false);
    expect(surfaceCommand('land on the surface')).toBe(false);
  });

  it('never steals a tab request', () => {
    for (const request of ['Open mission', 'show me the journal', 'switch to settings']) {
      expect(surfaceCommand(request)).toBe(false);
    }
    for (const request of ['Surface the app', 'bring EDSSI to the front']) {
      expect(tabCommand(request)).toBeUndefined();
    }
  });
});

describe('startOverCommand', () => {
  it('recognises a request to forget the conversation', () => {
    expect(startOverCommand('Start over.')).toBe(true);
    expect(startOverCommand('new conversation')).toBe(true);
    expect(startOverCommand('Start a new chat, please')).toBe(true);
    expect(startOverCommand('Reset the conversation.')).toBe(true);
    expect(startOverCommand('clear comms')).toBe(true);
    expect(startOverCommand('Forget all that.')).toBe(true);
  });

  it('leaves anything more to the assistant', () => {
    expect(startOverCommand('start over the route')).toBe(false);
    expect(startOverCommand('Reset the route')).toBe(false);
    expect(startOverCommand('forget the last system')).toBe(false);
    expect(startOverCommand('What did we say at the start of the conversation?')).toBe(false);
  });
});
