import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../../shared/settings';
import { modelFor, wantsUltrathink } from './ultrathink';

describe('wantsUltrathink', () => {
  it('hears the word however it was typed or transcribed', () => {
    for (const question of [
      'ultrathink: plan my route to Colonia',
      'Where should I sell this? Ultrathink.',
      'ultra think about the best carrier route',
      'Ultra-think this one',
      'ULTRATHINKING please',
    ]) {
      expect(wantsUltrathink(question), question).toBe(true);
    }
  });

  it('ignores the word inside another and plain questions', () => {
    expect(wantsUltrathink('how much fuel is left')).toBe(false);
    expect(wantsUltrathink('I think ultra deep core mining is fun')).toBe(false);
    expect(wantsUltrathink('superultrathinker')).toBe(false);
  });
});

describe('modelFor', () => {
  it('uses the ultrathink model and effort only when asked', () => {
    expect(modelFor(DEFAULT_SETTINGS.assistant, 'ultrathink: which engineer first?')).toEqual({
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      ultrathink: true,
    });
    expect(modelFor(DEFAULT_SETTINGS.assistant, 'which engineer first?')).toEqual({
      model: 'gpt-5.6-terra',
      reasoningEffort: 'medium',
      ultrathink: false,
    });
  });
});
