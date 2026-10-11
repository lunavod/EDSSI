import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { Glyph } from './Glyph';
import { popupPlace } from './popup-place';
import { scrollWithin } from './scroll-within';

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  /** Options sharing a group are listed under its name, in the order they first appear. */
  group?: string;
}

/** How long typed letters keep adding to the same search before it starts afresh. */
const TYPE_AHEAD_MS = 700;

/**
 * A dropdown in the HUD's own style, in place of a `<select>`, whose list is the system's and
 * ignores the page's styles. It sits in the same `.input` box as a text field, and its list hangs
 * under it as `Suggest`'s does: fixed, so no scrolling parent clips it, and above when there is
 * no room below. The arrows, Home and End move through it, typing jumps to an option starting with
 * what was typed, Enter or Space picks, Escape closes it without closing a dialog around it.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  id,
  className,
  style,
  before,
  placeholder = 'Choose…',
  'aria-label': ariaLabel,
  title,
}: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  id?: string;
  /** Added to the box's `input` class: `sm`, a width class… */
  className?: string;
  style?: CSSProperties;
  /** Shown in the box before the chosen option, such as a unit-style label. */
  before?: ReactNode;
  /** Shown when the value is none of the options. */
  placeholder?: string;
  'aria-label'?: string;
  title?: string;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = `${useId()}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<CSSProperties>();
  const typed = useRef({ text: '', at: 0 });

  const chosen = options.findIndex((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const anchor = button.current?.closest('.input') ?? button.current;
      if (!anchor) return;
      setPlace(popupPlace(anchor, { minWidth: 160, room: 240, maxHeight: 360 }));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || active < 0 || !list.current) return;
    const item = list.current.querySelector(`[data-index="${active}"]`);
    if (item instanceof HTMLElement) scrollWithin(list.current, item);
  }, [open, active]);

  const show = () => {
    setOpen(true);
    setActive(Math.max(0, chosen));
  };
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const pick = (index: number) => {
    const option = options[index];
    close();
    if (option && option.value !== value) onChange(option.value);
  };

  /** The next option starting with what has been typed lately, from where the list is now. */
  const typeAhead = (letter: string) => {
    const now = Date.now();
    const text = now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text + letter : letter;
    typed.current = { text, at: now };
    const from = open ? active : chosen;
    // A fresh letter moves on past the current match; more letters refine it.
    const start = text.length === 1 ? from + 1 : Math.max(0, from);
    for (let step = 0; step < options.length; step++) {
      const index = (start + step) % options.length;
      if (options[index]!.label.toLowerCase().startsWith(text)) {
        if (open) setActive(index);
        else if (options[index]!.value !== value) onChange(options[index]!.value);
        return;
      }
    }
  };

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!open) {
          show();
          return;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current) => Math.min(last, Math.max(0, current + step)));
        return;
      }
      case 'Home':
      case 'End':
        if (!open) return;
        event.preventDefault();
        setActive(event.key === 'Home' ? 0 : last);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open && active >= 0) pick(active);
        else show();
        return;
      case 'Escape':
        if (!open) return;
        // The list closes; a dialog around it stays.
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      case 'Tab':
        close();
        return;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          typeAhead(event.key.toLowerCase());
        }
    }
  };

  const current = options[chosen];
  // A heading goes above each option that starts a group.
  const startsGroup = options.map(
    (option, index) => option.group !== undefined && option.group !== options[index - 1]?.group,
  );
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <span
      className={['input select', className].filter(Boolean).join(' ')}
      style={style}
      title={title}
      // The whole box opens it, not only the text: the chevron, the padding, a label before it.
      // The keyboard reaches all of this through the button, so the box needs no key handler.
      onMouseDown={(event) => {
        if (!(event.target instanceof Node)) return;
        if (button.current?.contains(event.target) || list.current?.contains(event.target)) return;
        // Kept from taking focus off the button, whose blur would close the list again.
        event.preventDefault();
        button.current?.focus();
        if (open) close();
        else show();
      }}
    >
      {before}
      <button
        ref={button}
        id={id}
        type="button"
        // A button opening a styled list is the point: a <select>'s list is the system's.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        className={current ? 'select-value' : 'select-value empty'}
        onClick={() => (open ? close() : show())}
        onBlur={close}
        onKeyDown={keyDown}
      >
        {current?.label ?? placeholder}
      </button>
      <span className="chev" aria-hidden>
        <Glyph name="chevronDown" />
      </span>
      {open && (
        <ul
          ref={list}
          id={listId}
          className="suggest select-list"
          // A styled listbox is the point: a <select>'s popup is the system's and ignores CSS.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role
          role="listbox"
          aria-label={ariaLabel}
          style={place}
        >
          {options.map((option, index) => {
            return [
              startsGroup[index] && (
                <li key={`group-${option.group}`} className="select-group" role="presentation">
                  {option.group}
                </li>
              ),
              <li
                key={String(option.value)}
                id={`${listId}-${index}`}
                data-index={index}
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role, jsx-a11y/prefer-tag-over-role
                role="option"
                aria-selected={index === active}
                className={index === chosen ? 'chosen' : undefined}
                // Before the button's blur, which would close the list first.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(index);
                }}
                onMouseEnter={() => setActive(index)}
              >
                {option.label}
              </li>,
            ];
          })}
        </ul>
      )}
    </span>
  );
}
