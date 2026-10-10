import { useEffect, useRef, useState } from 'react';

import type { AssistantPhase, VoicePreview } from '../../../shared/assistant';
import { DEFAULT_KOKORO_VOICE, type KokoroState } from '../../../shared/kokoro';
import { Glyph } from '../hud/Glyph';
import { type Getter, speakingProvider } from './fields';

const SAMPLE =
  'Docking request granted, Commander. Proceed to landing pad seventeen. ' +
  'Shinrarta Dezhra is three jumps out, and the fuel will last.';

/** A text setting as it is on screen, or nothing when it is empty. */
function textAt(get: Getter, path: readonly string[]): string | undefined {
  const value = get(path);
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * What to ask for: the line, in the voice the settings on screen pick, with that provider's own
 * settings as they stand — saved or not.
 */
export function previewFor(get: Getter, text: string): VoicePreview | undefined {
  const speed = get(['voice', 'speech', 'speed']);
  const instructions = textAt(get, ['voice', 'speech', 'instructions']);
  const common = {
    text,
    speed: typeof speed === 'number' ? speed : 1,
    ...(instructions ? { instructions } : {}),
  };
  switch (speakingProvider(get)) {
    case 'kokoro':
      return {
        ...common,
        provider: 'kokoro',
        voice: textAt(get, ['kokoro', 'voice']) ?? DEFAULT_KOKORO_VOICE,
      };
    case 'inworld': {
      const apiKey = textAt(get, ['inworld', 'api_key']);
      return {
        ...common,
        provider: 'inworld',
        model: textAt(get, ['inworld', 'model']) ?? 'inworld-tts-2',
        voice: textAt(get, ['inworld', 'voice']) ?? 'Ashley',
        ...(apiKey ? { apiKey } : {}),
      };
    }
    case 'wyoming': {
      const voice = textAt(get, ['wyoming', 'voice']);
      return {
        ...common,
        provider: 'wyoming',
        uri: textAt(get, ['wyoming', 'speech_uri']) ?? 'tcp://127.0.0.1:10200',
        ...(voice ? { voice } : {}),
      };
    }
    default:
      return undefined;
  }
}

/**
 * Hear a line in the voice the settings above pick — Kokoro, Inworld or a Wyoming server — as they
 * are on screen, saved or not, so a voice can be tried before it is kept. It plays like any
 * answer, through this window, and while anything is being said the button stops it instead.
 *
 * Kokoro can be pressed before it is ready (still downloading, or loading): this shows how far
 * along that is and plays the line the moment it is.
 */
export function VoiceTestPanel({ get }: { get: Getter }) {
  const [text, setText] = useState(SAMPLE);
  const [problem, setProblem] = useState<string>();
  const [phase, setPhase] = useState<AssistantPhase>('idle');
  const [kokoro, setKokoro] = useState<KokoroState>({ kind: 'idle' });
  const [starting, setStarting] = useState(false);
  // Pressed before the voice was ready: play once it is. A ref as well, for the subscription.
  const [waiting, setWaiting] = useState(false);
  const waitingRef = useRef(false);

  const wait = (on: boolean) => {
    waitingRef.current = on;
    setWaiting(on);
  };

  const isKokoro = speakingProvider(get) === 'kokoro';

  const play = async () => {
    const preview = previewFor(get, text);
    if (!preview) return;
    setProblem(undefined);
    setStarting(true);
    try {
      const why = await window.edssi.assistant.previewVoice(preview);
      // Kokoro not ready yet: asking has set it going (again, after a failure), and the progress
      // below says how far it is.
      if (why !== undefined && preview.provider === 'kokoro' && latest.current.kind !== 'ready') {
        wait(true);
      } else setProblem(why);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  };

  // The newest of each, for the subscription, which outlives the render that made it.
  const latest = useRef<KokoroState>(kokoro);
  const playRef = useRef(play);
  useEffect(() => {
    playRef.current = play;
  });

  // Shown with Kokoro picked means it's about to be tried: load it now, not when Play is pressed.
  useEffect(() => {
    if (isKokoro) void window.edssi.assistant.prepareKokoro();
  }, [isKokoro]);

  useEffect(() => {
    const take = (state: KokoroState, now: AssistantPhase) => {
      latest.current = state;
      setKokoro(state);
      setPhase(now);
      const next = whileWaiting(waitingRef.current, state);
      if (next === 'wait') return;
      waitingRef.current = false;
      setWaiting(false);
      if (next === 'play') void playRef.current();
    };
    void window.edssi.assistant
      .getSnapshot()
      .then((snapshot) => take(snapshot.setup.kokoro, snapshot.phase));
    return window.edssi.assistant.onChange((snapshot) =>
      take(snapshot.setup.kokoro, snapshot.phase),
    );
  }, []);

  // From the press until the first word, which is a second or so, while waiting for the voice
  // to be ready, and while it speaks.
  const busy = starting || waiting || phase === 'speaking';

  const stop = () => {
    if (waitingRef.current) wait(false);
    else void window.edssi.assistant.cancel();
  };

  return (
    <div className="sf voice-test">
      <div className="sf-l">
        <label className="sf-name" htmlFor="voice-test-line">
          Try the voice
        </label>
        <div className="sf-help">The voice and speed above, saved or not.</div>
      </div>
      <div className="sf-c">
        <div className="row">
          <span className="input grow">
            <input
              id="voice-test-line"
              spellCheck={false}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  if (busy) stop();
                  else void play();
                }
              }}
            />
          </span>
          <button
            type="button"
            className="btn sm voice-play"
            disabled={!busy && !text.trim()}
            aria-pressed={busy}
            onClick={() => (busy ? stop() : void play())}
          >
            <span className="ic-w">
              <Glyph name={busy ? 'stop' : 'play'} />
            </span>
            {busy ? 'Stop' : 'Play'}
          </button>
        </div>
        {isKokoro && <Progress state={kokoro} waiting={waiting} />}
        {isKokoro && kokoro.kind === 'failed' && (
          <div className="sf-problem">Kokoro’s voice couldn’t be set up: {kokoro.message}</div>
        )}
        {problem && !(isKokoro && kokoro.kind === 'failed') && (
          <div className="sf-problem">{problem}</div>
        )}
      </div>
    </div>
  );
}

