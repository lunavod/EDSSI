import OpenAI from 'openai';

import { type ModelProvider, type ModelRequest, requestBody } from './provider';

export interface OpenAiOptions {
  apiKey?: string;
  /** For an OpenAI-compatible gateway; the SDK's own default is used when unset. */
  baseUrl?: string;
}

/** Requests billed to an OpenAI API key. */
export function createOpenAiProvider(options: OpenAiOptions): ModelProvider {
  const client = options.apiKey
    ? new OpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl })
    : undefined;

  return {
    name: 'openai',
    problem: () => (client ? undefined : 'No OpenAI API key yet.'),
    async stream(request: ModelRequest, signal: AbortSignal) {
      if (!client) throw new Error('No OpenAI API key.');
      return client.responses.create(requestBody(request), { signal });
    },
  };
}

/** The same key drives transcription and speech, whichever provider answers questions. */
export function createAudioClient(options: OpenAiOptions): OpenAI | undefined {
  return options.apiKey
    ? new OpenAI({ apiKey: options.apiKey, baseURL: options.baseUrl })
    : undefined;
}
