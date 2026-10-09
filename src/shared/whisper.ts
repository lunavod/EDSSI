/**
 * The Whisper models EDSSI can run locally (whisper.cpp's ggml files), smallest first. The `.en`
 * ones only hear English, and hear it better for their size; `large-v3-turbo` hears any language.
 */
export const WHISPER_MODELS = [
  'tiny.en',
  'base.en',
  'small.en',
  'medium.en-q5_0',
  'large-v3-turbo-q5_0',
] as const;

export type WhisperModel = (typeof WHISPER_MODELS)[number];

/** Download sizes, in MB, for the settings screen. */
export const WHISPER_MODEL_MB: Record<WhisperModel, number> = {
  'tiny.en': 78,
  'base.en': 148,
  'small.en': 488,
  'medium.en-q5_0': 539,
  'large-v3-turbo-q5_0': 574,
};

/** Under half a second for a five-second question on four threads, and good with the name hints. */
export const DEFAULT_WHISPER_MODEL: WhisperModel = 'base.en';
