import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AnswerSource,
  AssistantSnapshot,
  ToolCallRecord,
  TranscriptEntry,
} from '../../../shared/assistant';
import { useEdssi } from '../api/context';
import { Glyph } from '../hud/Glyph';
import { scrollNearest } from '../hud/scroll-within';
import { formatShortTime } from '../journal/format';
import { useSettingsRequests } from '../settings/open';
import { formatJson, preview } from './json';
import { PromptBar } from './PromptBar';
import type { Voice } from './useVoice';

interface CommsViewProps {
  snapshot: AssistantSnapshot | undefined;
  voice: Voice;
  /**
   * Drawn as a VR panel rather than as the Comms tab. There is no pointer in a headset and no
   * keyboard the commander can see, so everything that has to be clicked or typed into is left out
   * rather than shown greyed: the question box, the buttons, the links and the disclosure on a
   * tool call. What is left is the conversation and one line saying what the assistant is doing,
   * which is the whole of what a voice can reach.
   */
  vr?: boolean;
}

const PHASES: Record<string, string> = {
  transcribing: 'Hearing you out…',
  thinking: 'Working on it…',
  waiting: 'Waiting for you…',
  speaking: 'Speaking…',
};

/**
 * The conversation with the ship's assistant as a transcript: who and when above each message,
 * tool calls as slim rows that open. Talking and typing share the bar below; the model and the
 * voice are set in Settings, not on top of the conversation.
 */
