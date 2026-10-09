import { Fragment, useCallback, useState } from 'react';

import {
  bindingKey,
  bindingLabel,
  type InputBinding,
  type InputSnapshot,
} from '../../../shared/input';
import { Glyph } from '../hud/Glyph';

interface BindingsPanelProps {
  bindings: InputBinding[];
  input: InputSnapshot | undefined;
  /** Writes the list straight to the settings file; there is nothing to press Save for. */
  onSave: (bindings: InputBinding[]) => Promise<void>;
}

/**
 * Push-to-talk. Any of these held opens the microphone, so the commander can have a key at the
 * desk and a button under their thumb.
 *
 * A binding is bound by pressing it, never by typing it: a control on a stick has no name the
 * commander could type, and the number EDSSI gives a button is its own. Held bindings light up,
 * which is how the commander knows they bound the one they meant.
 */
export function BindingsPanel({ bindings, input, onSave }: BindingsPanelProps) {
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState<string>();
  /** Which row is being rebound, or -1 for a new one. */
  const [target, setTarget] = useState<number>(-1);

  const capture = useCallback(
    async (index: number) => {
      setTarget(index);
      setCapturing(true);
      setProblem(undefined);
      try {
        const result = await window.edssi.input.capture();
        if (!result) return;
        const already = bindings.findIndex(
          (binding) => bindingKey(binding) === bindingKey(result.binding),
        );
        // Binding the same thing twice would just fight with itself.
        if (already !== -1 && already !== index) {
          setProblem(`${result.label} is already bound.`);
          return;
        }
        const next = [...bindings];
        if (index === -1) next.push(result.binding);
        else next[index] = result.binding;
        await onSave(next);
      } catch (error) {
        console.error('[settings] capture failed', error);
        setProblem('EDSSI could not read that.');
      } finally {
        setCapturing(false);
      }
    },
    [bindings, onSave],
  );

  const cancel = useCallback(() => {
    void window.edssi.input.cancelCapture();
    setCapturing(false);
  }, []);

  const remove = useCallback(
    (index: number) => void onSave(bindings.filter((_binding, at) => at !== index)),
    [bindings, onSave],
  );

  return (
    <div className="settings-panel">
      <ul className="bindings">
        {bindings.map((binding, index) => (
          <li
            key={bindingKey(binding)}
            className="binding"
            data-held={input?.state[bindingKey(binding)] ? 'true' : 'false'}
          >
            <span className="binding-dot" aria-hidden="true" />
            <Caps binding={binding} />
            <span className="binding-kind">{binding.kind === 'key' ? 'Keyboard' : 'Joystick'}</span>
            <span className="sp" />
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
          </li>
        ))}
        {bindings.length === 0 && (
          <li className="binding empty">
            Nothing is bound. Push-to-talk is off until you add something.
          </li>
        )}
      </ul>

      {capturing ? (
        <output className="capture">
          <span className="capture-pulse" aria-hidden="true" />
          <span className="grow">
            <b>
              {target === -1 ? 'Press a key, or a control on a stick' : 'Press its replacement'}
            </b>
            Hold it for a moment. A stick button, a hat direction or a ministick pushed one way all
            count.
          </span>
          <button type="button" className="btn ghost sm" onClick={cancel}>
            Cancel
          </button>
        </output>
      ) : (
        <div className="settings-actions">
          <button type="button" className="btn ghost sm" onClick={() => void capture(-1)}>
            <span className="ic-w">
              <Glyph name="plus" />
            </span>
            Add a binding
          </button>
        </div>
      )}

      {problem && <p className="settings-problem">{problem}</p>}
      {input?.problem && <p className="settings-problem">{input.problem}</p>}

      <Devices input={input} />
    </div>
  );
}

/** A binding as key caps: one per key of a chord, or one naming the stick and its control. */
export function Caps({ binding }: { binding: InputBinding }) {
  const label = bindingLabel(binding);
  if (binding.kind !== 'key') {
    return (
      <span className="kbdkey lg">
        <span className="ic-w">
          <Glyph name="joystick" />
        </span>
        {label}
      </span>
    );
  }
  const keys = label.split('+');
  return (
    <>
      {keys.map((key, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- a chord's keys are in a fixed order.
        <Fragment key={index}>
          {index > 0 && <span className="plus">+</span>}
          <span className="kbdkey lg">{key}</span>
        </Fragment>
      ))}
    </>
  );
}

/** The sticks EDSSI has open, so a stick that isn't listed can be chased down before binding. */
function Devices({ input }: { input: InputSnapshot | undefined }) {
  const devices = input?.devices ?? [];
  return (
    <div className="row micro devices-line">
      <span>Sticks EDSSI can see:</span>
      {devices.length === 0 ? (
        <span className="fg">
          None. EDSSI reads joysticks and gamepads; if yours is plugged in, give it a moment.
        </span>
      ) : (
        devices.map((device) => (
          <span
            key={`${device.vendorId}:${device.productId}:${device.serial ?? ''}`}
            className="fg"
          >
            {device.product}
            {device.manufacturer && ` · ${device.manufacturer}`}
          </span>
        ))
      )}
    </div>
  );
}
