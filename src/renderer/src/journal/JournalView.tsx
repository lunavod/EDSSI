import { Fragment, useDeferredValue, useState } from 'react';

import type { ShipLoss } from '../../../shared/history';
import type { PlottedRoute } from '../../../shared/nav-routes';
import { Glyph } from '../hud/Glyph';
import { Icon } from '../hud/Icon';
import { iconFor } from '../hud/icons';
import { EventDetails } from './EventDetails';
import { formatDateTime, formatTime } from './format';
import { type EventRow, type GroupRow, groupEntries, type VisibleEntry } from './grouping';
import { lossFor, summariseLoss } from './losses';
import type { JournalEntry } from './state';
import {
  CATEGORIES,
  type Category,
  describeEvent,
  type EventDescription,
  HIDDEN_BY_DEFAULT,
  join,
} from './summaries';

interface JournalViewProps {
  entries: JournalEntry[];
  /** Recorded routes, oldest first, to place jumps on the route being followed. */
  routes: readonly PlottedRoute[];
  /** Ships destroyed, to say what each death cost. */
  losses: readonly ShipLoss[];
}

const ALL: ReadonlySet<Category> = new Set();
const NONE: ReadonlySet<Category> = new Set(CATEGORIES.map(({ id }) => id));
const ONLY_EXPLORATION: ReadonlySet<Category> = new Set(
  CATEGORIES.map(({ id }) => id).filter((id) => id !== 'exploration'),
);

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/**
 * The session's events, newest first: one card each, open for their full details. Runs of related
 * events (a jump, scans in one system…) share a card that opens into theirs. Categories are ticked
 * on and off down the rail on the left.
 */
