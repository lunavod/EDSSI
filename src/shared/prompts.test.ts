import { describe, expect, it } from 'vitest';

import { interpretReply, spokenPrompt } from './prompts';

describe('interpretReply', () => {
  it.each([
    ['Yes.', 'allow'],
    ['go ahead', 'allow'],
    ['uh, okay', 'allow'],
    ['No, don’t', 'deny'],
    ["don't do that", 'deny'],
    ['what does it cost?', undefined],
  ])('confirm: %s → %s', (text, expected) => {
    expect(interpretReply('confirm', text)).toBe(expected);
  });

  it.each([
    ['Done', 'done'],
    ['all set, carry on', 'done'],
    ['give up', 'give-up'],
    ['never mind', 'give-up'],
    ['where am I?', undefined],
  ])('help: %s → %s', (text, expected) => {
    expect(interpretReply('help', text)).toBe(expected);
  });
});

describe('spokenPrompt', () => {
  it('asks in a sentence', () => {
    expect(spokenPrompt({ kind: 'confirm', action: 'Click "Place order"' })).toBe(
      'Permission to click "Place order"?',
    );
    expect(spokenPrompt({ kind: 'help', reason: 'solve the CAPTCHA' })).toBe(
      'I need you in the browser: solve the CAPTCHA',
    );
  });
});
