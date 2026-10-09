import OpenAI, { AuthenticationError } from 'openai';

import type { ChatGptAuth } from './chatgpt-auth';
import { type ModelProvider, type ModelRequest, requestBody } from './provider';

/** The Codex backend: the same Responses API, behind a ChatGPT sign-in instead of an API key. */
const BASE_URL = 'https://chatgpt.com/backend-api/codex';

/**
 * Answers on the commander's ChatGPT plan. Requests are made with the SDK, pointed at the Codex
 * backend and carrying the headers it expects.
 */
export function createChatGptProvider(auth: ChatGptAuth): ModelProvider {
  const send = async (request: ModelRequest, signal: AbortSignal, refresh: boolean) => {
    const { accessToken, accountId } = await auth.token(refresh);
    const client = new OpenAI({
      apiKey: accessToken,
      baseURL: BASE_URL,
      defaultHeaders: {
        'OpenAI-Beta': 'responses=experimental',
        originator: 'codex_cli_rs',
        ...(accountId ? { 'ChatGPT-Account-ID': accountId } : {}),
      },
    });
    return client.responses.create(requestBody(request), { signal });
  };

  return {
    name: 'codex',
    problem: () =>
      auth.signedIn() ? undefined : 'Not signed in to ChatGPT. Sign in from the Comms tab.',
    async stream(request, signal) {
      try {
        return await send(request, signal, false);
      } catch (error) {
        // A token the backend won't take is worth one forced refresh before giving up.
        if (!(error instanceof AuthenticationError)) throw error;
        return send(request, signal, true);
      }
    },
  };
}
