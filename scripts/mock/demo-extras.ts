/**
 * The demo scenario's parts no journal makes: the assistant's conversation, the settings, the
 * uploads, the shopping list. Written to match the trip in demo-journal.ts, quoting what the real
 * services made of it, so the Comms tab talks about the world the Mission tab shows.
 */

import { readFileSync } from 'node:fs';

import type { MockScenario } from '../../src/mock/scenario';
import type { TranscriptEntry } from '../../src/shared/assistant';
import type { HistorySnapshot } from '../../src/shared/history';
import { MATERIALS } from '../../src/shared/recipes.generated';
import { defaultSettings } from '../../src/shared/settings';
import { parseReleaseNotes } from '../../src/shared/updates';
import { defaultViewOptions } from '../../src/shared/view-options';
import type { ServiceAnswers } from './run-services';

type Extras = Omit<MockScenario, keyof ServiceAnswers>;

export function demoExtras(now: number, answers: ServiceAnswers, version: string): Extras {
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const settings = defaultSettings();
  const notes = parseReleaseNotes(readFileSync('CHANGELOG_USER.md', 'utf8'));
  const history = answers.history;
  const here = answers.journal.overview.system ?? 'here';

  return {
    version,
    shoppingList: {
      items: [
        { id: 'steel', commodity: 'Steel', needed: 5_412, bought: 3_200 },
        { id: 'aluminium', commodity: 'Aluminium', needed: 1_480, bought: 1_480 },
        { id: 'cmm', commodity: 'CMM Composite', needed: 4_028, bought: 1_104 },
        { id: 'polymers', commodity: 'Polymers', needed: 512, bought: 0 },
        { id: 'semiconductors', commodity: 'Semiconductors', needed: 66, bought: 66 },
        { id: 'ceramics', commodity: 'Ceramic Composites', needed: 702, bought: 260 },
        { id: 'oxygen', commodity: 'Liquid Oxygen', needed: 1_840, bought: 0 },
        { id: 'membrane', commodity: 'Insulating Membrane', needed: 340, bought: 120 },
      ],
    },
    pinnedPlan: null,
    commodityNames: Object.values(MATERIALS as Record<string, { name: string; category: string }>)
      .filter((material) => material.category === 'Commodity')
      .map((material) => material.name)
      .toSorted(),
    systems: {
      'Shinrarta Dezhra': {
        name: 'Shinrarta Dezhra',
        status: 'ok',
        traffic: { total: 412_880, week: 6_120, day: 902 },
        deaths: { total: 3_418, week: 41, day: 6 },
        primaryStar: { type: 'K (Yellow-Orange) Star', scoopable: true },
        closestStarport: { name: 'Jameson Memorial', type: 'Orbis Starport', distanceLs: 347 },
      },
    },
    assistant: {
      version: 1,
      phase: 'idle',
      transcript: transcript(at, history, here),
      setup: {
        enabled: true,
        provider: 'openai',
        model: settings.assistant.model,
        ready: true,
        voiceInput: true,
        voiceOutput: true,
        kokoro: { kind: 'ready' },
        voiceInputFormat: 'wav',
        pushToTalk: ['Right Ctrl + T'],
        holdToTalk: true,
        signedIn: false,
        maxRecordingSeconds: 30,
        keepMicrophoneOpen: false,
        configPath: 'C:\\Users\\Commander\\.edssi\\config.yaml',
      },
    },
    input: {
      version: 1,
      devices: [
        {
          vendorId: 0x231d,
          productId: 0x0200,
          product: 'VKB-Sim Gladiator EVO R',
          manufacturer: 'VKB-Sim',
          connected: true,
        },
        {
          vendorId: 0x231d,
          productId: 0x0201,
          product: 'VKB-Sim Gladiator EVO L',
          manufacturer: 'VKB-Sim',
          connected: true,
        },
      ],
      state: {},
      capturing: false,
      talking: false,
    },
    settings: { settings, path: 'C:\\Users\\Commander\\.edssi\\config.yaml' },
    uploads: {
      version: 1,
      logVersion: 1,
      targets: [
        { target: 'edsm', state: 'waiting', pending: 0, lastSentAt: at(3), sent: 214 },
        { target: 'inara', state: 'off', pending: 0, sent: 0 },
        { target: 'eddn', state: 'waiting', pending: 0, lastSentAt: at(3), sent: 188 },
      ],
    },
    uploadLog: [
      {
        id: 3,
        target: 'edsm',
        source: 'live',
        at: at(3),
        firstEvent: at(9),
        lastEvent: at(4),
        events: 14,
        eventCounts: {
          Scan: 9,
          FSSDiscoveryScan: 1,
          FSDJump: 1,
          FuelScoop: 1,
          SAAScanComplete: 1,
          ScanOrganic: 1,
        },
        systems: [here],
        outcome: 'sent',
        accepted: 14,
        refused: [],
      },
      {
        id: 2,
        target: 'eddn',
        source: 'live',
        at: at(3),
        firstEvent: at(9),
        lastEvent: at(4),
        events: 11,
        eventCounts: { Scan: 9, FSDJump: 1, FSSDiscoveryScan: 1 },
        systems: [here],
        outcome: 'sent',
        accepted: 11,
        refused: [],
      },
      {
        id: 1,
        target: 'edsm',
        source: 'live',
        at: at(31),
        firstEvent: at(44),
        lastEvent: at(32),
        events: 22,
        eventCounts: { Scan: 16, FSDJump: 2, FuelScoop: 2, SAASignalsFound: 2 },
        systems: [],
        outcome: 'sent',
        accepted: 21,
        skipped: 1,
        refused: [],
      },
    ],
    updates: { status: 'idle', checkedAt: at(12) },
    whatsNew: { running: version, unseen: [], all: notes },
    hudColor: null,
    fssOverlay: {
      state: 'ready',
      gameDir: 'C:\\Games\\Elite Dangerous',
      installed: true,
      shaders: true,
      conflicts: [],
    },
    viewOptions: defaultViewOptions(),
    browser: { loading: false, canGoBack: false, canGoForward: false },
    tab: 'mission',
  };
}

