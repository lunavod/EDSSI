/**
 * Announces a release on Discord, from the release workflow (.github/workflows/release.yml), once
 * the installer is on the update server and the GitHub release is made: every CHANGELOG_USER.md
 * section after the previous `v*` tag, up to this one, so a release whose run failed still gets
 * its notes said by the next.
 *
 *   DISCORD_RELEASE_WEBHOOK=… GITHUB_REF_NAME=v1.2.3 npx jiti scripts/post-discord-release.ts
 *
 * Without the webhook it says so and does nothing, so the step is optional.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { compareVersions, notesSince, parseReleaseNotes } from '../src/shared/updates';

const tag = process.env['GITHUB_REF_NAME'] ?? '';
const webhook = process.env['DISCORD_RELEASE_WEBHOOK'];

if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.log(`Skipping: ${tag || '(no tag)'} is not a vX.Y.Z tag`);
  process.exit(0);
}
if (!webhook) {
  console.log('Skipping: DISCORD_RELEASE_WEBHOOK is not set');
  process.exit(0);
}

const version = tag.slice(1);
const previous = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /^v\d+\.\d+\.\d+$/.test(line))
  .map((line) => line.slice(1))
  .filter((other) => compareVersions(other, version) < 0)
  .sort(compareVersions)
  .at(-1);

const notes = notesSince(
  parseReleaseNotes(readFileSync('CHANGELOG_USER.md', 'utf8')),
  previous ?? '0.0.0',
  version,
);
const body = notes
  .map((note) =>
    [notes.length > 1 ? `**${note.version}**` : '', ...note.items.map((item) => `- ${item}`)]
      .filter(Boolean)
      .join('\n'),
  )
  .join('\n\n');
// An embed's description holds 4,096 characters.
const description =
  body.length > 4000 ? `${body.slice(0, 4000).replace(/\n[^\n]*$/, '')}\n…` : body;

async function post(url: string): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          title: `EDSSI ${version}`,
          url: `https://updates.edssi.app/edssi-${version}-setup.exe`,
          description: description || 'Fixes and improvements.',
          footer: { text: 'EDSSI updates itself; this is the installer for a new install.' },
        },
      ],
    }),
  });
  if (!response.ok)
    throw new Error(`Discord answered ${response.status}: ${await response.text()}`);
  console.log(`Announced ${version} (${notes.length} version(s) of notes)`);
}

post(webhook).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
