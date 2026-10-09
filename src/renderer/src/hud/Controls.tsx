import type React from 'react';
import { useState } from 'react';

import { formatNumber } from '../journal/format';

/** An on/off switch that says which way it is. */
export function Switch({
  checked,
  onChange,
  title,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
  /** What it switches; "On"/"Off" when there is a label beside it already. */
  label?: string;
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
    >
      <span className="track" />
      {label ?? (checked ? 'On' : 'Off')}
    </button>
  );
}

/**
 * A number with its unit inside the box, shown with separators, clamped when it is kept (on
 * leaving the box or Enter) rather than while it is typed.
 */
export function NumberInput({
  unit,
  value,
  onChange,
  min,
  max,
  digits = 0,
  size,
  disabled = false,
  label,
  style,
}: {
  unit: string;
  value: number | undefined;
  onChange: (value: number) => void;
  min: number;
  max: number;
  /** Decimal places kept. */
  digits?: number;
  size?: 'sm' | 'lg';
  disabled?: boolean;
  /** For a box with no label of its own beside it. */
  label?: string;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState<string>();
  const scale = 10 ** digits;
  const commit = () => {
    if (draft === undefined) return;
    const parsed = Math.round(Number(draft.replaceAll(/[\s,]/g, '')) * scale) / scale;
    if (Number.isFinite(parsed)) onChange(Math.min(max, Math.max(min, parsed)));
    setDraft(undefined);
  };
  return (
    <span className={size ? `input ${size} num` : 'input num'} style={style}>
      <input
        inputMode="decimal"
        aria-label={label}
        disabled={disabled}
        value={draft ?? (value === undefined ? '' : formatNumber(value, digits))}
        onFocus={(event) => {
          setDraft(value === undefined ? '' : String(value));
          event.target.select();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
      <span className="unit">{unit}</span>
    </span>
  );
}

/** A labelled whole number: the label over its box, as every field in a form. */
export function NumberField({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  title,
  large = false,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  title?: string;
  large?: boolean;
}) {
  return (
    <label className="field" title={title}>
      <span className="label">{label}</span>
      <NumberInput
        unit={unit}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        size={large ? 'lg' : undefined}
      />
    </label>
  );
}