/** A few questions about the trip, answered from what the services made of the journal. */
function transcript(
  at: (minutesAgo: number) => string,
  history: HistorySnapshot,
  here: string,
): TranscriptEntry[] {
  const bodies = history.survey?.bodies ?? [];
  const living = bodies.filter((body) => body.genuses.length > 0 || body.bioSignals > 0);
  const best = living.toSorted((a, b) => b.genuses.length - a.genuses.length)[0];
  const genera = best?.genuses.map((genus) => genus.name) ?? [];
  const started = best?.organics.find((organic) => organic.samples > 0 && organic.samples < 3);
  const fresh = (best?.genuses ?? []).flatMap((genus) =>
    genus.candidates.some((species) => species.newSpecies) ? [genus.name] : [],
  );
  const unsold = history.ledger;
  const entries: Omit<TranscriptEntry, 'id'>[] = [
    {
      role: 'commander',
      text: "What's worth landing for in this system?",
      at: at(14),
      detail: 'spoken',
    },
    {
      role: 'tool',
      text: 'get_biology_here',
      at: at(14),
      call: { input: '{}', output: JSON.stringify({ system: here, bodies: living.length }) },
    },
    {
      role: 'assistant',
      text: best
        ? `${best.name}: ${genera.length} genera mapped — ${genera.join(', ')}. ${
            started ? `You've ${started.samples} of 3 samples of ${started.name}; ` : ''
          }${
            fresh.length > 0
              ? `${fresh.join(' and ')} ${fresh.length > 1 ? 'are' : 'is'} new to your codex.`
              : 'Nothing here is new to your codex.'
          }${best.firstFootfall ? ' Nobody has landed here before, so every sample pays five times over.' : ''}`
        : 'Nothing with biological signals has been scanned here yet. Honk and I will look again.',
      at: at(14),
    },
    { role: 'commander', text: 'How much am I carrying unsold?', at: at(6), detail: 'spoken' },
    {
      role: 'tool',
      text: 'get_ledger',
      at: at(6),
      call: { input: '{}', output: JSON.stringify(unsold) },
    },
    {
      role: 'assistant',
      text: `About ${formatCredits(totalUnsold(history))} in exploration and organic data since the last sale at your carrier. Worth a trip back once this system is done — the carrier is six jumps behind you.`,
      at: at(6),
    },
  ];
  return entries.map((entry, index) => ({ ...entry, id: index + 1 }));
}

function totalUnsold({ ledger }: HistorySnapshot): number {
  return ledger.cartographics.value + ledger.exobiology.value;
}

/** "412 million credits", as a commander would say it. */
function formatCredits(value: number): string {
  return value >= 1e9
    ? `${(value / 1e9).toFixed(2)} billion credits`
    : `${Math.round(value / 1e6)} million credits`;
}
