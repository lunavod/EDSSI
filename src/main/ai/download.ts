/**
 * Fetches one file to disk, checking its SHA-256 before it takes its place: it is written beside
 * the target as `.part` and renamed only once whole and right, so a broken or interrupted download
 * never looks like a finished one.
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function download(
  url: string,
  path: string,
  sha256: string,
  onProgress?: (received: number, total: number | undefined) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok || !response.body) {
    throw new Error(`Downloading ${url} failed (${response.status}).`);
  }
  const length = Number(response.headers.get('content-length'));
  const total = Number.isFinite(length) && length > 0 ? length : undefined;

  await mkdir(dirname(path), { recursive: true });
  const part = `${path}.part`;
  const out = createWriteStream(part);
  const hash = createHash('sha256');
  let received = 0;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk))
        await new Promise<void>((resolve) => out.once('drain', () => resolve()));
      onProgress?.(received, total);
    }
    await new Promise<void>((resolve, reject) =>
      out.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );
    const actual = hash.digest('hex');
    if (actual !== sha256) {
      throw new Error(`${url} isn't the file expected (SHA-256 ${actual}).`);
    }
    await rename(part, path);
  } catch (error) {
    out.destroy();
    await rm(part, { force: true });
    throw error;
  }
}
