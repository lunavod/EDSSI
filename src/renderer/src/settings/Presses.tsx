import { actionKey, type BoundAction } from '../../../shared/input';

/** How many presses a binding can ask for, as the choice is worded. */
const PRESSES = [
  { clicks: 1, label: 'Once' },
  { clicks: 2, label: 'Twice' },
  { clicks: 3, label: 'Three times' },
] as const;

interface PressesProps {
  /** Unique on the page, to group the radio buttons. */
  name: string;
  clicks: number | undefined;
  onChange: (clicks: number) => void;
  className?: string;
}

/**
 * Once, twice or three times: how a binding has to be pressed. One control can carry three things
 * this way, and only a control with two or three presses bound waits to see which it was.
 */
export function Presses({ name, clicks, onChange, className }: PressesProps) {
  return (
    <div
      className={`seg sm${className ? ` ${className}` : ''}`}
      role="radiogroup"
      aria-label="Presses"
    >
      {PRESSES.map((option) => (
        <label key={option.clicks}>
          <input
            type="radio"
            className="visually-hidden"
            name={name}
            checked={(clicks ?? 1) === option.clicks}
            onChange={() => onChange(option.clicks)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

/** Bindings that belong to another panel, and what they do there. */
export interface BoundElsewhere {
  label: string;
  actions: readonly BoundAction[];
}

/**
 * What the same control pressed the same way already does in another panel, if anything. Bound
 * twice, one press would do both.
 */
export function takenElsewhere(
  elsewhere: readonly BoundElsewhere[],
  action: BoundAction,
): string | undefined {
  const key = actionKey(action);
  return elsewhere.find((other) => other.actions.some((candidate) => actionKey(candidate) === key))
    ?.label;
}
