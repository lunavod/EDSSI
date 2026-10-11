/**
 * The shape of EDSSI's settings file (`~/.edssi/config.yaml`). Everything has a default, so the
 * file may be empty, partial, or missing entirely; only the API key really has to be filled in.
 *
 * YAML writes a key with no value as null (`api_key:`), which users do all the time, so every
 * field treats null like "not set" rather than failing.
 */

import { z } from 'zod';

import type { BoundAction, InputBinding, PressOptions } from './input';
import { DEFAULT_KOKORO_VOICE } from './kokoro';
import { type VrCommand, vrCommandFrom } from './vr';
import { DEFAULT_WHISPER_MODEL, WHISPER_MODELS } from './whisper';

/** Reasoning efforts the Responses API accepts. `none` turns thinking off on models that allow it. */
export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** `openai` bills an API key; `codex` uses a ChatGPT plan, as the Codex CLI does. */
export const PROVIDERS = ['openai', 'codex'] as const;

export type ProviderName = (typeof PROVIDERS)[number];

/** Who reads answers aloud: Kokoro on this machine, Inworld on its own key, or a Wyoming server. */
export const SPEECH_PROVIDERS = ['kokoro', 'inworld', 'wyoming'] as const;

export type SpeechProviderName = (typeof SPEECH_PROVIDERS)[number];

/** Who listens: OpenAI on the key, whisper.cpp on this machine, or a Wyoming server. */
export const TRANSCRIPTION_PROVIDERS = ['whisper', 'openai', 'wyoming'] as const;

export type TranscriptionProviderName = (typeof TRANSCRIPTION_PROVIDERS)[number];

/** Terms the transcriber would otherwise guess at. Live names (systems, stations) are added too. */
const DEFAULT_KEYWORDS = [
  'Elite Dangerous',
  'commander',
  'supercruise',
  'hyperspace',
  'frame shift drive',
  'fuel scoop',
  'interdiction',
  'Thargoid',
  'Guardian',
  'Universal Cartographics',
  'Vista Genomics',
  'exobiology',
  'Shinrarta Dezhra',
  'Colonia',
  'Sagittarius A*',
];

/** A key chord as a binding; a settings file may write one as a bare string. */
function asKey(accelerator: string): InputBinding {
  return { kind: 'key', accelerator };
}

/** What push-to-talk is bound to until the commander binds something else. */
const DEFAULT_BINDINGS: InputBinding[] = [{ kind: 'key', accelerator: 'Control+Alt+Space' }];

const DEFAULT_SPEECH_INSTRUCTIONS =
  'Calm, competent ship computer. Even tone, unhurried, no enthusiasm. Speak clearly and briskly.';

/** Trimmed text, where empty and null both mean "not set". */
function text() {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => value?.trim() || undefined);
}

function flag(fallback: boolean) {
  return z
    .union([z.boolean(), z.null()])
    .optional()
    .transform((value) => value ?? fallback);
}

function number(fallback: number, min: number, max: number) {
  return z
    .union([z.number().min(min).max(max), z.null()])
    .optional()
    .transform((value) => value ?? fallback);
}

// Typed by hand: the type inferred for it declares (`.d.ts`) as one that doesn't compile, which the
// mock UI's package ships.
function choice<T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number],
): z.ZodType<T[number], T[number] | null | undefined> {
  return z
    .union([z.enum(values), z.null()])
    .optional()
    .transform((value) => value ?? fallback);
}

function words(fallback: string[]) {
  return z
    .union([z.array(z.string()), z.null()])
    .optional()
    .transform((value) => value ?? fallback);
}

/** The `clicks` and `repeat` of a parsed binding, leaving out whatever the file didn't say. */
function how(value: { clicks?: number | null; repeat?: boolean | null }): PressOptions {
  return {
    ...(value.clicks === null || value.clicks === undefined ? {} : { clicks: value.clicks }),
    ...(value.repeat === null || value.repeat === undefined ? {} : { repeat: value.repeat }),
  };
}

