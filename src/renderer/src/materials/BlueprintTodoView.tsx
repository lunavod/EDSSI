import { type FormEvent, type ReactNode, useState } from 'react';

import {
  type Blueprint,
  blueprintByKey,
  blueprintGrade,
  blueprintModules,
  blueprintsFor,
  type BlueprintTodo,
  type CraftingTodo,
  type EngineerStanding,
  engineerKey,
  type EngineerOption,
  engineerOptions,
  experimentalChoices,
  experimentalsFor,
  maxGrade,
  moduleCount,
  plannedRolls,
  RANK_UP_ROLLS,
  rollsToMax,
  standingText,
  todoEngineerOptions,
  todoEngineerRank,
  todoDone,
  todoNeeds,
} from '../../../shared/crafting';
import type { MaterialsSnapshot } from '../../../shared/materials';
import { useEdssi } from '../api/context';
import { lyText } from '../commodities/MarketFields';
import { NumberInput } from '../hud/Controls';
import { CopyButton } from '../hud/CopyButton';
import { Glyph } from '../hud/Glyph';
import { Select } from '../hud/Select';
import { BuildImport } from './BuildImport';
import { ingredientLines, shortCount } from './materials';
import { Ingredients, RemoveTodo, TodoStatus } from './parts';

const NO_INVENTORY: Readonly<Record<string, number>> = {};

const ROLLS_HELP =
  "Rolls at the target grade. Every grade is planned maxed, from the engineer's rank: as many " +
  'rolls as the grade once they are at rank 5 (1, 2, 3, 4, 5), and five at a grade they rank up ' +
  'on. Type a number to plan fewer at the target; one roll is enough to have the grade.';

type Coords = { x: number; y: number; z: number };

/** Further than this, an engineer is in another region: the bubble and Colonia are 22,000 ly apart. */
const FAR_LY = 1000;

/**
 * The Materials module's blueprint to-do list: blueprints to apply, from the grade a module has
 * now up to a target, with an experimental effect. It says how many rolls each
 * grade takes, from the engineer's rank; rolls aren't tracked, so it is crossed off by hand.
 */
