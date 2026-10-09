/**
 * "Ultrathink": a word the commander puts in a question to have that one answered by a stronger
 * model thinking harder, as set under `assistant.ultrathink`. Every other question keeps the usual
 * model, so the cost is only paid when asked for.
 */

import type { AssistantSettings, ReasoningEffort } from '../../shared/settings';

export const ULTRATHINK = 'ultrathink';

/** Typed as one word; a transcriber may well write "ultra think" or "Ultra-think". */
const SPOKEN = /\bultra[\s-]?think(?:ing)?\b/i;

export function wantsUltrathink(question: string): boolean {
  return SPOKEN.test(question);
}

export interface ModelChoice {
  model: string;
  reasoningEffort: ReasoningEffort;
  ultrathink: boolean;
}

/** The model and effort a question is answered with. */
export function modelFor(settings: AssistantSettings, question: string): ModelChoice {
  return wantsUltrathink(question)
    ? {
        model: settings.ultrathink.model,
        reasoningEffort: settings.ultrathink.reasoning_effort,
        ultrathink: true,
      }
    : { model: settings.model, reasoningEffort: settings.reasoning_effort, ultrathink: false };
}