/**
 * What the voice's state means for a line waiting to be played: play it now it's ready, drop it
 * if getting ready failed (the failure is shown), otherwise keep waiting. Nothing waiting is
 * nothing to do.
 */
export function whileWaiting(waiting: boolean, state: KokoroState): 'play' | 'drop' | 'wait' {
  if (!waiting) return 'wait';
  if (state.kind === 'ready') return 'play';
  // A retry after a failure shows as `loading` at once (the client says so before it answers),
  // so a `failed` seen while waiting is a new failure.
  if (state.kind === 'failed') return 'drop';
  return 'wait';
}

/** How far the voice is in getting ready: a bar that fills while it downloads, and moves while it loads. */
function Progress({ state, waiting }: { state: KokoroState; waiting: boolean }) {
  const then = waiting ? ' It plays as soon as it’s ready.' : '';
  if (state.kind === 'downloading') {
    const percent = Math.floor((100 * state.received) / state.total);
    const mb = Math.round(state.total / 1_000_000);
    return (
      <output className="kokoro-progress">
        <div className="bar" aria-hidden>
          <i style={{ width: `${Math.max(1, percent)}%` }} />
        </div>
        <span>
          Downloading Kokoro’s voice: {percent}% of {mb} MB.{then}
        </span>
      </output>
    );
  }
  if (
    state.kind === 'loading' ||
    (waiting && (state.kind === 'idle' || state.kind === 'missing'))
  ) {
    return (
      <output className="kokoro-progress">
        <div className="bar busy" aria-hidden>
          <i />
        </div>
        <span>Loading Kokoro’s voice.{then}</span>
      </output>
    );
  }
  return null;
}