/**
 * A binding as the settings file spells it: a key chord (`key: Control+Alt+Space`), or one control
 * on one stick — a button, a hat direction or an axis pushed one way, named by the usage the
 * device's own descriptor gives it. The byte-and-bit form EDSSI wrote before it could read a
 * descriptor is still understood, so bindings made then keep working.
 *
 * A bare string is taken as a key chord, so is a settings file written before EDSSI could bind
 * anything else.
 *
 * `clicks` and `repeat` come along with it: a binding is not only which control, but how it has to
 * be pressed. They mean nothing for push-to-talk, which is held rather than clicked, and are
 * simply ignored there.
 */
function boundAction() {
  const device = {
    device: text(),
    vendor_id: z.number().int().min(0),
    product_id: z.number().int().min(0),
    serial: text(),
  };
  const press = {
    /** 1, 2 or 3 presses in quick succession. */
    clicks: z.union([z.number().int().min(1).max(3), z.null()]).optional(),
    /** Keep running while the control is held; unset lets the command decide. */
    repeat: z.union([z.boolean(), z.null()]).optional(),
  };
  const key = z
    .object({ key: z.string().min(1), ...press })
    .transform((value): BoundAction => ({ binding: asKey(value.key.trim()), ...how(value) }));
  const button = z
    .object({
      ...device,
      report_id: z.union([z.number().int().min(0), z.null()]).optional(),
      byte: z.number().int().min(0),
      bit: z.number().int().min(0).max(7),
      ...press,
    })
    .transform((value): BoundAction => ({
      binding: {
        kind: 'button',
        vendorId: value.vendor_id,
        productId: value.product_id,
        serial: value.serial,
        product: value.device,
        reportId: value.report_id ?? 0,
        byte: value.byte,
        bit: value.bit,
      },
      ...how(value),
    }));
  const control = z
    .object({
      ...device,
      usage_page: z.number().int().min(0),
      usage: z.number().int().min(0),
      mode: z.enum(['button', 'hat', 'axis']),
      value: z.union([z.number().int().min(0), z.null()]).optional(),
      direction: z.union([z.enum(['low', 'high']), z.null()]).optional(),
      ...press,
    })
    .transform((value): BoundAction => ({
      binding: {
        kind: 'control',
        vendorId: value.vendor_id,
        productId: value.product_id,
        serial: value.serial,
        product: value.device,
        usagePage: value.usage_page,
        usage: value.usage,
        mode: value.mode,
        ...(value.value === null || value.value === undefined ? {} : { value: value.value }),
        ...(value.direction ? { direction: value.direction } : {}),
      },
      ...how(value),
    }));

  return z.union([
    z
      .string()
      .min(1)
      .transform((accelerator): BoundAction => ({ binding: asKey(accelerator) })),
    control,
    button,
    key,
  ]);
}

/** One binding or a list of them, which is how every binding field in the file may be written. */
function actionList() {
  const one = boundAction();
  return z
    .union([z.array(one), one])
    .transform((value) => (Array.isArray(value) ? value : [value]));
}

/**
 * Push-to-talk bindings: any number of key chords and stick controls, and holding any of them
 * opens the microphone. Bind them on the settings screen rather than by hand — a control is
 * learnt by moving it, which is neither a number to guess at nor a name to look up.
 */
function bindings(fallback: InputBinding[]) {
  return z
    .union([actionList(), z.null()])
    .optional()
    .transform((value) =>
      value === undefined || value === null ? fallback : value.map((action) => action.binding),
    );
}

/** A list of bindings and how each is pressed; none bound unless the file says otherwise. */
function actions() {
  return z
    .union([actionList(), z.null()])
    .optional()
    .transform((value): BoundAction[] => value ?? []);
}

/**
 * `vr.bindings`: which controls run which command of the VR cockpit, keyed by the command's name.
 *
 * The cockpit's keys live in `~/.edssi/vr-overlay.json`, because a commander in a headset can't be
 * shown a settings screen and no two keyboards agree on which keys exist. Sticks are the other
 * way round: a stick button has no name to write down, so it has to be bound by pressing it —
 * which is a settings screen, and so the file the settings screen writes.
 *
 * A command may be spelt as EDSSI writes it (`scrollUp`) or as a YAML file looks like it should
 * (`scroll_up`); both are the same command. Anything that isn't a command at all is left out
 * rather than rejected, so one typo doesn't cost the commander the rest of their file.
 */
