import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SettingsView as View } from '../../../shared/api';
import type { AssistantSetup } from '../../../shared/assistant';
import type { HudColor } from '../../../shared/edhm';
import type { BoundAction, InputBinding, InputSnapshot } from '../../../shared/input';
import type { SettingsPatch } from '../../../shared/settings';
import type { UpdateState } from '../../../shared/updates';
import type { UploadsSnapshot, UploadStatus } from '../../../shared/uploads';
import { VR_COMMAND_LABELS, VR_COMMAND_NAMES, type VrCommand } from '../../../shared/vr';
import { useEdssi, useOwnsEvent, useWindowStorage, type WindowStorage } from '../api/context';
import { Glyph } from '../hud/Glyph';
import { Tabs } from '../hud/Tabs';
import { formatShortTime } from '../journal/format';
import { UpdatesPanel } from '../updates/UpdatesPanel';
import { BindingsPanel } from './BindingsPanel';
import { CarrierWebhookPanel } from './CarrierWebhookPanel';
import { EdhmPanel } from './EdhmPanel';
import { FieldInput, FieldRow, Toggle } from './FieldRow';
import {
  effectiveValue,
  type Field,
  fieldKey,
  type Getter,
  hidden,
  holds,
  locate,
  mergePatches,
  PAGE_IDS,
  PAGES,
  type Page,
  type PageId,
  patchFor,
  problemWith,
  sameValue,
  search,
  type Section,
  valueAt,
} from './fields';
import { HelpText } from './HelpText';
import { useSettingsRequests } from './open';
import { PasteBindingsPanel } from './PasteBindingsPanel';
import { type StepStatus, stepStatus } from './quickstart';
import { UploadLog } from './UploadLog';
import { VoiceTestPanel } from './VoiceTestPanel';
import { VrBindingsPanel } from './VrBindingsPanel';

interface SettingsViewProps {
  view: View | undefined;
  input: InputSnapshot | undefined;
  uploads: UploadsSnapshot | undefined;
  /** What the updater is doing, for the About page. */
  updates: UpdateState | undefined;
  /** How the assistant stands: ready, or what it is missing. */
  assistant: AssistantSetup | undefined;
  /** The EDHM theme's colour the window is wearing, if any. */
  hud: HudColor | null | undefined;
  /** The tab is on screen, so Ctrl+S is ours. */
  active: boolean;
  /** Told whenever there start or stop being unsaved changes, so the tabs can hold the screen. */
  onDirtyChange: (dirty: boolean) => void;
  /** A tab the commander tried to leave for while changes were unsaved. */
  leavingFor: string | undefined;
  /** Settles that attempt: go (after a save or a discard), or stay. */
  onLeave: (go: boolean) => void;
}

/** A field the commander has changed but not yet saved, by the path it lives at. */
type Draft = Record<string, unknown>;

const PAGE_KEY = 'edssi.settings.page';

function initialPage(storage: WindowStorage): PageId {
  try {
    const saved = storage.getItem(PAGE_KEY);
    if (PAGE_IDS.some((id) => id === saved)) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked just above
      return saved as PageId;
    }
  } catch {
    // Storage may be unavailable; the first page will do.
  }
  // Nothing remembered: a first run, which is what the Quickstart page is for.
  return 'quickstart';
}

/**
 * The settings file, as a screen. It writes the same `~/.edssi/config.yaml` the commander can edit
 * by hand — comments and all are kept — so neither way of changing a setting is second class.
 *
 * Pages down the side, each a few sections; a search across all of them. Nothing takes effect
 * until it is saved, and every unsaved change is marked where it is and counted on its page.
 */
