# 0110. Unified Distribution — Port Daddy as one beautiful whole

## Status

Proposed — 2026-06-17

> Reconciled by [ADR-0087](0087-trusted-computing-base-broker.md) (2026-06-20):
> the TCB broker binary is another signed limb of the one whole this ADR ships —
> ADR-0087 phase 7 builds/signs/notarizes it and adds it to the `latest.json` feed
> defined here. No new distribution mechanism; one more artifact through the same pipe.

Numbering note: 0055 (parley) and 0056 (weighted note retrieval) are the latest
sequential ADRs; 0084 is an out-of-band outlier. 0057 is the lowest free number.

Supersedes the *delivery* half of [ADR-0028](0028-signed-binary-distribution.md)
(signed binary distribution, still `PROPOSED`) by widening its scope from "sign the
daemon binary" to "ship every Port Daddy surface as one signed, versioned whole."
ADR-0028's macOS signing recipe and its two code blockers remain valid and are
folded into the Implementation Matrix below.

## Context

The operator's ask (2026-06-17), verbatim:

> We do need the Rust desktop app / Rust kernel / homebrew of the daemon / fleetbar /
> the MCP / the agent skill / etc all to be distributed as one beautiful whole.

Today they are **six separately-distributed things with one shared version number and
no shared trust story.** An audit of the real pipeline (`.github/workflows/release.yml`,
`publish.yml`, `scripts/build-single-binary.mjs`, `scripts/sign-and-notarize.mjs`):

| Surface | Source | How it ships today | Signed? |
|---|---|---|---|
| **Daemon + CLI** (`pd`) | `server.ts`, `cli/`, bun-compiled by `scripts/build-single-binary.mjs` | `release.yml` builds `bun-darwin-arm64` + `bun-linux-x64`, tars to a GitHub Release, dispatches a formula bump to `curiositech/homebrew-tap` | ❌ **unsigned** |
| **Rust kernel** (`pd-anchor` + crates) | `core/kernel/` | embedded into the daemon as `libharbor_card_rs.dylib` via `scripts/build-core.sh`; not separately shipped | ❌ (rides the unsigned daemon) |
| **Rust desktop app** (`pd-console`) | `core/pd-console/` — GPU-native GPUI console (ADR-0046 Phase 1), bin `pd-console` behind `--features gpui` | `rust-console-gpui` CI job **builds it on macOS and discards it**; no `.app`, no bundle, no release artifact | ❌ **never bundled** |
| **FleetBar** (menu-bar app) | `apps/FleetBar/` (Swift) | `scripts/package-fleetbar.sh` → `scripts/sign-and-notarize.mjs` | ✅ **the only signed surface** |
| **MCP server** | `mcp/server.ts` | `publish.yml` → npm; `pd mcp install` wires it into a harness | n/a (npm) |
| **Agent skill** | `skills/port-daddy-agent-skill/` | base64-embedded into the daemon binary by `build-single-binary.mjs`; also in the npm package | n/a |

Three structural problems fall out of that table:

1. **One trust story is missing.** The **Developer ID** (Apple's per-developer code-signing
   identity that lets Gatekeeper trust a binary without the App Store) `Curiositech LLC
   (P5H9P59X2M)` is valid and **proven — but only on FleetBar.** The daemon ships unsigned;
   `pd-console` is never even bundled. A user who `brew install`s the daemon and downloads
   the console gets a Gatekeeper "unidentified developer" wall on the GUI and an unsigned
   CLI. ADR-0028 designed the fix; it is `PROPOSED`, blocked on two code changes (below),
   and the signing identity is **not wired into CI** (`release.yml` references only
   `NPM_TOKEN` and `HOMEBREW_TAP_TOKEN`).

2. **The version is shared by accident, not by construction.** `scripts/sync-version.ts`
   propagates `package.json`'s version to *some* surfaces; `mcp/server.ts` and
   `website-v2/src/data/referenceCatalog.ts` are **manual** (`docs/VERSIONING.md`). The
   GPUI console and the kernel crates carry their own `Cargo.toml` versions. "One whole"
   requires one version authority, enforced.

3. **There is no shared update channel.** The only upgrade path is `brew upgrade
   port-daddy` (`docs/RELEASING.md` §1). The GUI apps (`pd-console`, FleetBar) have no
   `latest.json`, no `pd upgrade`, no in-app check. A whole that updates one limb at a
   time is not a whole.

**Explicitly out of scope (operator call, 2026-06-17):** Intel-mac (`x86_64-apple-darwin`,
dropped 2026-05-22) and Windows. They are real gaps — the daemon matrix is arm64-only and
there is no `signtool`/EV-cert path — and we *record* them here so the next session does
not rediscover them, but we do not pursue them. **fail-closed on scope:** a future PR that
adds an Intel or Windows target must cite an explicit operator reversal of this line.

