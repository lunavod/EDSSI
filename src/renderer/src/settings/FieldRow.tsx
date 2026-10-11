import { useCallback, useEffect, useState } from 'react';

import { useLocalDevices } from '../api/context';
import { Glyph } from '../hud/Glyph';
import { Select } from '../hud/Select';
import { Suggest } from '../hud/Suggest';
import { defaultAt, effectiveValue, type Field, fieldKey, problemWith, sameValue } from './fields';
import { HelpText } from './HelpText';

interface FieldRowProps {
  field: Field;
  /** As the file has it now. */
  saved: unknown;
  /** The commander's unsaved edit, if there is one. */
  draft: unknown;
  /** Why the field does nothing as things stand, if it doesn't. */
  inactive: string | undefined;
  onEdit: (field: Field, value: unknown) => void;
  onCommit: () => void;
}

/**
 * One setting: its label and what it does, the control, and around them whether it is unsaved,
 * whether it differs from the default (with a way back), and anything wrong with it.
 */
export function FieldRow({ field, saved, draft, inactive, onEdit, onCommit }: FieldRowProps) {
  const key = fieldKey(field);
  const edited = draft !== undefined;
  const shown = edited ? draft : saved;
  const effective = effectiveValue(saved, field.path, draft);
  const fallback = defaultAt(field.path);
  const changed = edited && !sameValue(effective, effectiveValue(saved, field.path));
  const problem = problemWith(field, shown);
  const custom = !sameValue(effective, fallback);

  const className = [
    'sf',
    changed && 'unsaved',
    inactive !== undefined && 'inactive',
    problem !== undefined && 'problem',
    // A long list of choices won't fit the control column; it gets the row's width instead.
    (field.kind === 'words' ||
      field.kind === 'lines' ||
      (field.kind === 'choice' && field.options.length > 4)) &&
      'sf-stack',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div id={`row-${key}`} className={className}>
      <div className="sf-l">
        <label className="sf-name" htmlFor={key}>
          {field.label}
        </label>
        {field.help && (
          <div className="sf-help">
            <HelpText text={field.help} />
          </div>
        )}
        {inactive && <div className="sf-note">{inactive}</div>}
      </div>
      <div className="sf-c">
        <div className="row">
          <FieldInput field={field} value={shown} onEdit={onEdit} onCommit={onCommit} />
          {custom && <DefaultButton field={field} fallback={fallback} onEdit={onEdit} />}
        </div>
        {problem && (
          <div className="sf-problem">
            <span className="ic-w" style={{ width: 14, height: 14 }}>
              <Glyph name="warning" />
            </span>
            {problem}
          </div>
        )}
      </div>
      {field.aside && (
        <p className="sf-aside">
          <HelpText text={field.aside} />
        </p>
      )}
    </div>
  );
}

/** Back to the default: the key comes out of the file. */
export function DefaultButton({
  field,
  fallback,
  onEdit,
}: {
  field: Field;
  fallback: unknown;
  onEdit: (field: Field, value: unknown) => void;
}) {
  return (
    <button
      type="button"
      className="link dimlink"
      title={`Back to the default: ${describe(field, fallback)}`}
      onClick={() => onEdit(field, null)}
    >
      Default
    </button>
  );
}

/** A value as words, for the reset button's tooltip. */
export function describe(field: Field, value: unknown): string {
  if (value === undefined || value === null || value === '') return 'not set';
  switch (field.kind) {
    case 'flag':
      return value === true ? 'on' : 'off';
    case 'number':
      return typeof value === 'number' ? `${formatNumber(field, value)} ${field.unit ?? ''}` : '';
    case 'words':
      return Array.isArray(value) ? `${value.length} words` : '';
    case 'choice':
    case 'select':
      return typeof value === 'string' ? (field.labels?.[value] ?? value) : '';
    default:
      return typeof value === 'string' ? value : '';
  }
}

function formatNumber(field: Extract<Field, { kind: 'number' }>, value: number): string {
  // Rounded so a scaled fraction (0.15 × 100) doesn't show its binary tail.
  return String(Math.round(value * (field.scale ?? 1) * 1e6) / 1e6);
}

interface FieldInputProps {
  field: Field;
  /** The draft or the saved value; null is "back to the default". */
  value: unknown;
  onEdit: (field: Field, value: unknown) => void;
  onCommit: () => void;
}

