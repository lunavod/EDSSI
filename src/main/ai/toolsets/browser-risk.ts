/**
 * What the assistant may do on a page by itself, and what it has to ask the commander about first.
 *
 * Reading, scrolling, following links and searching are its own business. Anything that could
 * change something out in the world — submitting a form, pressing a button that buys, sends, posts
 * or deletes, running a script — waits for a yes. Passwords and payment details it never types at
 * all: the commander fills those in themselves.
 *
 * These are guesses from what a page says about itself, so they lean towards asking.
 */

import type { PageElement } from '../browser-control';

/** Buttons that do something for good, however they are built. */
const COMMITTING =
  /\b(buy|purchase|pay|payment|checkout|check out|order|send|post|publish|submit|delete|remove|erase|destroy|confirm|sign up|signup|register|subscribe|unsubscribe|donate|transfer|withdraw|deposit|sell|trade|accept|agree|reply|comment|upload|save|apply|book|reserve|vote|report|block|follow|invite|share|transmit|claim|redeem|cancel (my |the )?(account|subscription|order)|log ?in|sign ?in)\b/iu;

/** Links are only pages, unless their name says otherwise. */
const COMMITTING_LINK =
  /\b(buy now|purchase|pay|checkout|check out|place order|delete|remove|unsubscribe|donate|transfer|withdraw|sell|log ?out|sign ?out)\b/iu;

const SECRET_AUTOCOMPLETE = /password|one-time-code|cc-|card|security-code/iu;
const SECRET_LABEL =
  /\b(password|passphrase|passcode|pin|cvv|cvc|security code|card number|credit card|debit card|expiry|expiration|iban|account number|sort code|routing number|social security|ssn|2fa|verification code|one[- ]time code|authenticator)\b/iu;

/** Why a field must be left to the commander, or undefined when the assistant may type into it. */
export function secretField(element: PageElement): string | undefined {
  if (element.type === 'password') return 'a password field';
  if (SECRET_AUTOCOMPLETE.test(element.autocomplete)) return 'a password or payment field';
  if (SECRET_LABEL.test(`${element.label} ${element.name}`)) return 'a field for secrets';
  return undefined;
}

/** Whether clicking this needs the commander's yes. */
export function clickNeedsConfirmation(element: PageElement): boolean {
  if (element.submits && !element.harmlessForm) return true;
  if (element.tag === 'a') return COMMITTING_LINK.test(element.label);
  // A search button that also happens to say "Submit" is still a search.
  if (element.submits && element.harmlessForm) return false;
  return COMMITTING.test(element.label);
}

/** Pressing Enter in a form submits it. */
export function enterNeedsConfirmation(focused: PageElement | undefined): boolean {
  if (!focused) return false;
  // In a text area Enter is a new line, and on a button it is a click.
  if (focused.tag === 'textarea') return false;
  if (!focused.editable) return clickNeedsConfirmation(focused);
  return focused.inForm && !focused.harmlessForm;
}

/** An element, named the way the commander would see it. */
export function describeElement(element: PageElement): string {
  const label = element.label.trim();
  if (label) return `"${label.length > 60 ? `${label.slice(0, 60)}…` : label}"`;
  return element.tag === 'a' ? 'a link' : `a ${element.tag}`;
}
