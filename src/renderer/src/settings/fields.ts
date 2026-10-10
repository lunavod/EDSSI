/**
 * The settings file, described so the screen can render it.
 *
 * The zod schema in `src/shared/settings.ts` stays the authority on what a value may be; this only
 * says how to show it, where it lives, and which page it is on. A new setting is a line here and a
 * line there.
 */

import { KOKORO_VOICES, kokoroVoiceLabel } from '../../../shared/kokoro';
import type { Settings, SettingsPatch } from '../../../shared/settings';
import {
  defaultSettings,
  PROVIDERS,
  REASONING_EFFORTS,
  SPEECH_PROVIDERS,
  TRANSCRIPTION_PROVIDERS,
} from '../../../shared/settings';
import type { UploadTarget } from '../../../shared/uploads';
import { WHISPER_MODEL_MB, WHISPER_MODELS } from '../../../shared/whisper';
import { RENDERER_EXTENSIONS } from '../extensions';
import type { StepKind } from './quickstart';

/** Some of Inworld's built-in English voices; any other voice ID, cloned ones too, can be typed. */
const INWORLD_VOICES = [
  'Ashley',
  'Alex',
  'Craig',
  'Deborah',
  'Dennis',
  'Edward',
  'Elizabeth',
  'Julia',
  'Mark',
  'Olivia',
  'Ronald',
  'Sarah',
  'Theodore',
  'Timothy',
  'Wendy',
] as const;

/** Reads a setting as it would be saved: the draft where there is one, else the file. */
export type Getter = (path: readonly string[]) => unknown;

/**
 * When a field or section does anything. One that doesn't is still shown and can still be set,
 * so a key can go in before the provider is switched, but it is dimmed and says why.
 */
export interface Condition {
  /** The setting it hangs on; a card groups the fields tuning a switch by this. */
  path: readonly string[];
  /** The values that make it apply. */
  is: readonly unknown[];
  /**
   * In place of `is`, for a condition that depends on more than its own setting — such as whether
   * anything still uses the OpenAI key.
   */
  test?: (get: Getter) => boolean;
  /** Why it is dimmed, e.g. "Only used when Speaking uses inworld." */
  note: string;
  /**
   * Left out of its section, rather than dimmed, while it doesn't hold: for a choice between
   * providers, whose others' settings are only clutter. Search still finds them.
   */
  hide?: boolean;
}

interface FieldBase {
  /** Where the value lives, in both the settings and the patch. */
  path: readonly string[];
  label: string;
  /** One line under the label, saying what it does. */
  help?: string;
  /** A paragraph of its own under that, for what someone choosing it ought to know. */
  aside?: string;
  when?: Condition;
  /** A problem with a value the schema would take but that won't work, e.g. a malformed URL. */
  validate?: (value: unknown) => string | undefined;
}

export type Field = FieldBase &
  (
    | {
        kind: 'text';
        placeholder?: string;
        secret?: boolean;
        suggestions?: readonly string[];
      }
    | { kind: 'lines'; placeholder?: string }
    | { kind: 'flag' }
    | {
        kind: 'number';
        min: number;
        max: number;
        step?: number;
        unit?: string;
        /** Shown multiplied by this: 100 shows a fraction as a percentage. */
        scale?: number;
      }
    | {
        kind: 'choice';
        options: readonly string[];
        labels?: Readonly<Record<string, string>>;
      }
    /** A dropdown, for a choice with too many options to lay out side by side as `choice` does. */
    | { kind: 'select'; options: readonly string[]; labels?: Readonly<Record<string, string>> }
    | { kind: 'words'; placeholder?: string }
    /**
     * A dropdown of the machine's own audio inputs, by name. Not a `choice`: that is a segmented
     * row of every option, written down here, and the microphones are neither few nor known until
     * the window asks for them. Empty is "whatever the system calls the default".
     */
    | { kind: 'device' }
  );

/** Something built into a section that isn't a field in the file. */
export type Panel =
  | 'assistant-status'
  | 'bindings'
  | 'carrier-webhook'
  | 'edhm'
  | 'voice-test'
  | 'paste-bindings'
  | 'updates'
  | 'upload-log'
  | 'vr-bindings'
  /** The VR stick bindings worth having in flight, for the Quickstart page. */
  | 'vr-quick-bindings';

export interface Section {
  id: string;
  title: string;
  help?: string;
  when?: Condition;
  /** The upload this section configures, whose status is shown under the title. */
  upload?: UploadTarget;
  panel?: Panel;
  /** Where the panel goes: above the fields (the default), or under them. */
  panelAt?: 'start' | 'end';
  /**
   * `cards`: each switch a card of its own, with the numbers that tune it inside; for a page of
   * many on/off options.
   */
  layout?: 'cards';
  fields: Field[];
  /** Setups that will not work as they stand, said above the fields. */
  checks?: ((get: Getter) => string | undefined)[];
  /**
   * One step of the Quickstart page: numbered, with how it stands in a line, and a way on to the
   * page with the rest of its settings.
   */
  step?: { kind: StepKind; more: { page: PageId; section?: string } };
}