/** One control per kind of setting. Empty text is saved as "not set", never the empty string. */
export function FieldInput({ field, value, onEdit, onCommit }: FieldInputProps) {
  const id = fieldKey(field);
  const current = value === null ? defaultAt(field.path) : value;

  switch (field.kind) {
    case 'flag':
      return <Toggle id={id} on={current === true} onChange={(next) => onEdit(field, next)} />;

    case 'choice':
      return (
        <div id={id} className="seg" role="radiogroup" aria-label={field.label}>
          {field.options.map((option) => (
            <label key={option} title={field.labels?.[option] ? option : undefined}>
              <input
                type="radio"
                className="visually-hidden"
                name={id}
                value={option}
                checked={current === option}
                onChange={() => onEdit(field, option)}
              />
              {field.labels?.[option] ?? option}
            </label>
          ))}
        </div>
      );

    case 'select': {
      const chosen = typeof current === 'string' ? current : '';
      // A value the list doesn't have (written by hand, or from an older list) stays visible.
      const options =
        chosen === '' || field.options.includes(chosen)
          ? field.options
          : [...field.options, chosen];
      return (
        <Select
          id={id}
          aria-label={field.label}
          style={{ width: 320 }}
          value={chosen}
          options={options.map((option) => ({
            value: option,
            label: field.options.includes(option)
              ? (field.labels?.[option] ?? option)
              : `${option} (not one of the options)`,
          }))}
          onChange={(next) => onEdit(field, next)}
        />
      );
    }

    case 'device':
      return (
        <DeviceInput
          id={id}
          label={field.label}
          value={typeof value === 'string' ? value : ''}
          onChange={(next) => onEdit(field, next === '' ? null : next)}
        />
      );

    case 'number':
      return (
        <NumberInput id={id} field={field} value={current} onEdit={onEdit} onCommit={onCommit} />
      );

    case 'words':
      return (
        <WordsInput
          id={id}
          words={Array.isArray(current) ? current.filter((word) => typeof word === 'string') : []}
          placeholder={field.placeholder}
          onChange={(next) => onEdit(field, next)}
        />
      );

    case 'lines':
      return (
        <textarea
          id={id}
          className="area"
          rows={3}
          placeholder={field.placeholder ?? placeholderFor(field)}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onEdit(field, event.target.value)}
        />
      );

    default:
      return <TextInput id={id} field={field} value={value} onEdit={onEdit} onCommit={onCommit} />;
  }
}

/**
 * The names of the machine's audio inputs.
 *
 * Windows lists the default device a second and third time under `Default -` and
 * `Communications -`; those are aliases for something already in the list, and the empty option
 * below already means "the default", so they would only be two more ways to say the same thing.
 */
async function inputNames(): Promise<{ names: string[]; unnamed: boolean }> {
  const found = await navigator.mediaDevices.enumerateDevices();
  const inputs = found.filter((device) => device.kind === 'audioinput');
  const names = inputs
    .map((device) => device.label.trim())
    .filter(
      (name) =>
        name !== '' && !name.startsWith('Default -') && !name.startsWith('Communications -'),
    );
  // Devices but no names means the browser is withholding them until a microphone is allowed.
  return { names: [...new Set(names)], unnamed: inputs.length > 0 && names.length === 0 };
}

/**
 * The machine's microphones, as a dropdown.
 *
 * Chosen and stored by name rather than by `deviceId` — see `voice.microphone` — so what is saved
 * is readable in the file and survives the browser reissuing its ids.
 *
 * Two wrinkles, both the browser's rather than ours. Names are withheld until the commander has
 * allowed a microphone at least once, so an unlabelled list means "not allowed yet" and not "no
 * microphones"; asking for one and letting go of it at once is what fills the names in, which is
 * what the button does. And a device chosen once can be unplugged later, so whatever is saved
 * stays in the list, marked — dropping it silently would look like EDSSI forgetting the setting.
 */
function DeviceInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [devices, setDevices] = useState<string[]>([]);
  const [unnamed, setUnnamed] = useState(false);
  // Embedded in someone else's page (the mock UI), the visitor's devices are none of its business.
  const localDevices = useLocalDevices();

  const look = useCallback(async (): Promise<void> => {
    const found = await inputNames();
    setDevices(found.names);
    setUnnamed(found.unnamed);
  }, []);

  useEffect(() => {
    if (!localDevices) return undefined;
    const refresh = (): void => {
      void look().catch((error: unknown) =>
        console.error('[voice] could not list the inputs', error),
      );
    };

    refresh();
    // One named handler, so the listener that is added is the one that is taken away again.
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, [localDevices, look]);

  /** Asks for a microphone and lets go at once, which is all it takes to be told the names. */
  const reveal = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      await look();
    } catch (error) {
      console.error('[voice] the microphone was not allowed', error);
    }
  };

  // A device that was chosen and has since been unplugged still belongs in the list.
  const options = value === '' || devices.includes(value) ? devices : [...devices, value];

  return (
    <>
      <Select
        id={id}
        aria-label={label}
        style={{ width: 260 }}
        value={value}
        options={[
          { value: '', label: 'System default' },
          ...options.map((name) => ({
            value: name,
            label: devices.includes(name) ? name : `${name} (not connected)`,
          })),
        ]}
        onChange={onChange}
      />
      {unnamed && (
        <button type="button" className="btn ghost sm" onClick={() => void reveal()}>
          Show names
        </button>
      )}
    </>
  );
}

