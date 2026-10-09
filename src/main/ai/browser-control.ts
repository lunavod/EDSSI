/**
 * The browser in EDSSI's window, as the assistant drives it. Electron lives behind this, in
 * `main/browser/`, so the tools can be tested without it.
 */

import type { BrowserState } from '../../shared/browser';

/** What an element on the page is, as far as deciding whether it's safe to use goes. */
export interface PageElement {
  /** Lower case, e.g. `button`. */
  tag: string;
  /** An input's or button's `type`, lower case; a button with none is `submit`. */
  type: string;
  /** What a person would call it: its label, text, placeholder or title. */
  label: string;
  /** The `autocomplete` hint, which says whether a field wants a password or a card number. */
  autocomplete: string;
  /** The `name` attribute. */
  name: string;
  /** Takes typing: a text field, text area, select or editable region. */
  editable: boolean;
  inForm: boolean;
  /**
   * A search, or a form that only fetches (`method="get"`): submitting it changes nothing on the
   * site.
   */
  harmlessForm: boolean;
  /** Clicking it submits its form. */
  submits: boolean;
  href: string;
}

export type BrowserKey =
  | 'Enter'
  | 'Tab'
  | 'Escape'
  | 'Backspace'
  | 'Delete'
  | 'Space'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'PageUp'
  | 'PageDown'
  | 'Home'
  | 'End';

export interface BrowserControl {
  /** Where the browser is. Undefined until it has opened a page. */
  state(): BrowserState | undefined;
  /** Loads an address and waits, within reason, for it to finish. Throws on an address it refuses. */
  open(url: string, signal: AbortSignal): Promise<BrowserState>;
  back(signal: AbortSignal): Promise<BrowserState>;
  /** The page as an outline of what is on it, with a ref on everything that can be used. */
  outline(signal: AbortSignal): Promise<string>;
  /** What is on screen, as a JPEG data URL. */
  screenshot(signal: AbortSignal): Promise<string>;
  /** Looks an outline ref up. Throws a `PageError` when the page no longer has it. */
  inspect(ref: number, signal: AbortSignal): Promise<PageElement>;
  /** The element with keyboard focus, if any. */
  focused(signal: AbortSignal): Promise<PageElement | undefined>;
  click(ref: number, signal: AbortSignal): Promise<BrowserState>;
  /** Replaces what is in a field with `text`, or picks the option of a select that matches it. */
  type(ref: number, text: string, signal: AbortSignal): Promise<BrowserState>;
  press(key: BrowserKey, signal: AbortSignal): Promise<BrowserState>;
  scroll(direction: 'up' | 'down', signal: AbortSignal): Promise<BrowserState>;
  /** Runs a script in the page and answers with its value, as JSON allows. */
  evaluate(script: string, signal: AbortSignal): Promise<unknown>;
}