## Decision

Treat distribution as a single product with one version, one signing identity, one
Homebrew presence, and one update channel. Concretely:

### 1. One version, enforced

Make `scripts/sync-version.ts` the **sole** version authority and extend it to *every*
surface, including the ones that are manual today (`mcp/server.ts`,
`website-v2/src/data/referenceCatalog.ts`) and the Rust `Cargo.toml`s
(`core/pd-console`, `core/kernel/*`, embedded via `[workspace.package] version`). A CI
check (extend the existing `tests/unit/distribution-freshness.test.js`) fails the build if any
surface drifts from `package.json`. A release stamps one number across the whole.

### 2. One signing identity, applied everywhere

Lift the Developer ID + notary profile out of local keychains and into CI as secrets,
and reuse the **already-proven** `scripts/sign-and-notarize.mjs` for the daemon binary
and the `pd-console.app` — not just FleetBar. **Hardened runtime** (Apple's opt-in that
restricts a signed process's privileges, required for **notarization** — Apple's
automated malware scan that staples a Gatekeeper-trusted ticket to the artifact) +
`--timestamp`, exactly as ADR-0028 specifies. One identity signs the CLI, the console,
and FleetBar; one `xcrun notarytool submit --wait` + `xcrun stapler staple` per artifact.

### 3. `pd-console.app` becomes a real, signed bundle

`core/pd-console` builds the `pd-console` bin today but stops there. Add the macOS
**app bundle** (a `cargo-packager`/`cargo-bundle` step or a small bundle script that
produces `pd-console.app` with an `Info.plist`, an `.icns` icon set, and the entitlements
ADR-0028 lists) → Developer ID sign → notarize → staple → ship as a release artifact.
The kernel rides inside it (the console links the kernel crates directly).

### 4. One Homebrew presence: formula + cask

Keep the **formula** (`brew install port-daddy`) for the headless daemon/CLI — the
existing dispatch-to-tap flow is fine. Add a **cask** (`brew install --cask
port-daddy-console`, and `--cask port-daddy-fleetbar`) for the signed `.app`s, rolled by
the same `release.yml` → tap dispatch, hashes computed from the notarized artifacts. A
reader gets the whole with `brew install port-daddy && brew install --cask
port-daddy-console`. (A future meta-formula can wrap both; not required for v1.)

### 5. One update channel

Ship a `latest.json` (version + per-artifact URL + signature) alongside each GitHub
Release — the Tauri/Sparkle-shaped manifest the `rust-app-distribution` skill documents.
`pd upgrade` self-updates the CLI/daemon (re-points brew or pulls the release); the GUI
apps poll the same manifest and verify the signature against an embedded public key. One
feed, every limb updates together.

### What rides along for free

The **MCP server** *is* the daemon (`mcp/server.ts` runs in-process), so signing the
daemon signs the MCP. The **agent skill** is already embedded in the binary by
`build-single-binary.mjs` and shipped in the npm package — once the binary is signed, the
skill is delivered inside a trusted artifact. No new pipeline for those two; they are
surfaces of the daemon, and that is the point.

## Considered Options

1. **Status quo — six independent distributions.** Rejected: it is the problem. Unsigned
   daemon + Gatekeeper-walled console + drifting versions is not "one whole," and ADR-0028
   has sat `PROPOSED` for six weeks because no single artifact forced the signing wiring.
2. **Sign each surface independently, on its own cadence.** Rejected: multiplies the
   notarization wiring, lets versions drift, and still has no shared update channel. The
   shared identity and shared version are the entire value.
3. **One monolithic installer (`.pkg`) containing everything.** Tempting but premature:
   a single `.pkg` couples the daemon's fast release cadence to the GUI apps' slower one,
   and Homebrew is already the operator-blessed channel (ADR-0028). Defer; a meta-formula
   composing the formula + casks gives 90% of the "one install" feel without the coupling.
4. **Chosen: one version + one identity + formula/cask + one update feed.** Each surface
   keeps its build cadence; the *trust*, the *version*, and the *update channel* are
   unified. This is the smallest change that makes the six feel like one.

## Implementation Matrix (build DAG)

Cartographer-owned; phases promote to `roadmap_items` at `now` when picked up. The first
two are the ADR-0028 blockers — nothing signs until they land.