export const PAGE_IDS = [
  'quickstart',
  'interface',
  'assistant',
  'voice',
  'alerts',
  'uploads',
  'router',
  'vr',
  'about',
] as const;

export type PageId = (typeof PAGE_IDS)[number];

export interface Page {
  id: PageId;
  title: string;
  help: string;
  sections: Section[];
  /**
   * Made of fields that live on other pages, so search leaves it out rather than find each of
   * them twice.
   */
  guide?: boolean;
}

const ASSISTANT_ON: Condition = {
  path: ['assistant', 'enabled'],
  is: [true],
  note: 'The assistant is off.',
};

const SPEECH_ON: Condition = {
  path: ['voice', 'speech', 'enabled'],
  is: [true],
  note: 'Speaking is off (Voice).',
};

const TRANSCRIPTION_ON: Condition = {
  path: ['voice', 'transcription', 'enabled'],
  is: [true],
  note: 'Hearing you is off.',
};

const CARRIER_ON: Condition = {
  path: ['carrier_alert', 'enabled'],
  is: [true],
  note: 'The carrier alert is off.',
};

const CARRIER_WEBHOOK_ON: Condition = {
  path: ['carrier_webhook', 'enabled'],
  is: [true],
  note: 'Posting carrier jumps is off.',
};

const hasOpenAiKey = (get: Getter) => typeof get(['openai', 'api_key']) === 'string';

/** The OpenAI account: on the ChatGPT plan only hearing through OpenAI still needs it. */
const OPENAI_USED: Condition = {
  path: ['assistant', 'provider'],
  is: ['openai'],
  test: (get) =>
    get(['assistant', 'provider']) === 'openai' ||
    get(['voice', 'transcription', 'provider']) === 'openai',
  note: 'Not needed on the ChatGPT plan unless OpenAI is hearing you.',
  hide: true,
};

/** Who speaks: the provider chosen. */
export function speakingProvider(get: Getter): string | undefined {
  const chosen = get(['voice', 'speech', 'provider']);
  return typeof chosen === 'string' ? chosen : undefined;
}

function speechBy(provider: 'inworld' | 'kokoro' | 'wyoming', label: string): Condition {
  return {
    path: ['voice', 'speech', 'provider'],
    is: [provider],
    note: `Only used when answers are spoken by ${label}.`,
    hide: true,
  };
}

function hearingBy(provider: 'openai' | 'whisper' | 'wyoming', label: string): Condition {
  return {
    path: ['voice', 'transcription', 'provider'],
    is: [provider],
    note: `Only used when ${label} is hearing you.`,
    hide: true,
  };
}

/** A Wyoming address, as Home Assistant writes one. */
function wyomingUriProblem(value: unknown): string | undefined {
  return typeof value === 'string' && !/^(tcp:\/\/)?[^\s:/]+:\d+\/?$/u.test(value.trim())
    ? 'Write it as tcp://host:port, e.g. tcp://127.0.0.1:10200.'
    : undefined;
}

