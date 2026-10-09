/**
 * What the Settings tab's "Try the voice" asks for, checked: it comes over IPC from a window, so
 * it is read as data, not trusted as a type.
 */

import type { VoicePreview } from '../../shared/assistant';

/** A preview is a line or two, not an essay. */
export const MAX_PREVIEW_CHARS = 500;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function field(value: object, key: string): unknown {
  const found: unknown = Reflect.get(value, key);
  return found;
}

export function readVoicePreview(value: unknown): VoicePreview | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const line = text(field(value, 'text'));
  const speed = field(value, 'speed');
  if (!line || typeof speed !== 'number' || !Number.isFinite(speed)) return undefined;
  const instructions = text(field(value, 'instructions'));
  const common = {
    text: line.slice(0, MAX_PREVIEW_CHARS),
    speed,
    ...(instructions ? { instructions } : {}),
  };
  const voice = text(field(value, 'voice'));
  switch (field(value, 'provider')) {
    case 'kokoro':
      return voice ? { ...common, provider: 'kokoro', voice } : undefined;
    case 'inworld': {
      const model = text(field(value, 'model'));
      const apiKey = text(field(value, 'apiKey'));
      if (!voice || !model) return undefined;
      return { ...common, provider: 'inworld', model, voice, ...(apiKey ? { apiKey } : {}) };
    }
    case 'wyoming': {
      const uri = text(field(value, 'uri'));
      if (!uri) return undefined;
      return { ...common, provider: 'wyoming', uri, ...(voice ? { voice } : {}) };
    }
    default:
      return undefined;
  }
}
