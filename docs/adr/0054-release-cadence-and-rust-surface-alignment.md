# 0054. Release Cadence and Rust-Surface Alignment

## Status

Accepted — 2026-06-12. Author: Erich (operator, single-person operation).

> Reconciled by [ADR-0087](0087-trusted-computing-base-broker.md) (2026-06-20):
> the canonical Rust kernel (`pd-anchor`) this ADR established is the *same process*
> ADR-0087 designates as the Trusted Computing Base. ADR-0087 clarifies that the
> kernel's security comes from running it under a separate UID, not from the choice
> of Rust — Rust buys memory-safe key handling and one canonical impl, not isolation.

Two questions prompted this ADR, both from the operator:

1. **Release cadence** — "Create a programmed, broadcasted, well-understood cadence
   for when we deploy Cloudflare, fix its bugs, and when we deploy and cut a new
   version of Port Daddy to Homebrew."
2. **Rust alignment** — "Is it in sync with FleetBar and Rust? Are we all targeting
   the rust kernel? Does everyone know about the rust kernel?"

This ADR answers both. The cadence answer is a runbook. The Rust answer is, bluntly,
**no** — there is no single canonical Rust kernel today, the surfaces are scattered,
and nobody has written down a convergence target. This ADR writes one down.

## Context

### What ships today, and how

Port Daddy releases in **four artifact lanes** that fan out from one trigger or fire
independently. The machinery already exists; what is missing is a *rhythm* and a
*broadcast*. The lanes:

| Lane | Artifact | Built by | Trigger today |
|------|----------|----------|---------------|
| Website | `portdaddy.dev` (Cloudflare Pages) | `.github/workflows/deploy-website-v2.yml` | Auto, on push to `main` touching `website-v2/**` |
| Binary | `pd` CLI + daemon (darwin-arm64, linux-x64) | `.github/workflows/release.yml` → `build-binaries` | Human: GitHub `release` event **or** `workflow_dispatch` |
| npm | `port-daddy` package | `release.yml` → `publish-npm` (and standalone `publish.yml`) | Same release/dispatch trigger |
| Homebrew | `curiositech/homebrew-tap` formula | `release.yml` → `update-homebrew` (repository-dispatch) | Same release/dispatch trigger |
| FleetBar | macOS menu-bar app preview `.zip` | `release.yml` → `build-fleetbar-preview` | Same release/dispatch trigger |

**Cloudflare Pages** (*Cloudflare's static-site host with git integration; we deploy
the snapshotted SPA to it*) deploys continuously and automatically. Every merge to
`main` that touches `website-v2/**` fires `deploy-website-v2.yml`, which runs the full
build — `npm run build:full` = vite build + route HTML injection + `snap:routes`
(a headless-chromium pass that captures post-mount HTML so Googlebot sees real
content) — then ships `website-v2/dist` to the `port-daddy` Pages project via
`cloudflare/wrangler-action@v3`. There is **no human gate and no cadence**: the
website is whatever last landed on `main`.

The other four lanes (`release.yml`) fire only when **a human triggers them** — a
published GitHub `release`, or a `workflow_dispatch` with a `tag` input. There is
**no schedule**. So the binary, npm, Homebrew, and FleetBar artifacts move only when
the operator decides to cut a release. Between cuts, `main` races ahead of every
installed `pd` in the world.

### The drift defects, named

Three concrete defects make the current state lie to its consumers:

- **`Formula/port-daddy.rb` in this repo is stale and fake.** It pins
  `url ".../v3.7.0.tar.gz"` with `sha256 "REPLACE_WITH_ACTUAL_SHA256"` — a literal
  placeholder. The live Homebrew `pd` is **3.18.0** (repo `package.json` agrees).
  The in-repo Formula is **not** the live tap; the real formula lives in
  `curiositech/homebrew-tap` and is updated by repository-dispatch from
  `release.yml`. The in-repo file is a decade-old decoy that teaches the wrong thing
  to anyone who reads it.