function vrBindings() {
  return z
    .union([z.record(z.string(), z.union([actionList(), z.null()])), z.null()])
    .optional()
    .transform((value) => {
      const bound: Partial<Record<VrCommand, BoundAction[]>> = {};
      if (value === undefined || value === null) return bound;
      for (const [name, actions] of Object.entries(value)) {
        const command = vrCommandFrom(name);
        if (command === undefined) {
          console.error(`[settings] vr.bindings: "${name}" is not a cockpit command`);
          continue;
        }
        if (actions === null || actions.length === 0) continue;
        bound[command] = [...(bound[command] ?? []), ...actions];
      }

      return bound;
    });
}

/** A section of the file: missing or null means "all defaults", so its fields are parsed anyway. */
function section<T extends z.ZodRawShape>(shape: T) {
  return z.preprocess((value) => value ?? {}, z.object(shape));
}

export const SettingsSchema = z.object({
  display: section({
    /** How large EDSSI's window draws everything; 1 is 100%. */
    zoom: number(1, 0.5, 3),
    /** Take EDSSI's colour from the EDHM theme in use, when there is one. */
    match_hud_color: flag(true),
  }),
  openai: section({
    /** Platform API key. Listening needs one even when the assistant runs on a ChatGPT plan. */
    api_key: text(),
    /** For an OpenAI-compatible gateway; leave unset for OpenAI itself. */
    base_url: text(),
  }),
  /** Inworld's voices, for speech when `voice.speech.provider` picks Inworld. */
  inworld: section({
    /** From platform.inworld.ai → Settings → API Keys: the Base64 credentials. */
    api_key: text(),
    /** `inworld-tts-2` follows the delivery instructions; `inworld-tts-2-flash` is quicker. */
    model: text().transform((value) => value ?? 'inworld-tts-2'),
    voice: text().transform((value) => value ?? 'Ashley'),
  }),
  /** Kokoro, which speaks on this machine, for when `voice.speech.provider` picks it. */
  kokoro: section({
    /** One of `KOKORO_VOICES`: `af_heart`, `bf_emma`, `am_michael`… */
    voice: text().transform((value) => value ?? DEFAULT_KOKORO_VOICE),
  }),
  /** whisper.cpp, which listens on this machine, for when `voice.transcription.provider` picks it. */
  whisper: section({
    model: choice(WHISPER_MODELS, DEFAULT_WHISPER_MODEL),
    /** CPU threads it may use while transcribing; more is quicker, and takes more from the game. */
    threads: number(4, 1, 64),
  }),
  /**
   * Wyoming servers, as Home Assistant's voice uses (wyoming-piper, wyoming-faster-whisper…), for
   * when a provider picks Wyoming. Addresses are written `tcp://host:port`.
   */
  wyoming: section({
    speech_uri: text().transform((value) => value ?? 'tcp://127.0.0.1:10200'),
    /** Unset: the server's own default voice. */
    voice: text(),
    transcription_uri: text().transform((value) => value ?? 'tcp://127.0.0.1:10300'),
  }),
  assistant: section({
    enabled: flag(true),
    provider: choice(PROVIDERS, 'openai'),
    model: text().transform((value) => value ?? 'gpt-5.6-terra'),
    reasoning_effort: choice(REASONING_EFFORTS, 'medium'),
    /** Takes over from the two above for any question that says "ultrathink". */
    ultrathink: section({
      model: text().transform((value) => value ?? 'gpt-5.6-terra'),
      reasoning_effort: choice(REASONING_EFFORTS, 'high'),
    }),
    /** How many rounds of tool calls one question may take before the turn is cut short. */
    max_tool_rounds: number(8, 1, 50),
    /** Exchanges kept in the conversation; older ones drop off to keep prompts small. */
    history_turns: number(12, 1, 200),
    /** Lets the model search the web on the provider's side. Billed per search on an API key. */
    web_search: flag(true),
    /** Appended to EDSSI's own instructions: persona, callsign, house rules. */
    instructions: text(),
  }),
  voice: section({
    /**
     * What opens the microphone, from anywhere — including while the game has focus. Any number of
     * key chords and stick buttons; an empty list turns push-to-talk off. Bind them on the
     * settings screen rather than by hand: a button is a bit position, not something to guess at.
     */
    push_to_talk: bindings(DEFAULT_BINDINGS),
    /**
     * Hold a binding to talk, and let go to send. When false a press starts recording and another
     * press sends it, which is how EDSSI worked before it could see a key being released.
     */
    hold_to_talk: flag(true),
    /** Recording stops itself after this long, in case the key is pressed by accident. */
    max_recording_seconds: number(30, 3, 300),
    /**
     * Hold the microphone open between questions. Opening it takes long enough that the first word
     * of a question is lost without this; the cost is that the microphone indicator stays lit
     * while EDSSI runs. Nothing is recorded or sent except while a binding is held.
     */
    keep_microphone_open: flag(true),
    /**
     * Which microphone to record from, by the name Windows gives it — unset uses whatever the
     * system calls the default. The name rather than the browser's `deviceId`, which is an opaque
     * per-origin hash that means nothing in a hand-edited file and changes when storage is
     * cleared; EDSSI looks the name up when it opens the device. Matching ignores case, the first
     * of two identically named devices wins, and one that isn't plugged in falls back to the
     * default rather than failing to record. Pick it on the settings screen.
     */
    microphone: text(),
    transcription: section({
      enabled: flag(true),
      provider: choice(TRANSCRIPTION_PROVIDERS, 'whisper'),
      /** OpenAI's model; whisper.cpp's is under `whisper`. */
      model: text().transform((value) => value ?? 'gpt-transcribe'),
      /** ISO-639-1, e.g. `en`. Unset lets the model work it out, which is slower and less exact. */
      language: text(),
      keywords: words(DEFAULT_KEYWORDS),
    }),
    speech: section({
      enabled: flag(true),
      provider: choice(SPEECH_PROVIDERS, 'kokoro'),
      /** How to deliver the words; only Inworld's `inworld-tts-2` follows it. */
      instructions: text().transform((value) => value ?? DEFAULT_SPEECH_INSTRUCTIONS),
      /** 1 is the voice's own pace. Inworld keeps it between 0.5 and 1.5, Kokoro to 2. */
      speed: number(1, 0.25, 4),
      /** Reads out each body the FSS finds life on: its signals and what they could pay. */
      exobiology_callouts: flag(true),
      /** Says when a scan beats one of the commander's own records for its class. */
      personal_best_callouts: flag(true),
      /** Once the FSS has found every body: how many are worth mapping, and what they come to. */
      probe_callouts: flag(true),
      /** When a route is plotted: how many of the systems on it EDSM has never heard of. */
      route_callouts: flag(true),
      /** A minute before the commander's own carrier jumps, while docked on it. */
      carrier_departure_callouts: flag(true),
    }),
  }),
  /** Sends the journal to EDSM as it is written, the way EDDI and EDMC do. Needs the key below. */
  edsm: section({
    upload: flag(true),
    /** As spelt on the EDSM account. Unset means the journal's; another commander isn't sent. */
    commander_name: text(),
    /** From edsm.net → Settings → API key. */
    api_key: text(),
  }),
  /** Sends the commander's progress to Inara: travel, ranks, ship, missions, inventory. */
  inara: section({
    upload: flag(true),
    /** Personal key, from inara.cz → Settings → Inara API. */
    api_key: text(),
  }),
  /**
   * Sends what every player could see (systems, bodies, stations, markets, carriers) to EDDN, which
   * passes it on to Spansh, EDSM, Inara and the rest. No account: the commander name is hashed.
   */
  eddn: section({
    upload: flag(true),
  }),
  /**
   * After each jump, looks on Spansh for fleet carriers within reach and says which ones are new:
   * somewhere to repair, refuel or restock far from any station.
   */
  carrier_alert: section({
    enabled: flag(true),
    /** How far to look, in jumps of the current ship's full range. */
    jumps: number(10, 1, 500),
    /** A carrier Spansh hasn't heard about for longer than this has probably moved on. */
    max_age_days: number(60, 1, 3650),
    /** Stay quiet while a station with repairs is within reach, as in the bubble or Colonia. */
    quiet_near_stations: flag(true),
    /** Read out a carrier's callsign (e.g. X2J-19Z) as well as its name. */
    say_callsign: flag(false),
  }),
  /**
   * Posts the commander's carrier jumps (scheduled and cancelled) to a Discord channel, as the SWS
   * Carrier Tracker EDMC plugin does. Idle until the webhook is filled in.
   */
  carrier_webhook: section({
    enabled: flag(true),
    /** The channel's webhook: Discord's channel settings, then Integrations, then Webhooks. */
    webhook_url: text(),
    /** A picture shown in every post, such as the carrier's image on Inara. */
    image_url: text(),
    /** Unset: the carrier's name from the journal. */
    carrier_name: text(),
    /** The carrier's ID, e.g. X2J-19Z. Unset: its callsign from the journal. */
    carrier_serial: text(),
  }),
  /** The Mission tab. */
  mission: section({
    /** Bodies worth less than this once mapped, in credits, aren't listed as worth a probe. */
    min_probe_value: number(1_000_000, 0, 100_000_000),
  }),
  /** Keys and stick controls, wherever they are bound. */
  input: section({
    /**
     * How long a control with two or three presses bound waits to see whether another is coming,
     * in milliseconds. It is also what a single click on that same control costs, so it is worth
     * no more than it has to be — but a stiff stick button is slower to tap twice than a mouse,
     * and a triple click that outruns this window is read as a single and a double instead.
     */
    multi_click_ms: number(280, 100, 2000),
    /**
     * Controls that press Ctrl+V in the game, for pasting the next system of a route into the
     * galaxy map's search without reaching for the keyboard. Each may ask for two or three presses,
     * so a button that already does something can paste on a double click. Bind them on the
     * settings screen.
     */
    paste: actions(),
  }),
  /**
   * The VR cockpit (a prototype). Where the panels hang and which keys move them are in
   * `~/.edssi/vr-overlay.json`; the stick bindings live here.
   */
  vr: section({
    /** Run the cockpit, while SteamVR and the game are both running. */
    enabled: flag(false),
    bindings: vrBindings(),
  }),
  /** Warnings in flight, each said once per system or body, and never while docked. */
  flight_alerts: section({
    /** Name the nearest scoopable star when the main tank runs low. */
    low_fuel: flag(true),
    /** Share of the main tank, 0–1, below which fuel counts as low. */
    low_fuel_fraction: number(0.25, 0.05, 0.95),
    /** Warn when the next system targeted has no star a fuel scoop works on. */
    unscoopable_next_jump: flag(true),
    /**
     * Warn when a system targeted on the route starts a run of unscoopable stars the fuel in the
     * tank won't last through, to the next scoopable one.
     */
    fuel_for_stretch: flag(true),
    /** Warn on approaching a body whose gravity makes landing dangerous. */
    high_gravity: flag(true),
    /** In g. Landings start going wrong around 2.5. */
    high_gravity_threshold: number(2.5, 0.1, 20),
  }),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type DisplaySettings = Settings['display'];
export type InworldSettings = Settings['inworld'];
export type KokoroSettings = Settings['kokoro'];
export type WhisperSettings = Settings['whisper'];
export type WyomingSettings = Settings['wyoming'];
export type AssistantSettings = Settings['assistant'];
export type VoiceSettings = Settings['voice'];
export type EdsmSettings = Settings['edsm'];
export type InaraSettings = Settings['inara'];
export type EddnSettings = Settings['eddn'];
export type CarrierAlertSettings = Settings['carrier_alert'];
export type CarrierWebhookSettings = Settings['carrier_webhook'];
export type FlightAlertSettings = Settings['flight_alerts'];
export type MissionSettings = Settings['mission'];
export type VrSettings = Settings['vr'];
export type InputSettings = Settings['input'];

/** What EDSSI runs on when there is no settings file at all. */
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/**
 * A set of changes to write back to the settings file. Every field is optional, so the settings
 * screen sends only what it changed; null clears a field back to its default.
 */
export type SettingsPatch = Patchable<Settings>;

type Patchable<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? Patchable<T[K]>
      : T[K] | null;
};

/** A binding as the settings file spells it. Undefined fields are left out when it is written. */
export function bindingToConfig(binding: InputBinding): Record<string, unknown> {
  if (binding.kind === 'key') return { key: binding.accelerator };
  const device = {
    device: binding.product,
    vendor_id: binding.vendorId,
    product_id: binding.productId,
    ...(binding.serial ? { serial: binding.serial } : {}),
  };
  if (binding.kind === 'control') {
    return {
      ...device,
      usage_page: binding.usagePage,
      usage: binding.usage,
      mode: binding.mode,
      ...(binding.value === undefined ? {} : { value: binding.value }),
      ...(binding.direction ? { direction: binding.direction } : {}),
    };
  }

  return {
    ...device,
    ...(binding.reportId ? { report_id: binding.reportId } : {}),
    byte: binding.byte,
    bit: binding.bit,
  };
}

/** A binding and how it is pressed, as the file spells it. */
export function actionToConfig(action: BoundAction): Record<string, unknown> {
  return {
    ...bindingToConfig(action.binding),
    ...(action.clicks !== undefined && action.clicks > 1 ? { clicks: action.clicks } : {}),
    ...(action.repeat === undefined ? {} : { repeat: action.repeat }),
  };
}

export interface ParsedSettings {
  settings: Settings;
  /** Why the file was rejected, for the UI and the log; the defaults are used in its place. */
  problem?: string;
}

/**
 * The field types the schema above is built from, for an extension's own sections: each treats
 * null as "not set" and falls back to its default.
 */
export const settingTypes = { section, text, flag, number, choice, words };

/** Sections of the file that extensions add (`src/main/extensions.ts`), by key. */
const extensionSections = new Map<string, z.ZodType>();

/** Adds an extension's sections to the file, each parsed by its own schema. */
export function registerSettingsSections(sections: Readonly<Record<string, z.ZodType>>): void {
  for (const [key, schema] of Object.entries(sections)) {
    if (key in SettingsSchema.shape) throw new Error(`The settings file already has ${key}.`);
    extensionSections.set(key, schema);
  }
  defaults = undefined;
}

function fullSchema(): z.ZodType<Settings> {
  if (extensionSections.size === 0) return SettingsSchema;
  const extended = SettingsSchema.extend(Object.fromEntries(extensionSections));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the sections only add keys
  return extended as unknown as z.ZodType<Settings>;
}

let defaults: Settings | undefined;

/** The defaults, the sections extensions add included. */
export function defaultSettings(): Settings {
  defaults ??= extensionSections.size === 0 ? DEFAULT_SETTINGS : fullSchema().parse({});
  return defaults;
}

/**
 * An extension's section of the parsed settings. `schema` gives its type, and its defaults where
 * the section wasn't registered on this side.
 */
export function extensionSettings<S extends z.ZodType>(
  settings: Settings,
  key: string,
  schema: S,
): z.output<S> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- extra keys ride on the object
  const value = (settings as unknown as Record<string, unknown>)[key];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- parsed by this schema already
  return value === undefined ? schema.parse(undefined) : (value as z.output<S>);
}

