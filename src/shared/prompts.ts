/**
 * When the assistant has to stop and ask the commander: before doing something on a web page that
 * can't be taken back, or when it needs a person (a CAPTCHA, a sign-in).
 */

export type CommanderPrompt =
  | {
      id: number;
      kind: 'confirm';
      /** What it wants to do, as a sentence: `Click "Place order"`. */
      action: string;
      /** More to go on, such as the script it wants to run. */
      detail?: string;
      url?: string;
    }
  | {
      id: number;
      kind: 'help';
      /** What the commander is asked to do. */
      reason: string;
      url?: string;
    };

export type PromptRequest = CommanderPrompt extends infer P
  ? P extends CommanderPrompt
    ? Omit<P, 'id'>
    : never
  : never;

/** `allow`/`deny` answer a confirmation; `done`/`give-up` a request for help. */
export type PromptAnswer = 'allow' | 'deny' | 'done' | 'give-up';

const YES =
  /^(yes|yeah|yep|allow|allowed|approve|approved|go ahead|do it|ok|okay|sure|confirm|confirmed|affirmative)\b/iu;
const NO = /^(no|nope|deny|denied|don't|do not|stop|cancel|abort|negative)\b/iu;
const DONE =
  /^(done|finished|solved|all set|ready|go on|continue|carry on|ok|okay|yes|there you go)\b/iu;
const GIVE_UP = /^(give up|forget it|never ?mind|skip|cancel|stop|abort|no|i can't|i cannot)\b/iu;

/**
 * Reads a spoken or typed reply as an answer to the prompt, or undefined when it doesn't sound
 * like one (a new question, which replaces what the assistant was doing).
 */
export function interpretReply(
  kind: CommanderPrompt['kind'],
  text: string,
): PromptAnswer | undefined {
  const reply = text
    .trim()
    .replaceAll('’', "'")
    .replace(/^(uh|um|er|well|right|alright)[,\s]+/iu, '');
  if (kind === 'confirm') {
    if (NO.test(reply)) return 'deny';
    if (YES.test(reply)) return 'allow';
    return undefined;
  }
  if (GIVE_UP.test(reply)) return 'give-up';
  if (DONE.test(reply)) return 'done';
  return undefined;
}

/** The prompt as it is read out. */
export function spokenPrompt(prompt: PromptRequest): string {
  if (prompt.kind === 'help') return `I need you in the browser: ${prompt.reason}`;
  return `Permission to ${lowerFirst(prompt.action)}?`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