- **The shipped Homebrew `pd` lags repo HEAD by design.** Merging PRs and rebuilding
  `dist/` does *not* move the installed binary. A user only gets new behavior after
  (a) the operator cuts a release **and** (b) the user runs `brew upgrade`. This is
  the core pain the operator feels: "I fixed it on `main`, why is `pd` still broken?"
  Because `main` is not a release.

- **No broadcast.** When a release does cut, nothing announces it on a channel the
  operator (or a future session, or a watching agent) reads. The `CHANGELOG.md`
  `[Unreleased]` section is the only record, and it is updated by hand, inconsistently.

### What the Rust surface actually is

The operator asked whether everything targets "the rust kernel." Verified against
`git ls-tree -d --name-only HEAD core/`, the truth is: **there is no `core/kernel`.**
"The Rust kernel" is a *concept the operator holds*, not a crate that exists. What
exists on `main` is three independent crates with no workspace `Cargo.toml` tying
them together (verified: no `Cargo.toml` at repo root or under `core/`):

| Crate | Role | Status | Consumer | Wired? |
|-------|------|--------|----------|--------|
| `core/pd-tui` | ratatui surfaces — `pd vibe`, `pd watch`, `pd costs`, `pd inbox` (binary `pd-vibe`) | On `main`, `v0.1.0` | The operator at a terminal | **Standalone** — grep finds no `cli/`/`bin/` reference; it is its own binary, not yet shelled from `pd` |
| `core/pd-bosun` | filesystem-heartbeat supervisor for the daemon | On `main`, `v0.1.0`, empty `[dependencies]` | The daemon (as a watchdog) | **Shadowed** — a shipped TS twin `lib/bosun-heartbeat.ts` does the live job today; the Rust crate is a stub |
| `core/harbor-card-rs` | Ed25519 harbor-card issue/verify + capability attenuation, `crate-type = ["cdylib", "rlib"]` (i.e. an FFI library) | On `main`, `v0.1.0` | The TS daemon, via FFI | **Aspirational** — `lib/cap-attenuation-monitor.ts:11` states the FFI enforcer "depends on a Rust enforcer. When that binary is absent" it falls back to pure-TS enforcement. The fallback is what runs today |
| `core/pd-console` | GPUI native shell (the operator-TUI seat of ADR-0046) | **Not on `main`** — open in **PR #306** and **PR #318** | The operator | **Unlanded** |
| `core/kernel/*` (`pd-core`, `pd-eventlog`, `pd-anchor`, `pd-runtime`, `pd-compat`, `pd-mesh`, `pd-tui`) | The single-writer kernel workspace: domain state machine, append-only WAL eventlog, Ed25519 capability cards **+ the canonical macaroon discharge gate** (`pd-anchor::macaroon`, ADR-0053 Phase 1), job/context runtime, read-only TS→Rust import bridge | **On `main` — landed via PR #306 (2026-06-15), AFTER this ADR was accepted.** Supersedes the "no `core/kernel`" stance in Part 2 below. | The TS daemon (via FFI, planned) | **Canonical-impl landed, FFI pending** — `pd-anchor::macaroon` is the canonical macaroon implementation; the TS `lib/macaroon` is deprecated to a byte-parity fallback (the harbor-card-rs model), pending shared test vectors + a koffi FFI client |

So the Rust surface is four crates at four different maturities: one standalone TUI
binary, one stub shadowed by working TypeScript, one FFI library whose binary is not
built so its TypeScript fallback is the real enforcer, and one native shell that is
not merged. **None of them is a "kernel," and none of them is the load-bearing
runtime.** The load-bearing runtime is the **Bun/TypeScript daemon** (*`server.ts`
plus `lib/*.ts`, compiled to a standalone binary by `scripts/build-single-binary.mjs`*).
That is what `pd` *is* when you `brew install` it.

**FleetBar** (*`apps/FleetBar/`, a Swift macOS menu-bar app, `Package.swift`*) is the
fourth surface and it is **Swift, not Rust**. It talks to the daemon over HTTP. It
shares no code with any `core/*` crate. The honest answer to "is it in sync with
Rust?" is: it is not *out of* sync because it was never *in* a shared codebase — it
is a separate client of the same daemon API.

