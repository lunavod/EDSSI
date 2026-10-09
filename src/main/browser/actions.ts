/**
 * Doing things on a page through the DevTools protocol: clicks and keys go in as real input
 * events, at the element's place on screen, so the page reacts as it would to a person.
 *
 * A hidden view (the Browser tab not showing) drops or holds back input unless focus emulation is
 * on, which `browser.ts` turns on when it attaches, and a wheel event there never scrolls, so
 * scrolling is done by script. Tried on Electron 44.
 *
 * Elements are looked at from an isolated world, where the page's own scripts can't change what
 * `closest()` or `getAttribute()` say. (A page can still lie in its markup; the checks built on
 * this lean towards asking.)
 */

import type { BrowserKey, PageElement } from '../ai/browser-control';
import { PageError } from '../web/fetch';

export type Send = <T>(method: string, params?: Record<string, unknown>) => Promise<T>;

interface RemoteObject {
  objectId?: string;
  value?: unknown;
  description?: string;
}

interface EvaluateResult {
  result: RemoteObject;
  exceptionDetails?: { text?: string; exception?: RemoteObject };
}

const WORLD = 'edssi';
/** An input event the page never acknowledges shouldn't hang the tool. */
const INPUT_TIMEOUT_MS = 5000;

/** Runs as the element itself (`this`), and answers with a `PageElement`. */
const DESCRIBE = `function () {
  const el = this;
  const tag = el.tagName.toLowerCase();
  const text = (s) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  let type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'button' && !type) type = 'submit';
  const form = el.form || el.closest('form');
  const labels = el.labels ? Array.from(el.labels).map((l) => l.innerText).join(' ') : '';
  const label = text(
    el.getAttribute('aria-label') || labels || el.innerText || (tag === 'input' ? el.value : '') ||
    el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '',
  );
  const blocked = ['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'hidden', 'range', 'color'];
  const editable = el.isContentEditable || tag === 'textarea' || tag === 'select' ||
    (tag === 'input' && !blocked.includes(type));
  const submits = !!form && ((tag === 'button' && type === 'submit') ||
    (tag === 'input' && (type === 'submit' || type === 'image')));
  const method = form ? String(form.getAttribute('method') || 'get').toLowerCase() : '';
  const harmlessForm = !!form && (method === 'get' || type === 'search' ||
    !!el.closest('[role=search]') || form.getAttribute('role') === 'search');
  return {
    tag, type, label,
    autocomplete: text(el.getAttribute('autocomplete')),
    name: text(el.getAttribute('name')),
    editable, inForm: !!form, harmlessForm, submits,
    href: tag === 'a' ? String(el.href || '') : '',
  };
}`;

/** Selects what is in a field, so typing replaces it. */
const SELECT_CONTENTS = `function () {
  this.focus();
  if (typeof this.select === 'function') { this.select(); return; }
  if (this.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(this);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}`;

/** Picks the option of a select whose text or value matches, as a person choosing it would. */
const CHOOSE_OPTION = `function (wanted) {
  const want = String(wanted).trim().toLowerCase();
  const options = Array.from(this.options);
  const option = options.find((o) => o.text.trim().toLowerCase() === want || o.value.toLowerCase() === want) ||
    options.find((o) => o.text.trim().toLowerCase().includes(want));
  if (!option) return options.map((o) => o.text.trim()).slice(0, 30);
  this.value = option.value;
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}`;

const KEYS: Record<BrowserKey, { key: string; code: string; keyCode: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
};

export async function inspectElement(send: Send, ref: number): Promise<PageElement> {
  const objectId = await resolve(send, ref);
  return callOn<PageElement>(send, objectId, DESCRIBE);
}

export async function focusedElement(send: Send): Promise<PageElement | undefined> {
  const context = await isolatedWorld(send);
  const { result } = await send<EvaluateResult>('Runtime.evaluate', {
    expression: 'document.activeElement === document.body ? null : document.activeElement',
    contextId: context,
  });
  if (!result.objectId) return undefined;
  return callOn<PageElement>(send, result.objectId, DESCRIBE);
}

