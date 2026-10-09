import { type FormEvent, useEffect, useRef, useState } from 'react';

import type { BrowserState } from '../../../shared/browser';
import type { CommanderPrompt } from '../../../shared/prompts';
import { PromptBar } from '../comms/PromptBar';
import { Glyph } from '../hud/Glyph';

interface BrowserViewProps {
  /** Whether the Browser tab is the one showing. The page is hidden otherwise. */
  active: boolean;
  /** What the assistant is waiting on the commander for. */
  prompt: CommanderPrompt | undefined;
}

/**
 * The assistant's browser. The page itself isn't part of this document: it is a view the main
 * process lays over the frame below, so this reports where the frame is whenever it moves.
 */
export function BrowserView({ active, prompt }: BrowserViewProps) {
  const state = useBrowserState();
  const frame = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const element = frame.current;
    if (!active || !element) return undefined;
    const report = (): void => {
      const rect = element.getBoundingClientRect();
      void window.edssi.browser.setBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      void window.edssi.browser.setBounds(null);
    };
  }, [active]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const text = address.trim();
    if (!text) return;
    setEditing(false);
    void window.edssi.browser.navigate(text);
  };

  return (
    <div className="browser">
      <form className="bbar" onSubmit={submit}>
        <button
          type="button"
          className="ibtn"
          aria-label="Back"
          disabled={!state.canGoBack}
          onClick={() => void window.edssi.browser.back()}
        >
          <Glyph name="back" />
        </button>
        <button
          type="button"
          className="ibtn"
          aria-label="Forward"
          disabled={!state.canGoForward}
          onClick={() => void window.edssi.browser.forward()}
        >
          <Glyph name="forward" />
        </button>
        <button
          type="button"
          className="ibtn"
          aria-label="Reload"
          disabled={!state.url}
          onClick={() => void window.edssi.browser.reload()}
        >
          <Glyph name="reload" />
        </button>
        <label className="input grow">
          <span className="ic-w">
            <Glyph name="globe" />
          </span>
          <input
            type="text"
            placeholder="Address, or words to search for"
            aria-label="Address, or words to search for"
            spellCheck={false}
            value={editing ? address : (state.url ?? '')}
            onFocus={(event) => {
              setAddress(state.url ?? '');
              setEditing(true);
              event.currentTarget.select();
            }}
            onBlur={() => setEditing(false)}
            onChange={(event) => setAddress(event.target.value)}
          />
          {(state.error || state.loading) && (
            <span className={state.error ? 'unit danger' : 'unit'} title={state.error}>
              {state.error ? 'Failed' : 'Loading…'}
            </span>
          )}
        </label>
      </form>
      <PromptBar prompt={prompt} />
      <div ref={frame} className={state.url ? 'webframe' : 'webframe empty-frame'}>
        {!state.url && (
          <div className="bempty">
            <div className="qlinks">
              {QUICK_LINKS.map((link) => (
                <button
                  key={link.url}
                  type="button"
                  className="qlink"
                  title={link.url}
                  onClick={() => void window.edssi.browser.navigate(link.url)}
                >
                  <span className="ql-n">{link.name}</span>
                </button>
              ))}
            </div>
            <p className="hint" style={{ textAlign: 'center' }}>
              Pages the ship opens show up here too.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Where the ship's pilots go most, one click away while nothing is open. */
const QUICK_LINKS = [
  { name: 'Spansh', url: 'https://spansh.co.uk' },
  { name: 'EDSM', url: 'https://www.edsm.net' },
  { name: 'Inara', url: 'https://inara.cz' },
  { name: 'Frontier forums', url: 'https://forums.frontier.co.uk' },
];

function useBrowserState(): BrowserState {
  const [state, setState] = useState<BrowserState>({
    loading: false,
    canGoBack: false,
    canGoForward: false,
  });
  useEffect(() => {
    let live = true;
    const unsubscribe = window.edssi.browser.onChange(setState);
    window.edssi.browser.getState().then(
      (next) => {
        if (live) setState(next);
      },
      (error: unknown) => console.error('[browser] failed to load', error),
    );
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return state;
}