| Phase | Slug | Depends on | What ships |
|---|---|---|---|
| 1 | dist-bun-sqlite-migration | — | migrate the daemon off `better-sqlite3` to `bun:sqlite` so the compiled binary has no native-binding/`__dirname` breakage (ADR-0028 blocker 2); regression test under the bun runtime |
| 2 | dist-log-path-fix | — | resolve daemon log paths to `$PORT_DADDY_PREFIX/logs/` instead of `__dirname` (ADR-0028 blocker 1) so a signed, relocated binary can write logs |
| 3 | dist-ci-signing-secrets | — | **CI wiring LANDED in this PR** — `release.yml` now runs `scripts/sign-and-notarize.mjs` on the macOS daemon + launcher with the `P5H9P59X2M` Developer ID; gated on the `APPLE_CERT_*` secrets (no-op until the operator adds them, then signs; notarizes too when the `APPLE_NOTARY_*` secrets are present). Locally proven 2026-06-17: the shipped adhoc `pd` re-signs to a valid hardened-runtime Developer ID binary (`codesign --verify --strict` passes). *Note: phases 1–2 are not blockers for signing the bun-compiled binary as shown; they remain blockers for a fully self-contained relocatable daemon.* |
| 4 | dist-console-app-bundle | 3 | `pd-console.app` bundle (Info.plist + `.icns` + entitlements) from `core/pd-console`; sign + notarize + staple; upload as a release artifact |
| 5 | dist-version-authority | — (parallel) | extend `scripts/sync-version.ts` to every surface incl. `mcp/server.ts`, `referenceCatalog.ts`, and the Rust `Cargo.toml`s; CI drift gate in `tests/unit/distribution-freshness.test.js` |
| 6 | dist-homebrew-cask | 4 | `port-daddy-console` + `port-daddy-fleetbar` casks rolled by the tap dispatch; hashes from notarized artifacts |
| 7 | dist-update-channel | 4 | **CLI half LANDED.** `scripts/build-latest-json.mjs` generates a `latest.json` feed (schema + semver math in `lib/latest-manifest.ts`) from the built artifacts; `release.yml`'s `build-latest-json` job publishes it to each Release so `releases/latest/download/latest.json` is stable. `pd upgrade` (`cli/commands/upgrade.ts`) fetches the feed, compares the embedded version, surfaces the per-artifact SHA-256 + signed flag (so a human/GUI can verify a manual download), and `--apply` re-points brew (`brew upgrade port-daddy` + service restart) — privileged in-place self-replace is deferred to brew by design. `pd upgrade` does NOT itself download-then-verify the bottle; on `--apply`, Homebrew verifies the bottle's integrity before installing it. (`verifyChecksum`/`sha256File` in `upgrade.ts` are helpers for the deferred manual/GUI verify path; the current command does not exercise them.) *Remaining:* GUI in-app update check that performs the standalone SHA-256 verify + a real cryptographic signature over the manifest (the feed is not yet detached-signed against an embedded pubkey). |
| 8 | dist-meta-formula | 6,7 | optional meta-formula composing daemon + casks so `brew install port-daddy` pulls the whole |

Known gaps recorded, not scheduled (operator-deprioritized): Intel-mac target, Windows
EV-cert + `signtool` path, SmartScreen reputation.

## Consequences

- **Positive:** a user installs a coherent, Gatekeeper-trusted whole; the daemon, console,
  and FleetBar carry one version and update from one feed; ADR-0028's six-week-stalled
  signing finally has a forcing artifact; the kernel, MCP, and skill ride inside a signed
  binary for free.
- **Cost:** real engineering — the SQLite migration and log-path fix are prerequisites
  with their own risk; CI gains notarization latency (minutes per artifact); the cask +
  `latest.json` are new surfaces to maintain.
- **Operator-owned, not agent-doable:** the Apple Developer account, the CI signing
  secrets, and the cask-tap credentials are the operator's to provision. This ADR designs
  the pipeline and can scaffold the CI; it cannot mint the identity.
- **Risk — version-drift Goodhart:** a CI gate that only checks `package.json` equality can
  be satisfied by bumping the string without rebuilding a surface. The gate must compare
  the *embedded* version reported by each built artifact (`pd --version`, `pd-console
  --version`, the FleetBar `CFBundleShortVersionString`), not just the source literal.
- **Reversible per phase:** each phase is independently shippable; signing can dark-launch
  (sign without making it mandatory) and the cask can ship before the meta-formula.

## References

- ADR-0028 (signed binary distribution) — the macOS recipe + the two code blockers folded
  into phases 1–2.
- [ADR-0046](0046-operator-tui.md) (operator TUI + console; its Phase 1 is the GPUI app) —
  `core/pd-console`, the desktop app this bundles.
- `docs/RELEASING.md`, `docs/VERSIONING.md` — the release ceremony + the version surfaces.
- `scripts/sign-and-notarize.mjs`, `scripts/package-fleetbar.sh` — the proven signing path
  to reuse beyond FleetBar.
- `~/.claude/skills/rust-app-distribution/SKILL.md` — the Developer ID / notarization /
  cask / `latest.json` patterns applied here.
