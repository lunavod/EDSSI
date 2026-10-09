import {
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { scrollWithin } from './scroll-within';

/** More than this and the list is only shown once something is typed. */
const SHOW_ALL_UP_TO = 30;
const MAX_SHOWN = 60;

type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'list' | 'role' | 'autoComplete'
>;

/**
 * A text input with its suggestions in a list of the HUD's own, in place of a `<datalist>`, whose
 * popup is the system's and ignores the page's styles. Typing narrows the list (names starting
 * with the text first, then words starting with it, then anything containing it); the arrows move
 * through it, Enter or a click picks, Escape closes it without closing a dialog around it.
 */
export function Suggest({
  value,
  onChange,
  suggestions,
  onPick,
  onKeyDown,
  onBlur,
  onFocus,
  ...input
}: InputProps & {
  value: string;
  onChange: (value: string) => void;
  suggestions: readonly string[];
  /** A suggestion picked; `onChange` gets it when this isn't given. */
  onPick?: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<CSSProperties>();

  const query = value.trim().toLowerCase();
  const matches = useMemo(() => rank(suggestions, query), [suggestions, query]);
  // Nothing to suggest once the text is exactly the one suggestion left.
  const shown =
    open &&
    matches.length > 0 &&
    (query !== '' || suggestions.length <= SHOW_ALL_UP_TO) &&
    !(matches.length === 1 && matches[0]?.toLowerCase() === query);

  // Fixed under the whole box the input sits in, so no scrolling parent clips it.
  useLayoutEffect(() => {
    if (!shown) return undefined;
    const measure = () => {
      const anchor = ref.current?.closest('.input') ?? ref.current;
      if (!anchor) return;
      const box = anchor.getBoundingClientRect();
      const below = window.innerHeight - box.bottom;
      const up = below < 220 && box.top > below;
      setPlace({
        left: box.left,
        width: Math.max(box.width, 220),
        ...(up
          ? { bottom: window.innerHeight - box.top + 2, maxHeight: Math.min(320, box.top - 8) }
          : { top: box.bottom + 2, maxHeight: Math.min(320, below - 8) }),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [shown]);

  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    const item = listRef.current.children[active];
    if (item instanceof HTMLElement) scrollWithin(listRef.current, item);
  }, [active]);

  const pick = (choice: string) => {
    (onPick ?? onChange)(choice);
    setOpen(false);
    setActive(-1);
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + matches.length) % Math.max(1, matches.length));
      return;
    }
    if (shown && event.key === 'Enter' && active >= 0) {
      const choice = matches[active];
      if (choice !== undefined) {
        event.preventDefault();
        pick(choice);
        return;
      }
    }
    if (shown && event.key === 'Escape') {
      // The list closes; a dialog around it stays.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === 'Tab') setOpen(false);
    onKeyDown?.(event);
  };

  const list = `${id}-list`;
  return (
    <>
      <input
        {...input}
        ref={ref}
        role="combobox"
        aria-expanded={shown}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={(event) => {
          setOpen(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setOpen(false);
          setActive(-1);
          onBlur?.(event);
        }}
        onKeyDown={keyDown}
      />
      {shown && (
        <ul
          ref={listRef}
          id={list}
          className="suggest"
          // A styled listbox is the point: a datalist's popup is the system's and ignores CSS.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role
          role="listbox"
          style={place}
        >
          {matches.map((choice, index) => (
            <li
              key={choice}
              id={`${id}-${index}`}
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role
              role="option"
              aria-selected={index === active}
              // Before the input's blur, which would close the list first.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(choice);
              }}
              onMouseEnter={() => setActive(index)}
            >
              <Highlight text={choice} query={query} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Starts with the text, then a word starting with it, then containing it; each alphabetical. */
function rank(suggestions: readonly string[], query: string): string[] {
  if (query === '') return suggestions.slice(0, MAX_SHOWN);
  const scored: [score: number, name: string][] = [];
  for (const name of suggestions) {
    const lower = name.toLowerCase();
    const at = lower.indexOf(query);
    if (at < 0) continue;
    const score = at === 0 ? 0 : /[^a-z0-9]/.test(lower[at - 1] ?? '') ? 1 : 2;
    scored.push([score, name]);
  }
  return scored
    .toSorted((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
    .slice(0, MAX_SHOWN)
    .map(([, name]) => name);
}

function Highlight({ text, query }: { text: string; query: string }) {
  const at = query === '' ? -1 : text.toLowerCase().indexOf(query);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b>{text.slice(at, at + query.length)}</b>
      {text.slice(at + query.length)}
    </>
  );
}
