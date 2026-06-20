# Port Daddy Versioning

Port Daddy versions are operator-trust signals. If users will get a behavior change after `brew upgrade port-daddy`, the binary they download must report a newer version than the one they had.

This document covers **what to bump and when**. For **how to actually cut a release**, see [`RELEASING.md`](RELEASING.md).

## Semver policy

- **Patch** (`3.14.0` → `3.14.1`): daemon/runtime fixes, instrumentation, small CLI/SDK/MCP additions, docs that ship with runtime behavior, and safe UI improvements.
- **Minor** (`3.14.x` → `3.15.0`): user-visible capabilities, new workflow surfaces, new durable APIs, or changes that operators should notice in release notes.
- **Major** (`3.x` → `4.0.0`): breaking behavior, migration requirements, or a new compatibility line. Do not jump to v4 for ordinary daemon work.

## Version surfaces

A bump must update **every file** the build, MCP, and plugin metadata read from. `scripts/sync-version.ts` now handles **all** of them — the JSON manifests, the MCP/server TypeScript constants, and the website reference constant. The only manual surface left is `CHANGELOG.md` (see [Known gaps](#known-gaps-in-sync-versionts) below).

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
| `CHANGELOG.md` | manual | Rename `[Unreleased]` → `[<version>] - YYYY-MM-DD`, prepend a fresh `[Unreleased]` |

### Known gaps in `sync-version.ts`

`scripts/sync-version.ts` now touches the plugin/MCP/Gemini JSON surfaces, the MCP/server TypeScript constants, the website reference constant, and the public samples manifest. `tests/unit/distribution-freshness.test.js` gates those surfaces against `package.json`.

The remaining manual surface is `CHANGELOG.md`: pick the version section and release date deliberately so humans can read what changed.

## A release without a version bump is a release bug

The release tag, the binary `--version` output, the brew formula version, and the CHANGELOG entry must all agree. If they don't, the `--version` users see after `brew upgrade port-daddy` lies about what's installed, and rollback diagnostics get harder.

`tests/unit/distribution-freshness.test.js` enforces the package.json / mcp-server.json / plugin.json / mcp/server.ts agreement in CI. The remaining surfaces are unenforced and rely on the recipe in [`RELEASING.md`](RELEASING.md).

## What you do NOT do anymore

- There is no `~/port-daddy-stable` worktree.
- There is no `promote-stable.sh` script (it was removed with the stable-worktree flow).
- Do not `npm link` from a working checkout — the `port-daddy` and `pd` CLIs are the Homebrew-installed binaries. Local source work is for development only; users get the signed bottle.
- Do not hand-roll daemon promotion with `launchctl` commands. The brew formula installs the launchd service definition; `brew services restart port-daddy` is the supported operator action.

See [`adr/0028-signed-binary-distribution.md`](adr/0028-signed-binary-distribution.md) for why.
