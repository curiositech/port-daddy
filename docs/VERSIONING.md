# Port Daddy Versioning

Port Daddy versions are operator-trust signals. If users will get a behavior change after `brew upgrade port-daddy`, the binary they download must report a newer version than the one they had.

This document covers **what to bump and when**. For **how to actually cut a release**, see [`RELEASING.md`](RELEASING.md).

## Semver policy

- **Patch** (`3.14.0` → `3.14.1`): daemon/runtime fixes, instrumentation, small CLI/SDK/MCP additions, docs that ship with runtime behavior, and safe UI improvements.
- **Minor** (`3.14.x` → `3.15.0`): user-visible capabilities, new workflow surfaces, new durable APIs, or changes that operators should notice in release notes.
- **Major** (`3.x` → `4.0.0`): breaking behavior, migration requirements, or a new compatibility line. Do not jump to v4 for ordinary daemon work.

## Version surfaces

A bump must update **every file** the build, MCP, and plugin metadata read from. `scripts/sync-version.ts` now handles **all** of them — the JSON manifests, the MCP/server TypeScript constants, and the website reference constant. `CHANGELOG.md` is no longer a manual surface either: it is **assembled** from `changelog.d/` fragments by `scripts/assemble-changelog.mjs` and gated in CI (see [The changelog is generated too](#the-changelog-is-generated-too) below).

| Surface | Updated by | Notes |
|---|---|---|
| `package.json` (`version`) | `npm version <patch\|minor\|major>` | Source of truth — `sync-version.ts` reads from here |
| `package-lock.json` (root `version` + `packages.""` entry) | `npm version` | Two fields, both root-scoped |
| `mcp-server.json` (`version`) | `sync-version.ts` | MCP manifest published to consumers |
| `.claude-plugin/plugin.json` (`version`) | `sync-version.ts` | Claude plugin metadata |
| `.gemini/extensions/port-daddy/gemini-extension.json` (`version`) | `sync-version.ts` | Gemini CLI extension manifest |
| `mcp/server.ts` (`version: '...'` literal at the `Server()` constructor) | `sync-version.ts` | Gated by `tests/unit/distribution-freshness.test.js` |
| `server.ts` (`EMBEDDED_PACKAGE_VERSION`) | `sync-version.ts` | Binary fallback version when package.json is unavailable in the Bun bundle |
| `website-v2/src/data/referenceCatalog.ts` (`PORT_DADDY_VERSION`) | `sync-version.ts` | Display constant for `/reference` pages |
| `public/samples/manifest.json` (`packageVersion`) | `sync-version.ts` | Bundled sample manifest version |
| `VERSION` (plain text) | `sync-version.ts` | Human-facing product stamp. No code reads it, but it used to lie at `3.7.0`; now kept honest |
| `core/pd-console/Cargo.toml` (`[package] version`) | `sync-version.ts` | The GPU-native app's `CARGO_PKG_VERSION` → `pd-console`'s in-app build stamp AND its `.app` `CFBundleShortVersionString`. The **only** Rust crate that is a user-facing product surface |
| `CHANGELOG.md` | `assemble-changelog.mjs --release` | Splices the `changelog.d/` fragments into a dated `[<version>] - YYYY-MM-DD` section and deletes them. Run by the release train; `--check` gated by the `changelog-guard` CI job |

The kernel library crates (`core/kernel/*`, `core/Cargo.toml` `[workspace.package]`) keep their **own independent library semver** — they ride *inside* the daemon/console and are not user-facing version surfaces, so `sync-version.ts` deliberately does not touch them.

## The drift gate (`scripts/check-version-drift.mjs`)

`package.json` is the sole authority; `sync-version.ts` stamps it everywhere; **`scripts/check-version-drift.mjs` is the gate that fails the build when any surface drifts.** Run it locally with `npm run check:version-drift`. CI runs it two ways (ADR-0057 phase `dist-version-authority`):

- **`ci.yml` → `version-drift-guard`** runs it in *source mode* on every PR/push/merge-queue: every version literal in the repo must equal `package.json`. This is the regression that catches "bumped the version but forgot a surface" or a hand-edit.
- **`release.yml`** runs it `--deep --require-artifacts` after the `pd-console.app` is built: it reads the version *embedded* in the built artifact (the `.app`'s `CFBundleShortVersionString` and the binary's build stamp), not just the source literal — closing the Goodhart hole where someone bumps the string without rebuilding (ADR-0057 §Consequences). This deep check runs only on releases that actually rebuild the console: since 2026-08-22 a release where `core/pd-console` is unchanged since the previous tag (version-string churn aside) skips the console build entirely, ships no new console `.zip`, and the last-built console legitimately keeps *its own* release's embedded version — that is the point of not re-cutting it, not drift.

### Known gaps in `sync-version.ts`

`scripts/sync-version.ts` now touches the plugin/MCP/Gemini JSON surfaces, the MCP/server TypeScript constants, the website reference constant, and the public samples manifest. `tests/unit/distribution-freshness.test.js` gates those surfaces against `package.json`.

### The changelog is generated too

`CHANGELOG.md` used to be the last hand-edited surface, and that cost real entries. `## [Unreleased]` is line 8 and `### Added` is line 10, so every feature PR inserted its bullet at line 11 — 29 of the last 200 commits wrote those same three lines. Two branches cut from the same base conflict on nearly every pair, and a resolver taking "ours" drops the other PR's entry with **nothing failing**: no test reads the file, and the release gate only greps for a heading, not for content.

So the `[Unreleased]` section is now **assembled** from one file per PR:

- Contributors add `changelog.d/<pr>-<slug>.md` (format: `changelog.d/README.md`). Two branches never touch the same file, so there is no conflict to mis-resolve.
- `scripts/assemble-changelog.mjs --check` runs as the `changelog-guard` CI job (wired into `ci-gate`'s `needs:`), and rule (4) of `scripts/check-pr-requirements.mjs` fails a PR that changes a user-visible surface and adds no fragment.
- `.github/workflows/release-train.yml` calls `--release "$NEXT" --date "$(date -u +%F)"` in the version-bump step, which splices the fragments into a dated section and deletes them in the same `chore(release): bump to $NEXT` commit.

The one thing still chosen deliberately by a human is the fragment's **prose** — the gate checks presence and shape, never whether the entry is honest or well-scoped.

## A release without a version bump is a release bug

The release tag, the binary `--version` output, the brew formula version, and the CHANGELOG entry must all agree. If they don't, the `--version` users see after `brew upgrade port-daddy` lies about what's installed, and rollback diagnostics get harder.

`tests/unit/distribution-freshness.test.js` enforces the package.json / mcp-server.json / plugin.json / mcp/server.ts agreement in CI. `scripts/check-version-drift.mjs` (run by the `version-drift-guard` CI job and `tests/unit/version-drift-gate.test.js`) extends that to **every** surface in the table above incl. `VERSION` and `core/pd-console/Cargo.toml`, and adds the deep (embedded-artifact) check at release time. `CHANGELOG.md` has its own gate: `scripts/assemble-changelog.mjs --check` (the `changelog-guard` CI job, `tests/unit/changelog-fragments.test.js`), which pins the assembled output against the literal `grep -Fq "## [$version] -"` that `release-train.yml`'s `tag-and-publish` runs before it will tag.

## What you do NOT do anymore

- There is no `~/port-daddy-stable` worktree.
- There is no `promote-stable.sh` script (it was removed with the stable-worktree flow).
- Do not `npm link` from a working checkout — the `port-daddy` and `pd` CLIs are the Homebrew-installed binaries. Local source work is for development only; users get the signed bottle.
- Do not hand-roll daemon promotion with `launchctl` commands. The brew formula installs the launchd service definition; `brew services restart port-daddy` is the supported operator action.

See [`adr/0028-signed-binary-distribution.md`](adr/0028-signed-binary-distribution.md) for why.
