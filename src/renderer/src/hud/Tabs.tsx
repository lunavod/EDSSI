import type { ReactNode } from 'react';

interface TabsProps<T extends string> {
  tabs: readonly { id: T; label: string; badge?: ReactNode }[];
  active: T;
  onSelect: (id: T) => void;
  /** A module's own pages: smaller, and underlined rather than filled. */
  sub?: boolean;
  ariaLabel?: string;
  /** Buttons at the far end of a row of pages. */
  actions?: ReactNode;
}

/** The module switcher across the top of the main area, or a module's own pages. */
export function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
  sub,
  ariaLabel,
  actions,
}: TabsProps<T>) {
  return (
    <div className={sub ? 'subtabs' : 'tabs'} role="tablist" aria-label={ariaLabel}>
      {tabs.map(({ id, label, badge }) => (
        <button
          key={id}
          type="button"
          role="tab"
          className={sub ? 'subtab' : 'tab'}
          aria-selected={id === active}
          onClick={() => onSelect(id)}
        >
          {label}
          {badge !== undefined && badge !== null && (
            <span className={sub ? 'count' : 'badge'}>{badge}</span>
          )}
        </button>
      ))}
      {actions && <div className="sub-actions">{actions}</div>}
    </div>
  );
}