export function SettingsView({
  view,
  input,
  uploads,
  updates,
  assistant,
  hud,
  active,
  onDirtyChange,
  leavingFor,
  onLeave,
}: SettingsViewProps) {
  const edssi = useEdssi();
  const storage = useWindowStorage();
  const ownsEvent = useOwnsEvent();
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [page, setPage] = useState<PageId>(() => initialPage(storage));
  const [query, setQuery] = useState('');
  const content = useRef<HTMLDivElement>(null);

  const settings = view?.settings;

  const saved = useCallback(
    (path: readonly string[]): unknown =>
      settings === undefined ? undefined : valueAt(settings, path),
    [settings],
  );

  const get: Getter = useCallback(
    (path) => effectiveValue(saved(path), path, draft[path.join('.')]),
    [draft, saved],
  );

  /** Drafts that would change something once saved, not ones typed back to what was there. */
  const changed = useMemo(
    () =>
      Object.keys(draft).filter((key) => {
        const path = key.split('.');
        return !sameValue(get(path), effectiveValue(saved(path), path));
      }),
    [draft, get, saved],
  );
  const invalid = useMemo(
    () =>
      Object.entries(draft).filter(([key, value]) => {
        const match = locate(key);
        return match !== undefined && problemWith(match.field, value) !== undefined;
      }).length,
    [draft],
  );
  const dirty = changed.length > 0;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    try {
      storage.setItem(PAGE_KEY, page);
    } catch {
      // Only a convenience.
    }
  }, [page, storage]);

  /** Resolves to whether the save went through. */
  const save = useCallback(
    async (patch: SettingsPatch): Promise<boolean> => {
      setSaving(true);
      setProblem(undefined);
      try {
        await edssi.settings.save(patch);
        return true;
      } catch (error) {
        console.error('[settings] failed to save', error);
        setProblem(error instanceof Error ? error.message : String(error));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [edssi],
  );

  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (invalid > 0 || !dirty) return false;
    const patches = Object.entries(draft).map(([key, value]) =>
      // Empty text is "not set": the key comes out of the file and the default applies.
      patchFor(key.split('.'), value === '' ? null : value),
    );
    const ok = await save(mergePatches(patches));
    if (ok) setDraft({});
    return ok;
  }, [dirty, draft, invalid, save]);

  const discard = useCallback(() => {
    setDraft({});
    setProblem(undefined);
  }, []);

  const saveBindings = useCallback(
    async (bindings: InputBinding[]) => {
      await save({ voice: { push_to_talk: bindings } });
    },
    [save],
  );

  const savePasteBindings = useCallback(
    async (actions: BoundAction[]) => {
      await save({ input: { paste: actions } });
    },
    [save],
  );

  /**
   * One cockpit command's bindings. Written a command at a time, and an emptied one is cleared
   * from the file rather than left as an empty list — so the file only ever says what was meant.
   */
  const saveVrBindings = useCallback(
    async (command: VrCommand, actions: BoundAction[]) => {
      await save({ vr: { bindings: { [command]: actions.length > 0 ? actions : null } } });
    },
    [save],
  );

  const edit = useCallback((field: Field, value: unknown) => {
    setDraft((current) => ({ ...current, [fieldKey(field)]: value }));
  }, []);

  // Ctrl+S saves, as anywhere else.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event: KeyboardEvent) => {
      // Embedded in a page (the mock UI), only while typing in this EDSSI: Ctrl+S is the page's.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && ownsEvent(event)) {
        event.preventDefault();
        void saveDraft();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, ownsEvent, saveDraft]);

  /** Goes to a page, and to a section or field on it once that has rendered. */
  const open = useCallback((next: PageId, anchor?: string) => {
    setQuery('');
    setPage(next);
    requestAnimationFrame(() => {
      if (!anchor) {
        content.current?.scrollTo({ top: 0 });
        return;
      }
      const pane = content.current;
      // Within the pane, not the document: an embedded EDSSI (the mock UI) is in a shadow root.
      const element = pane?.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`);
      if (!element || !pane) return;
      // Scrolled by hand: scrollIntoView would scroll the whole window along with the pane. In the
      // pane's own pixels, as a page may draw it scaled.
      const paneBox = pane.getBoundingClientRect();
      const scale = pane.offsetHeight > 0 ? paneBox.height / pane.offsetHeight : 1;
      const top = (element.getBoundingClientRect().top - paneBox.top) / scale;
      pane.scrollTo({ top: pane.scrollTop + top - 8, behavior: 'smooth' });
      element.querySelector<HTMLElement>('input, textarea, button')?.focus({ preventScroll: true });
    });
  }, []);

  // A page asked for from elsewhere in the window, such as Comms' "Open Quickstart".
  const settingsRequests = useSettingsRequests();
  useEffect(() => settingsRequests.on((next) => open(next)), [settingsRequests, open]);

  const matches = useMemo(() => search(query), [query]);

  if (!view || !settings) return <p className="settings-empty">Reading the settings file…</p>;

  /** Unsaved changes and trouble, per page, for the badges down the side. */
  const pageState = (candidate: Page) => {
    let unsaved = 0;
    let trouble = false;
    for (const section of candidate.sections) {
      for (const field of section.fields) {
        const key = fieldKey(field);
        if (changed.includes(key)) unsaved += 1;
        if (key in draft && problemWith(field, draft[key]) !== undefined) trouble = true;
      }
      if (section.checks?.some((check) => check(get) !== undefined)) trouble = true;
      const upload = uploads?.targets.find((status) => status.target === section.upload);
      if (upload && (upload.state === 'retrying' || upload.state === 'rejected')) trouble = true;
    }
    return { unsaved, trouble };
  };

  const panel = (section: Section, warned: boolean): ReactNode => {
    switch (section.panel) {
      case 'assistant-status':
        return <AssistantStatus setup={assistant} quiet={warned} />;
      case 'bindings':
        return (
          <BindingsPanel
            bindings={settings.voice.push_to_talk}
            input={input}
            onSave={saveBindings}
          />
        );
      case 'paste-bindings':
        return (
          <PasteBindingsPanel
            bindings={settings.input.paste}
            input={input}
            onSave={savePasteBindings}
            elsewhere={VR_COMMAND_NAMES.map((command) => ({
              label: VR_COMMAND_LABELS[command],
              actions: settings.vr.bindings[command] ?? [],
            }))}
          />
        );
      case 'carrier-webhook':
        return <CarrierWebhookPanel get={get} />;
      case 'voice-test':
        // Whatever speaks, while anything does.
        return get(['voice', 'speech', 'enabled']) === false ? null : <VoiceTestPanel get={get} />;
      case 'edhm':
        return <EdhmPanel hud={hud} matching={settings.display.match_hud_color} />;
      case 'upload-log':
        return <UploadLog logVersion={uploads?.logVersion} />;
      case 'updates':
        return <UpdatesPanel state={updates} />;
      case 'vr-quick-bindings':
        return (
          <VrBindingsPanel
            bindings={settings.vr.bindings}
            input={input}
            onSave={saveVrBindings}
            elsewhere={[{ label: 'Paste', actions: settings.input.paste }]}
            quick={['toggle', 'scrollUp', 'scrollDown']}
          />
        );
      case 'vr-bindings':
        return (
          <VrBindingsPanel
            bindings={settings.vr.bindings}
            input={input}
            onSave={saveVrBindings}
            elsewhere={[{ label: 'Paste', actions: settings.input.paste }]}
          />
        );
      default:
        return null;
    }
  };

  const current = PAGES.find((candidate) => candidate.id === page) ?? PAGES[0]!;
  const steps = current.sections.filter((candidate) => candidate.step);
  const renderSection = (section: Section) => (
    <SettingsSection
      key={section.id}
      section={section}
      step={
        section.step && {
          number: steps.indexOf(section) + 1,
          status: stepStatus(section.step.kind, settings, assistant),
          signIn:
            section.step.kind === 'assistant' &&
            assistant?.provider === 'codex' &&
            !assistant.signedIn,
          more: PAGES.find((candidate) => candidate.id === section.step?.more.page)?.title ?? '',
          onMore: () =>
            open(
              section.step!.more.page,
              section.step!.more.section && `section-${section.step!.more.section}`,
            ),
        }
      }
      get={get}
      saved={saved}
      draft={draft}
      upload={uploads?.targets.find((status) => status.target === section.upload)}
      panel={(warned) => panel(section, warned)}
      onEdit={edit}
      onCommit={() => void saveDraft()}
    />
  );

  /** The page's sections, the upload services side by side. */
  const renderSections = (sections: readonly Section[]) => {
    const out: ReactNode[] = [];
    for (let index = 0; index < sections.length; index++) {
      const section = sections[index]!;
      if (section.upload) {
        const run: Section[] = [];
        while (sections[index]?.upload) run.push(sections[index++]!);
        index--;
        out.push(
          <div key={`services-${run[0]!.id}`} className="svc3">
            {run.map(renderSection)}
          </div>,
        );
      } else out.push(renderSection(section));
    }
    return out;
  };

  return (
    <div className="settings">
      <Tabs
        tabs={PAGES.map((candidate) => {
          const state = pageState(candidate);
          return {
            id: candidate.id,
            label: candidate.title,
            badge:
              state.unsaved > 0 || state.trouble ? (
                <PageBadges unsaved={state.unsaved} trouble={state.trouble} />
              ) : undefined,
          };
        })}
        active={query ? ('' as PageId) : page}
        onSelect={(id) => open(id)}
        sub
        ariaLabel="Settings pages"
        actions={
          <label className="input sm">
            <span className="ic-w">
              <Glyph name="search" />
            </span>
            <input
              type="search"
              placeholder="Search"
              aria-label="Find a setting"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('');
              }}
            />
          </label>
        }
      />
      {view.problem && (
        <p className="note danger">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          The settings file was rejected, so EDSSI is running the defaults: {view.problem}
        </p>
      )}

      <div className="scontent" ref={content} title={query ? undefined : current.help}>
        {query ? (
          <SearchResults
            query={query}
            matches={matches}
            render={(section, fields) =>
              renderSection({ ...section, panel: undefined, checks: undefined, fields })
            }
            onOpen={open}
          />
        ) : (
          renderSections(current.sections)
        )}
      </div>

      {leavingFor !== undefined && (
        <p className="note" role="alert">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          Save or discard your changes before leaving for {leavingFor}.
        </p>
      )}
      {problem && (
        <p className="note danger">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          Saving failed: {problem}
        </p>
      )}
      {/* Changes only take effect once saved, so the bar lights up while there is anything to save. */}
      <footer
        className={['sfoot', dirty && 'dirty', invalid > 0 && 'invalid'].filter(Boolean).join(' ')}
      >
        {saving ? (
          <span>Saving…</span>
        ) : invalid > 0 ? (
          <span className="danger">
            Fix {invalid === 1 ? 'the marked value' : `${invalid} marked values`} to save
          </span>
        ) : dirty ? (
          <>
            <span className="dot-u" />
            <span className="changed">
              <b>
                {changed.length} unsaved {changed.length === 1 ? 'change' : 'changes'}
              </b>
              <ChangedList keys={changed} onOpen={open} />
            </span>
          </>
        ) : (
          <span className="good row" style={{ gap: 8 }}>
            <span className="ic-w">
              <Glyph name="check" />
            </span>
            All changes saved
          </span>
        )}
        <span className="sp" />
        {dirty || leavingFor !== undefined || Object.keys(draft).length > 0 ? (
          <>
            <span className="hint">Ctrl S</span>
            {leavingFor !== undefined && (
              <button type="button" className="btn ghost" onClick={() => onLeave(false)}>
                Stay
              </button>
            )}
            <button
              type="button"
              className="btn ghost"
              disabled={Object.keys(draft).length === 0 || saving}
              onClick={() => {
                discard();
                if (leavingFor !== undefined) onLeave(true);
              }}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!dirty || invalid > 0 || saving}
              title="Ctrl+S"
              onClick={() => {
                void saveDraft().then((ok) => {
                  if (ok && leavingFor !== undefined) onLeave(true);
                });
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <>
            <span className="micro">Settings file</span>
            <span className="path" title={view.path}>
              {view.path}
            </span>
            <button
              type="button"
              className="link"
              style={{ fontSize: 13 }}
              onClick={() => void edssi.settings.openFile()}
            >
              Open
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

/** Unsaved changes counted on a page's tab, and a mark where something needs attention. */
function PageBadges({ unsaved, trouble }: { unsaved: number; trouble: boolean }) {
  return (
    <>
      {unsaved > 0 && (
        <span className="badge-u" title="Unsaved changes">
          {unsaved}
        </span>
      )}
      {trouble && (
        <span className="badge-t" title="Needs attention">
          !
        </span>
      )}
    </>
  );
}

/** The labels of the unsaved changes, each a way back to it. */
function ChangedList({
  keys,
  onOpen,
}: {
  keys: readonly string[];
  onOpen: (page: PageId, anchor: string) => void;
}) {
  const shown = keys.slice(0, 4);
  return (
    <>
      {shown.map((key) => {
        const match = locate(key);
        if (!match) return null;
        return (
          <button
            key={key}
            type="button"
            className="link"
            style={{ fontSize: 13 }}
            title={`${match.page.title} › ${match.section.title}`}
            onClick={() => onOpen(match.page.id, `row-${key}`)}
          >
            {match.field.label}
          </button>
        );
      })}
      {keys.length > shown.length && <span>+{keys.length - shown.length} more</span>}
    </>
  );
}

interface SearchResultsProps {
  query: string;
  matches: ReturnType<typeof search>;
  render: (section: Section, fields: Field[]) => ReactNode;
  onOpen: (page: PageId, anchor: string) => void;
}

/** What matched, grouped under the page and section it lives on, and editable where it stands. */
function SearchResults({ query, matches, render, onOpen }: SearchResultsProps) {
  if (matches.length === 0) {
    return <p className="settings-empty">No setting matches “{query}”.</p>;
  }
  const groups = new Map<string, { page: Page; section: Section; fields: Field[] }>();
  for (const { page, section, field } of matches) {
    const key = `${page.id}/${section.id}`;
    const group = groups.get(key) ?? { page, section, fields: [] };
    group.fields.push(field);
    groups.set(key, group);
  }
  return (
    <>
      <p className="settings-help">
        {matches.length} {matches.length === 1 ? 'setting matches' : 'settings match'} “{query}”.
      </p>
      {[...groups.values()].map(({ page, section, fields }) => (
        <div key={`${page.id}/${section.id}`} className="col" style={{ gap: 6 }}>
          <button
            type="button"
            className="link settings-crumb"
            onClick={() => onOpen(page.id, `section-${section.id}`)}
          >
            {page.title} ›
          </button>
          {render({ ...section, layout: undefined }, fields)}
        </div>
      ))}
    </>
  );
}

/** A Quickstart step: where it is in the list, how it stands, and where the rest of it lives. */
interface StepView {
  number: number;
  status: StepStatus;
  /** The ChatGPT plan is chosen and not signed in to: the button goes on the status line. */
  signIn: boolean;
  /** The title of the page with the step's other settings. */
  more: string;
  onMore: () => void;
}

interface SettingsSectionProps {
  section: Section;
  step?: StepView | undefined;
  get: Getter;
  saved: (path: readonly string[]) => unknown;
  draft: Draft;
  upload: UploadStatus | undefined;
  onEdit: (field: Field, value: unknown) => void;
  onCommit: () => void;
  /** Given whether the section is already warning, so a panel needn't say the same again. */
  panel: (warned: boolean) => ReactNode;
}

function SettingsSection({
  section,
  step,
  get,
  saved,
  draft,
  upload,
  onEdit,
  onCommit,
  panel,
}: SettingsSectionProps) {
  const edssi = useEdssi();
  const sectionOn = holds(section.when, get);
  const fields = section.fields.filter((field) => !hidden(field, get));
  const warnings = (section.checks ?? [])
    .map((check) => check(get))
    .filter((warning) => warning !== undefined);
  const row = (field: Field) => {
    const key = fieldKey(field);
    return (
      <FieldRow
        key={key}
        field={field}
        saved={saved(field.path)}
        draft={draft[key]}
        inactive={sectionOn && !holds(field.when, get) ? field.when?.note : undefined}
        onEdit={onEdit}
        onCommit={onCommit}
      />
    );
  };

  return (
    <section
      id={`section-${section.id}`}
      className="ss panel"
      data-inactive={!sectionOn}
      aria-label={section.title}
    >
      <header className="ss-head">
        {step && <span className="qs-num">{step.number}</span>}
        <h3 className="ss-title">{section.title}</h3>
        {step && (
          <button type="button" className="link qs-more" onClick={step.onMore}>
            More in {step.more} ›
          </button>
        )}
      </header>
      {section.help && (
        <p className="ss-help">
          <HelpText text={section.help} />
        </p>
      )}
      {step && (
        <output className="settings-status qs-status" data-tone={step.status.tone}>
          <span className="settings-status-dot" aria-hidden="true" />
          <span className="grow">{step.status.text}</span>
          {step.signIn && (
            <button type="button" className="btn sm" onClick={() => void edssi.assistant.signIn()}>
              Sign in with ChatGPT
            </button>
          )}
        </output>
      )}
      {!sectionOn && section.when && (
        <p className="note info ss-note">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          {section.when.note}
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="note ss-note">
          <span className="ic-w">
            <Glyph name="warning" />
          </span>
          {warning}
        </p>
      ))}
      <div className="ss-body">
        {upload && <UploadLine status={upload} />}
        {section.panelAt !== 'end' && panel(warnings.length > 0)}
        {section.layout === 'cards' ? (
          <Cards
            fields={fields}
            get={get}
            saved={saved}
            draft={draft}
            sectionOn={sectionOn}
            onEdit={onEdit}
            onCommit={onCommit}
          />
        ) : (
          fields.map(row)
        )}
        {section.panelAt === 'end' && panel(warnings.length > 0)}
      </div>
    </section>
  );
}

/**
 * Each switch as a card: its name, one line, the switch; the numbers that only matter while it is
 * on (their condition is that switch) sit inside it.
 */
function Cards({
  fields,
  get,
  saved,
  draft,
  sectionOn,
  onEdit,
  onCommit,
}: {
  fields: readonly Field[];
  get: Getter;
  saved: (path: readonly string[]) => unknown;
  draft: Draft;
  sectionOn: boolean;
  onEdit: (field: Field, value: unknown) => void;
  onCommit: () => void;
}) {
  const flags = fields.filter((field) => field.kind === 'flag');
  const tunes = (flag: Field) =>
    fields.filter(
      (field) =>
        field.kind !== 'flag' &&
        field.when !== undefined &&
        fieldKey({ ...field, path: field.when.path }) === fieldKey(flag),
    );
  const loose = fields.filter(
    (field) => field.kind !== 'flag' && !flags.some((flag) => tunes(flag).includes(field)),
  );
  const shownValue = (field: Field) => {
    const key = fieldKey(field);
    return key in draft ? draft[key] : saved(field.path);
  };
  const isUnsaved = (field: Field) => {
    const key = fieldKey(field);
    return (
      key in draft &&
      !sameValue(
        effectiveValue(saved(field.path), field.path, draft[key]),
        effectiveValue(saved(field.path), field.path),
      )
    );
  };
  return (
    <>
      <div className="agrid">
        {flags.map((flag) => {
          const key = fieldKey(flag);
          const on = get(flag.path) === true;
          const inactive = sectionOn && !holds(flag.when, get);
          const extras = tunes(flag);
          const className = [
            'acard',
            on && 'on',
            inactive && 'inactive',
            (isUnsaved(flag) || extras.some(isUnsaved)) && 'unsaved',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={key}
              id={`row-${key}`}
              className={className}
              title={inactive ? flag.when?.note : undefined}
            >
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <div className="col grow">
                  <label className="acard-t" htmlFor={key}>
                    {flag.label}
                  </label>
                  {flag.help && <span className="acard-d">{flag.help}</span>}
                </div>
                <Toggle
                  id={key}
                  on={
                    shownValue(flag) === null ? get(flag.path) === true : shownValue(flag) === true
                  }
                  onChange={(next) => onEdit(flag, next)}
                  text=""
                />
              </div>
              {extras.length > 0 && (
                <div className="acard-x">
                  {extras.map((field) => (
                    <span
                      key={fieldKey(field)}
                      id={`row-${fieldKey(field)}`}
                      className="row"
                      style={{ gap: 8 }}
                      title={field.help}
                    >
                      <label className="micro" htmlFor={fieldKey(field)}>
                        {shortLabel(field.label, flag.label)}
                      </label>
                      <FieldInput
                        field={field}
                        value={shownValue(field)}
                        onEdit={onEdit}
                        onCommit={onCommit}
                      />
                      {problemWith(field, shownValue(field)) && (
                        <span className="danger">{problemWith(field, shownValue(field))}</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {loose.map((field) => (
        <FieldRow
          key={fieldKey(field)}
          field={field}
          saved={saved(field.path)}
          draft={draft[fieldKey(field)]}
          inactive={sectionOn && !holds(field.when, get) ? field.when?.note : undefined}
          onEdit={onEdit}
          onCommit={onCommit}
        />
      ))}
    </>
  );
}

/** "Low fuel below" under the Low fuel switch is just "Below". */
function shortLabel(label: string, flag: string): string {
  return label.toLowerCase().startsWith(`${flag.toLowerCase()} `)
    ? label.slice(flag.length + 1).replace(/^./, (first) => first.toUpperCase())
    : label;
}

/** Whether the assistant can answer, and the sign-in when the ChatGPT plan is waiting on one. */
function AssistantStatus({ setup, quiet }: { setup: AssistantSetup | undefined; quiet: boolean }) {
  const edssi = useEdssi();
  if (!setup) return null;
  const needsSignIn = setup.provider === 'codex' && !setup.signedIn;
  // The section's own warning already says what is missing.
  if (quiet && setup.enabled && !setup.ready && !needsSignIn) return null;
  const tone = !setup.enabled ? 'off' : setup.ready ? 'good' : 'trouble';
  return (
    <div className="settings-status" data-tone={tone}>
      <span className="settings-status-dot" aria-hidden="true" />
      <span className="grow">
        {!setup.enabled
          ? 'The assistant is off.'
          : setup.ready
            ? `Ready: ${setup.model} on ${setup.provider === 'codex' ? 'your ChatGPT plan' : 'the API key'}.`
            : (setup.problem ?? 'Not ready.')}
        {setup.provider === 'codex' && setup.signedIn && ' Signed in to ChatGPT.'}
      </span>
      {needsSignIn && (
        <button type="button" className="btn sm" onClick={() => void edssi.assistant.signIn()}>
          Sign in with ChatGPT
        </button>
      )}
    </div>
  );
}

/** One line on how an upload is doing, with a dot for its state. */
function UploadLine({ status }: { status: UploadStatus }) {
  const parts: string[] = [];
  switch (status.state) {
    case 'off':
      parts.push(status.message ?? 'Off.');
      break;
    case 'waiting':
      parts.push(status.pending > 0 ? `${status.pending} waiting to be sent.` : 'Up to date.');
      break;
    case 'paused':
      parts.push(`Paused: ${status.message ?? ''}`);
      break;
    case 'retrying':
      parts.push(`${status.message ?? 'Failed'}. Trying again; ${status.pending} waiting.`);
      break;
    case 'rejected':
      parts.push(`Stopped: ${status.message ?? 'refused'}. Fix the settings to try again.`);
      break;
  }
  if (status.lastSentAt) {
    parts.push(`${status.sent} sent, last ${formatShortTime(status.lastSentAt)}.`);
  }
  const dot =
    status.state === 'waiting'
      ? 'dot-s ok'
      : status.state === 'retrying'
        ? 'dot-s warn'
        : status.state === 'rejected'
          ? 'dot-s danger'
          : 'dot-s';
  const trouble = status.state === 'retrying' || status.state === 'rejected';
  return (
    <div className={trouble ? 'upl-line warn' : 'upl-line'}>
      <span className={dot} />
      {parts.join(' ')}
    </div>
  );
}