/** A text field that is empty falls back to its default, so the default is what it says. */
function placeholderFor(field: Field): string | undefined {
  const fallback = defaultAt(field.path);
  return typeof fallback === 'string' ? fallback : undefined;
}

/**
 * A switch. It says On or Off beside itself unless given `text`, which names what it switches
 * instead, for a switch that has no label of its own beside it.
 */
export function Toggle({
  id,
  on,
  onChange,
  text,
  title,
}: {
  id?: string;
  on: boolean;
  onChange: (on: boolean) => void;
  text?: string;
  title?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      className="switch"
      aria-checked={on}
      title={title}
      onClick={() => onChange(!on)}
    >
      <span className="track" aria-hidden="true" />
      {text ?? (on ? 'On' : 'Off')}
    </button>
  );
}

interface NumberInputProps {
  id: string;
  field: Extract<Field, { kind: 'number' }>;
  value: unknown;
  onEdit: (field: Field, value: unknown) => void;
  onCommit: () => void;
}

/**
 * A number, in the units it is shown in. What is typed is kept as typed while the field has focus,
 * so clearing it to type another doesn't snap back to the default under the cursor.
 */
function NumberInput({ id, field, value, onEdit, onCommit }: NumberInputProps) {
  const scale = field.scale ?? 1;
  const shown = typeof value === 'number' ? formatNumber(field, value) : '';
  /** What is in the box while it has focus; otherwise it shows the value. */
  const [typed, setTyped] = useState<string>();

  return (
    <span className="input num">
      <input
        id={id}
        inputMode="decimal"
        value={typed ?? (typeof value === 'number' ? Number(shown).toLocaleString() : '')}
        onFocus={() => setTyped(shown)}
        onBlur={() => setTyped(undefined)}
        onChange={(event) => {
          setTyped(event.target.value);
          const text = event.target.value.replaceAll(/[\s,]/g, '');
          const next = Number(text);
          onEdit(field, text === '' || Number.isNaN(next) ? null : next / scale);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit();
        }}
      />
      {field.unit && <span className="unit">{field.unit}</span>}
    </span>
  );
}

interface TextInputProps {
  id: string;
  field: Extract<Field, { kind: 'text' }>;
  value: unknown;
  onEdit: (field: Field, value: unknown) => void;
  onCommit: () => void;
}

function TextInput({ id, field, value, onEdit, onCommit }: TextInputProps) {
  const [revealed, setRevealed] = useState(false);
  const text = typeof value === 'string' ? value : '';

  return (
    <span className="input">
      {field.suggestions ? (
        <Suggest
          id={id}
          placeholder={field.placeholder ?? placeholderFor(field)}
          spellCheck={false}
          value={text}
          suggestions={field.suggestions}
          onChange={(next) => onEdit(field, next)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCommit();
          }}
        />
      ) : (
        <input
          id={id}
          type={field.secret && !revealed ? 'password' : 'text'}
          placeholder={field.placeholder ?? placeholderFor(field)}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(event) => onEdit(field, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCommit();
          }}
        />
      )}
      {field.secret && (
        <button
          type="button"
          className="link"
          style={{ fontSize: 13 }}
          aria-pressed={revealed}
          disabled={text === ''}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
      )}
    </span>
  );
}

interface WordsInputProps {
  id: string;
  words: readonly string[];
  placeholder: string | undefined;
  onChange: (words: string[]) => void;
}

/** A list of words as chips: Enter or a comma adds what is typed, × or Backspace takes one off. */
function WordsInput({ id, words, placeholder, onChange }: WordsInputProps) {
  const [text, setText] = useState('');

  /** Adds each new word, and keeps `rest` in the box: what follows the last comma. */
  const add = (raw: readonly string[], rest = '') => {
    setText(rest);
    const next = [...words];
    for (const part of raw) {
      const word = part.trim();
      if (word && !next.some((existing) => existing.toLowerCase() === word.toLowerCase())) {
        next.push(word);
      }
    }
    if (next.length > words.length) onChange(next);
  };

  return (
    <div className="words">
      {words.map((word, index) => (
        <span key={word} className="tagin">
          {word}
          <button
            type="button"
            aria-label={`Remove ${word}`}
            onClick={() => onChange(words.filter((_word, at) => at !== index))}
          >
            <Glyph name="close" />
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          const parts = event.target.value.split(',');
          if (parts.length > 1) add(parts.slice(0, -1), parts.at(-1));
          else setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            add([text]);
          } else if (event.key === 'Backspace' && text === '' && words.length > 0) {
            onChange(words.slice(0, -1));
          }
        }}
        onBlur={() => add([text])}
      />
    </div>
  );
}
