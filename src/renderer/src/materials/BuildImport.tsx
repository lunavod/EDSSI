import { useEffect, useRef, useState } from 'react';

import type { PlannedBlueprint, PlannedBuild } from '../../../shared/build-import';
import { experimentalsFor, blueprintByKey } from '../../../shared/crafting';
import { Glyph } from '../hud/Glyph';

/** How many rolls the grade a build asks for gets; the grades below it are planned maxed. */
const ROLL_CHOICES: readonly { label: string; rolls: number | 'max'; help: string }[] = [
  {
    label: 'Max it',
    rolls: 'max',
    help: "As many rolls as maxing it takes at the engineer's rank (five at G5 at rank 5)",
  },
  { label: 'One roll', rolls: 1, help: 'Just reach the grade' },
];

/**
 * Blueprints from a ship build planned in EDSY or Coriolis: paste its export, check what it wants
 * against the commander's own ship of that type, pick, add.
 */
export function BuildImport({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [rolls, setRolls] = useState<number | 'max'>('max');
  const [builds, setBuilds] = useState<PlannedBuild[]>();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [problem, setProblem] = useState<string>();
  const [reading, setReading] = useState(false);
  const attempt = useRef(0);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  const read = (pasted: string, perGrade: number | 'max') => {
    const mine = ++attempt.current;
    setReading(true);
    setProblem(undefined);
    void window.edssi.materials
      .readBuild(pasted, perGrade)
      .then((outcome) => {
        if (mine !== attempt.current) return;
        if ('error' in outcome) {
          setProblem(outcome.error);
          setBuilds(undefined);
          return;
        }
        setBuilds(outcome.result);
        setPicked(
          new Set(
            outcome.result.flatMap((build, index) =>
              build.planned.flatMap((row, at) => (row.done ? [] : [rowKey(index, at)])),
            ),
          ),
        );
      })
      .finally(() => {
        if (mine === attempt.current) setReading(false);
      });
  };

  const close = () => {
    attempt.current++;
    onClose();
  };

  const chosen =
    builds?.flatMap((build, index) =>
      build.planned.filter((_, at) => picked.has(rowKey(index, at))).map((row) => row.todo),
    ) ?? [];

  const add = () => {
    if (chosen.length === 0) return;
    void window.edssi.materials.addTodos(chosen);
    close();
  };

  return (
    <dialog
      ref={dialog}
      className="modal build-import"
      aria-label="Import a build"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <h2 className="sec-title">Import a build</h2>
        <button type="button" className="ibtn sm" aria-label="Close" title="Close" onClick={close}>
          <Glyph name="close" />
        </button>
      </div>
      <p className="muted">
        In <b>EDSY</b>, press Export and copy the <b>SLEF</b> line. In <b>Coriolis</b>, press Export
        and copy the SLEF (or detailed build) text. EDSY and Coriolis import links work too.
      </p>
      <textarea
        className="build-paste"
        aria-label="The build's export"
        placeholder='[{"header":{"appName":"EDSY",…},"data":{"event":"Loadout",…}}]'
        spellCheck={false}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the one thing the dialog is for
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData('text');
          if (pasted.trim() !== '' && text.trim() === '') {
            event.preventDefault();
            setText(pasted);
            read(pasted, rolls);
          }
        }}
      />
      <div className="modal-actions">
        <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="label">At the top grade</legend>
          <div className="seg" style={{ marginTop: 6 }}>
            {ROLL_CHOICES.map((choice) => (
              <button
                key={choice.label}
                type="button"
                title={choice.help}
                aria-pressed={rolls === choice.rolls}
                onClick={() => {
                  setRolls(choice.rolls);
                  if (builds) read(text, choice.rolls);
                }}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </fieldset>
        <span className="sp" />
        <button
          type="button"
          className="btn ghost sm"
          disabled={reading || text.trim() === ''}
          onClick={() => read(text, rolls)}
        >
          {reading ? 'Reading…' : 'Read'}
        </button>
      </div>
      {problem && (
        <p className="note danger" role="alert">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          {problem}
        </p>
      )}
      {builds && (
        <div className="modal-scroll build-plans">
          {builds.map((build, index) => (
            <BuildPlan
              // oxlint-disable-next-line react/no-array-index-key -- builds have no id, and don't move
              key={index}
              build={build}
              isPicked={(at) => picked.has(rowKey(index, at))}
              onToggle={(at) =>
                setPicked((current) => {
                  const next = new Set(current);
                  const key = rowKey(index, at);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
            />
          ))}
        </div>
      )}
      <div className="modal-actions">
        <span className="sp" />
        <button type="button" className="btn ghost" onClick={close}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={chosen.length === 0} onClick={add}>
          <span className="ic-w">
            <Glyph name="plus" />
          </span>
          Add {chosen.length} {chosen.length === 1 ? 'blueprint' : 'blueprints'}
        </button>
      </div>
    </dialog>
  );
}

function rowKey(build: number, row: number): string {
  return `${build}:${row}`;
}

function BuildPlan({
  build,
  isPicked,
  onToggle,
}: {
  build: PlannedBuild;
  isPicked: (row: number) => boolean;
  onToggle: (row: number) => void;
}) {
  return (
    <section className="build-plan" aria-label={build.title}>
      <div className="build-plan-head">
        <span className="todo-name">{build.title}</span>
        <span className="sp" />
        <span className="micro">
          {build.comparedWith
            ? `Grades your ${build.comparedWith} has are left off`
            : 'No ship of yours like it: every grade from scratch'}
        </span>
      </div>
      {build.planned.length === 0 ? (
        <p className="mat-empty">No engineered modules in it.</p>
      ) : (
        <ul className="build-rows">
          {build.planned.map((row, at) => (
            // oxlint-disable-next-line react/no-array-index-key -- rows have no id, and don't move
            <BuildRow key={at} row={row} picked={isPicked(at)} onToggle={() => onToggle(at)} />
          ))}
        </ul>
      )}
      {build.skipped.length > 0 && (
        <p className="build-skipped">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          Left out: {build.skipped.join('; ')}.
        </p>
      )}
    </section>
  );
}

function BuildRow({
  row,
  picked,
  onToggle,
}: {
  row: PlannedBlueprint;
  picked: boolean;
  onToggle: () => void;
}) {
  const { todo } = row;
  const blueprint = blueprintByKey(todo.blueprint);
  const experimental =
    blueprint &&
    experimentalsFor(blueprint.module).find((recipe) => recipe.id === todo.experimental);
  const onlyExperimental = todo.onlyExperimental === true;
  return (
    <li className={row.done ? 'build-row done' : 'build-row'}>
      <label>
        <input type="checkbox" checked={picked} onChange={onToggle} />
        <span className="build-label">{row.label}</span>
        {(todo.count ?? 1) > 1 && <span className="rc-times">×{todo.count}</span>}
        <span className="sp" />
        {row.done ? (
          <span className="tag good">Already fitted</span>
        ) : (
          <>
            {!onlyExperimental && (
              <span className="todo-step">
                {todo.from > 0 ? `G${todo.from + 1}–G${todo.to}` : `G1–G${todo.to}`}
              </span>
            )}
            {experimental && <span className="tag">{experimental.name}</span>}
          </>
        )}
      </label>
      {(row.fitted || row.slots.length > 0) && (
        <span className="build-where">
          {[row.slots.join(', '), row.fitted && `yours: ${row.fitted}`].filter(Boolean).join(' · ')}
        </span>
      )}
    </li>
  );
}
