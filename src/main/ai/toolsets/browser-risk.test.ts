import { describe, expect, it } from 'vitest';

import type { PageElement } from '../browser-control';
import {
  clickNeedsConfirmation,
  describeElement,
  enterNeedsConfirmation,
  secretField,
} from './browser-risk';

function element(overrides: Partial<PageElement>): PageElement {
  return {
    tag: 'button',
    type: '',
    label: '',
    autocomplete: '',
    name: '',
    editable: false,
    inForm: false,
    harmlessForm: false,
    submits: false,
    href: '',
    ...overrides,
  };
}

describe('clickNeedsConfirmation', () => {
  it.each([
    ['a link to a page', element({ tag: 'a', label: 'Community goals' }), false],
    ['a register link', element({ tag: 'a', label: 'Register' }), false],
    ['a checkout link', element({ tag: 'a', label: 'Checkout' }), true],
    ['a plain button', element({ label: 'Show more' }), false],
    ['a button that buys', element({ label: 'Buy now' }), true],
    ['a button that posts', element({ label: 'Post reply' }), true],
    ['a form submit', element({ type: 'submit', submits: true, inForm: true, label: 'Go' }), true],
    [
      'a search submit',
      element({ type: 'submit', submits: true, inForm: true, harmlessForm: true, label: 'Submit' }),
      false,
    ],
  ])('%s → %s', (_name, target, expected) => {
    expect(clickNeedsConfirmation(target)).toBe(expected);
  });
});

describe('enterNeedsConfirmation', () => {
  it('lets a search go, and holds a form that changes something', () => {
    const field = element({ tag: 'input', type: 'text', editable: true, inForm: true });
    expect(enterNeedsConfirmation(field)).toBe(true);
    expect(enterNeedsConfirmation({ ...field, harmlessForm: true })).toBe(false);
    expect(enterNeedsConfirmation({ ...field, inForm: false })).toBe(false);
    expect(enterNeedsConfirmation(element({ tag: 'textarea', editable: true, inForm: true }))).toBe(
      false,
    );
    expect(enterNeedsConfirmation(undefined)).toBe(false);
  });
});

describe('secretField', () => {
  it.each([
    [element({ tag: 'input', type: 'password' }), true],
    [element({ tag: 'input', type: 'text', autocomplete: 'cc-number' }), true],
    [element({ tag: 'input', type: 'tel', label: 'CVV' }), true],
    [element({ tag: 'input', type: 'text', name: 'otp', label: 'Verification code' }), true],
    [element({ tag: 'input', type: 'text', label: 'System name' }), false],
    [element({ tag: 'input', type: 'search', label: 'Search', autocomplete: 'off' }), false],
  ])('%o', (target, secret) => {
    expect(secretField(target) !== undefined).toBe(secret);
  });
});

describe('describeElement', () => {
  it('names an element by its label', () => {
    expect(describeElement(element({ label: 'Place order' }))).toBe('"Place order"');
    expect(describeElement(element({ tag: 'a' }))).toBe('a link');
  });
});
