---
name: release
description: Check, bump the version, write both changelogs, tag and push an EDSSI release, then confirm the release workflow started. Use when ready to ship a release.
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Grep, Glob, AskUserQuestion
---

# Release

Cut a release of EDSSI. How releases and updates work is in `docs/releasing.md`; the workflow this
starts is `.github/workflows/release.yml`.

## 1. Start clean

Run `git status`. If there are uncommitted changes, stop and ask what to do with them: a release is
cut from committed work only, and nothing is committed without the user saying so.

Check the branch is `main` and up to date with `origin/main` (`git fetch`, `git status -sb`). If not,
say so and ask.

## 2. Check

Run `npm run check` (typecheck, lint, format check, tests). If anything fails, fix it, run it again,
and show the user the fix before going on; commit fixes only once the user agrees.

## 3. Nothing private

Private extensions live in `extensions/` (git-ignored). For each folder there, search everything
going out — `git log -p` since the last tag, the changelog drafts, the tag message — for the
folder's name and anything else that names or describes that extension. If anything turns up, stop
and tell the user; never release it.

## 4. Choose the version

- Current version: `package.json`.
- Commits since the last release: `git log --oneline $(git describe --tags --abbrev=0 --match 'v*')..HEAD`
  (all commits if there is no `v*` tag yet).
- Before 1.0, a minor bump for new features (`feat:`), a patch bump for fixes, refactors and chores.
- Ask with AskUserQuestion: the proposed version first (e.g. "0.3.0 → 0.4.0 (new features)") and one
  alternative.

## 5. Write both changelogs

- `npm version <X.Y.Z> --no-git-tag-version` (updates `package.json` and `package-lock.json`).
- `CHANGELOG.md`: a `## X.Y.Z` section at the top (under the intro), entries grouped under
  `### Added`, `### Changed`, `### Fixed`, `### Removed`, in technical detail: what changed, where,
  and why. Leave out chores, version bumps and merges. The GitHub release quotes this section.
- `CHANGELOG_USER.md`: what EDSSI shows commanders after the update, and what Discord is told.
  - Plain words: no IPC, journal event names, file names or module names unless a commander sees
    them. What they notice and can do, not how it works.
  - Short bullets, each leading with a **bold** headline.
  - Only what a commander can see.
  - **Show the draft in chat, word for word, and wait for approval.** If the user asks for changes,
    make them and show the whole revised draft again; a request for a change is not approval of
    the result. Only write the section once the user has approved its exact wording.

## 6. Commit, tag, push

Only with the user's go-ahead for this release (they asked for it by running this skill; still say
what is about to be pushed and wait for a yes).

- Stage `package.json`, `package-lock.json`, `CHANGELOG.md`, `CHANGELOG_USER.md`.
- Commit `chore: bump version to X.Y.Z`, with the co-author trailer naming the model actually
  running.
- `git tag vX.Y.Z`, then `git push` and `git push origin vX.Y.Z`.
- `CHANGELOG_USER.md` must be in the tagged commit: the installer carries it.

Remind the user that SimplySign Desktop must be signed in on the release machine, or the signing
step fails (safely: nothing is uploaded; sign in, then move and push the tag again).

## 7. Confirm the workflow

`gh run list --workflow release.yml --limit 3` should show a run for the tag. Give the user its URL
and status. Don't poll it.
