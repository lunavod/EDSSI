import type { CommanderPrompt, PromptAnswer } from '../../../shared/prompts';
import { Glyph } from '../hud/Glyph';

interface PromptBarProps {
  prompt: CommanderPrompt | undefined;
}

/**
 * What the assistant is waiting on the commander for: a yes or no before it does something on a
 * page, or a hand with something only a person should do. Saying the answer works too. It sits in
 * the flow, between what came before and what it is about, never over it.
 */
export function PromptBar({ prompt }: PromptBarProps) {
  if (!prompt) return null;
  const answer = (value: PromptAnswer) => void window.edssi.assistant.answer(prompt.id, value);

  return (
    <div
      className="prompt panel brk"
      role="alertdialog"
      aria-live="assertive"
      aria-label="The ship asks"
    >
      <div className="row" style={{ gap: 10 }}>
        <span className="tag warn">{prompt.kind === 'help' ? 'Your help' : 'Permission'}</span>
        {prompt.url && <span className="micro">{hostOf(prompt.url)}</span>}
      </div>
      <p className="prompt-q">{prompt.kind === 'help' ? prompt.reason : `${prompt.action}?`}</p>
      {prompt.kind === 'confirm' && prompt.detail && (
        <pre className="prompt-detail">{prompt.detail}</pre>
      )}
      <div className="row" style={{ gap: 10 }}>
        {prompt.kind === 'confirm' ? (
          <>
            <button type="button" className="btn primary" onClick={() => answer('allow')}>
              <span className="ic-w">
                <Glyph name="check" />
              </span>
              Allow
            </button>
            <button type="button" className="btn ghost" onClick={() => answer('deny')}>
              Deny
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn primary" onClick={() => answer('done')}>
              <span className="ic-w">
                <Glyph name="check" />
              </span>
              Done
            </button>
            <button type="button" className="btn ghost" onClick={() => answer('give-up')}>
              Give up
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
