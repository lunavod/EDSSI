# Releasing and updates

EDSSI updates itself with electron-updater from a plain file server: the Cloudflare R2 bucket
`edssi-updates`, served as `https://updates.edssi.app` (and as `https://updates-dev.edssi.app` for the
dev channel). A pushed tag builds, signs and uploads a release; every installed EDSSI finds it
within half an hour. It is OverLooker's setup, carried over.

## Cutting a release

Run `/release` in Claude Code (`.claude/skills/release/SKILL.md`). It runs `npm run check`, proposes
the version, writes both changelogs (asking you to approve the commanders' one word for word),
commits `chore: bump version to X.Y.Z`, tags `vX.Y.Z` and pushes. By hand it is the same:

1. Bump `version` in `package.json` (and `npm install` so the lock file follows).
2. Add a `## X.Y.Z` section to `CHANGELOG.md` (technical) and to `CHANGELOG_USER.md` (plain
   words, `**bold**` lead-ins; EDSSI shows it after the update and the Discord post quotes it).
3. Commit both with the version, tag `vX.Y.Z`, push the commit and the tag.

The tag must match `package.json` or the workflow stops. Sign in to SimplySign Desktop on the
release machine first: the certificate is only there while a session is (about two hours). A
release that failed to sign uploaded nothing, so sign in and push the tag again
(`git push --delete origin vX.Y.Z`, `git tag -f vX.Y.Z`, push).

`.github/workflows/release.yml` then, on the self-hosted runner:

- refuses to go on if `extensions/` has anything in it (a release is the repository alone; the
  checkout cleans out ignored files, so this only trips if something put them back);
- `npm ci`, `npm run check`, builds the stick addon (`hid:build`) and the VR host (`vr:build`),
  `npm run build`, packages with `electron-builder`, signing with the Certum certificate given by
  thumbprint on the command line, and checks the signatures;
- uploads the installer and its blockmap, then `latest.yml` (uncached, and last, so it never names
  a file that isn't there yet), and deletes all but the three newest releases;
- on GitHub's runners, makes a GitHub release with the installer, this version's `CHANGELOG.md`
  section and the commits, and posts `CHANGELOG_USER.md`'s new sections to Discord when
  `DISCORD_RELEASE_WEBHOOK` is set (`scripts/post-discord-release.ts`);
- also on GitHub's runners, once the installer is uploaded, publishes the mock UI
  (`src/mock/README.md`) to GitHub Packages as `@lunavod/edssi-mock-ui` at the same version: it
  makes the demo scenario afresh (`npm run mock:scenario`, which fetches EDSY's tables), builds
  `npm run mock:lib`, and publishes `dist/mock-ui` with the workflow's own `GITHUB_TOKEN`, which
  needs nothing set up beyond the job's `packages: write`. A rerun skips a version already
  published. GitHub Packages never takes a version twice: a release whose package went out but
  needs changing is a new version. The steps are `.github/workflows/mock-ui.yml`, which can also
  be run by hand (Actions → Mock UI → Run workflow, or `gh workflow run mock-ui.yml`) to publish
  between releases, with a version of its own such as `1.1.0-mock.1`.

## The dev channel

A `dev-vX.Y.Z-dev.N` tag builds **EDSSI Dev** (`electron-builder.dev.yml`): its own app id,
name, install folder, data folder (`%APPDATA%\EDSSI Dev`: its own database, update marker and
"What's new") and download cache, so it sits beside EDSSI, updating from `dev.yml` on
`updates-dev.edssi.app`. `~/.edssi/config.yaml` is shared, so keys and bindings carry over. The version comes from the tag, nothing is committed, and no GitHub
release or announcement is made. Try a change of the release machinery there first.

## In the app

`src/main/update-service.ts` and `src/main/updates/`:

- only an installed EDSSI updates (`app.isPackaged`); from source the About page says so;
- it checks 10 s after starting and every 30 minutes, and downloads in the background;
- a finished download leaves `pending-update.json` in the data folder, and the title bar shows
  "Update ready";
- it is never installed on quit. The next start installs it before any service starts, silently,
  and starts EDSSI again; Settings → About can restart into it at once;
- after an update, the "What's new" dialog shows `CHANGELOG_USER.md`'s sections since the version
  last shown (`whats-new.json` in the data folder); a first install shows nothing;
- the updater's log is `updater.log` in the data folder, trimmed to a month.

## Local builds

`npm run dist:win` builds an installer that works the same way but is unsigned (the certificate
thumbprint only comes from the workflow). It is built from whatever is in the working tree,
**`extensions/` included**, so never hand one out: releases come from the workflow only.

## Setting it up (once)

What the workflow needs that the repository can't hold:

1. **The runner.** A self-hosted runner for `lunavod/EDSSI` on the machine with SimplySign
   Desktop, labelled `certum-signing` (Settings → Actions → Runners → New self-hosted runner; a
   second runner beside OverLooker's, in its own folder). It needs Node 24, the .NET SDK
   (`vr:build`), the Visual Studio C++ build tools (`hid:build`), Python, and the AWS CLI.
2. **The bucket.** An R2 bucket `edssi-updates`, with the custom domains `updates.edssi.app` and
   `updates-dev.edssi.app` both attached to it (the domain `edssi.app` on Cloudflare first). Never
   change the production URL: every installed EDSSI has it baked into its `app-update.yml`.
3. **The secrets** (Settings → Secrets and variables → Actions): `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (an R2 API token that can read and write the bucket),
   and optionally `DISCORD_RELEASE_WEBHOOK`.

If the signing certificate is ever reissued under another subject, add the new subject to
`publisherName` in `electron-builder.yml` and release that **before** releasing anything signed
with the new certificate, or installed copies will refuse the update.
