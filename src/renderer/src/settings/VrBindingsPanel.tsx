import { useCallback, useState } from 'react';

import {
  actionKey,
  bindingKey,
  bindingLabel,
  type BoundAction,
  type InputSnapshot,
} from '../../../shared/input';
import {
  VR_COMMAND_GROUPS,
  VR_COMMAND_LABELS,
  VR_COMMAND_NAMES,
  type VrCommand,
  VR_REPEAT_COMMANDS,
} from '../../../shared/vr';
import { Select } from '../hud/Select';
import { Toggle } from './FieldRow';
import { type BoundElsewhere, Presses, takenElsewhere } from './Presses';

interface VrBindingsPanelProps {
  bindings: Partial<Record<VrCommand, BoundAction[]>>;
  input: InputSnapshot | undefined;
  /** Writes one command's bindings straight to the settings file; nothing to press Save for. */
  onSave: (command: VrCommand, actions: BoundAction[]) => Promise<void>;
  /** What else is bound to controls, such as paste, so a press can't be given two jobs. */
  elsewhere?: readonly BoundElsewhere[];
  /**
   * Just these commands, a row each whether bound or not, and none of the explaining: the
   * Quickstart page's few that matter in flight. Without it, everything bound and a picker for more.
   */
  quick?: readonly VrCommand[];
}

/** One row of the list: a control, and the command it runs. */
interface Row {
  command: VrCommand;
  action: BoundAction;
  at: number;
}

/**
 * What the commander's stick does in the VR cockpit.
 *
 * The list is what is bound, not what could be — there are thirty-odd commands and a stick has two
 * or three buttons to spare, so a row per command is a page of nothing with the answer buried in
 * it. Binding is one row at the bottom: pick the command, press the button.
 *
 * The keys are not here. They live in `~/.edssi/vr-overlay.json` beside the layout, because a
 * commander wearing a headset can't be shown this screen and no two keyboards agree on which keys
 * exist. A stick button is the other way round — it has no name to write down, so the only way to
 * bind one is to press it, which is a screen.
 */