export function BlueprintTodoView({ snapshot }: { snapshot: MaterialsSnapshot | undefined }) {
  const inventory = snapshot?.inventory ?? NO_INVENTORY;
  const engineers = snapshot?.engineers ?? [];
  const here = snapshot?.position?.coords;
  const list = snapshot?.todos ?? [];
  // Nearest engineer first; one with no known distance goes last, in list order.
  const todos = list
    .filter((todo): todo is BlueprintTodo => todo.kind === 'blueprint')
    .map((todo) => ({
      todo,
      distance: todoEngineer(todo, engineers, here, list)?.distanceLy ?? Infinity,
    }))
    .sort((a, b) => (a.distance === b.distance ? 0 : a.distance - b.distance))
    .map(({ todo }) => todo);
  const [importing, setImporting] = useState(false);
  // Hidden until asked for: the page is mostly for reading the list, not adding to it.
  const [adding, setAdding] = useState(false);
  const importButton = (
    <button type="button" className="btn ghost sm" onClick={() => setImporting(true)}>
      <span className="ic-w">
        <Glyph name="upload" />
      </span>
      Import a build from EDSY or Coriolis
    </button>
  );
  return (
    <>
      {adding ? (
        <AddBlueprint
          engineers={engineers}
          here={here}
          list={list}
          importButton={importButton}
          onClose={() => setAdding(false)}
        />
      ) : (
        <div className="mat-bar">
          <button type="button" className="btn sm" onClick={() => setAdding(true)}>
            <span className="ic-w">
              <Glyph name="plus" />
            </span>
            Add a blueprint
          </button>
          {importButton}
        </div>
      )}
      {importing && <BuildImport onClose={() => setImporting(false)} />}
      <div className="mat-scroll">
        {todos.length === 0 ? (
          <p className="mat-empty">
            Nothing planned. Add a blueprint, import a build from EDSY or Coriolis, or press +
            beside one on the Recipes page.
          </p>
        ) : (
          <div className="todo-list">
            {todos.map((todo) => (
              <BlueprintCard
                key={todo.id}
                todo={todo}
                inventory={inventory}
                engineers={engineers}
                here={here}
                list={list}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function AddBlueprint({
  engineers,
  here,
  list,
  importButton,
  onClose,
}: {
  engineers: readonly EngineerStanding[];
  here: Coords | undefined;
  list: readonly CraftingTodo[];
  importButton: ReactNode;
  onClose: () => void;
}) {
  const edssi = useEdssi();
  const modules = blueprintModules();
  const [module, setModule] = useState(
    () => modules.find((name) => name === 'Frame Shift Drive') ?? modules[0] ?? '',
  );
  const choices = blueprintsFor(module);
  const [key, setKey] = useState(choices[0]?.key ?? '');
  const blueprint = blueprintByKey(key) ?? choices[0];
  const top = blueprint ? maxGrade(blueprint) : 5;
  const [from, setFrom] = useState(0);
  const [to, setToGrade] = useState(5);
  /** Unset: as many as maxing the target takes at the engineer's rank. */
  const [rolls, setRolls] = useState<number>();
  const setTo = (grade: number) => {
    setToGrade(grade);
    setRolls(undefined);
  };
  const [count, setCount] = useState(1);
  const [experimental, setExperimental] = useState('');
  const [engineer, setEngineer] = useState('');
  const target = Math.min(to, top);
  const current = Math.min(from, target - 1);
  const draft: BlueprintTodo | undefined = blueprint && {
    id: '',
    kind: 'blueprint',
    blueprint: blueprint.key,
    from: current,
    to: target,
    ...(rolls !== undefined && { targetRolls: rolls }),
    ...(count > 1 && { count }),
    ...(engineer && { engineer }),
  };
  const rank = draft ? todoEngineerRank(draft, engineers, list) : 5;
  const options = draft ? todoEngineerOptions(draft, engineers, here, list) : [];
  const selected = engineer
    ? (options.find((option) => engineerKey(option.name) === engineerKey(engineer)) ??
      engineerOptions([engineer], engineers, target, here)[0])
    : options[0];

  const pickModule = (next: string) => {
    setModule(next);
    const first = blueprintsFor(next)[0];
    setKey(first?.key ?? '');
    setExperimental('');
    setEngineer('');
    setTo(first ? maxGrade(first) : 5);
  };
  const pickBlueprint = (next: string) => {
    setKey(next);
    setEngineer('');
    const chosen = blueprintByKey(next);
    if (chosen) setTo(maxGrade(chosen));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!blueprint) return;
    void edssi.materials.addTodo({
      kind: 'blueprint',
      blueprint: blueprint.key,
      from: current,
      to: target,
      ...(rolls !== undefined && { targetRolls: rolls }),
      ...(count > 1 && { count }),
      ...(experimental && { experimental }),
      ...(engineer && { engineer }),
    });
  };

  return (
    <form className="panel pad todo-form" onSubmit={submit}>
      <div className="todo-form-head">
        <span className="panel-title">Add a blueprint</span>
        <span className="sp" />
        {importButton}
        <button
          type="button"
          className="ibtn sm"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <Glyph name="close" />
        </button>
      </div>
      <div className="todo-row">
        <div className="field" style={{ flex: '1 1 220px' }}>
          <span className="label">Module</span>
          <Select
            aria-label="Module"
            value={module}
            options={modules.map((name) => ({ value: name, label: name }))}
            onChange={pickModule}
          />
        </div>
        <div className="field" style={{ flex: '1 1 240px' }}>
          <span className="label">Blueprint</span>
          <Select
            aria-label="Blueprint"
            value={blueprint?.key ?? ''}
            options={choices.map((choice) => ({
              value: choice.key,
              label: `${choice.name}${maxGrade(choice) < 5 ? ` (up to G${maxGrade(choice)})` : ''}`,
            }))}
            onChange={pickBlueprint}
          />
        </div>
        <div className="field" style={{ flex: '1 1 220px' }}>
          <span className="label">Experimental effect</span>
          <Select
            aria-label="Experimental effect"
            value={experimental}
            options={[
              { value: '', label: 'None' },
              ...experimentalChoices(module).map((recipe) => ({
                value: recipe.id,
                label: recipe.name,
              })),
            ]}
            onChange={setExperimental}
          />
        </div>
      </div>
      <div className="todo-row">
        <div className="field">
          <span className="label">Grade</span>
          <div className="todo-grades">
            <GradeSelect label="Current" value={current} min={0} max={top - 1} onChange={setFrom} />
            <span className="todo-arrow" aria-hidden>
              →
            </span>
            <GradeSelect
              label="Target"
              value={target}
              min={current + 1}
              max={top}
              onChange={setTo}
            />
          </div>
        </div>
        <div className="field" style={{ width: 132 }}>
          <span className="label" title={ROLLS_HELP}>
            Rolls at G{target} <span className="help">?</span>
          </span>
          <NumberInput
            unit={rolls === undefined ? 'max' : '×'}
            value={rolls ?? rollsToMax(target, rank)}
            min={1}
            max={99}
            onChange={setRolls}
            label={`Rolls at grade ${target}`}
          />
        </div>
        <div className="field" style={{ width: 96 }}>
          <span className="label" title="How many modules take it, e.g. four shield boosters">
            Modules
          </span>
          <NumberInput
            unit="×"
            value={count}
            min={1}
            max={99}
            onChange={setCount}
            label="Modules"
          />
        </div>
        <div className="field" style={{ flex: '1 1 180px' }}>
          <span className="label">Engineer</span>
          <Select
            aria-label="Engineer"
            value={engineer}
            options={[
              {
                value: '',
                label: options[0]
                  ? `Most suitable: ${options[0].name}`
                  : 'Most suitable (recommended)',
              },
              ...options.map((option) => ({
                value: option.name,
                label: [
                  option.name,
                  standingText(option.standing),
                  option.distanceLy !== undefined && lyText(option.distanceLy),
                ]
                  .filter(Boolean)
                  .join(' · '),
              })),
            ]}
            onChange={setEngineer}
          />
        </div>
        <button type="submit" className="btn primary todo-submit" disabled={!blueprint}>
          <span className="ic-w">
            <Glyph name="plus" />
          </span>
          Add
        </button>
      </div>
      {selected && (
        <div className="eng-lines eng-pick">
          <EngineerLine
            option={selected}
            grade={target}
            note={engineer ? 'chosen' : 'most suitable'}
          />
        </div>
      )}
      {selected && <EngineerWarnings option={selected} grade={target} />}
      {draft && (
        <p className="todo-plan">
          <RollPlan todo={draft} standings={engineers} list={list} />
          {rolls !== undefined && (
            <button type="button" className="link" onClick={() => setRolls(undefined)}>
              Max it
            </button>
          )}
        </p>
      )}
    </form>
  );
}

/**
 * What stands between the commander and the engineer a blueprint would go to: not unlocked yet
 * (and what it takes), or a workshop in another region. Warnings only; adding still works.
 */
function EngineerWarnings({ option, grade }: { option: EngineerOption; grade: number }) {
  const { info, standing, name } = option;
  const progress = standing?.progress;
  const unlocked = progress === 'Unlocked';
  const steps = !info
    ? []
    : progress === 'Invited'
      ? [info.unlock && `To unlock: ${info.unlock}`]
      : [
          !progress && info.discovery && `To hear of them: ${info.discovery}`,
          info.meeting && `To be invited: ${info.meeting}`,
          info.unlock && `Then, to unlock: ${info.unlock}`,
        ];
  const far = option.distanceLy !== undefined && option.distanceLy > FAR_LY;
  if (unlocked && !far) return null;
  return (
    <div className="eng-warnings">
      {!unlocked && (
        <p className="note" role="note">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          <span>
            You haven't unlocked {name} yet
            {progress === 'Invited'
              ? " (you're invited)"
              : progress === 'Known'
                ? ' (you know of them)'
                : ''}
            ; the plan starts them at rank 1 and ranks them up to G{grade}.
            {steps.filter(Boolean).map((step) => (
              <span key={String(step)} className="eng-step">
                {step}
              </span>
            ))}
          </span>
        </p>
      )}
      {far && info && (
        <p className="note" role="note">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          <span>
            {name}'s workshop is {lyText(option.distanceLy!)} from you, in{' '}
            {info.coords[2] > 10_000 ? 'the Colonia region' : 'the bubble'} ({info.system}).
          </span>
        </p>
      )}
    </div>
  );
}

function GradeSelect({
  label,
  value,
  min,
  max,
  onChange,
  small = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (grade: number) => void;
  small?: boolean;
}) {
  const grades = Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
  return (
    <Select
      className={small ? 'sm todo-grade' : 'todo-grade'}
      title={`${label} grade`}
      aria-label={`${label} grade`}
      before={!small && <span className="unit">{label}</span>}
      value={value}
      options={grades.map((grade) => ({ value: grade, label: grade === 0 ? 'None' : `G${grade}` }))}
      onChange={onChange}
    />
  );
}

function BlueprintCard({
  todo,
  inventory,
  engineers,
  here,
  list,
}: {
  todo: BlueprintTodo;
  inventory: Readonly<Record<string, number>>;
  engineers: readonly EngineerStanding[];
  here: Coords | undefined;
  list: readonly CraftingTodo[];
}) {
  const edssi = useEdssi();
  const blueprint = blueprintByKey(todo.blueprint);
  if (!blueprint) return null;
  const lines = ingredientLines(todoNeeds(todo, engineers, list), inventory);
  const done = todoDone(todo, engineers);
  const update = (patch: Partial<BlueprintTodo>) =>
    void edssi.materials.updateTodo({ ...todo, ...patch });
  const top = maxGrade(blueprint);
  const rank = todoEngineerRank(todo, engineers, list);
  const experimental = experimentalsFor(blueprint.module).find(
    (recipe) => recipe.id === todo.experimental,
  );
  return (
    <article className={done ? 'todo done' : 'todo'}>
      <header className="todo-head">
        <span className="todo-name">{blueprint.name}</span>
        <span className="todo-what">{blueprint.module}</span>
        <span className="sp" />
        <TodoStatus done={done} short={shortCount(lines)} />
        <RemoveTodo id={todo.id} name={blueprint.name} />
      </header>
      <div className="todo-meta">
        <span className="todo-edit">
          <GradeSelect
            label="Current"
            value={todo.from}
            min={0}
            max={todo.to - 1}
            small
            onChange={(from) => update({ from })}
          />
          <span className="todo-arrow" aria-hidden>
            →
          </span>
          <GradeSelect
            label="Target"
            value={todo.to}
            min={todo.from + 1}
            max={top}
            small
            onChange={(to) => update({ to, targetRolls: undefined })}
          />
          <span title={ROLLS_HELP}>
            <NumberInput
              unit={todo.targetRolls === undefined ? `max at G${todo.to}` : `at G${todo.to}`}
              size="sm"
              value={todo.targetRolls ?? rollsToMax(todo.to, rank)}
              min={1}
              max={99}
              label={`Rolls at grade ${todo.to}`}
              style={{ width: todo.targetRolls === undefined ? 138 : 104 }}
              onChange={(rolls) => update({ targetRolls: rolls })}
            />
          </span>
          {todo.targetRolls !== undefined && (
            <button
              type="button"
              className="link"
              title="Plan as many rolls as maxing the grade takes at the engineer's rank"
              onClick={() => update({ targetRolls: undefined })}
            >
              Max
            </button>
          )}
          <NumberInput
            unit={moduleCount(todo) === 1 ? 'module' : 'modules'}
            size="sm"
            value={moduleCount(todo)}
            min={1}
            max={99}
            label="Modules that take it"
            style={{ width: 118 }}
            onChange={(count) => update({ count })}
          />
        </span>
        <GradeSteps todo={todo} blueprint={blueprint} engineers={engineers} list={list} />
        {experimental && (
          <span className="tag" title="Experimental effect">
            {experimental.name}
          </span>
        )}
      </div>
      {!done && <Ingredients lines={lines} />}
      {!done && (
        <Engineers
          todo={todo}
          engineers={engineers}
          here={here}
          list={list}
          onChoose={(engineer) => update({ engineer })}
        />
      )}
    </article>
  );
}

/** "17 rolls: G1 ×3, G2 ×3, G3 ×3, G4 ×3, G5 ×5", what the plan comes to. */
function RollPlan({
  todo,
  standings,
  list,
}: {
  todo: BlueprintTodo;
  standings: readonly EngineerStanding[];
  list: readonly CraftingTodo[];
}) {
  const planned = plannedRolls(todo, standings, list);
  const total = planned.reduce((sum, rolls) => sum + rolls, 0);
  const rank = todoEngineerRank(todo, standings, list);
  return (
    <span className="muted">
      <b>{total}</b> {total === 1 ? 'roll' : 'rolls'}
      {total > 0 && ': '}
      {planned.flatMap((rolls, index) => (rolls > 0 ? [`G${index + 1} ×${rolls}`] : [])).join(', ')}
      {rank < 5 && ` · from rank ${rank}: five rolls at each grade they rank up on`}
    </span>
  );
}

/** Each grade still to go, and how many rolls it takes. */
function GradeSteps({
  todo,
  blueprint,
  engineers,
  list,
}: {
  todo: BlueprintTodo;
  blueprint: Blueprint;
  engineers: readonly EngineerStanding[];
  list: readonly CraftingTodo[];
}) {
  const plan = plannedRolls(todo, engineers, list);
  const grades: number[] = [];
  for (let grade = todo.from + 1; grade <= todo.to; grade++) {
    if (blueprintGrade(blueprint, grade) && (plan[grade - 1] ?? 0) > 0) grades.push(grade);
  }
  return (
    <span className="todo-steps">
      {grades.map((grade) => {
        const planned = plan[grade - 1] ?? 0;
        return (
          <span
            key={grade}
            className="todo-step"
            title={`Grade ${grade}: ${planned} ${planned === 1 ? 'roll' : 'rolls'} to max it`}
          >
            G{grade}
            <span className="dim"> ×{planned}</span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * Who the blueprint goes to, at the bottom of its card: the engineer chosen, else the most
 * suitable, with where their workshop is (names to copy into the galaxy map) and how far. The
 * others offering the target grade are a press away, and choosing one plans the rolls from their
 * rank instead.
 */
function Engineers({
  todo,
  engineers,
  here,
  list,
  onChoose,
}: {
  todo: BlueprintTodo;
  engineers: readonly EngineerStanding[];
  here: Coords | undefined;
  list: readonly CraftingTodo[];
  onChoose: (engineer: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = todoEngineerOptions(todo, engineers, here, list);
  const selected = pickEngineer(todo, options, engineers, here);
  if (!selected) return null;
  const others = options.filter((option) => option.name !== selected.name);
  return (
    <div className="eng-lines" aria-label={`Engineer for G${todo.to}`}>
      <EngineerLine
        option={selected}
        grade={todo.to}
        note={todo.engineer ? 'chosen' : 'most suitable'}
      />
      {open &&
        others.map((option) => (
          <EngineerLine
            key={option.name}
            option={option}
            grade={todo.to}
            action={
              <button type="button" className="btn ghost sm" onClick={() => onChoose(option.name)}>
                Use
              </button>
            }
          />
        ))}
      <div className="eng-foot">
        {others.length > 0 && (
          <button type="button" className="link" onClick={() => setOpen(!open)}>
            {open ? 'fewer' : `${others.length} more`}
          </button>
        )}
        {todo.engineer && (
          <button type="button" className="link" onClick={() => onChoose(undefined)}>
            Back to the most suitable
          </button>
        )}
      </div>
    </div>
  );
}

/** The engineer a to-do is planned with: the one chosen, else the most suitable. */
function pickEngineer(
  todo: BlueprintTodo,
  options: readonly EngineerOption[],
  engineers: readonly EngineerStanding[],
  here: Coords | undefined,
): EngineerOption | undefined {
  if (!todo.engineer) return options[0];
  const chosenKey = engineerKey(todo.engineer);
  return (
    options.find((option) => engineerKey(option.name) === chosenKey) ??
    engineerOptions([todo.engineer], engineers, todo.to, here)[0]
  );
}

function todoEngineer(
  todo: BlueprintTodo,
  engineers: readonly EngineerStanding[],
  here: Coords | undefined,
  list: readonly CraftingTodo[],
): EngineerOption | undefined {
  return pickEngineer(todo, todoEngineerOptions(todo, engineers, here, list), engineers, here);
}

function EngineerLine({
  option,
  grade,
  note,
  action,
}: {
  option: EngineerOption;
  grade: number;
  /** Why this one: "chosen", "most suitable". */
  note?: string;
  /** A button at the end of the line. */
  action?: React.ReactNode;
}) {
  const { info, standing } = option;
  const rank = standing?.progress === 'Unlocked' ? (standing.rank ?? 0) : 0;
  const status = option.ready
    ? standingText(standing)
    : rank > 0
      ? `rank ${rank} · ranks up on the way to G${grade}`
      : standingText(standing);
  const how =
    !option.ready && info
      ? standing?.progress === 'Invited'
        ? `To unlock: ${info.unlock ?? 'see the engineer'}`
        : standing?.progress === 'Unlocked'
          ? `Rolls here rank them up: ${RANK_UP_ROLLS} at a grade equal to their rank`
          : [
              info.meeting && `To be invited: ${info.meeting}`,
              info.unlock && `Then: ${info.unlock}`,
            ]
              .filter(Boolean)
              .join('\n')
      : undefined;
  const locked = !option.ready && rank === 0;
  return (
    <div className={locked ? 'eng-line locked' : note ? 'eng-line best' : 'eng-line'}>
      <span className="eng-mark" aria-hidden>
        {note && option.ready && <Glyph name="check" />}
      </span>
      <span className="eng-who" title={how}>
        <span className="eng-name">{option.name}</span>
        <span className="eng-status">{note ? `${note} · ${status}` : status}</span>
      </span>
      {info ? (
        <>
          <span className="eng-place">
            <span className="eng-base">{info.base}</span>
            {info.planet && <span className="dim">{info.planet}</span>}
            <CopyButton text={info.base} label={`${info.base}, ${option.name}'s workshop`} />
          </span>
          <span className="eng-place">
            <span>{info.system}</span>
            {info.permit && (
              <span className="tag ghost" title="The system needs a permit">
                Permit
              </span>
            )}
            <CopyButton text={info.system} />
          </span>
          <span className="eng-ly">
            {option.distanceLy === undefined ? '' : lyText(option.distanceLy)}
          </span>
        </>
      ) : (
        <span className="eng-place dim">Workshop not known</span>
      )}
      <span className="eng-act">{action}</span>
    </div>
  );
}