const BUILT_IN_PAGES: Page[] = [
  {
    id: 'interface',
    title: 'Interface',
    help: 'How EDSSI looks, and the EDHM mod it can install into the game.',
    sections: [
      {
        id: 'display',
        title: 'Display',
        fields: [
          {
            kind: 'number',
            path: ['display', 'zoom'],
            label: 'Zoom',
            min: 50,
            max: 300,
            step: 5,
            scale: 100,
            unit: '%',
            help: 'How large everything in the window is drawn.',
          },
          {
            kind: 'flag',
            path: ['display', 'match_hud_color'],
            label: 'Match HUD colour',
            help: 'Take EDSSI’s colour from the EDHM theme the game is using, when EDHM is installed.',
          },
        ],
      },
      {
        id: 'mission',
        title: 'Mission tab',
        fields: [
          {
            kind: 'number',
            path: ['mission', 'min_probe_value'],
            label: 'Worth a probe from',
            min: 0,
            max: 100_000_000,
            step: 100_000,
            unit: 'CR',
            help: 'Bodies worth less than this once mapped aren’t listed.',
          },
        ],
      },
      { id: 'edhm', title: 'EDHM', panel: 'edhm', fields: [] },
    ],
  },
  {
    id: 'assistant',
    title: 'Assistant',
    help: 'The voice and text assistant on the Comms tab: who answers, and how hard it thinks.',
    sections: [
      {
        id: 'model',
        title: 'Model',
        panel: 'assistant-status',
        checks: [
          (get) =>
            get(['assistant', 'enabled']) === true &&
            get(['assistant', 'provider']) === 'openai' &&
            !hasOpenAiKey(get)
              ? 'The openai provider needs an API key: fill it in under OpenAI account below, or switch to codex.'
              : undefined,
        ],
        fields: [
          { kind: 'flag', path: ['assistant', 'enabled'], label: 'Enabled' },
          {
            kind: 'choice',
            path: ['assistant', 'provider'],
            label: 'Provider',
            options: PROVIDERS,
            labels: { openai: 'API key', codex: 'ChatGPT plan' },
            help: 'An API key is billed per request; a ChatGPT plan uses your subscription.',
            aside:
              'Your API key and ChatGPT sign-in are stored only on this PC, and used only with OpenAI: never shared or uploaded anywhere else. The assistant only runs when you speak or type a question to it, or import screenshots, so nothing runs or is billed in the background.',
            when: ASSISTANT_ON,
          },
          { kind: 'text', path: ['assistant', 'model'], label: 'Model', when: ASSISTANT_ON },
          {
            kind: 'choice',
            path: ['assistant', 'reasoning_effort'],
            label: 'Reasoning',
            options: REASONING_EFFORTS,
            help: 'Higher thinks longer, answers slower and costs more.',
            when: ASSISTANT_ON,
          },
        ],
      },
      {
        id: 'ultrathink',
        title: 'Ultrathink',
        help: 'Any question that says “ultrathink” is answered by this model instead.',
        when: ASSISTANT_ON,
        fields: [
          { kind: 'text', path: ['assistant', 'ultrathink', 'model'], label: 'Model' },
          {
            kind: 'choice',
            path: ['assistant', 'ultrathink', 'reasoning_effort'],
            label: 'Reasoning',
            options: REASONING_EFFORTS,
          },
        ],
      },
      {
        id: 'behaviour',
        title: 'Behaviour',
        when: ASSISTANT_ON,
        fields: [
          {
            kind: 'flag',
            path: ['assistant', 'web_search'],
            label: 'Web search',
            help: 'Lets the assistant search the web. On an API key each search is billed.',
          },
          {
            kind: 'number',
            path: ['assistant', 'max_tool_rounds'],
            label: 'Tool rounds',
            min: 1,
            max: 50,
            help: 'How many rounds of tool calls one question may take before it is cut short.',
          },
          {
            kind: 'number',
            path: ['assistant', 'history_turns'],
            label: 'History',
            min: 1,
            max: 200,
            unit: 'exchanges',
            help: 'Older exchanges drop off, to keep questions quick and cheap.',
          },
          {
            kind: 'lines',
            path: ['assistant', 'instructions'],
            label: 'Your instructions',
            placeholder: 'How to address you, a callsign, house rules…',
            help: "Added after EDSSI's own instructions, and wins where they disagree.",
          },
        ],
      },
      {
        id: 'openai',
        title: 'OpenAI account',
        help: 'Hearing you through OpenAI needs a key even on a ChatGPT plan.',
        fields: [
          {
            kind: 'text',
            path: ['openai', 'api_key'],
            label: 'API key',
            secret: true,
            placeholder: 'sk-…',
            help: 'From platform.openai.com/api-keys.',
            when: OPENAI_USED,
          },
          {
            kind: 'text',
            path: ['openai', 'base_url'],
            label: 'Base URL',
            placeholder: 'OpenAI’s own',
            help: 'Only for an OpenAI-compatible gateway.',
            validate: validateUrl,
            when: OPENAI_USED,
          },
        ],
      },
    ],
  },
  {
    id: 'voice',
    title: 'Voice',
    help: 'Talking to the assistant, and how it talks back.',
    sections: [
      { id: 'push-to-talk', title: 'Push to talk', panel: 'bindings', fields: [] },
      {
        id: 'microphone',
        title: 'Microphone',
        fields: [
          {
            kind: 'flag',
            path: ['voice', 'hold_to_talk'],
            label: 'Hold to talk',
            help: 'Off means press once to start and again to send.',
          },
          {
            kind: 'device',
            path: ['voice', 'microphone'],
            label: 'Microphone',
            help: 'Which input to record from. The system default unless you pick one.',
          },
          {
            kind: 'flag',
            path: ['voice', 'keep_microphone_open'],
            label: 'Hold the mic open',
            help: 'Stops the first word being lost while the device starts. The mic light stays lit; nothing is recorded unless a binding is held.',
          },
          {
            kind: 'number',
            path: ['voice', 'max_recording_seconds'],
            label: 'Recording limit',
            min: 3,
            max: 300,
            unit: 's',
            help: 'Recording stops itself after this long.',
          },
        ],
      },
      {
        id: 'hearing',
        title: 'Hearing you',
        help: 'Speech to text: through OpenAI, by Whisper on this PC, or a Wyoming server.',
        checks: [
          (get) =>
            get(['voice', 'transcription', 'enabled']) === true &&
            get(['voice', 'transcription', 'provider']) === 'openai' &&
            !hasOpenAiKey(get)
              ? 'Needs the OpenAI API key (Assistant › OpenAI account).'
              : undefined,
        ],
        fields: [
          { kind: 'flag', path: ['voice', 'transcription', 'enabled'], label: 'Enabled' },
          {
            kind: 'choice',
            path: ['voice', 'transcription', 'provider'],
            label: 'Provider',
            options: TRANSCRIPTION_PROVIDERS,
            labels: { openai: 'OpenAI', whisper: 'Whisper', wyoming: 'Wyoming' },
            help: 'Whisper runs on this PC, free; it downloads itself and its model on first use.',
            when: TRANSCRIPTION_ON,
          },
          {
            kind: 'text',
            path: ['voice', 'transcription', 'model'],
            label: 'OpenAI model',
            when: hearingBy('openai', 'OpenAI'),
          },
          {
            kind: 'choice',
            path: ['whisper', 'model'],
            label: 'Whisper model',
            options: WHISPER_MODELS,
            help: `Bigger hears better and takes longer. ${WHISPER_MODELS.map((model) => `${model} ${WHISPER_MODEL_MB[model]} MB`).join(', ')}.`,
            when: hearingBy('whisper', 'Whisper'),
          },
          {
            kind: 'number',
            path: ['whisper', 'threads'],
            label: 'Whisper threads',
            min: 1,
            max: 64,
            step: 1,
            help: 'CPU threads it may use. More is quicker, and takes more from the game.',
            when: hearingBy('whisper', 'Whisper'),
          },
          {
            kind: 'text',
            path: ['wyoming', 'transcription_uri'],
            label: 'Wyoming server',
            placeholder: 'tcp://127.0.0.1:10300',
            help: 'A speech-to-text server, such as wyoming-faster-whisper.',
            when: hearingBy('wyoming', 'Wyoming'),
            validate: wyomingUriProblem,
          },
          {
            kind: 'text',
            path: ['voice', 'transcription', 'language'],
            label: 'Language',
            placeholder: 'work it out',
            help: 'Two letters, e.g. en. Setting it is faster and more accurate.',
            when: TRANSCRIPTION_ON,
            validate: (value) =>
              typeof value === 'string' && !/^[a-z]{2,3}$/i.test(value.trim())
                ? 'Use a two-letter code, such as en or de.'
                : undefined,
          },
          {
            kind: 'words',
            path: ['voice', 'transcription', 'keywords'],
            label: 'Keywords',
            placeholder: 'Add a name…',
            help: 'Names to spell the way the game does. Live systems and stations are added automatically.',
            // Wyoming's transcribe has nowhere to put them.
            when: {
              path: ['voice', 'transcription', 'provider'],
              is: ['openai', 'whisper'],
              note: 'Only used by OpenAI and Whisper.',
              hide: true,
            },
          },
        ],
      },
      {
        id: 'speaking',
        title: 'Speaking',
        panel: 'voice-test',
        panelAt: 'end',
        help: 'Answers read out loud, by Inworld, by Kokoro on this PC, or a Wyoming server.',
        checks: [
          (get) =>
            get(['voice', 'speech', 'enabled']) === true &&
            get(['voice', 'speech', 'provider']) === 'inworld' &&
            typeof get(['inworld', 'api_key']) !== 'string'
              ? 'Speaking by Inworld needs the Inworld API key below.'
              : undefined,
        ],
        fields: [
          { kind: 'flag', path: ['voice', 'speech', 'enabled'], label: 'Enabled' },
          {
            kind: 'choice',
            path: ['voice', 'speech', 'provider'],
            label: 'Provider',
            options: SPEECH_PROVIDERS,
            labels: { inworld: 'Inworld', kokoro: 'Kokoro', wyoming: 'Wyoming' },
            help: 'Kokoro runs on this PC, free; Inworld sounds the most natural, on a key of its own.',
            when: SPEECH_ON,
          },
          {
            kind: 'text',
            path: ['inworld', 'api_key'],
            label: 'Inworld API key',
            secret: true,
            help: 'From platform.inworld.ai → Settings → API Keys: the Base64 credentials.',
            when: speechBy('inworld', 'Inworld'),
          },
          {
            kind: 'text',
            path: ['inworld', 'model'],
            label: 'Inworld model',
            suggestions: ['inworld-tts-2', 'inworld-tts-2-flash'],
            help: 'inworld-tts-2 follows the Delivery instructions; the flash model is quicker.',
            when: speechBy('inworld', 'Inworld'),
          },
          {
            kind: 'text',
            path: ['inworld', 'voice'],
            label: 'Inworld voice',
            suggestions: INWORLD_VOICES,
            when: speechBy('inworld', 'Inworld'),
          },
          {
            kind: 'select',
            path: ['kokoro', 'voice'],
            label: 'Kokoro voice',
            options: KOKORO_VOICES,
            labels: Object.fromEntries(
              KOKORO_VOICES.map((voice) => [voice, kokoroVoiceLabel(voice)]),
            ),
            help: 'Graded A to F by Kokoro’s makers. Downloads 330 MB the first time it speaks.',
            when: speechBy('kokoro', 'Kokoro'),
            validate: (value) =>
              typeof value === 'string' && !(KOKORO_VOICES as readonly string[]).includes(value)
                ? 'Not one of Kokoro’s English voices.'
                : undefined,
          },
          {
            kind: 'text',
            path: ['wyoming', 'speech_uri'],
            label: 'Wyoming server',
            placeholder: 'tcp://127.0.0.1:10200',
            help: 'A text-to-speech server, such as wyoming-piper.',
            when: speechBy('wyoming', 'Wyoming'),
            validate: wyomingUriProblem,
          },
          {
            kind: 'text',
            path: ['wyoming', 'voice'],
            label: 'Wyoming voice',
            placeholder: 'the server’s default',
            help: 'As the server names it; Piper’s are like en_GB-alan-medium.',
            when: speechBy('wyoming', 'Wyoming'),
          },
          {
            kind: 'number',
            path: ['voice', 'speech', 'speed'],
            label: 'Speed',
            min: 0.5,
            max: 2,
            step: 0.05,
            unit: '×',
            help: '1 is the voice’s own pace. Inworld keeps it between 0.5 and 1.5.',
            // Wyoming's synthesize has no speed; a Piper voice's pace is set on the server.
            when: {
              path: ['voice', 'speech', 'provider'],
              is: ['inworld', 'kokoro'],
              note: 'Only used by Inworld and Kokoro.',
              hide: true,
            },
          },
          {
            kind: 'lines',
            path: ['voice', 'speech', 'instructions'],
            label: 'Delivery',
            help: 'How to read the answer out. Only Inworld’s inworld-tts-2 model follows it.',
            when: speechBy('inworld', 'Inworld'),
          },
        ],
      },
    ],
  },
  {
    id: 'alerts',
    title: 'Alerts',
    help: 'What EDSSI says without being asked.',
    sections: [
      {
        id: 'callouts',
        title: 'Callouts',
        layout: 'cards',
        help: 'Spoken as they happen.',
        when: SPEECH_ON,
        fields: [
          {
            kind: 'flag',
            path: ['voice', 'speech', 'exobiology_callouts'],
            label: 'Exobiology',
            help: 'After an FSS scan finds life: the body, its biological signals and their value.',
          },
          {
            kind: 'flag',
            path: ['voice', 'speech', 'personal_best_callouts'],
            label: 'Personal bests',
            help: 'When a scan beats your own record for its class, such as the largest water world.',
          },
          {
            kind: 'flag',
            path: ['voice', 'speech', 'probe_callouts'],
            label: 'Worth a probe',
            help: 'Once every body is found: how many are worth mapping, and their total once mapped.',
          },
          {
            kind: 'flag',
            path: ['voice', 'speech', 'route_callouts'],
            label: 'Route not in EDSM',
            help: 'When a route is plotted: how many of the systems on it EDSM has never heard of.',
          },
          {
            kind: 'flag',
            path: ['voice', 'speech', 'carrier_departure_callouts'],
            label: 'Carrier departure',
            help: 'A minute before your own carrier jumps, while you’re docked on it.',
          },
        ],
      },
      {
        id: 'flight',
        title: 'Flight alerts',
        layout: 'cards',
        help: 'Said once per system or body, never while docked.',
        fields: [
          {
            kind: 'flag',
            path: ['flight_alerts', 'low_fuel'],
            label: 'Low fuel',
            help: 'Names the nearest scoopable star, one on the route if it’s close.',
          },
          {
            kind: 'number',
            path: ['flight_alerts', 'low_fuel_fraction'],
            label: 'Low fuel below',
            min: 5,
            max: 95,
            step: 5,
            scale: 100,
            unit: '% of the tank',
            when: { path: ['flight_alerts', 'low_fuel'], is: [true], note: 'Low fuel is off.' },
          },
          {
            kind: 'flag',
            path: ['flight_alerts', 'unscoopable_next_jump'],
            label: 'Unscoopable next jump',
            help: 'When the next system’s star isn’t one of O, B, A, F, G, K or M.',
          },
          {
            kind: 'flag',
            path: ['flight_alerts', 'fuel_for_stretch'],
            label: 'Fuel for the stretch ahead',
            help: 'When a system targeted on the route starts a run of unscoopable stars the fuel in the tank won’t last through.',
          },
          {
            kind: 'flag',
            path: ['flight_alerts', 'high_gravity'],
            label: 'High gravity',
            help: 'On approaching a body, once it has been scanned.',
          },
          {
            kind: 'number',
            path: ['flight_alerts', 'high_gravity_threshold'],
            label: 'High gravity from',
            min: 0.1,
            max: 20,
            step: 0.1,
            unit: 'g',
            when: {
              path: ['flight_alerts', 'high_gravity'],
              is: [true],
              note: 'High gravity is off.',
            },
          },
        ],
      },
      {
        id: 'carrier',
        title: 'Carrier alert',
        layout: 'cards',
        help: 'After each jump, names fleet carriers Spansh knows of within reach.',
        fields: [
          { kind: 'flag', path: ['carrier_alert', 'enabled'], label: 'Enabled' },
          {
            kind: 'number',
            path: ['carrier_alert', 'jumps'],
            label: 'Range',
            min: 1,
            max: 500,
            unit: 'jumps',
            help: 'Jumps of the ship’s full range, as the crow flies.',
            when: CARRIER_ON,
          },
          {
            kind: 'number',
            path: ['carrier_alert', 'max_age_days'],
            label: 'Last seen within',
            min: 1,
            max: 3650,
            unit: 'days',
            help: 'Carriers move. One nobody has reported for longer is left out.',
            when: CARRIER_ON,
          },
          {
            kind: 'flag',
            path: ['carrier_alert', 'quiet_near_stations'],
            label: 'Quiet near stations',
            help: 'No alerts while a station with repairs is within range.',
            when: CARRIER_ON,
          },
          {
            kind: 'flag',
            path: ['carrier_alert', 'say_callsign'],
            label: 'Say callsign',
            help: 'Read out letters like X2J-19Z as well as the carrier’s name.',
            when: CARRIER_ON,
          },
        ],
      },
    ],
  },
  {
    id: 'uploads',
    title: 'Uploads',
    help: 'Sends the journal on as you play, so EDDI and EDMC needn’t run alongside.',
    sections: [
      {
        id: 'edsm',
        title: 'EDSM',
        help: 'Your flight log and discoveries, on edsm.net.',
        upload: 'edsm',
        fields: [
          { kind: 'flag', path: ['edsm', 'upload'], label: 'Upload' },
          {
            kind: 'text',
            path: ['edsm', 'commander_name'],
            label: 'Commander',
            placeholder: 'from the journal',
            help: 'As spelt on EDSM. Set, it also stops any other commander being sent.',
          },
          {
            kind: 'text',
            path: ['edsm', 'api_key'],
            label: 'API key',
            secret: true,
            help: 'On edsm.net: your account settings, then API key.',
          },
        ],
      },
      // No Inara section until Inara has whitelisted EDSSI: it answers no other application.
      {
        id: 'eddn',
        title: 'EDDN',
        help: 'Shares systems, stations, markets and carriers with Spansh, EDSM and other tools. No account: the commander name is hashed.',
        upload: 'eddn',
        fields: [{ kind: 'flag', path: ['eddn', 'upload'], label: 'Upload' }],
      },
      {
        id: 'carrier-webhook',
        title: 'Carrier jumps to Discord',
        help: 'Posts your carrier’s jumps, scheduled and cancelled, to a Discord channel, as the SWS Carrier Tracker EDMC plugin does.',
        panel: 'carrier-webhook',
        fields: [
          { kind: 'flag', path: ['carrier_webhook', 'enabled'], label: 'Post' },
          {
            kind: 'text',
            path: ['carrier_webhook', 'webhook_url'],
            label: 'Webhook URL',
            secret: true,
            placeholder: 'https://discord.com/api/webhooks/…',
            help: 'In Discord: the channel’s settings, then Integrations, then Webhooks.',
            validate: validateUrl,
            when: CARRIER_WEBHOOK_ON,
          },
          {
            kind: 'text',
            path: ['carrier_webhook', 'image_url'],
            label: 'Carrier image URL',
            help: 'Shown in every post, such as the carrier’s image on Inara.',
            validate: validateUrl,
            when: CARRIER_WEBHOOK_ON,
          },
          {
            kind: 'text',
            path: ['carrier_webhook', 'carrier_name'],
            label: 'Carrier name',
            placeholder: 'from the journal',
            when: CARRIER_WEBHOOK_ON,
          },
          {
            kind: 'text',
            path: ['carrier_webhook', 'carrier_serial'],
            label: 'Carrier serial (ID)',
            placeholder: 'from the journal',
            help: 'Its callsign, such as X2J-19Z.',
            when: CARRIER_WEBHOOK_ON,
          },
        ],
      },
      { id: 'upload-log', title: 'Upload log', panel: 'upload-log', fields: [] },
    ],
  },
  {
    id: 'router',
    title: 'Routes',
    help: 'Following a route from the stick.',
    sections: [{ id: 'paste', title: 'Paste', panel: 'paste-bindings', fields: [] }],
  },
  {
    id: 'vr',
    title: 'VR',
    help: 'Five panels of EDSSI hung around you as SteamVR overlays. A prototype: the panels are placed with the keys in ~/.edssi/vr-overlay.json.',
    sections: [
      {
        id: 'vr-cockpit',
        title: 'Cockpit',
        fields: [
          {
            kind: 'flag',
            path: ['vr', 'enabled'],
            label: 'Enabled',
            help: 'Runs the cockpit whenever SteamVR and Elite Dangerous are both running, and stops it when either closes.',
          },
        ],
      },
      { id: 'vr-bindings', title: 'Stick bindings', panel: 'vr-bindings', fields: [] },
      {
        id: 'presses',
        title: 'Presses',
        fields: [
          {
            kind: 'number',
            path: ['input', 'multi_click_ms'],
            label: 'Multi-click window',
            min: 100,
            max: 2000,
            step: 20,
            unit: 'ms',
            help: 'How long a control with two or three presses bound waits for the next one — and so how long one press of that same control takes to do anything. Raise it if a triple click comes out as a single and a double; lower it if one press feels slow.',
          },
        ],
      },
    ],
  },
  {
    id: 'about',
    title: 'About',
    help: 'The version of EDSSI running, its updates and what each one brought.',
    sections: [{ id: 'updates', title: 'Updates', panel: 'updates', fields: [] }],
  },
];

