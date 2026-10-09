import { useCallback, useState } from 'react';

import {
  actionKey,
  bindingKey,
  bindingLabel,
  type BoundAction,
  type InputSnapshot,
} from '../../../shared/input';
import { type BoundElsewhere, Presses, takenElsewhere } from './Presses';

interface PasteBindingsPanelProps {
  bindings: BoundAction[];
  input: InputSnapshot | undefined;
  /** Writes the list straight to the settings file; there is nothing to press Save for. */
  onSave: (bindings: BoundAction[]) => Promise<void>;
  /** The cockpit's stick bindings, so a press can't paste and run a command at once. */
  elsewhere: readonly BoundElsewhere[];
}

/**
 * The controls that press Ctrl+V in the game. Each can ask for one, two or three presses, so a
 * button that already does something in the cockpit can paste on a double click.
 */
export function PasteBindingsPanel({
  bindings,
  input,
  onSave,
  elsewhere,
}: PasteBindingsPanelProps) {
  /** Which row is being rebound, -1 for a new one; undefined while nothing is being captured. */
  const [target, setTarget] = useState<number>();
  const [problem, setProblem] = useState<string>();
  const capturing = target !== undefined;

  /** Rebinding a row keeps how it is pressed: it changes which button pastes, nothing else. */
  const capture = useCallback(
    async (index: number) => {
      setTarget(index);
      setProblem(undefined);
      try {
        const result = await window.edssi.input.capture();
        if (!result) return;
        const action: BoundAction = { ...bindings[index], binding: result.binding };
        const already = bindings.findIndex(
          (candidate, at) => at !== index && actionKey(candidate) === actionKey(action),
        );
        if (already !== -1) {
          setProblem(`${result.label} already pastes.`);
          return;
        }
        const other = takenElsewhere(elsewhere, action);
        if (other !== undefined) {
          setProblem(
            `${result.label} already does “${other}”. Remove that, or set this one to two or ` +
              'three presses.',
          );
          return;
        }

        await onSave(
          index === -1
            ? [...bindings, action]
            : bindings.map((candidate, at) => (at === index ? action : candidate)),
        );
      } catch (error) {
        console.error('[settings] capture failed', error);
        setProblem('EDSSI could not read that.');
      } finally {
        setTarget(undefined);
      }
    },
    [bindings, elsewhere, onSave],
  );

  const cancel = useCallback(() => {
    void window.edssi.input.cancelCapture();
    setTarget(undefined);
  }, []);

  const changeClicks = useCallback(
    (index: number, clicks: number) => {
      const action = { ...bindings[index]!, clicks };
      const other = takenElsewhere(elsewhere, action);
      if (other !== undefined) {
        setProblem(`Pressed that way, ${bindingLabel(action.binding)} already does “${other}”.`);
        return;
      }
      setProblem(undefined);
      void onSave(bindings.map((candidate, at) => (at === index ? action : candidate)));
    },
    [bindings, elsewhere, onSave],
  );

  const remove = useCallback(
    (index: number) => void onSave(bindings.filter((_action, at) => at !== index)),
    [bindings, onSave],
  );

  return (
    <div className="settings-panel">
      <p className="settings-help">
        Presses Ctrl+V in the game. Following a route, EDSSI copies the next system after every
        jump, so a button on the stick pastes it into the galaxy map’s search.
      </p>

      <ul className="bindings vr-bindings">
        {bindings.map((action, index) => (
          <li
            key={actionKey(action)}
            className="binding vr-binding"
            data-held={input?.state[bindingKey(action.binding)] ? 'true' : 'false'}
          >
            <div className="vr-binding-head">
              <span className="binding-dot" aria-hidden="true" />
              <span className="vr-binding-command">{bindingLabel(action.binding)}</span>
              <button
                type="button"
                className="link"
                disabled={capturing}
                onClick={() => void capture(index)}
              >
                Rebind
              </button>
              <button
                type="button"
                className="link"
                disabled={capturing}
                onClick={() => remove(index)}
              >
                Remove
              </button>
            </div>
            <div className="vr-binding-detail">
              <Presses
                className="vr-binding-clicks"
                name={`paste-clicks-${actionKey(action)}`}
                clicks={action.clicks}
                onChange={(clicks) => changeClicks(index, clicks)}
              />
            </div>
          </li>
        ))}
        {bindings.length === 0 && <li className="binding empty muted">Nothing is bound.</li>}
      </ul>

      {capturing ? (
        <output className="capture">
          <span className="capture-pulse" aria-hidden="true" />
          <span>
            {target === -1 ? 'Press a control on a stick' : 'Press its replacement'} — hold it for a
            moment. A stick button, a hat direction or a ministick pushed one way all count.
          </span>
          <button type="button" className="btn ghost sm" onClick={cancel}>
            Cancel
          </button>
        </output>
      ) : (
        <div className="settings-actions">
          <button type="button" className="btn ghost sm" onClick={() => void capture(-1)}>
            Add a binding
          </button>
        </div>
      )}

      {problem && <p className="settings-problem">{problem}</p>}
      {input?.problem && <p className="settings-problem">{input.problem}</p>}
    </div>
  );
}