### Why this matters now

ADR-0046 (operator-TUI) committed to a native Rust/GPUI seat (`pd-console`). PRs #306
and #318 are that work, unlanded. ADR-0049/0050 (relay, Coast Guard) added more
TypeScript surface. The operator is now holding a mental model — "the Rust kernel" —
that the repository does not contain and does not document. That gap is the actual
risk: a future session reading `core/` finds three stub-ish crates and cannot tell
whether they are the future, dead ends, or load-bearing. This ADR removes that
ambiguity.

## Decision Drivers

- A release must be **answerable** — at any moment a future session should be able to
  read one runbook and cut a correct release without archaeology.
- The Homebrew-lag pain has **two fixes** and they compose: a *named cut rhythm* so
  releases happen on a predictable beat, and a *staleness signal* so an installed `pd`
  tells the user it is behind.
- The Rust answer must be **honest about aspirational vs shipped**. Inventing a kernel
  in prose would repeat the write-only-document failure ADR-0043 was written against.
- Single-person reality: every "who triggers" answer is "Erich." The value is not
  delegation; it is a **checklist that survives context loss between sessions**.

## Decision

### Part 1 — Release cadence (programmed + broadcast)

#### Lane rhythms

**Website (Cloudflare) — continuous, with a hotfix path.**
Keep the auto-deploy on merge to `main`. It is correct: the website should be whatever
last landed. The discipline is the **bug-catch + hotfix path**, because continuous
deploy means a bad merge is live in minutes:

1. The workflow's **empty-root safety net** is load-bearing — do not remove it. CF
   Pages' own git integration may fire first and ship an empty-body deploy; our
   workflow runs after and overwrites it with snapped HTML (last-writer-wins). The
   "Assert snap landed real content" step hard-fails if `dist/index.html` still has
   `<div id="root"></div>` or any indexable route is under 10 KB. A green deploy is
   therefore a *content-verified* deploy.
2. **Hotfix**: a site regression is a normal PR to `main` touching `website-v2/**`.
   It auto-deploys on merge. No release, no version bump — the website is not
   versioned. If the auto-deploy itself is broken, `workflow_dispatch` on
   `deploy-website-v2.yml` re-runs it.

**Binary + npm + Homebrew + FleetBar — the cut, on a named beat plus on-demand hotfix.**
These four move together from `release.yml`. Adopt a **weekly cut, Friday**, plus an
**on-demand hotfix** path:

- **Friday cut (the beat):** if `main` has shipped any user-facing change since the
  last tag, the operator cuts a release Friday. If nothing user-facing landed, skip —
  an empty release is noise. This is a *ceiling on staleness* (at most a week behind),
  not a mandate to release weekly.