/** A field as another page defines it, so the two can't drift apart. */
function reuse(page: PageId, path: string, change: Partial<FieldBase> = {}): Field {
  const found = BUILT_IN_PAGES.find((candidate) => candidate.id === page)
    ?.sections.flatMap((section) => section.fields)
    .find((field) => field.path.join('.') === path);
  if (!found) throw new Error(`The ${page} page has no ${path}.`);
  return { ...found, ...change };
}

/**
 * Everything a new commander needs for the assistant to work, hear them, answer aloud and hang
 * in VR — and nothing else: each step's other settings are a link away.
 */
const QUICKSTART: Page = {
  id: 'quickstart',
  title: 'Quickstart',
  help: 'The few settings EDSSI needs to hear you, answer aloud and show up in VR. Everything else has a sensible default.',
  guide: true,
  sections: [
    {
      id: 'qs-assistant',
      title: 'The assistant',
      help: 'Who answers your questions: an OpenAI API key, billed per request, or your ChatGPT plan.',
      step: { kind: 'assistant', more: { page: 'assistant' } },
      fields: [
        reuse('assistant', 'assistant.provider'),
        reuse('assistant', 'openai.api_key', {
          help: 'From platform.openai.com/api-keys. Needed for the API key, and for hearing you through OpenAI.',
          when: OPENAI_USED,
        }),
      ],
    },
    {
      id: 'qs-hearing',
      title: 'Hearing you',
      help: 'Hold a key or stick button, say what you want, let go. Whisper runs on this PC, free; OpenAI uses the key above.',
      step: { kind: 'hearing', more: { page: 'voice', section: 'hearing' } },
      panel: 'bindings',
      fields: [
        reuse('voice', 'voice.microphone'),
        reuse('voice', 'voice.transcription.provider', {
          help: 'Whisper downloads itself (150 MB) the first time.',
        }),
        reuse('voice', 'whisper.model'),
        reuse('voice', 'wyoming.transcription_uri'),
      ],
    },
    {
      id: 'qs-speaking',
      title: 'Speaking',
      help: 'Answers read out loud. Kokoro runs on this PC, free; Inworld sounds the most natural, on a key of its own.',
      step: { kind: 'speaking', more: { page: 'voice', section: 'speaking' } },
      panel: 'voice-test',
      panelAt: 'end',
      fields: [
        reuse('voice', 'voice.speech.provider'),
        reuse('voice', 'kokoro.voice'),
        reuse('voice', 'inworld.api_key'),
        reuse('voice', 'wyoming.speech_uri'),
        reuse('voice', 'wyoming.voice'),
      ],
    },
    {
      id: 'qs-vr',
      title: 'VR cockpit',
      help: 'EDSSI’s panels hung around you in the headset, over the game.',
      step: { kind: 'vr', more: { page: 'vr' } },
      panel: 'vr-quick-bindings',
      panelAt: 'end',
      fields: [reuse('vr', 'vr.enabled')],
    },
  ],
};

