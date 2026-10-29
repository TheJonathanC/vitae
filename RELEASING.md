# Releasing Vitae

Releases are built and published by `.github/workflows/ci-cd.yml`. The version
rules below are enforced by `scripts/release.mjs` (tested in
`scripts/__tests__/release.test.mjs`); a run that breaks them fails before
anything is published.

## Channels

Users pick a channel in **Settings → Release channel**. New installs default to
stable. The app checks at startup and every 6 hours.

| Channel | Update feed | Gets |
| --- | --- | --- |
| Stable | `releases/latest/download/latest.json` | Stable releases only |
| Beta | `releases/download/latest-beta/latest-beta.json` | Every beta, plus every stable release newer than the latest beta |

Both feeds point at the signed NSIS installer (`*-setup.exe`) of a versioned
release. The updater installs it in passive mode and restarts the app. MSI
installers are attached to stable releases for manual installs only.

Switching channels never downgrades: a beta user who switches to stable stays on
their beta until a newer stable release ships.

## How to release

| To publish | Do this | Version |
| --- | --- | --- |
| A beta | Merge to `main` | `<next patch>-beta.<run number>`, computed automatically |
| A stable release | Bump `version` in `package.json`, merge, then push tag `vX.Y.Z` (or run the workflow manually with channel `stable`) | `X.Y.Z` |
| A release candidate | Push tag `vX.Y.Z-rc.N` | `X.Y.Z-rc.N` (beta channel) |

## Rules

1. **Betas always sort above the newest stable release.** A beta is the next patch after
   whichever is higher: `package.json` or the latest stable tag. Beta users never get
   stranded below stable.
2. **Stable versions only move forward.** A stable release must be newer than the
   latest stable tag.
3. **Versions are immutable.** A tag that already exists can only be re-run for the
   same commit; it is never reused for different code. The "Immutable release
   tags" ruleset blocks moving or deleting `v*` tags.
4. **A stable release only replaces the beta feed when it is newer than the
   current beta.** A hotfix like 1.1.4 doesn't pull beta users back from
   1.2.0-beta.5.
5. **Every update is verified before it's published.** The installer's signature is
   checked against the `updater.pubkey` in `tauri.conf.json`. If `TAURI_PRIVATE_KEY`
   is missing or doesn't match that key, the release fails. Never rotate one without
   the other: installed apps only accept the key they shipped with.
6. **Feeds never go offline.** Releases upload all assets before they're published,
   and the rolling `latest-beta` release is updated in place, never deleted.
7. **One release at a time.** Release runs are serialized, so two runs can't race on
   the feeds.
8. **`main` must stay releasable.** Every merge to `main` ships to beta users. Merge
   through PRs with green **Run Automated Tests**. The "Protect main" ruleset requires
   this and blocks force-pushes and deletion of `main`.

## Required secrets

- `TAURI_PRIVATE_KEY`: the updater signing key (matches `tauri.updater.pubkey`)
- `TAURI_KEY_PASSWORD`: its password (may be empty)

## GitHub rulesets

The rulesets live in `.github/rulesets/`. Repository admins can bypass them for
emergencies. To apply them (once, as a repo admin):

```bash
gh api -X POST repos/TheJonathanC/vitae/rulesets --input .github/rulesets/protect-main.json
gh api -X POST repos/TheJonathanC/vitae/rulesets --input .github/rulesets/release-tags.json
```

The `latest-beta` tag is outside the `v*` pattern, so the workflow can keep moving it.
