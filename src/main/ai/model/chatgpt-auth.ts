/**
 * Signing in with a ChatGPT plan, the way the Codex CLI does: an OAuth device-less flow with PKCE
 * against auth.openai.com, which hands back a token the Codex backend accepts.
 *
 * The tokens are kept in EDSSI's own folder rather than `~/.codex/auth.json`, so signing in here
 * can't invalidate the Codex CLI's session (refresh tokens are rotated on use).
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';

import { chatGptTokenPath } from '../../config/paths';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CALLBACK_PORT = 1455;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;
const SCOPES = 'openid profile email offline_access';
const AUDIENCE = 'https://api.openai.com/v1';

/** Tokens last an hour; refresh a little early so a request doesn't expire mid-flight. */
const EXPIRY_MARGIN_MS = 60_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  /** Epoch milliseconds. */
  expires_at?: number;
}

export interface ChatGptToken {
  accessToken: string;
  /** Which ChatGPT account the token belongs to; the backend wants it in a header. */
  accountId?: string;
}

export class ChatGptAuth {
  readonly #path: string;
  #tokens: StoredTokens | undefined;
  #refreshing: Promise<StoredTokens> | undefined;

  constructor(path = chatGptTokenPath()) {
    this.#path = path;
    this.#tokens = read(path);
  }

  signedIn(): boolean {
    return this.#tokens !== undefined;
  }

  /** A usable access token, refreshed if it has run out. `force` refreshes a rejected one. */
  async token(force = false): Promise<ChatGptToken> {
    const tokens = this.#tokens;
    if (!tokens) throw new Error('Not signed in to ChatGPT.');
    if (!force && !expired(tokens))
      return { accessToken: tokens.access_token, accountId: accountId(tokens.access_token) };
    if (!tokens.refresh_token) throw new Error('The ChatGPT sign-in has expired; sign in again.');

    // One refresh at a time: a turn can have several requests in flight.
    this.#refreshing ??= this.#refresh(tokens.refresh_token).finally(() => {
      this.#refreshing = undefined;
    });
    const refreshed = await this.#refreshing;
    return { accessToken: refreshed.access_token, accountId: accountId(refreshed.access_token) };
  }

  async #refresh(refreshToken: string): Promise<StoredTokens> {
    const tokens = await post({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    });
    // The server only sends a new refresh token when it rotates one.
    tokens.refresh_token ??= refreshToken;
    this.#save(tokens);
    return tokens;
  }

  /**
   * Opens the ChatGPT sign-in page and waits for the browser to come back to a local callback.
   * `openUrl` is Electron's `shell.openExternal` in the app, and the browser in tests.
   */
  async signIn(openUrl: (url: string) => void | Promise<void>): Promise<void> {
    const verifier = randomBytes(64).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      audience: AUDIENCE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    const url = `${AUTHORIZE_URL}?${query.toString()}`;

    const waiting = waitForCode(state);
    try {
      await openUrl(url);
      const code = await waiting.code;
      this.#save(
        await post({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: verifier,
        }),
      );
    } finally {
      waiting.close();
    }
  }

  signOut(): void {
    this.#tokens = undefined;
    try {
      rmSync(this.#path, { force: true });
    } catch (error) {
      console.error('[chatgpt] failed to remove the sign-in', error);
    }
  }

  #save(tokens: StoredTokens): void {
    this.#tokens = tokens;
    try {
      mkdirSync(dirname(this.#path), { recursive: true });
      // The refresh token is as good as a password, so keep it to this user.
      writeFileSync(this.#path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    } catch (error) {
      console.error('[chatgpt] failed to save the sign-in', error);
    }
  }
}

function expired(tokens: StoredTokens): boolean {
  return tokens.expires_at === undefined || tokens.expires_at - EXPIRY_MARGIN_MS <= Date.now();
}

function read(path: string): StoredTokens | undefined {
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- checked below
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredTokens>;
    return typeof parsed.access_token === 'string'
      ? {
          access_token: parsed.access_token,
          refresh_token: parsed.refresh_token,
          expires_at: parsed.expires_at,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

async function post(form: Record<string, string>): Promise<StoredTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(`ChatGPT sign-in failed (${response.status}): ${describe(body)}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field is checked below
  const data = body as Record<string, unknown>;
  if (typeof data['access_token'] !== 'string') throw new Error('No token came back.');
  return {
    access_token: data['access_token'],
    refresh_token: typeof data['refresh_token'] === 'string' ? data['refresh_token'] : undefined,
    expires_at:
      typeof data['expires_in'] === 'number' ? Date.now() + data['expires_in'] * 1000 : undefined,
  };
}

function describe(body: unknown): string {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fields are checked below
  const data = body as Record<string, unknown> | undefined;
  const detail = data?.['error_description'] ?? data?.['error'];
  return typeof detail === 'string' ? detail : 'no reason given';
}

/** The account id is inside the token, as a claim the backend puts there. */
function accountId(accessToken: string): string | undefined {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JWT payload is an object
    const auth = (payload as Record<string, unknown>)['https://api.openai.com/auth'];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the claim is checked below
    const claims = auth as Record<string, unknown> | undefined;
    const id = claims?.['chatgpt_account_id'] ?? claims?.['account_id'];
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Serves the one callback the sign-in page redirects to, then stops listening. */
function waitForCode(state: string): { code: Promise<string>; close: () => void } {
  let settle: { resolve: (code: string) => void; reject: (error: Error) => void } | undefined;
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://localhost:${CALLBACK_PORT}`);
    const returned = url.searchParams.get('code');
    const failure = url.searchParams.get('error_description') ?? url.searchParams.get('error');

    if (returned && url.searchParams.get('state') === state) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<h2>EDSSI is signed in.</h2><p>You can close this tab.</p>');
      settle?.resolve(returned);
    } else if (failure) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<h2>Sign-in failed</h2><p>${failure}</p>`);
      settle?.reject(new Error(failure));
    } else {
      response.writeHead(404);
      response.end();
    }
  });

  server.on('error', (error) => settle?.reject(error));
  server.listen(CALLBACK_PORT, '127.0.0.1');
  const timer = setTimeout(
    () => settle?.reject(new Error('Timed out waiting for the browser.')),
    SIGN_IN_TIMEOUT_MS,
  );

  return {
    code,
    close: () => {
      clearTimeout(timer);
      server.close();
    },
  };
}