export function CommsView({ snapshot, voice, vr = false }: CommsViewProps) {
  const edssi = useEdssi();
  const [question, setQuestion] = useState('');
  const entries = snapshot?.transcript ?? [];
  const bottom = useRef<HTMLDivElement>(null);
  // Also on the last entry's text, so the view follows an answer as it is written.
  const latest = entries.at(-1);
  const latestText = latest?.text;

  useEffect(() => {
    if (bottom.current) scrollNearest(bottom.current, 'end');
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- these are the cue to scroll
  }, [entries.length, latestText]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    setQuestion('');
    void edssi.assistant.ask(text);
  };

  const setup = snapshot?.setup;
  const status = voice.listening ? 'Listening…' : (PHASES[snapshot?.phase ?? 'idle'] ?? '');
  const busy = snapshot?.phase !== undefined && snapshot.phase !== 'idle';

  return (
    <div className={vr ? 'comms comms-vr' : 'comms'}>
      {vr ? (
        <VrHead snapshot={snapshot} problem={voice.problem} status={status} />
      ) : (
        <Trouble snapshot={snapshot} problem={voice.problem} />
      )}
      <div className="clog">
        {entries.map((entry) => (
          <Entry key={entry.id} entry={entry} vr={vr} />
        ))}
        {entries.length === 0 && <p className="clog-empty">{opening(setup, vr)}</p>}
        <div ref={bottom} />
      </div>
      <PromptBar prompt={snapshot?.prompt} />
      {!vr && (
        <>
          <form className={voice.listening ? 'cbar live' : 'cbar'} onSubmit={submit}>
            <button
              type="button"
              className="mic"
              aria-pressed={voice.listening}
              disabled={setup?.voiceInput === false}
              onClick={voice.toggle}
              title={
                setup?.pushToTalk.length
                  ? `Push to talk: ${setup.pushToTalk.join(', ')}`
                  : 'Push to talk'
              }
            >
              <span className="ic-w">
                <Glyph name="mic" />
              </span>
              {voice.listening ? 'Stop' : 'Talk'}
            </button>
            <label className="input lg grow">
              <input
                type="text"
                placeholder="Ask the ship"
                aria-label="Ask the ship"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <span className="kbd">Enter</span>
            </label>
            <button
              type="submit"
              className="ibtn send"
              aria-label="Send"
              disabled={!question.trim()}
            >
              <Glyph name="send" />
            </button>
          </form>
          <div className="row micro cfoot">
            <span>{status}</span>
            <span className="sp" />
            <button
              type="button"
              className="link"
              disabled={!busy}
              onClick={() => void edssi.assistant.cancel()}
            >
              Stop
            </button>
            <button
              type="button"
              className="link"
              title="Start a new conversation"
              onClick={() => void edssi.assistant.reset()}
            >
              New
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What the panel says before anything has been asked. In a headset it can only be the push to
 * talk: there is nothing to type into, so offering it would point at a box that is not there.
 */
function opening(setup: AssistantSnapshot['setup'] | undefined, vr: boolean): string {
  if (setup?.pushToTalk.length) {
    const keys = `${setup.holdToTalk ? 'Hold' : 'Press'} ${setup.pushToTalk.join(' or ')} and speak`;
    return vr ? `${keys}.` : `${keys}, or type below.`;
  }

  return vr ? 'Nothing is bound to push to talk.' : 'Type a question below.';
}

function Entry({ entry, vr }: { entry: TranscriptEntry; vr: boolean }) {
  if (entry.role === 'tool' && entry.call) {
    return <ToolEntry entry={entry} call={entry.call} vr={vr} />;
  }
  const kind = entry.role === 'commander' ? 'cmdr' : entry.role === 'assistant' ? 'ship' : 'error';
  return (
    <article className={`msg ${kind}`}>
      <header className="msg-head">
        <span className="msg-who">{who(entry.role)}</span>
        <span className="msg-t">
          {entry.pending && !entry.text ? 'thinking' : formatShortTime(entry.at)}
        </span>
      </header>
      <p className="msg-text">
        {entry.text}
        {entry.pending && <span className="caret" />}
      </p>
      {entry.sources && entry.sources.length > 0 && <Sources sources={entry.sources} vr={vr} />}
    </article>
  );
}

/** Where an answer from the web came from; opens in the commander's own browser. */
function Sources({ sources, vr }: { sources: AnswerSource[]; vr: boolean }) {
  return (
    <p className="msg-src">
      Sources:
      {sources.map((source) =>
        // A link nothing can follow is underlined text in the way. Naming the site is what the
        // link was good for in a headset anyway: it says whether to believe the answer.
        vr ? (
          <span key={source.url}>{source.site}</span>
        ) : (
          <a
            key={source.url}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            title={source.title === source.site ? source.url : `${source.title}\n${source.url}`}
          >
            {source.site}
          </a>
        ),
      )}
    </p>
  );
}

/** A tool call, opened to show what it was asked and what it answered. */
function ToolEntry({
  entry,
  call,
  vr,
}: {
  entry: TranscriptEntry;
  call: ToolCallRecord;
  vr: boolean;
}) {
  // The bodies are only built once opened: a transcript can hold many long answers.
  const [open, setOpen] = useState(false);
  const head = (
    <>
      <span className="tool-ic">
        <Glyph name="tool" />
      </span>
      <span className="tool-name">{entry.text}</span>
      {call.failed && <span className="tag danger">failed</span>}
      {!vr && <code>{preview(call.input)}</code>}
      <span className="sp" />
    </>
  );
  // Nothing can open a disclosure in a headset, and the parameters and the response are pages of
  // JSON — which is not what anyone wants read out to them. The line says what the ship did.
  if (vr) {
    return (
      <div className={call.failed ? 'tool fail' : 'tool'}>
        <div className="row" style={{ height: 36, padding: '0 10px', gap: 10 }}>
          {head}
        </div>
      </div>
    );
  }

  return (
    <details
      className={call.failed ? 'tool fail' : 'tool'}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {head}
        <span className="tool-chev">
          <Glyph name="forward" />
        </span>
      </summary>
      {open && (
        <div className="tool-body">
          {call.input !== undefined && <CallPart title="Parameters" text={call.input} />}
          {call.output !== undefined && (
            <CallPart
              title={
                call.images
                  ? `Response · ${call.images} image${call.images === 1 ? '' : 's'}`
                  : 'Response'
              }
              text={call.output}
            />
          )}
        </div>
      )}
    </details>
  );
}

function CallPart({ title, text }: { title: string; text: string }) {
  const tokens = useMemo(() => formatJson(text), [text]);
  return (
    <section className="tool-part">
      <h3>{title}</h3>
      <pre className="json">
        {tokens
          ? tokens.map((token, index) =>
              token.kind === 'space' ? (
                token.text
              ) : (
                // oxlint-disable-next-line react/no-array-index-key -- tokens have no identity.
                <span key={index} className={`json-${token.kind}`}>
                  {token.text}
                </span>
              ),
            )
          : text}
      </pre>
    </section>
  );
}

function who(role: TranscriptEntry['role']): string {
  switch (role) {
    case 'commander':
      return 'CMDR';
    case 'assistant':
      return 'SHIP';
    case 'tool':
      return 'SYS';
    default:
      return 'FAULT';
  }
}

/**
 * The head of the VR panel: what the assistant is doing, and anything stopping it.
 *
 * No model, no provider and no buttons. In a headset the only questions are whether it heard you
 * and whether something is broken — the rest is settled at the desk, before the headset goes on.
 */
function VrHead({
  snapshot,
  problem,
  status,
}: {
  snapshot?: AssistantSnapshot;
  problem?: string;
  status: string;
}) {
  const setup = snapshot?.setup;
  const trouble =
    problem ??
    setup?.configProblem ??
    setup?.problem ??
    (setup?.provider === 'codex' && !setup.signedIn ? 'Not signed in.' : undefined);

  return (
    <div className="comms-vr-head">
      <span className="comms-vr-status">{status || 'Ready'}</span>
      {trouble && <span className="danger">{trouble}</span>}
    </div>
  );
}

/** Whatever stops the assistant answering, and the button that fixes it; nothing when all is well. */
function Trouble({ snapshot, problem }: { snapshot?: AssistantSnapshot; problem?: string }) {
  const edssi = useEdssi();
  const settingsRequests = useSettingsRequests();
  const setup = snapshot?.setup;
  if (!setup) return null;
  const trouble = problem ?? setup.configProblem ?? setup.problem ?? setup.voiceNote;
  const needsSignIn = setup.provider === 'codex' && !setup.signedIn;
  if (!trouble && !needsSignIn) return null;

  return (
    <div className="note comms-trouble">
      <span className="ic-w">
        <Glyph name="warning" />
      </span>
      <span className="grow">{trouble ?? 'Sign in to ChatGPT for the ship to answer.'}</span>
      {needsSignIn && (
        <button type="button" className="btn sm" onClick={() => void edssi.assistant.signIn()}>
          Sign in with ChatGPT
        </button>
      )}
      <button type="button" className="link" onClick={() => settingsRequests.open('quickstart')}>
        Open Quickstart
      </button>
    </div>
  );
}