/** Every page, with the sections extensions add at the end of theirs. */
export const PAGES: Page[] = [QUICKSTART, ...BUILT_IN_PAGES].map((page) => ({
  ...page,
  sections: [
    ...page.sections,
    ...RENDERER_EXTENSIONS.flatMap((extension) =>
      (extension.settingsSections ?? [])
        .filter((added) => added.page === page.id)
        .map((added) => added.section),
    ),
  ],
}));

function validateUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? undefined
      : 'Needs to start with https:// or http://.';
  } catch {
    return 'Not a web address.';
  }
}

export function fieldKey(field: Field): string {
  return field.path.join('.');
}

/** The value at a field's path. Everything the form renders is a scalar or a list of words. */
export function valueAt(settings: Settings, path: readonly string[]): unknown {
  let value: unknown = settings;
  for (const key of path) {
    if (typeof value !== 'object' || value === null) return undefined;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- walking a known shape
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** What a field is when the file doesn't set it. */
export function defaultAt(path: readonly string[]): unknown {
  return valueAt(defaultSettings(), path);
}

/**
 * A setting as it would be once saved: a draft of null means "cleared", which is the default. Empty
 * text is saved as null too, so it counts as the default here.
 */
export function effectiveValue(saved: unknown, path: readonly string[], draft?: unknown): unknown {
  const value = draft === undefined ? saved : draft;
  return value === null || value === '' ? defaultAt(path) : value;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
}

/** Whether a condition holds for the values as they would be saved. */
export function holds(condition: Condition | undefined, get: Getter): boolean {
  if (condition === undefined) return true;
  return condition.test ? condition.test(get) : condition.is.includes(get(condition.path));
}

/** A field its section leaves out as things stand: one whose condition hides it, not dims it. */
export function hidden(field: Field, get: Getter): boolean {
  return field.when?.hide === true && !holds(field.when, get);
}

/** What is wrong with a value, if anything: out of the schema's range, or failing the field's own check. */
export function problemWith(field: Field, value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (field.kind === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) return 'Not a number.';
    const scale = field.scale ?? 1;
    const shown = value * scale;
    // A little slack, as a scaled fraction isn't always exact.
    if (shown < field.min - 1e-9 || shown > field.max + 1e-9) {
      return `Between ${field.min} and ${field.max}${field.unit ? ` ${field.unit}` : ''}.`;
    }
  }
  return field.validate?.(value);
}

export interface Match {
  page: Page;
  section: Section;
  field: Field;
}

/** Every field that has all the words of `query` in its label, help, section, page or key. */
export function search(query: string, pages: readonly Page[] = PAGES): Match[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const matches: Match[] = [];
  for (const page of pages) {
    if (page.guide) continue;
    for (const section of page.sections) {
      for (const field of section.fields) {
        const haystack = [
          field.label,
          field.help,
          section.title,
          section.help,
          page.title,
          field.path.join(' '),
          field.path.join('.'),
        ]
          .join(' ')
          .toLowerCase()
          .replaceAll('_', ' ');
        if (words.every((word) => haystack.includes(word))) matches.push({ page, section, field });
      }
    }
  }
  return matches;
}

/** Where each field is, by its key, so an unsaved change can name its page. */
export function locate(key: string, pages: readonly Page[] = PAGES): Match | undefined {
  // A field's own page, not a guide that borrows it.
  for (const page of pages) {
    if (page.guide) continue;
    for (const section of page.sections) {
      const field = section.fields.find((candidate) => fieldKey(candidate) === key);
      if (field) return { page, section, field };
    }
  }
  return undefined;
}

/**
 * Builds the patch for one field. Only the branch the field lives in is created, so a save carries
 * nothing the commander didn't touch.
 */
export function patchFor(path: readonly string[], value: unknown): SettingsPatch {
  const patch: Record<string, unknown> = {};
  let branch = patch;
  for (const key of path.slice(0, -1)) {
    const next: Record<string, unknown> = {};
    branch[key] = next;
    branch = next;
  }
  branch[path.at(-1)!] = value;
  return patch;
}

/** Merges the patches of every field that changed into the one a save sends. */
export function mergePatches(patches: SettingsPatch[]): SettingsPatch {
  const merged: Record<string, unknown> = {};
  for (const patch of patches) merge(merged, patch);
  return merged;
}

function merge(target: Record<string, unknown>, source: object): void {
  for (const [key, value] of Object.entries(source)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const existing = target[key];
      const branch =
        existing !== null && typeof existing === 'object' && !Array.isArray(existing)
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a patch branch
            (existing as Record<string, unknown>)
          : {};
      target[key] = branch;
      merge(branch, value);
      continue;
    }
    target[key] = value;
  }
}