- **On-demand hotfix (the escape):** a severity-1 fix (the daemon lies, secrets leak,
  `pd` won't start) does not wait for Friday. Cut immediately.

#### Semver bump rule

Port Daddy follows SemVer (`CHANGELOG.md` already declares this). The bump rule:

- **patch** (`3.18.0 → 3.18.1`): bug fixes, no new surface, no behavior change for
  correct callers.
- **minor** (`3.18.0 → 3.19.0`): new commands, new routes, new MCP tools, new flags —
  additive, backward-compatible. This is the common case; most weeks are a minor.
- **major** (`3.x → 4.0.0`): a removed/renamed CLI command, route, or MCP tool; a
  changed default that breaks existing callers. Rare. The v4 line is reserved for the
  distribution rework already sketched in MEMORY.

#### The cut runbook (a future session can follow this verbatim)

> **Preflight** (this repo's gotchas apply — see `AGENTS.md`):
> 1. `git fetch origin && git rebase origin/main` — never cut from a stale tree.
> 2. `pd guard status` — coordination guard should be enforcing.
> 3. Confirm CI is green on `main` (every required check), not just "looks done."
>
> **Decide the version:**
> 4. Apply the bump rule above against everything in `CHANGELOG.md` `[Unreleased]`.
> 5. Bump `package.json` `version`. Move `[Unreleased]` entries under a new
>    `## [X.Y.Z] - YYYY-MM-DD` heading in `CHANGELOG.md`. Leave `[Unreleased]` empty.
>    Commit (`--no-verify`, no `Co-Authored-By` trailer).
>
> **Cut:**
> 6. `git tag vX.Y.Z && git push origin vX.Y.Z`.
> 7. `env -u GITHUB_HOST gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <changelog-section>`.
>    This `release: published` event fires `release.yml`: `build-binaries` →
>    `build-fleetbar-preview` → `publish-npm` → `update-homebrew` (the tap dispatch).
>
> **Verify the cut actually landed (do not trust green):**
> 8. `build-binaries`, `build-fleetbar-preview`, and `build-latest-json` are the
>    gate. Tagged `v3.30.3` made FleetBar and `latest.json` essential release cargo:
>    `update-homebrew` now waits on all three because the tap consumes
>    `latest.json`, and the operator ships the daemon and FleetBar together. Do
>    not bypass a red FleetBar preview and expect Homebrew promotion to remain
>    correct.
> 9. If a required release lane failed partway (historically this included the
>    `bun install` regression, and now includes FleetBar/`latest.json` because
>    they gate Homebrew promotion), repair the underlying lane and re-run via
>    `workflow_dispatch` with `tag=vX.Y.Z` — that path is a deliberate recovery
>    trigger, not a second publisher.
> 10. `brew update && brew upgrade port-daddy`, then `pd --version` — confirm the
>     installed binary matches the tag. **This is the step the lag hides; do not skip it.**
>
> **Broadcast (the missing half today):**
> 11. The `CHANGELOG.md` section IS the canonical release note. Keep it human-readable.
> 12. `pd note "release vX.Y.Z cut: <one-line summary>. brew upgrade to get it."` on
>     the `port-daddy` harbor — this is the durable, queryable broadcast a future
>     session or watching agent reads. Chat-only is not enough (house rule).
> 13. If the change is user-facing, add a `/changelog`-table entry per the repo's
>     changelog protocol.

#### Fix the drift defects (this ADR's concrete deliverables)

- **Delete `Formula/port-daddy.rb`** from this repo, or replace its body with a
  one-line pointer comment to `curiositech/homebrew-tap`. It is a fake that pins
  `v3.7.0` with a placeholder SHA while the live tap is at 3.18.0. A lying file is
  worse than no file. (Phase 1.)
- **Auto-bump the tap is already wired** (`update-homebrew` repository-dispatches the
  tap with the new version). The defect is only the stale in-repo decoy; removing it
  closes the lie.
- **Ship a `pd self-update` staleness check** (Phase 2): on `pd` startup (throttled,
  e.g. once/day), compare the running version against the latest GitHub release tag
  and, if behind, print one line — `pd 3.18.0 installed; 3.19.0 available — brew
  upgrade port-daddy`. This converts the silent lag into a visible nudge. FleetBar
  gets the same signal as a badge (already tracked as task #143).

### Part 2 — Rust-surface alignment

**Decision: the `core/*` crates are intentionally separate, bounded crates — NOT a
single kernel today — and the TypeScript daemon remains the load-bearing runtime.**
This is stated loudly so the answer to "does everyone know about the rust kernel?" is
answered by this document: **there is no single Rust kernel. There are four bounded
Rust surfaces, each a satellite of the TypeScript daemon, at four maturities.** Read
the table in Context for the per-crate truth.

The migration target — **aspirational, not shipped** — is:

1. **`harbor-card-rs` becomes real first.** It is the only crate with a load-bearing
   reason to be Rust: it is the capability/identity enforcer, and a memory-safe,
   FFI-callable enforcer is a security upgrade over the TS fallback that
   `cap-attenuation-monitor.ts` runs today. **ETA: next minor after the FFI build is
   wired into `scripts/build-single-binary.mjs` and CI.** Until then the TS fallback
   is canonical and that is fine — it is ProVerif-verified.
2. **`pd-console` lands** (PRs #306/#318) as the ADR-0046 native seat. It consumes the
   daemon API, same as FleetBar. It does **not** absorb the other crates.
3. **`pd-bosun` and `pd-tui` stay bounded satellites.** `pd-bosun` is a supervisor;
   `pd-tui` is a set of terminal surfaces. Neither needs to merge into a kernel. If
   `pd-bosun` (Rust) ever replaces `lib/bosun-heartbeat.ts` (TS), that is a
   one-for-one swap behind the same daemon contract, decided in its own ADR.

There is **no `core/kernel`** and this ADR does **not** create one. Naming a kernel
that does not exist would be the exact write-only-document lie ADR-0043 forbids. If a
shared-crate workspace ever becomes worth it (today it is not — three stubs do not
justify a `Cargo.toml` workspace), that is a future ADR with its own Implementation
Matrix.

#### Update (2026-06-15) — the kernel landed; the macaroon gate is kernel-canonical

The paragraph above is **superseded by reality**: **`core/kernel/` landed on `main`
via PR #306** three days after this ADR was accepted. It is a real
`Cargo.toml` workspace — `pd-core` (work-transaction state machine), `pd-eventlog`
(single-writer WAL append-only log), `pd-anchor` (Ed25519 capability cards), plus
`pd-runtime`/`pd-compat`/`pd-mesh`/`pd-tui`. An independent adversarial review (logged
on PR #390) found the crates real and tested — not the stubs this ADR assumed. The
"three stubs do not justify a workspace" judgment was correct *when written*; the
work-list grew, so the judgment changed. This is the honest-update discipline of
ADR-0043, not a reversal in bad faith.

One concrete convergence decision follows from the landing, and it is the reason for
this update:

**The macaroon discharge gate is kernel-canonical.** The capability primitive of
ADR-0053 (a **macaroon** — Birgisson et al. 2014, a bearer credential whose authority
only narrows) exists in two runtimes: a TypeScript library (`lib/macaroon`, PRs
#384/#385) and a Rust module (`pd-anchor::macaroon`, ADR-0053 Step A). They are **not
wire-compatible** — TS seals the third-party-caveat verification id with AES-GCM, Rust
uses an HMAC commitment (no AEAD dependency, sound in the daemon-is-verifier-and-key-
holder model). Two live verifiers of the same credential is the OP-3 dual-runtime
hazard the *Single-Writer Kernel* whitepaper names (invariant I11).

The resolution, mirroring **`harbor-card-rs`** exactly (this ADR's Phase 4): the
**Rust `pd-anchor::macaroon` is the canonical implementation and the preferred runtime
path via FFI**; the TS `lib/macaroon` is **deprecated to a byte-parity fallback** used
only when the FFI dylib is absent (source installs, CI) — the same posture
`cap-attenuation-monitor.ts` holds toward the harbor enforcer today. Parity is made
enforceable, not aspirational, by **shared test vectors generated from the canonical
Rust impl** that both test suites assert against; the TS third-party construction is
realigned to the Rust HMAC commitment so the divergence closes. The koffi FFI client
(`lib/arbiter.ts` is the working template) and the build wiring follow the
`harbor-card-rs` precedent in Phase 4.

### Part 3 — The sync question, answered plainly

**Is FleetBar in sync with the Rust surfaces? No — and they were never meant to be in
the same codebase.** FleetBar is Swift; `pd-console` (its eventual Rust sibling) is
unlanded. They are two native clients of one daemon. The convergence prescription is
**contract convergence, not code convergence**: both FleetBar and `pd-console` must
speak the same daemon HTTP/SSE API (the relay envelope of ADR-0049, the attention/
pheromone routes of ADR-0046). They will never share a binary; they must share an
*interface*. When `pd-console` lands, the rule is: any daemon route FleetBar consumes,
`pd-console` consumes the same way, and a route added for one is added to the API
contract, not bolted onto one client.

## Consequences

**Positive.**
- A future session can cut a release from the runbook without reconstructing the
  pipeline. The Friday beat caps staleness; the hotfix path handles emergencies.
- The `pd note` broadcast + `CHANGELOG` section make a release a *legible event* on a
  channel agents and the operator already read.
- The Rust answer is written down once, honestly. Nobody re-derives "wait, is there a
  kernel?" from `core/` ever again.
- Deleting the fake Formula stops the repo lying about its own distribution.

**Negative / cost.**
- The Friday beat is a discipline a single operator must keep; a forgotten Friday
  means a week of lag. The `pd self-update` nudge (Phase 2) is the mitigation, and
  until it ships the lag is still silent.
- "Intentionally separate crates" defers the kernel question rather than resolving it.
  That is the honest call today, but it means the operator's mental "kernel" stays a
  concept until a real convergence need appears.
- `harbor-card-rs` running its TS fallback in production is acceptable (ProVerif-
  verified) but is not the memory-safety win the Rust crate promises. The win waits on
  the FFI build wiring.

**Neutral.**
- The website cadence does not change — it was already correct. This ADR only writes
  down *why* (continuous-on-merge with a verified-content gate) so it is not "fixed"
  by someone who mistakes continuous deploy for a missing cadence.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0054-phase-0-cadence-runbook | now | — | This ADR: cadence runbook + lane rhythms + semver rule documented |
| 1 | adr-0054-phase-1-kill-fake-formula | now | adr-0054-phase-0-cadence-runbook | Delete/replace stale `Formula/port-daddy.rb` (pins fake v3.7.0); tap is the only truth |
| 2 | adr-0054-phase-2-pd-self-update-staleness | now | adr-0054-phase-1-kill-fake-formula | `pd self-update` startup staleness check vs latest release tag + FleetBar badge (task #143) |
| 3 | adr-0054-phase-3-release-broadcast-note | now | adr-0054-phase-0-cadence-runbook | Make `pd note` release broadcast a step in the cut (and, if automatable, a `release.yml` job) |
| 4 | adr-0054-phase-4-harbor-card-ffi-build | now | — | Wire `harbor-card-rs` FFI build into `build-single-binary.mjs` + CI so the Rust enforcer replaces the TS fallback |
| 5 | adr-0054-phase-5-console-api-parity | now | adr-0046-operator-tui | Land `pd-console` (PRs #306/#318); enforce daemon-API parity with FleetBar (contract, not code) |
| 6 | adr-0054-phase-6-macaroon-kernel-canonical | now | adr-0053-macaroon-discharge-gate | Make `pd-anchor::macaroon` the canonical macaroon implementation (PR #393 landed it). Generate shared test vectors from the Rust impl; realign the TS `lib/macaroon` third-party caveat to the Rust HMAC commitment + assert byte-parity against the vectors; deprecate `lib/macaroon` to the fallback role. Then a koffi FFI client (template: `lib/arbiter.ts`) + build wiring, mirroring Phase 4. |

Slugs are the join key; keep them stable. Per ADR-0043, Cartographer owns syncing
these rows to `roadmap_items` and `pd adr matrix 0054` renders live status.

## References

- ADR-0043 — ADRs carry a roadmap-linked Implementation Matrix (the matrix convention above)
- ADR-0046 — The operator TUI (`pd-console`, PRs #306/#318)
- ADR-0049 — Relay v0 architecture (the daemon API contract FleetBar + `pd-console` must share)
- ADR-0050 — Coast Guard (a recent TypeScript-daemon surface; shipped in 3.18.0)
- `.github/workflows/release.yml` — binary + FleetBar + npm + Homebrew lanes
- `.github/workflows/deploy-website-v2.yml` — continuous Cloudflare Pages deploy
- `curiositech/homebrew-tap` — the **live** formula (NOT `Formula/port-daddy.rb` in this repo)
- `core/pd-tui`, `core/pd-bosun`, `core/harbor-card-rs` — the on-`main` Rust crates
- `apps/FleetBar/Package.swift` — the Swift menu-bar client
