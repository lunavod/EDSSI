/**
 * Requests plain enough to carry out without the model: "open the route tab" needs no thinking,
 * and answering it locally makes it instant, free, and work with no provider set up at all.
 */

import { TAB_IDS, type TabId } from '../../shared/ui';

/** Other names a transcriber, or the commander, might use for a tab. */
const TAB_ALIASES: Readonly<Record<string, TabId>> = {
  missions: 'mission',
  log: 'journal',
  routes: 'route',
  com: 'comms',
  coms: 'comms',
  comm: 'comms',
  web: 'browser',
  setting: 'settings',
  options: 'settings',
};

/** The words of a request, lower case, without the punctuation a transcriber adds. */
function plainly(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replaceAll(/[.,!?]+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

const OPEN_TAB =
  /^(?:please\s+)?(?:open|show(?:\s+me)?|go\s+to|switch\s+to)\s+(?:the\s+)?([a-z]+)(?:\s+(?:tab|view|screen|page|module))?(?:\s+please)?$/u;

/** The tab a request like "Open the route tab." asks for, or undefined if it asks anything else. */
export function tabCommand(text: string): TabId | undefined {
  const name = OPEN_TAB.exec(plainly(text))?.[1];
  if (!name) return undefined;
  if ((TAB_IDS as readonly string[]).includes(name)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked against TAB_IDS
    return name as TabId;
  }
  return TAB_ALIASES[name];
}

/** What EDSSI itself is called when it is asked to come forward. */
const APP = String.raw`(?:the\s+)?(?:app|window|edssi|interface|display)`;
/** Where it is asked to come: "up", "to the front", "forward". */
const FRONT = String.raw`(?:up|forward|(?:back\s+)?(?:to|in)\s+(?:the\s+)?(?:front|foreground))`;

const SURFACE = new RegExp(
  String.raw`^(?:please\s+)?(?:` +
    // "surface the app", "raise EDSSI", "show the window", and the bare "surface"
    String.raw`(?:surface|raise|unhide|show|open|focus)\s+${APP}(?:\s+${FRONT})?` +
    // "bring the app up", "bring EDSSI to the front"
    String.raw`|bring\s+${APP}(?:\s+${FRONT})?` +
    // "the app to the front"
    String.raw`|${APP}\s+${FRONT}` +
    String.raw`|surface` +
    String.raw`)(?:\s+please)?$`,
  'u',
);

/**
 * Whether a request like "Surface the app." asks for EDSSI's window to come in front of the game.
 * Answered locally like `tabCommand`, and for the same reasons — with one of its own: the window
 * coming up is the answer, so there is nothing for a model to add.
 */
export function surfaceCommand(text: string): boolean {
  return SURFACE.test(plainly(text));
}

/** What the conversation is called: "the conversation", "this chat", "comms". */
const CONVERSATION = String.raw`(?:the\s+|this\s+|our\s+)?(?:conversation|chat|comms|transcript)`;

const START_OVER = new RegExp(
  String.raw`^(?:please\s+)?(?:` +
    // "start over", "start again", "start afresh"
    String.raw`start\s+(?:over|again|afresh)` +
    // "new conversation", "start a new conversation", "a new chat"
    String.raw`|(?:start\s+)?(?:a\s+)?(?:new|fresh)\s+(?:conversation|chat)` +
    // "reset the conversation", "clear comms", "wipe the transcript"
    String.raw`|(?:reset|clear|wipe)\s+${CONVERSATION}` +
    // "forget everything", "forget all that"
    String.raw`|forget\s+(?:everything|all\s+(?:of\s+)?that|it\s+all)` +
    String.raw`)(?:\s+please)?$`,
  'u',
);

/**
 * Whether a request like "New conversation." asks for the conversation to be forgotten, as the
 * Comms tab's New does. Answered locally like `tabCommand`: nothing said now would be remembered,
 * so there is nothing for a model to add, and it works before a provider is set up. Anything put
 * less plainly goes to the model, which has `start_over` for it.
 */
export function startOverCommand(text: string): boolean {
  return START_OVER.test(plainly(text));
}