export async function clickElement(send: Send, ref: number): Promise<void> {
  await send('DOM.scrollIntoViewIfNeeded', { backendNodeId: ref }).catch(() => undefined);
  const { x, y } = await centre(send, ref);
  await input(send, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await input(send, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await input(send, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

export async function typeInto(send: Send, ref: number, text: string): Promise<void> {
  const objectId = await resolve(send, ref);
  const element = await callOn<PageElement>(send, objectId, DESCRIBE);
  if (element.tag === 'select') {
    const chosen = await callOn<true | string[]>(send, objectId, CHOOSE_OPTION, [text]);
    if (chosen !== true) {
      throw new PageError(`No option matches "${text}". The options are: ${chosen.join('; ')}.`);
    }
    return;
  }
  if (!element.editable)
    throw new PageError(`That is a ${element.tag}, which can't be typed into.`);
  await send('DOM.scrollIntoViewIfNeeded', { backendNodeId: ref }).catch(() => undefined);
  await callOn(send, objectId, SELECT_CONTENTS);
  if (text) {
    await input(send, 'Input.insertText', { text });
  } else {
    await pressKey(send, 'Delete');
  }
}

export async function pressKey(send: Send, name: BrowserKey): Promise<void> {
  const key = KEYS[name];
  const common = { key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode };
  await input(send, 'Input.dispatchKeyEvent', {
    type: key.text ? 'keyDown' : 'rawKeyDown',
    ...common,
    ...(key.text ? { text: key.text, unmodifiedText: key.text } : {}),
  });
  await input(send, 'Input.dispatchKeyEvent', { type: 'keyUp', ...common });
}

/**
 * Scrolls the page, or failing that the scrolling box in the middle of the screen (a map's side
 * panel, say). Answers with false when there was nowhere further to go.
 */
export async function scrollPage(send: Send, direction: 'up' | 'down'): Promise<boolean> {
  const context = await isolatedWorld(send);
  const { result } = await send<EvaluateResult>('Runtime.evaluate', {
    expression: `(${SCROLL})(${direction === 'down' ? 1 : -1})`,
    contextId: context,
    returnByValue: true,
  });
  return result.value === true;
}

const SCROLL = `function (sign) {
  const step = (height) => Math.round(height * 0.8) * sign;
  const before = window.scrollY;
  window.scrollBy(0, step(window.innerHeight));
  if (window.scrollY !== before) return true;
  let el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  while (el && el !== document.documentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight) {
      const top = el.scrollTop;
      el.scrollBy(0, step(el.clientHeight));
      if (el.scrollTop !== top) return true;
    }
    el = el.parentElement;
  }
  return false;
}`;

/** Runs in the page's own world, so the script sees what the page's scripts see. */
export async function evaluateScript(send: Send, script: string): Promise<unknown> {
  const answer = await send<EvaluateResult>('Runtime.evaluate', {
    expression: script,
    awaitPromise: true,
    returnByValue: true,
    timeout: 10_000,
  });
  if (answer.exceptionDetails) {
    const reason =
      answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text ?? 'it threw';
    throw new PageError(`The script failed: ${reason}`);
  }
  return answer.result.value ?? answer.result.description ?? null;
}

async function isolatedWorld(send: Send): Promise<number> {
  const { frameTree } = await send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
  const { executionContextId } = await send<{ executionContextId: number }>(
    'Page.createIsolatedWorld',
    { frameId: frameTree.frame.id, worldName: WORLD },
  );
  return executionContextId;
}

async function resolve(send: Send, ref: number): Promise<string> {
  try {
    const context = await isolatedWorld(send);
    const { object } = await send<{ object: RemoteObject }>('DOM.resolveNode', {
      backendNodeId: ref,
      executionContextId: context,
    });
    if (object.objectId) return object.objectId;
  } catch {
    // An element in another frame isn't in the main frame's world; its own frame's will do.
  }
  try {
    const { object } = await send<{ object: RemoteObject }>('DOM.resolveNode', {
      backendNodeId: ref,
    });
    if (object.objectId) return object.objectId;
  } catch {
    // Handled below.
  }
  throw new PageError(`The page has no element ${ref} any more. Read it again for fresh refs.`);
}

async function callOn<T>(
  send: Send,
  objectId: string,
  functionDeclaration: string,
  args: unknown[] = [],
): Promise<T> {
  const answer = await send<EvaluateResult>('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
  });
  if (answer.exceptionDetails) {
    throw new PageError(`The page wouldn't say: ${answer.exceptionDetails.text ?? 'it threw'}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the function returns this shape
  return answer.result.value as T;
}

async function centre(send: Send, ref: number): Promise<{ x: number; y: number }> {
  let quads: number[][];
  try {
    ({ quads } = await send<{ quads: number[][] }>('DOM.getContentQuads', { backendNodeId: ref }));
  } catch {
    throw new PageError(`The page has no element ${ref} any more. Read it again for fresh refs.`);
  }
  const quad = quads[0];
  if (!quad || quad.length < 8) throw new PageError('That element is not on screen.');
  const x = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4;
  const y = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4;
  return { x: Math.round(x), y: Math.round(y) };
}

async function input(send: Send, method: string, params: Record<string, unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      send(method, params),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new PageError('The page stopped responding to input.')),
          INPUT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