/** Never throws: a file EDSSI can't make sense of falls back to the defaults with a problem. */
export function parseSettings(raw: unknown): ParsedSettings {
  if (raw === undefined || raw === null) return { settings: defaultSettings() };
  const result = fullSchema().safeParse(withoutAutoSpeech(raw));
  return result.success
    ? { settings: result.data }
    : { settings: defaultSettings(), problem: z.prettifyError(result.error) };
}

/**
 * A file from before `auto` was dropped from the speaking providers, read as what it came to:
 * Inworld once it had a key, Kokoro until then.
 */
function withoutAutoSpeech(raw: unknown): unknown {
  const root = asRecord(raw);
  const voice = asRecord(root?.['voice']);
  const speech = asRecord(voice?.['speech']);
  if (!root || !voice || speech?.['provider'] !== 'auto') return raw;
  const key = asRecord(root['inworld'])?.['api_key'];
  const provider = typeof key === 'string' && key.trim() ? 'inworld' : 'kokoro';
  return { ...root, voice: { ...voice, speech: { ...speech, provider } } };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a parsed YAML mapping
  return value as Record<string, unknown>;
}

/** Written the first time EDSSI starts without a settings file, to fill the key in. */
export const SETTINGS_TEMPLATE = `# EDSSI settings. Saved changes take effect straight away — no restart.
# Every key below is optional; the values shown are the defaults.

display:
  # How large everything in the window is drawn: 1 is 100%, 1.25 is 125%. From 0.5 to 3.
  zoom: 1
  # Take EDSSI's colour from the EDHM theme the game is using, when EDHM is installed.
  match_hud_color: true

openai:
  # https://platform.openai.com/api-keys — needed for listening even on a ChatGPT plan.
  api_key:

# Speech from Inworld, whose voices are the most natural. Used when voice.speech.provider is
# inworld.
inworld:
  # https://platform.inworld.ai → Settings → API Keys. Copy the "Base64 credentials".
  api_key:
  # inworld-tts-2 follows the instructions under voice.speech; inworld-tts-2-flash is quicker.
  model: inworld-tts-2
  voice: Ashley

# Kokoro, which speaks on this PC: no key, and no network once its voice (330 MB) is downloaded,
# which happens the first time it's used. Used when voice.speech.provider is kokoro.
kokoro:
  # a = American, b = British; f = a woman, m = a man. af_heart, af_bella, bf_emma, bf_isabella,
  # am_michael, am_fenrir, bm_george, bm_fable and more.
  voice: af_heart

# whisper.cpp, which listens on this PC: no key, and no network once it and its model are
# downloaded, the first time it's used. Used when voice.transcription.provider is whisper.
whisper:
  # tiny.en, base.en, small.en, medium.en-q5_0 or large-v3-turbo-q5_0 (the only one for languages
  # other than English). Bigger hears better, and takes longer.
  model: base.en
  threads: 4

# Wyoming servers, as Home Assistant's voice uses: wyoming-piper to speak, wyoming-faster-whisper to
# listen. Used when a provider under voice is wyoming.
wyoming:
  speech_uri: tcp://127.0.0.1:10200
  # Unset uses the server's default voice; Piper's are named like en_GB-alan-medium.
  voice:
  transcription_uri: tcp://127.0.0.1:10300

assistant:
  enabled: true
  # openai: pay per request with the key above.
  # codex: your ChatGPT plan, after signing in from the Comms tab.
  provider: openai
  model: gpt-5.6-terra
  # none, minimal, low, medium, high, xhigh or max. Higher thinks longer and costs more.
  reasoning_effort: medium
  # Say "ultrathink" in a question to have that one answered by this model, thinking this hard.
  ultrathink:
    model: gpt-5.6-terra
    reasoning_effort: high
  # Lets the assistant search the web. On an API key each search is billed.
  web_search: true
  # Added to EDSSI's own instructions, e.g. how to address you.
  instructions:

voice:
  # Hold to talk, let go to send. Set to false to press once to start and again to send.
  hold_to_talk: true
  # Keeps the microphone open between questions so the first word isn't lost while the device
  # starts. Nothing is recorded unless a binding is held; set false to close it after each question.
  keep_microphone_open: true
  # Which microphone to record from, by the name Windows gives it; unset uses the system default.
  # Pick it on the Settings tab — the names come from the device list, and one that isn't plugged
  # in falls back to the default rather than failing to record.
  # microphone: Headset Microphone (Arctis 7)
  # What opens the microphone, from anywhere — even while the game has focus. Bind stick buttons
  # on the Settings tab: a button is a bit position in the device's report, not a number to guess.
  push_to_talk:
    - key: Control+Alt+Space
  transcription:
    enabled: true
    # whisper (on this PC), openai (with the key above) or wyoming.
    provider: whisper
    # OpenAI's model.
    model: gpt-transcribe
    # Setting the language makes transcription faster and more accurate.
    language: en
  speech:
    enabled: true
    # kokoro (on this PC), inworld (with its key above) or wyoming.
    provider: kokoro
    # 1 is the voice's own pace; Inworld keeps between 0.5 and 1.5, Kokoro up to 2.
    speed: 1
    instructions: ${JSON.stringify(DEFAULT_SPEECH_INSTRUCTIONS)}
    # Read out each body the FSS finds life on, with its signals and what they could pay.
    exobiology_callouts: true
    # Say when a scan beats your own record for its class: the largest water world, and so on.
    personal_best_callouts: true
    # Once every body is found, say how many are worth mapping (mission.min_probe_value) and their
    # total value once mapped.
    probe_callouts: true
    # When a route is plotted, say how many of its systems aren't in EDSM yet.
    route_callouts: true
    # A minute before your own carrier jumps, while you're docked on it.
    carrier_departure_callouts: true

# The VR cockpit (a prototype). While enabled, it runs whenever SteamVR and the game are both
# running. Where the panels hang, and the keys that move them, are in ~/.edssi/vr-overlay.json — a
# headset leaves no way to show a settings screen. Stick buttons are the other way round: bind them
# on the Settings tab, by pressing them, since a control has no name to type. They look like this:
vr:
  enabled: false
  # bindings:
  #   toggle:
  #     - device: VKBsim Gladiator EVO R
  #       vendor_id: 8989
  #       product_id: 512
  #       usage_page: 9
  #       usage: 35
  #       mode: button
  #   scroll_up:
  #     - device: VKBsim Gladiator EVO R
  #       vendor_id: 8989
  #       product_id: 512
  #       usage_page: 1
  #       usage: 52
  #       mode: axis
  #       direction: high

# Uploads, so EDDI or EDMC needn't run alongside. EDSM and Inara start once their key is filled in.
edsm:
  upload: true
  # Leave empty to use the commander in the journal.
  commander_name:
  # On edsm.net: your account's settings, then API key.
  api_key:

inara:
  upload: true
  # On inara.cz: Settings, then Inara API. The personal key, not an application one.
  api_key:

# EDDN passes what you see (systems, stations, markets, carriers) on to Spansh, EDSM and others.
eddn:
  upload: true

# After each jump, says which fleet carriers Spansh knows of within reach.
carrier_alert:
  enabled: true
  # How far to look, in jumps of your ship's full range.
  jumps: 10
  # Leave out carriers nobody has reported for longer than this.
  max_age_days: 60
  # Stay quiet while a station with repairs is within reach.
  quiet_near_stations: true
  # Also read out the callsign (e.g. X2J-19Z), not just the carrier's name.
  say_callsign: false

# Posts your carrier's jumps, scheduled and cancelled, to a Discord channel, as the SWS Carrier
# Tracker EDMC plugin does. Idle until webhook_url is filled in.
carrier_webhook:
  enabled: true
  # The channel's webhook: channel settings, then Integrations, then Webhooks.
  webhook_url:
  # A picture shown in every post, such as the carrier's image on Inara.
  image_url:
  # Leave empty to use the carrier's name and callsign from the journal.
  carrier_name:
  carrier_serial:

mission:
  # Leave out bodies worth less than this once mapped, in credits, from "Worth a probe".
  min_probe_value: 1000000

# Warnings in flight, each said once per system or body, and never while docked.
flight_alerts:
  # Name the nearest scoopable star when the main tank runs low.
  low_fuel: true
  # Share of the main tank below which fuel is low: 0.25 is a quarter.
  low_fuel_fraction: 0.25
  # Warn when the next system targeted has no star a fuel scoop works on.
  unscoopable_next_jump: true
  # Warn when a system targeted on the route starts a run of unscoopable stars that the fuel in
  # the tank won't last through.
  fuel_for_stretch: true
  # Warn on approaching a body at or above this gravity, in g.
  high_gravity: true
  high_gravity_threshold: 2.5
`;