export function VrBindingsPanel({
  bindings,
  input,
  onSave,
  elsewhere = [],
  quick,
}: VrBindingsPanelProps) {
  const [command, setCommand] = useState<VrCommand>('toggle');
  /** What the capture will do with what is pressed: add a binding, or replace this row's. */
  const [capturing, setCapturing] = useState<{ row?: Row; target?: VrCommand } | undefined>();
  const [problem, setProblem] = useState<string>();

  const bound = useCallback((of: VrCommand) => bindings[of] ?? [], [bindings]);

  /** Everything bound, in the order the groups are listed, so the list reads the same every time. */
  const rows: Row[] = VR_COMMAND_GROUPS.flatMap((group) =>
    group.commands.flatMap((of) => bound(of).map((action, at) => ({ command: of, action, at }))),
  );

  /**
   * Waits for a control and binds it. Given a row, it replaces that row's control and keeps how it
   * is pressed — rebinding is changing which button does this, not starting the binding over.
   */
  const capture = useCallback(
    async (row?: Row, target?: VrCommand) => {
      setCapturing({ row, ...(target ? { target } : {}) });
      setProblem(undefined);
      const into = row?.command ?? target ?? command;
      try {
        const result = await window.edssi.input.capture();
        if (!result) return;
        const action: BoundAction = { ...row?.action, binding: result.binding };
        // The same control pressed the same way can't run two commands; it would run both. The row
        // being rebound doesn't count against itself: pressing the same button again is a no-op,
        // not a clash.
        const taken = VR_COMMAND_NAMES.find((name) =>
          (bindings[name] ?? []).some(
            (candidate) =>
              actionKey(candidate) === actionKey(action) &&
              !(name === row?.command && candidate === row.action),
          ),
        );
        const other = takenElsewhere(elsewhere, action);
        if (other !== undefined) {
          setProblem(
            `${result.label} already does “${other}”. Remove that, or set this one to two or ` +
              'three presses.',
          );
          return;
        }
        if (taken !== undefined) {
          setProblem(
            taken === into
              ? `${result.label} already does this.`
              : `${result.label} already does “${VR_COMMAND_LABELS[taken]}”. Remove that, or set ` +
                  'this one to two or three presses.',
          );
          return;
        }

        const existing = bound(into);
        await onSave(
          into,
          row === undefined
            ? [...existing, action]
            : existing.map((candidate, index) => (index === row.at ? action : candidate)),
        );
      } catch (error) {
        console.error('[settings] capture failed', error);
        setProblem('EDSSI could not read that.');
      } finally {
        setCapturing(undefined);
      }
    },
    [bindings, bound, command, elsewhere, onSave],
  );

  const cancel = useCallback(() => {
    void window.edssi.input.cancelCapture();
    setCapturing(undefined);
  }, []);

  const change = useCallback(
    (row: Row, how: Partial<BoundAction>) => {
      const next = bound(row.command).map((action, index) =>
        index === row.at ? { ...action, ...how } : action,
      );
      void onSave(row.command, next);
    },
    [bound, onSave],
  );

  const remove = useCallback(
    (row: Row) =>
      void onSave(
        row.command,
        bound(row.command).filter((_action, index) => index !== row.at),
      ),
    [bound, onSave],
  );

  const listening =
    capturing !== undefined ? (
      <output className="capture">
        <span className="capture-pulse" aria-hidden="true" />
        <span>
          Press the button, or push the stick, and hold it for a moment — a hat direction and a
          ministick both count. It will run{' '}
          <b>{VR_COMMAND_LABELS[capturing.row?.command ?? capturing.target ?? command]}</b>
          {capturing.row === undefined
            ? '.'
            : `, in place of ${bindingLabel(capturing.row.action.binding)}.`}
        </span>
        <button type="button" className="btn ghost sm" onClick={cancel}>
          Cancel
        </button>
      </output>
    ) : null;

  if (quick) {
    return (
      <div className="settings-panel">
        <ul className="bindings vr-bindings vr-bindings-quick">
          {quick.map((of) => {
            const mine = rows.filter((row) => row.command === of);
            const first = mine[0];
            return (
              <li
                key={of}
                className="binding vr-binding"
                data-held={
                  mine.some((row) => input?.state[bindingKey(row.action.binding)])
                    ? 'true'
                    : 'false'
                }
              >
                <div className="vr-binding-head">
                  <span className="binding-dot" aria-hidden="true" />
                  <span className="vr-binding-command">{VR_COMMAND_LABELS[of]}</span>
                  <span className="vr-binding-control">
                    {first ? (
                      mine.map((row) => bindingLabel(row.action.binding)).join(', ')
                    ) : (
                      <span className="muted">Not bound</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="link"
                    disabled={capturing !== undefined}
                    onClick={() => void capture(first, of)}
                  >
                    {first ? 'Rebind' : 'Bind…'}
                  </button>
                  {first && (
                    <button
                      type="button"
                      className="link"
                      disabled={capturing !== undefined}
                      onClick={() => remove(first)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {listening}
        {problem && <p className="settings-problem">{problem}</p>}
        {input?.problem && <p className="settings-problem">{input.problem}</p>}
      </div>
    );
  }

  return (
    <div className="settings-panel">
      <p className="settings-help">
        What your stick does in the cockpit. The keys are in <code>~/.edssi/vr-overlay.json</code>,
        which is the only place they can be rebound — you can’t be shown this screen with a headset
        on.
      </p>

      <ul className="bindings vr-bindings">
        {rows.map((row) => (
          <li
            key={`${row.command}:${actionKey(row.action)}`}
            className="binding vr-binding"
            data-held={input?.state[bindingKey(row.action.binding)] ? 'true' : 'false'}
          >
            {/* What it does first: that is what the commander is looking for down the list. */}
            <div className="vr-binding-head">
              <span className="binding-dot" aria-hidden="true" />
              <span className="vr-binding-command">{VR_COMMAND_LABELS[row.command]}</span>
              <button
                type="button"
                className="link"
                disabled={capturing !== undefined}
                onClick={() => void capture(row)}
              >
                Rebind
              </button>
              <button
                type="button"
                className="link"
                disabled={capturing !== undefined}
                onClick={() => remove(row)}
              >
                Remove
              </button>
            </div>
            <div className="vr-binding-detail">
              <span className="vr-binding-control">{bindingLabel(row.action.binding)}</span>
              <Presses
                className="vr-binding-clicks"
                name={`clicks-${row.command}-${actionKey(row.action)}`}
                clicks={row.action.clicks}
                onChange={(clicks) => change(row, { clicks })}
              />
              <Toggle
                text="Repeats while held"
                title="Keep running while the control is held"
                on={row.action.repeat ?? VR_REPEAT_COMMANDS.has(row.command)}
                onChange={(repeat) => change(row, { repeat })}
              />
            </div>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="binding empty muted">
            Nothing on your stick yet. The cockpit still answers to its keys.
          </li>
        )}
      </ul>

      {listening ?? (
        <div className="settings-actions vr-add-binding">
          <Select
            aria-label="Command to bind"
            value={command}
            options={VR_COMMAND_GROUPS.flatMap((group) =>
              group.commands.map((name) => ({
                value: name,
                label: VR_COMMAND_LABELS[name],
                group: group.title,
              })),
            )}
            onChange={setCommand}
          />
          <button type="button" className="btn ghost sm" onClick={() => void capture()}>
            Press a control…
          </button>
        </div>
      )}

      {problem && <p className="settings-problem">{problem}</p>}
      {input?.problem && <p className="settings-problem">{input.problem}</p>}

      <p className="settings-help">
        One control can carry three commands: pressed once, twice and three times. Only a control
        with two or three presses bound waits to see which it was. Everything else runs the moment
        it goes down.
      </p>
    </div>
  );
}