export function JournalView({ entries, routes, losses }: JournalViewProps) {
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<ReadonlySet<Category>>(() => new Set(HIDDEN_BY_DEFAULT));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const needle = useDeferredValue(query).trim().toLowerCase();

  const counts = new Map<Category, number>();
  const visible: VisibleEntry[] = [];
  for (const entry of entries) {
    const description = describeEvent(entry.event);
    // Events that tell us nothing new are background noise, whatever their type.
    const category = entry.redundant ? 'background' : description.category;
    counts.set(category, (counts.get(category) ?? 0) + 1);
    if (hidden.has(category) || !matches(description, entry, needle)) continue;
    visible.push({ entry, description, category });
  }
  const rows = groupEntries(visible, routes);
  const toggle = (key: string) => setExpanded((current) => toggled(current, key));

  return (
    <div className="journal">
      <nav className="rail" aria-label="Filters">
        <label className="input">
          <span className="ic-w">
            <Glyph name="search" />
          </span>
          <input
            type="search"
            placeholder="Filter…"
            aria-label="Filter events"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="side-label">Categories</div>
        <div className="col">
          {CATEGORIES.filter(({ id }) => counts.has(id)).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="rail-item"
              aria-pressed={!hidden.has(id)}
              onClick={() => setHidden((current) => toggled(current, id))}
            >
              <span className="box" />
              <span className="grow">{label}</span>
              <span className="n">{counts.get(id)}</span>
            </button>
          ))}
        </div>
        <div className="rail-presets">
          <button type="button" className="link" onClick={() => setHidden(ALL)}>
            All
          </button>
          <button type="button" className="link" onClick={() => setHidden(NONE)}>
            None
          </button>
          <button type="button" className="link" onClick={() => setHidden(ONLY_EXPLORATION)}>
            Exploration
          </button>
          {expanded.size > 0 && (
            <button type="button" className="link" onClick={() => setExpanded(new Set())}>
              Close all
            </button>
          )}
        </div>
      </nav>

      <div className="cards">
        {rows.length === 0 ? (
          <p className="cards-empty">
            {entries.length === 0 ? 'Waiting for the journal…' : 'No events match the filters.'}
          </p>
        ) : (
          rows.map((row, index) => {
            const day = dayOf(row);
            const newDay = index === 0 || dayOf(rows[index - 1]!) !== day;
            return (
              <Fragment key={row.key}>
                {newDay && <div className="day">{day}</div>}
                {row.kind === 'group' ? (
                  <GroupCard
                    row={row}
                    expanded={expanded}
                    onToggle={toggle}
                    routes={routes}
                    losses={losses}
                  />
                ) : (
                  <EventCard
                    row={row}
                    isOpen={expanded.has(row.key)}
                    onToggle={toggle}
                    routes={routes}
                    losses={losses}
                  />
                )}
              </Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}

function dayOf(row: EventRow | GroupRow): string {
  const timestamp = row.kind === 'group' ? row.timestamp : row.item.entry.event.timestamp;
  return dayFormat.format(new Date(timestamp));
}

/** Exobiology is what the Mission tab is about; its events are picked out in the good colour. */
function isLife(eventName: string): boolean {
  return /Organic|^Codex|^SellOrganicData/.test(eventName);
}

interface EventCardProps {
  row: EventRow;
  isOpen: boolean;
  onToggle: (key: string) => void;
  routes: readonly PlottedRoute[];
  losses: readonly ShipLoss[];
}

function EventCard({ row, isOpen, onToggle, routes, losses }: EventCardProps) {
  const { event } = row.item.entry;
  const loss = lossFor(event, losses);
  const summary = join(row.summary, loss && summariseLoss(loss));
  const className = [
    'card',
    isOpen && 'open',
    isLife(event.event) && 'hl',
    row.item.category === 'background' && 'bg',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <article className={className}>
      <button
        type="button"
        className="card-head"
        aria-expanded={isOpen}
        onClick={() => onToggle(row.key)}
      >
        <span className="card-ic">
          <Icon src={iconFor(event.event, row.item.category)} />
        </span>
        <span className="col grow">
          <span className="card-title">{row.item.description.title}</span>
          {summary && <span className="card-sum">{summary}</span>}
        </span>
        <time className="card-t" dateTime={event.timestamp} title={formatDateTime(event.timestamp)}>
          {formatTime(event.timestamp)}
        </time>
      </button>
      {isOpen && <EventDetails event={event} routes={routes} loss={loss} />}
    </article>
  );
}

interface GroupCardProps {
  row: GroupRow;
  expanded: ReadonlySet<string>;
  onToggle: (key: string) => void;
  routes: readonly PlottedRoute[];
  losses: readonly ShipLoss[];
}

function GroupCard({ row, expanded, onToggle, routes, losses }: GroupCardProps) {
  const isOpen = expanded.has(row.key);
  // The newest event says most about the group: the arrival of a jump, the last scan.
  const newest = row.events[0]?.item.entry.event.event ?? '';
  const className = ['card', isOpen && 'open', isLife(newest) && 'hl'].filter(Boolean).join(' ');
  return (
    <article className={className}>
      <button
        type="button"
        className="card-head"
        aria-expanded={isOpen}
        onClick={() => onToggle(row.key)}
      >
        <span className="card-ic">
          <Icon src={iconFor(newest, row.category)} />
        </span>
        <span className="col grow">
          <span className="card-title">
            {row.title}
            <span className="card-count" title={`${row.events.length} events`}>
              {row.events.length}
            </span>
          </span>
          {row.summary && <span className="card-sum">{row.summary}</span>}
        </span>
        <time className="card-t" dateTime={row.timestamp} title={formatDateTime(row.timestamp)}>
          {formatTime(row.timestamp)}
        </time>
      </button>
      {isOpen && (
        <div className="card-kids">
          {row.events.map((event) => (
            <EventCard
              key={event.key}
              row={event}
              isOpen={expanded.has(event.key)}
              onToggle={onToggle}
              routes={routes}
              losses={losses}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function matches(description: EventDescription, entry: JournalEntry, needle: string): boolean {
  if (!needle) return true;
  const haystack = `${description.title} ${description.summary ?? ''} ${entry.event.event}`;
  return haystack.toLowerCase().includes(needle);
}

function toggled<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(item)) next.add(item);
  return next;
}
