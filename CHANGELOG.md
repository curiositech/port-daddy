# Changelog

All notable changes to Port Daddy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **The end-of-turn SITREP is now the harness's visible value surface.** A per-repo `sitrep.endOfTurn` dial (`off` | `suggest` | `enforce`, default `enforce`; `PD_SITREP` env override, then `agent.config.json` → `.portdaddy/sitrep.json` → `.portdaddy/project.json`) governs a standing end-of-turn SITREP table contract injected each turn by the Squid prompt tentacle and taught at session birth by the Pilot SessionStart hook: track ideas, roadmap claims, and assigned work; update Status each turn; carry unresolved rows forward; and mint a roadmap link before writing code for a row. The coordination envelope keeps its existing invisible-and-bounded byte caps — the SITREP block is a constant-size contract that rides outside them. This supplants the earlier quiet-hooks doctrine by operator decision (2026-08-22).

### Fixed
- **`pd sitrep --template` no longer hardcodes an operator's home directory in the transcript pointer** — the path is derived from the running user's homedir — **and its Ideas/Suggestions/Remediations table pre-fills from active roadmap-pop claims** (fail-silent back to the blank scaffold when the cartographer routes are absent) instead of emitting an empty placeholder row.
- **Release supervision and promotion now enforce the supported single-supervisor boundary end to end.** `pd doctor` keeps optional legacy Bosun state visible without treating its deliberate v3.28+ absence as a critical defect, while redirected doctor targets no longer borrow canonical launchd or registry evidence. Release CI omits the retired watchdog build, attests both sealed platform archives, and waits for the Homebrew tap's credential-independent, evidence-verified self-promotion instead of relying on a fragile cross-repository write token.

## [3.30.2] - 2026-08-21

### Added
- **Squid hook execution is inspectable per session without exposing tool payloads.** The debug timeline records each bounded lifecycle step with actual and expected timestamps, elapsed time, outcome, and a short plain-language description, while keeping arguments, prompts, and command contents out of the diagnostic record.

### Fixed
- **Interactive hooks are fast, cumulative, and self-disabling instead of becoming a turn-by-turn storm.** The installer emits one prompt hook and one edit-time hook with no generic post-tool fan-out, stages version-stable tentacle paths instead of Homebrew Cellar paths, and migrates obsolete Codex registrations. Portable timing works under macOS and Linux `dash`; repeated failures or budget overruns open a no-retry circuit breaker after three cumulative failures, make later calls immediate no-ops, emit one remediation notice, and expose native Repair through Squid/FleetBar. Atomic failure receipts preserve the count even when many hook processes fail concurrently.
- **Fleet Purser output validation rejects non-source JSON-string bypasses.** The repaired contract tests cover sibling and mixed-fence cases so generated reviewer text cannot masquerade as source evidence.

## [3.30.1] - 2026-08-21

### Fixed
- **Plans now follow the documented CLI syntax and close against the newest checklist.** `pd plan set "- [ ] ..."` preserves quoted Markdown without requiring an extra `--`, while `pd plan show` and `pd done` agree on the latest plan revision even when an older checklist was incomplete.
- **Coordination failures stay safe and observable.** Guard guidance no longer teaches agents the operator escape hatch, every long-lived Bun child receives the JavaScriptCore safe-mode environment, and rejected `pd begin` attempts reach usage telemetry without creating ghost sessions.
- **Supported Homebrew installs stay quiet on successful commands.** Canonical `pd`, `port-daddy`, and `port-daddy-daemon` executables in a flat `bin/` layout no longer emit the internal unconventional-layout warning; noncanonical binaries still warn and retain the safe fallback.

## [3.30.0] - 2026-08-21

### Added
- **Trusted executor identity, mediator, and Mercy telemetry complete the remote-fleet control loop.** Relay now provisions operator-approved Fleet Executor identities, verifies signed publish/run reports against the current relay and channel, enforces durable per-harbor daily budgets, predicts mediator conflicts, chains summonses and acknowledgements, and requires a human gate for irreversible actions. The Mercy surface reports hook health and SLO burn with request correlation, bounded identifiers, fail-closed quota errors, and readable mobile evidence.

### Fixed
- **Agent startup coordination is fast and nonblocking.** Empty `pd attention` calls no longer run channel discovery/history scans inline, and operator-state Guard probes moved behind an asynchronous stale-while-revalidate cache. A fresh current-main daemon now returns real source-CLI attention calls in 0.81–0.94 seconds instead of the observed cold/contention path near 60 seconds, while preserving inbox, channel, and parley delivery semantics.
- **Fleet and tutorial cleanup paths fail safely.** Executor credentials stay out of transcripts, retryable telemetry drains ride the Worker execution context, generated Purser duplicates no longer masquerade as coverage, and tutorial cleanup preserves its lock owner across retries.
- **Release publication detects and recovers carrier topology.** Version-transition discovery, token failures, tap polling, and fresh-install contracts are executable tests rather than path-only checks, so a rebased/Purser-carried release can still tag the exact version transition and fail loudly when publication authority is unavailable.

## [3.29.0] - 2026-08-20

### Added
- **Seamanship slice 1 — the skill layer becomes auditable, owned, and graph-aware.** (1) *Weighted first-hop graft expansion*: `lib/skill-graft.ts` builds a skill-reference graph at scan time (`pairs-with` frontmatter edges outrank prose mentions) and expands the craft() candidate pool one hop from the top fused seeds with decay — ranked entries carry `via`/`hopSeed` provenance so a neighbor never surfaces silently; injection caps unchanged. Transitive closure was measured (median 40, max 145 skills) and rejected in favor of first hop (median 3, max 10). (2) *Skill ownership*: `owner` / `repos` / `visibility` frontmatter parsed catalog-wide, defaulting **private** — absence never widens exposure; `isPublishableSkill()` is the single predicate any future listing/publishing path must call; `pd seamanship list/show` surface the fields. (3) *Auditable grafts*: the fleet's native graft path now records a schema-conformant `skill-graft` transcript event (`lib/skill-graft-events.ts`, per `schemas/agent-harbor/v0/skill-graft.schema.json`) — grafts become auditable facts, not silent prompt injection; recording is fail-open so telemetry can never break a spawn. (4) `docs/research/skills-io-and-composition.md`: skills as typed transforms, the measured composition graph, and the graft/Snipe implications.

### Fixed
- **Fleet-executor retries resume instead of restarting.** Each completed ship's verdict is checkpointed to the run transcript (own seq band, no migration); a retried delivery — or a DLQ replay of it — reuses those verdicts and spends only on ships that never finished. This makes runs converge when attempts complete at least one ship under the uncatchable platform-kill class (memory/CPU isolate termination), ends the retry treadmill of re-running (and re-paying for) every completed ship, and lets the dead-letter summary report how many ships finished before a loss. `fleet-runs` `max_retries` is raised 3→5 for bounded headroom; a ship that dies before checkpointing can still repeat unfinished work.

## [3.28.2] - 2026-08-18

## [3.28.1] - 2026-08-18

## [3.28.0] - 2026-08-15

### Added
- **FleetBar Giant Squid controls.** The selected-project header now shows an unmistakable `◆ GIANT SQUID` LIVE/READY/PARTIAL/DEGRADED strip, detected/wired provider counts, the before-turn/before-edit/after-tool value being added, and native Arm/Repair/Disarm actions.

### Fixed
- **`pd squid on` is now the one truthful full-harness command.** The duplicate `pd squid hooks` surface was removed; setup, init, doctor, and repair guidance use the canonical interactive installer and real provider scopes. Codex/agy user-level hooks now require an exact armed-project registry match, so disarming one repo actually makes them inert there without removing hooks needed by another repo.
- **Squid release cargo is proved end to end.** Tentacles, statusline, and the Pilot SessionStart hook share one runtime asset resolver and declarative Batten manifest. Release CI launches the staged binary outside the source tree and verifies all four provider configs, identity surfaces, and READY JSON status before packaging.
- **Prompt injections are bounded and fresh.** Next-turn narration is limited to 12 exact-project entries and 4 KiB, with 30-minute TTL enforcement for timestamped alerts and pheromones.

## [3.27.0] - 2026-07-23

### Added
- **`pd account` — GitHub device-flow login for the CLI (ADR-0101 Phase 1).** `pd account login` (alias `pair`) runs the GitHub device flow, opens the browser, and stores a `pdu_` personal access token at `~/.port-daddy/account.json` (0600); `pd account status | logout | token` round it out. This gives the CLI (and, next, FleetBar / pd-console) a real cloud identity. Relay-side: a `user_tokens` table (SHA-256 of the token only, revocable), `POST /auth/device/start` + `/auth/device/token` (GitHub device-flow proxy — GitHub tokens never leave the relay), and `GET /auth/whoami` (accepts a `pdu_` bearer or the browser session cookie). Requires "Enable Device Flow" on the GitHub App and the `user_tokens` D1 migration.
- **Storefront account surfaces (ADR-0101 Phase 1).** Server-rendered, script-free `/login` and `/account` pages on the relay, built to the ch20 story-linework design (warm substrate, cobalt knockout slab, ICS signal flags). GitHub login now lands on a real signed-in `/account` page (identity plate, export/delete) instead of a 404; `/` redirects to `/account`.
- **`activate-accounts.sh`** — one-shot operator helper to set the six accounts/login/run-page Worker secrets across the relay + fleet-executor.
- **Runtime egress-assertion gate** (`lib/safe/egress-assertion.ts`, ADR-0101 Critical 1) — fail-closed "local-only uploads nothing" check with a `verified` flag so an unobservable host is never a silent pass.

### Fixed
- **`pd squid hooks` on a compiled install** — the `pd-hook-*` tentacles are now shipped in the release tarball next to `pd`, and `tentaclePath()` resolves them relative to `process.execPath` instead of a synthetic `import.meta.url` (which collapsed to a bogus `/bin/pd-hook-prompt` in the single-file binary).
- **CSRF defense-in-depth** on `POST /account/delete` + `/auth/logout` — cross-origin requests are refused (403) on top of the existing `SameSite=Lax` session cookie.

## [3.26.4] - 2026-07-23

### Fixed
- **Completes the "Bosun watchdog survives `brew upgrade`" fix (3.26.3).** 3.26.3 made the plist's `ExecStart` reference the stable `<prefix>/bin/pd-bosun` symlink, but three OTHER launch-critical fields — `WorkingDirectory`, `StandardOutPath`, and `StandardErrorPath` — still embedded the versioned Cellar keg path (`join(__dirname, …)`), which the next `brew upgrade` deletes. launchd cannot `chdir` to a missing WorkingDirectory or open a log file under a deleted keg, so the watchdog would still fail to launch (`EX_CONFIG`) on the upgrade after next. Those now use the version-independent durable home (`~/.port-daddy/pd-bosun.log`, WorkingDirectory `~/.port-daddy`), so every launch-critical field in `com.portdaddy.bosun.plist` is now upgrade-stable.

## [3.26.3] - 2026-07-23

### Fixed
- **The Bosun watchdog survives `brew upgrade` — it no longer points at a deleted keg.** The generated `com.portdaddy.bosun.plist` embedded a **versioned** Cellar path (e.g. `.../3.26.1_2/bin/pd-bosun`); the next `brew upgrade` deletes that keg, so launchd's `ExecStart` failed with `EX_CONFIG` and a crashing daemon (the known upstream Bun 1.2.21 #676 segfault family) no longer auto-restarted — turning an ordinary crash into a silent outage until someone re-ran `port-daddy install-bosun` by hand. The plist now references the **version-stable `<prefix>/bin/pd-bosun` symlink** that Homebrew repoints on every upgrade, so it stays valid across upgrades. The formula's `post_install` already calls `install-bosun`, so this makes that regeneration produce a durable plist (derived from `process.execPath`, covering both the brew-symlink invocation and the brew-keg invocation during `post_install`). Non-Homebrew/source installs are unchanged (they fall back to the existing resolver).

## [3.26.2] - 2026-07-23

### Fixed
- **`pd doctor` no longer exits 0 while the daemon is DOWN.** The biggest doctor lie: a failed check only ever emitted `warn`, never `critical`, so `pd doctor --ci`/`--json` returned exit 0 (a green build) over an unreachable or not-running daemon. Daemon-unreachable / invalid-health / not-running are now CRITICAL and gate the exit code. A CI honesty-gate assertion (`scripts/ci-doctor-gate.sh`) runs `pd doctor` against a dead port and fails the build if it exits 0.
- **`pd setup` works from a Homebrew install instead of failing with a fake remediation, and the "Resource directory" check stops lying.** Root cause: for a compiled `pd` binary, `__dirname` collapses to `/`, so `resolveDistributionRoot` returned `/` — making everything resolve under the filesystem root (`resolvedRoot=/`, `expectedBinary=/dist/daemon/… MISSING`). That made `pd setup` run a non-existent `/node_modules/.bin/tsx install-daemon.ts` (→ "Daemon install failed" → the fake `pd daemon install` remediation, which is not a real subcommand), and made doctor's "Resource directory" check report a green ✓ while broken. `resolveDistributionRoot` now routes `/` through execPath resolution (like a bun-virtual path), `pd setup` detects a packaged build and gives a real remediation (`brew services restart port-daddy`), and the Resource-directory check reports "packaged install — the daemon is bundled in the compiled binary" instead of the source-only "run npm run build:daemon:dist".
- **`pd doctor` stops overstating "the daemon is crash-looping".** The Bun-crash check scans the (possibly unrotated) daemon-log tail, so historical crash banners made it assert a present-tense crash-loop even on a stable daemon. It now says the daemon "has crashed repeatedly … check `pd status` uptime for the live state" — still CRITICAL when banners are present, but no longer a false present-tense claim.
- **`pd doctor` version checks stop reading "CLI vunknown".** The compiled `pd` has no sibling `package.json`, so the CLI self-version fell back to `unknown` and then advised a pointless restart. It now reads a stamped `EMBEDDED_PACKAGE_VERSION` (synced every release by `scripts/sync-version.ts`, same mechanism as `server.ts`).

## [3.26.1] - 2026-07-23

### Fixed
- **The Bosun watchdog is now correctly detected on a Homebrew install, and a genuinely-missing watchdog is a REQUIRED (critical) doctor failure, not a warning.** `resolveBosunBinaryPath` only looked for the supervisor flat at `<root>/pd-bosun` plus source/dist fallbacks — never `<root>/bin/pd-bosun`, which is exactly where brew installs it next to `pd`. So `pd doctor` reported "pd-bosun binary not built" on every brew install *even while the daemon's own `guardians.bosun` reported the binary present and the heartbeat healthy* (reproduced live on 3.26.0). Two fixes: (1) the resolver now also checks `<root>/bin/pd-bosun` and `<root>/libexec/bin/pd-bosun`; (2) the doctor check trusts the daemon's authoritative `guardians.bosun.binaryExists`/state over its own local path guess when the daemon is reachable, and escalates a truly-absent watchdog to CRITICAL so a supervisor-less build fails `pd doctor` (non-zero exit) instead of shipping with a silent warning. The CI release + smoke jobs now build `pd-bosun` before the doctor gate, so CI proves the watchdog actually ships.
- **`pd doctor` can no longer report ✓ healthy for a check it never actually ran.** Three checks — DB fragmentation, Stuck lsof processes, and Shell-idiom `.env.local` — caught their own probe failure and reported `✓ "Could not check (skipped)"`, turning "I couldn't look" into "it's fine." They now surface as a WARN (unknown), never a green pass.
- **`pd doctor` no longer calls a live process "stale".** Stale-services and PID-file checks used a bare `process.kill(pid,0)` that treats **EPERM** (a live process owned by another uid) as dead — advising deletion of a running daemon's pidfile. Both now reuse `isPidAlive`, which correctly treats EPERM as alive.
- **A CI honesty gate (`scripts/ci-doctor-gate.sh`) now fails the build if `pd doctor` lies:** it runs the *compiled* `pd doctor --json` against a freshly-booted daemon and asserts no check reports OK while admitting it could not check, the Bosun watchdog is present (never the "not built" false-negative), and the report actually ran its full check set (no short-circuit to a tiny green report).

## [3.26.0] - 2026-07-23

### Added
- **Unified observability layer (`lib/observability/`, #3142) — the shared primitives whose absence let a daemon write 313 GB and log the same error 7,182 times.** A four-front audit found the identical failure mode had recurred twice (`semantic_resolution_failed`, and earlier `bosun_heartbeat_write_failed`): error-level logging inside an unthrottled retry/poll loop, no dedup, feeding an unrotated sink. This release closes the *class*: a **log governor** (per-key dedup + rate-limit + sampling with honest suppression rollups — a loop can emit a few lines then `…and N more`, never the full storm), a **gated loader** (a circuit breaker around a load-once dependency that finally *wires* the previously dead-code `agent-resilience.ts` full-jitter backoff + breaker), a **retention registry** (one declared policy per table + `incremental_vacuum` reclaim + a fail-loud coverage guard), a **self-monitor** (alarms on the daemon's OWN db/wal/row footprint, not whole-disk %), and **correlation context** (`requestId`/`actorId`/`tenantId` threaded via `AsyncLocalStorage` for the multi-tenant horizon). 37 new unit tests.
- **Global failure visibility.** `unhandledRejection`/`uncaughtException` handlers (previously absent — a long-lived daemon could die or corrupt silently) and a durable `RESOURCE_ALARM` activity type so a runaway footprint leaves an audit trail.
- **Five skill-architect-validated skills** encoding the discipline: `responsible-logging`, `resilience-wiring-for-load-once-deps` (defers to the existing `circuit-breakers-and-retries` canon rather than duplicating it), `db-retention-and-compaction`, `self-monitoring-resource-alarms`, `observability-absences-audit`.

### Fixed
- **The semantic-resolver embedder no longer doom-loops on a broken native dependency (#3142).** `getEmbedder()` memoized the embedder promise and never reset it on failure, so a missing ONNX/transformers dylib became a permanently-rejected promise re-awaited on every fleet-agent tick — each awaiting, logging a full error, and writing a DB row. Loads now go through the gated loader: after a few failures the breaker OPENs and stops re-attempting the native load (no repeated `dlopen`, no per-tick spam), periodically re-probing so a genuinely transient failure still recovers. Regression-tested (40 ticks → ≤3 load attempts, ≤3 log lines).
- **Two unbounded tables are now pruned, and pruning actually shrinks the file.** `harbor_issued_tokens` (a reaper index existed but the `DELETE` was never written — 101K expired-token rows) and `semantic_resolution_events` (no prune at all) are swept on the cleanup tick, and `auto_vacuum=INCREMENTAL` plus an `incremental_vacuum` reclaim step return freed pages to the OS — previously a pruned registry never shrank on disk.

## [3.25.2] - 2026-07-15

### Fixed
- **`port-daddy install-bosun` actually succeeds when the Homebrew formula's `post_install` calls it (found live during the v3.25.1 rollout).** `install-bosun` (new in 3.25.1) was missing from `FRESHNESS_SKIP_COMMANDS` — unlike `install`/`uninstall`/`start`/`stop`/`restart`, which are already skip-listed for exactly this reason. The CLI's daemon-freshness probe ran for it, detected the still-live-but-stale-code daemon left over from the in-flight upgrade, and attempted its normal auto-restart-via-`tsx` recovery path — which doesn't exist in a packaged brew install — tripping the top-level "daemon unreachable" handler and making the whole `install-bosun` invocation report failure even though the actual (network-free) watchdog-wiring logic had already completed. `install-bosun` is now in the skip list alongside its daemon-lifecycle siblings, with a regression test (`tests/unit/cli-freshness.test.js`) locking it in.

## [3.25.1] - 2026-07-15

### Fixed
- **Bosun actually ships and runs on a Homebrew install — the daemon can no longer go down quietly (roadmap: daemon-down-hard-stop-mandate).** PR #2381 taught `release.yml` to build `pd-bosun` (ADR-0036's out-of-process watchdog) into the release tarball, but the published v3.25.0 tarball predated that change and the `curiositech/homebrew-tap` formula only ran `bin.install "pd", "port-daddy"` — so every brew install shipped a daemon with no watchdog binary at all. This release: ships v3.25.1 binaries (built from the merged Bosun-Phase-C tarball), fixes the tap formula to install `pd-bosun` alongside `pd`/`port-daddy`, and adds `port-daddy install-bosun` — a new, non-destructive CLI subcommand the formula's `post_install` calls unconditionally to wire the Bosun launchd job against the brew-managed daemon label. `install-bosun` is deliberately narrower than the existing `port-daddy install`: the full install path only skips creating a competing standalone daemon LaunchAgent when it detects `homebrew.mxcl.port-daddy` already loaded, which isn't true yet at `post_install` time (before `brew services start` has run) — calling it there would have raced brew's own supervisor for `:9876`. Bosun has no such ordering hazard (it's a one-way heartbeat watcher that best-effort `launchctl kickstart`s the daemon label), so it's safe to wire at install time regardless of whether the brew service has started yet.

## [3.25.0] - 2026-07-14

### Fixed
- **The registry now lives in a durable home and survives `brew upgrade` (#2067, #2083).** The default DB path was anchored on the distribution root — for Homebrew installs, the versioned Cellar directory that is deleted on every upgrade. That is how the machine repeatedly lost roadmap items, notes, sessions, and even the Harbor Card signing keys. `resolveDbPath()` now defaults to `~/.port-daddy/port-registry.db` (checkout- and binary-independent); first boot performs a one-time `VACUUM INTO` rescue of the legacy registry, scanning sibling Homebrew kegs newest-first because after an upgrade the data sits in the *previous* keg, not the one the new binary resolves to. Explicit `PORT_DADDY_DB` overrides (instance profiles, tests) keep their isolation semantics.
- **Roadmap deletes no longer resurrect from stale replicas (#2140).** `pd roadmap delete` was a hard DELETE of the row and its audit trail; in a multi-replica registry reconciled by union-merge, a deletion in one replica silently came back from any replica still carrying the row. Deletion is now a soft-delete tombstone (`deleted_at`) that bumps `last_touched_at` past the live row so last-write-wins reconciliation propagates it; audit rows are preserved; every read surface filters tombstones; upserting the same slug/harbor resurrects.

### Added
- **`scripts/registry-reunify.ts` (#2109)** — union-merges scattered registry shards (instance daemons, old kegs, backups) plus the committed roadmap snapshot into one registry: merge key `(slug, harbor)`, newest-`last_touched_at` wins whole-row, snapshot acts as a floor that never overrides fresher live rows, provenance appended to `notes_json`, destination backed up via `VACUUM INTO` before any write, idempotent, `--dry-run` prints the full plan.
- **Fail-closed schema verification at boot (#2122, #2140).** `verifyCoreSchema` probes the real schema objects (required tables + sentinel columns) after the boot migrations and refuses to serve from a broken registry; the legacy-rescue path post-verifies its output and quarantines (never deletes) a bad rescue.
- **`pd doctor` "Database home" check (#2067)** — critical when the registry sits on a version-volatile path (Homebrew Cellar), with exact remediation.
- **Weekly release-cadence workflow (#2067)** — files/refreshes a "Homebrew release overdue" issue when daemon surfaces on main sit unreleased past 7 days.
- **Cutover + porting doctrine (#2129, #2156, #2164)** — `docs/recovery/V3.25.0-DURABLE-HOME-CUTOVER.md` (eight verified steps incl. signing-key continuity) and ADR-0090 Amendment 1 (schema epochs, version-skew rules, per-table port policies).
- **`npm run test:affected` (#2174)** — local affected-only jest runs via `--changedSince=origin/main`.

## [3.24.2] - 2026-07-09

### Fixed
- **Daemon backend launches now resolve agent CLIs correctly and prove transcript capture before release (#1066).** The daemon no longer loses `claude`/`agy` resolution when launched under Homebrew/launchd-style PATHs, `cli:agy` is covered as a first-class backend, and the daemon transcript smoke is hard-gated with readback evidence so missing launch transcripts block CI instead of reaching users.

### Changed
- **README rewritten against the live v3.24 surface.** The front-door doc had rotted at v3.13: it never mentioned `pd setup`, `pd parley`, `pd dispatch`/`pd review`, `pd safe`, `pd secret` corralling, `pd cut`, daemon berths (`pd dev`/`pd use`), `pd embed`, `pd attention`/`pd nudge`, `pd transcripts`, or the harness lanes; it still advertised the retired web dashboard as "The Dashboard (HUD)"; its OpenAPI stats (96 paths/125 ops) and test badge (3,700+) were stale; and it never said `pd begin --lifecycle` is mandatory. The rewrite documents the three sanctioned operator surfaces (FleetBar, Control Center, pd-console), adds a complete Command Index grouped by task, refreshes the destructive-command list from `cli/permission-tiers.ts`, and states verified numbers (178 MCP tools + 6 resources, 115 API paths / 146 operations, 7,300+ test cases).

### Added
- **Commit-time README freshness gate (`scripts/check-readme-freshness.mjs`).** The pre-commit hook now blocks a commit that stages changes to README-documented surfaces — `cli/permission-tiers.ts`, `mcp/server.ts`, `docs/openapi.yaml`, `pd-fleet.yml`, `features.manifest.json`, or a NEW file under `cli/commands/` — without staging a README.md update alongside. Edits to existing command files do not trigger (internal churn is not a new verb). Escape hatch for genuinely internal changes: `PD_README_OK=1 git commit …` (logged to stderr). `npm run check:readme-freshness` runs it standalone; regression-tested in `tests/unit/readme-freshness-gate.test.js`.
- **README.md title and `docs/openapi.yaml` `info.version` are now synced + gated version surfaces.** `scripts/sync-version.ts` stamps both on every version bump (and `postversion` stages them), and `scripts/check-version-drift.mjs` fails CI when either drifts — the README can never silently claim an old version again, and the OpenAPI spec no longer lies at 3.10.0.
- **Per-project, daemon-gated coordination hooks for agent CLIs (pd-adr-090).** `pd hooks install` (plus a per-project silent step in `pd init` and a Yes-default staging step in `pd setup`) auto-detects which agent CLIs are installed — Claude Code, Codex, Gemini, Antigravity (`agy`) — and wires the Giant Squid Harness tentacles (`pd-hook-prompt` / `pd-hook-pre-tool` / `pd-hook-post-tool`) into their **interactive** sessions. **Per project, not machine-wide:** Claude/Gemini get config in the repo (`.claude/settings.json`, `.gemini/settings.json`); Codex (repo-local hooks don't fire interactively — openai/codex#17532) and agy (home-scoped `~/.gemini/hooks.json`) are user-level but **constrained by a runtime gate**. Every hook points at a gate wrapper that no-ops unless the pd daemon is running AND the cwd is inside a `.portdaddy/` project — so hooks are inert in non-pd projects or when the daemon is down. Hook shapes come from one shared source of truth (`lib/squid/hook-shape.ts`) used by both the headless squid adapter and this interactive installer, so they can't drift (enforced by integration tests). Edits are idempotent and reversible (`pd hooks uninstall`). Codex needs a one-time `/hooks` trust (persisted). `pd hooks list` shows status.
- **`pd squid on` / `off` / `status` / `tap` — the one-command harness toggle + the non-diegetic readout.** `pd squid on` arms EVERYTHING for a project in one shot: tentacle hooks for every detected agent CLI, the Pilot SessionStart steering hook, the `/squid` slash command (drive the toggle from inside Claude Code), and the new **visual identity statusline** — `bin/pd-statusline`, a fail-open POSIX-sh script wired into `.claude/settings.json` that renders a cyan `◆ PD` badge plus live daemon/alert/trace/lock counters on every Claude Code render, so a harnessed session is unmistakable at a glance. `pd squid off` reverses all of it (marker-matched: a user-authored statusLine or hook is never touched; `--all` also clears the user-level codex/agy configs the runtime gate otherwise keeps inert). `pd squid status` shows the whole background machinery live — daemon, staged tentacles, per-CLI wiring, identity surfaces, the Ink Cloud matrix contents, and a Codex-bridge probe — and `pd squid tap` prints the exact Suggestibility Envelope the next turn would receive by running the real `pd-hook-prompt` tentacle.
- **Codex-piloted Claude Code is visually identifiable and boots clean.** `pd squid codex` launches Claude Code in an isolated, pre-trusted config home with bearer-only auth, so the one command boots straight into a working REPL — no login/token auth-conflict warning, no folder-trust prompt, no onboarding. `pd-statusline` flips the badge to a magenta `◆ PD⇄CODEX` reporting the real Codex backend model, so a session answered by Codex-through-ChatGPT-Pro can never be mistaken for a direct Anthropic seat. The bridge also honors the client's `output_config.effort` (and defaults adaptive thinking to medium) so piloted sessions aren't silently run at low effort. `pd setup` stages the statusline alongside the tentacles, and `pd init` wires it (plus `/squid`) into every pd project.

## [3.24.1] - 2026-07-04

### Fixed
- **`pd-console --version` panicked without a daemon, sinking the release console build (#673).** `main()` ran daemon discovery before parsing args, so the release workflow's deep version-drift guard — which execs the freshly built binary on a daemonless CI runner — got a panic instead of a version, and no contiguous `pd-console v<ver>` literal existed for its strings-extraction fallback. `--version`/`-V` now early-exits printing the build stamp before any daemon, GPU, or window init, and a `#[used]` static keeps the marker in rodata for cross-arch checks. Restores the `pd-console.app` release asset, absent from v3.24.0 and failing on the three release runs before it.

## [3.24.0] - 2026-07-04

### Fixed
- **`begin_session` MCP tool could not satisfy the daemon's lifecycle requirement.** The daemon (`lib/sugar.ts`) hard-requires `lifecycle: "durable" | "ephemeral"` on session begin, but the MCP tool schema neither declared the field nor forwarded it — every MCP-driven `begin_session` failed with `SESSION_LIFECYCLE_REQUIRED`, locking MCP agents out of the mandatory coordination protocol (the CLI worked via `--lifecycle`). The tool schema now declares `lifecycle` as a required enum with guidance (ephemeral = one-off task session, durable = long-lived staff agent) and the handler forwards it to `/sugar/begin`.

### Added
- **Fleet HITL proposal queue (#648).** Cloud ships (Spark, Spider, future ships) can now submit product/build proposals without spawning any work: `POST /fleet-proposals` persists an inert packet into a new `fleet_hitl_proposals` SQLite table, FleetBar renders native Approve/Reject controls, and pd-console's Cloud Fleet pane shows pending-proposal awareness. Approval — and only approval — hands the packet to the dispatch queue as a specialist PR build (`review` merge policy). The surface is deliberately operator-only: no MCP tool can approve a proposal (an agent must never approve its own idea). Hardened under adversarial review: honest HTTP codes (404 unknown id, 409 state/duplicate conflict, 429 queue full), a 200-pending queue cap, a 16KB context cap, SQL-side list filtering, and cross-process race guards on every state transition.
- **`pd safe corral` — pack secrets off disk into the vault (ADR-0088 Phase B).** Takes the read-only scanner's findings and, for each detected plaintext secret, saves the value into the Keychain/broker vault (`lib/secret-env.ts`) and rewrites the source line to a `pd-secret://KEY` reference, so there is no plaintext secret at rest. `pd safe corral <KEY>` targets one finding, `--all` does every one; **dry-run by default** (prints the plan, writes nothing), `--apply` to write. The safety order is an invariant: re-verify the value at the line → save to vault → **verify the resolver round-trips the exact value** → write a `.bak` under `~/.port-daddy/recovered` → only then rewrite the source. A failure at any step aborts that item with the source untouched (no plaintext lost). No raw secret is ever printed, logged, or stored — plan/result objects carry path/line/ruleId/last4 + the env-var key only.
- **`pd env exec -- <cmd>` — frictionless corralled-secret access.** Runs a command with any `pd-secret://KEY` env refs resolved into the child process environment only (never to disk). This is the read side of corralling: a `.env` rewritten to `FOO=pd-secret://FOO` is transparently re-injected for the duration of the one command. An unresolved ref is passed through literally so a missing secret fails loudly rather than silently running empty.
- **`pd safe guard --staged` — a secret guard on the staged diff (ADR-0053 surface).** Reuses the structured-format + entropy scanner against `git diff --staged` and exits non-zero when a NEW secret is staged, stopping leaks at the commit/push boundary. Wired into the `hooks/pre-commit` guard (fail-open when `pd` is absent, fail-closed when it finds a staged secret). Findings show path/line/rule-id/last-4 only.

- **App watcher — the operator's app lanes refresh themselves.** `scripts/pd-app-watch.sh` (LaunchAgent `com.portdaddy.appwatch`, installed via `scripts/install-app-watch.sh`, 3-min poll) rebuilds + relaunches the **latest** pair (`pd-console-latest.app`, `FleetBar (dev-latest).app`) whenever `origin/main` moves — polling rather than a git hook, because merge-queue pushes never fire local hooks — and, when the Homebrew tap cuts a new `port-daddy` version, runs `brew upgrade` (re-starting the daemon service if brew churn unloaded it) and rebuilds + relaunches the **prod** pair (`pd-console-prod.app`, `FleetBar.app`) from that release tag. Builds run in a dedicated clone under `~/.port-daddy/app-watch/repo`, never in a working checkout; failed SHAs/versions are not retried until they move again.
- **FleetBar build LANES.** `apps/FleetBar/scripts/package-fleetbar-lane.sh` mirrors the console's lane model: `--prod` → `FleetBar.app`, `--latest` → `FleetBar (dev-latest).app` (each swapped + `launchctl` kickstarted under its KeepAlive label), `--devbuild <name>` → a timestamped one-shot bundle.

### Changed
- **pd-console dev bundles are date-sorted.** `--devbuild <name>` now writes `pd-console-dev-<YYYYMMDD-HHMM>-<name>.app` (stamp first, so lexicographic sort == chronological sort in `pd-console-dev-apps/`) and retires that name's superseded bundles, including legacy `pd-console_dev-<name>.app` (`PD_CONSOLE_KEEP_OLD_DEV=1` to keep).

### Security
- Corralling reduces blast radius (no plaintext at rest, scoped + logged Keychain access), but it is **not** confidentiality against a malicious same-UID agent whose binary satisfies the Keychain ACL — that needs the separate-UID broker (ADR-0087 phase 5). Every corral report path echoes that honest limit verbatim.

### Fixed
- **Release: FleetBar.app is now Developer ID signed + notarized (#531).** The release job extends the daemon/pd-console signing rig (same `APPLE_*` secrets, temp keychain, notary profile) to FleetBar: nested bun payload binaries signed inside-out with bun's JIT entitlements, SwiftUI host sealed with empty entitlements + hardened runtime, then notarized + stapled. A new signature guard re-extracts the released zip and fails the release if the cert secret was present but the .app is not Developer-ID signed — no more silently shipping a Gatekeeper-quarantined app.

### Removed
- **Web dashboard retired; operator surfaces consolidated to THREE (#652).** `public/index.html` is no longer a 2,600-line dashboard — it is a minimal landing page that health-checks the daemon and points at the sanctioned surfaces: **FleetBar** (menu bar), **Control Center** (FleetBar's window, whose content IS `public/fleet-ui/`), and **pd-console** (GPU operator console). Deleted the orphaned `public/fleet-live.html`, `public/app-surgery.html`, and `public/fleet-config.html` (their live counterparts are Control Center surfaces), and removed the Control Center's redundant "Browser" pill (`FleetControlCenter.swift`) — the browser control plane it opened is the same `fleet-ui` the window already shows. References to the retired pages in old release notes below are historical record and intentionally unchanged. <!-- cite-exempt: the cited paths are the files this PR deletes -->

## [3.23.0] - 2026-06-26

### Added
- **pd-console Parley pane (RCP-2a, #528).** Turns a disagreement into a decision: the lineage route (`GET /msg/:channel/lineage`) now returns a `parley` field — `shouldConvene(digest, costs)`, the cost-aware Signal-Detection call `P(fail)·waste·|unresolved| > parleyCost` over the unresolved contradictions (ADR-0086). The pane renders the CONVENE/hold decision, the SDT economics (expected waste vs cost + margin), and the contradiction edges a parley would reconcile. Tunable via `?parleyCost` / `?wastePerContradiction`.
- **pd-console build LANES — prod / latest / dev (#534).** `package-console.sh` builds the console in one of three distinct bundles, each a separate `CFBundleIdentifier` with a distinct icon colour + label: `--prod` → `pd-console-prod.app` (blue, version badge), `--latest` (default) → `pd-console-latest.app` (green), `--devbuild <name>` → `pd-console-dev-apps/pd-console_dev-<name>.app` (amber). Agents working in Rust each get an isolated, testable build instead of clobbering one shared app; a `post-merge` hook keeps `-latest.app` current when `main` advances. The Homebrew cask installs the signed/notarized artifact as `pd-console-prod.app`. The release packager prod-brands the shipped icon (blue + `vX.Y.Z`).
- **`rust-data-structures-advanced` skill** — expert guidance for choosing the advanced Rust data structure that makes ownership trivial instead of fighting the borrow checker: arenas & generational indices (slotmap / generational-arena / id-arena / typed-arena) as the idiomatic alternative to `Rc<RefCell>` for graphs/trees, petgraph (`StableGraph`), inline/cache-friendly vectors (smallvec/tinyvec/arrayvec), lock-free & concurrent containers (crossbeam channels/epoch/queue, flume, dashmap, the ABA problem), copy-on-write & persistent structures (`Cow`, im/rpds), struct-of-arrays/ECS, interning, roaring bitsets, and map/hasher selection (HashMap/BTreeMap/hashbrown/fxhash/ahash/IndexMap). Ships four references, two compilable examples (`cargo build`-green: a slotmap graph and a crossbeam pipeline), an `agents/openai.yaml`, and a `validate_skill.py` self-check.

### Fixed
- **pd-console "Jump to a pane" launcher was dead (#562).** The launcher card lacked `.occlude()`, so a tile press fell through to the scrim's `on_mouse_down`, which closed the launcher before the tile's `on_click` (the mouse-up) could fire — the pane never switched. The card now occludes the scrim.
- **pd-console Parley pane was unreachable (#528).** `ParleyPane` and `ConductorPane` both pushed their view at nav index 20 in `main.rs`; conductor (added later) overwrote parley, so `--pane parley` rendered Conductor's idle "Fleet Lineage". Conductor moved to its correct slot 21.
- **Release: a prerelease no longer rolls the brew tap (#564).** `release.yml`'s `update-homebrew` job fired for any release event — including prereleases — contradicting the documented RC-first discipline (an RC would have shipped to every `brew upgrade` user). Guarded to a real, non-prerelease published release only.

## [3.22.0] - 2026-06-23

The **dev-daemon** release: feature-branch daemons become first-class and
self-cleaning, and the auto-upgrade path that quietly stopped working is fixed.

### Added
- **Feature-branch dev daemons + smart GC (ADR-0084).** `pd dev up` on a feature branch (no `--from`) now launches a `codebase` berth for *that worktree* — its own claimed port, isolated DB/socket — instead of the shared `dev-latest` lane (the `--label`-without-`--from` footgun). Many coexist, each named. New **`pd dev gc`** (auto-swept on `dev up`/`dev list`) reaps berths that are dead, worktree-orphaned, or idle past a 24h TTL (codebase only — `stable`/`dev-latest` are standing lanes), and clears the orphaned profile-dir graveyard.
- **`pd whois` — semantic agent directory / skill router** (#453): find the right agent or skill by capability, not exact name.
- **Inbox read receipts** (#525): `read_at` + `pd sent` so a sender can see whether a message was read.
- **pd-console animated pane launcher** + clearer Substrate pane (#516).
- **Bespoke OG art** for six top-level marketing routes (#536), plus examples friction/appeal surfacing on cards (#521).

### Fixed
- **Auto-freshness now actually auto-upgrades (#535).** The hourly `pd self-update --tick` logged "daemon already current" for hours while a newer release sat in the tap: `brew outdated` prints the *tap-qualified* `curiositech/tap/port-daddy` for a tapped formula in the unattended pipe, but the matcher only accepted the bare name. It now matches both forms, and logs the actual version transition (`daemon upgraded 3.21.0 → 3.22.0 + restarted`) whenever the daemon is updated.
- **`pd dev up` works from the compiled binary (#532):** resolves the source tree from the git checkout instead of the bundle's virtual FS (which yielded a bogus `/scripts/...`).
- **Dispatch worker observability** restored + a SIGKILL publish-timeout post-fold-in (#538).
- **Dead-agent timeout** ladders reconciled to a single source of truth (#459).

## [3.21.0] - 2026-06-21

This release makes **cutting a release** a first-class, tested command and teaches the
menu bar to tell you **which daemon you're talking to** — the two halves of the berth
model (ADR-0084) that let a stable daemon and a dev daemon run side by side.

### Added
- **`pd cut` — the release orchestrator (ADR-0084 Phase 3).** One command builds the three decoupled release artifacts (the bun-compiled daemon binary, the Rust cdylib kernel, and `FleetBar.app`), collects them into `dist/release/<version>/`, hashes each, and writes a manifest. Honest by default: an unsigned cut is recorded as `signed: false` and says so — it never passes for a distributable build.
- **`pd cut --require-sign` — fail-closed signing for the release pipeline (ADR-0057).** Pre-flights the signing credentials *before* building (so a missing `PORT_DADDY_SIGN_IDENTITY` / `PORT_DADDY_NOTARY_PROFILE` fails in milliseconds, not after a multi-minute build), captures a per-artifact codesign/notarize manifest, and exits non-zero if any signable artifact ends up unsigned. `--sign` remains the best-effort dev convenience.
- **FleetBar surfaces the daemon berth (ADR-0084 Phase 2).** The menu bar now shows a colour-coded chip for the berth it is connected to — `stable` / `dev-latest` / `codebase` — so a dev daemon can never be mistaken for the canonical one. The daemon reports its berth identity under `/status.daemon.berth`; a legacy daemon that omits it is treated as the canonical stable berth.
- Added `.github/PULL_REQUEST_TEMPLATE.md` — the fill-in form for the PR contract (exhaustive summary, non-trivial test plan, visual proof, surface parity, coverage, roadmap reasoning, changelog, parsimony, adversarial verdict).
- Added `scripts/check-pr-requirements.mjs` and CI job `pr-requirements-guard` (`npm run check:pr-requirements`): the machine half of AGENTS.md § Pull Request Operating Procedure. Fails the PR when the Summary or Test Plan is empty or too thin, or when a visual surface (`core/pd-console/`, `website-v2/`, `fleet-config-ui/`, `public/fleet-ui/`, `public/`, `dashboard/`, `apps/FleetBar/`) changes without a screenshot + a GIF/recording. Lives in its own `pr-requirements.yml` workflow so it re-runs on PR-body `edited` events; becomes merge-blocking once added to branch protection. Escape hatches require a reason: `<!-- visual-exempt: … -->` and `<!-- pr-requirements-exempt: … -->`.
- Added the `claude-adversarial-review` workflow: an always-on neutral adversary that assumes laziness/slop/lies/corner-cutting, reasons about whether visual artifacts show ideal behavior (presuming failure on sparse evidence), checks summary honesty / test-plan integrity / surface parity / coverage / parsimony, and ends with a `SHIP / SHIP-AFTER-FIX / DO-NOT-SHIP` verdict. Complements (does not duplicate) `claude-code-review`.

### Changed
- Documented the now machine-enforced visual-artifact and PR-description rules in AGENTS.md, CONTRIBUTING.md (new § Pull Request Requirements), and the `port-daddy-internal-dev` skill.
- Added an `Agent Operating Expectations` section to AGENTS.md (and a matching slice-discipline block to the internal skill): coordinate + pay rent on clean worktrees, dogfood novelly and capture hard-won gambits in the skill, assume features are broken until read-back/cold-start/worktree/GitHub-verified, confirm the usage + transcript + Cloudflare durability trail, generalize beyond tsx/Rust to any repo and remote harbor, treat GUIs as needing real design feedback, avoid AI tropes / humanize, reconcile against the whitepapers, work at maximal tool+skill access (pausing for skill research), and launch other agents through Port Daddy's own fabric. README gains a Contributing section pointing at the PR contract.

### Fixed
- `pd cut` now names the FleetBar artifact what the packager actually writes (`PortDaddy-FleetBar-macOS-<arch>.zip`), pinned via `PORT_DADDY_FLEETBAR_ZIP` so the planner and the package script can't drift — a real cut previously aborted with `ENOENT` hashing a `FleetBar.app.zip` that never existed.
- De-flaked the compiled-CLI `pd tube` fan-out smoke (`scripts/smoke-compiled-cli-runs.sh`): it raced a blind `sleep` against asynchronous subscriber setup and a single live send, so a slow second listener intermittently missed the message. It now re-sends until both listeners receive a copy (or a ~15s timeout), proving fan-out delivery without depending on subscribe timing. (Unrelated to the PR-process changes; surfaced as a flaky required check while landing them.)

## [3.19.0] - 2026-06-15

### Added
- Added the Parley coordination surface (`pd parley` plus daemon routes) for bounded multi-agent debate, votes, critiques, revisions, and durable outcomes.
- Added swarm-fit scoring helpers and research-backed guidance for when Port Daddy should summon a swarm versus keep work single-agent.
- Added roadmap item upsert/touch receipts so coordination-changing work can prove it updated the live roadmap DB.

### Changed
- Coordination Guard now treats swarm/parley/roadmap-sensitive changes as requiring a live roadmap receipt.
- Release binary packaging now emits a long-name `port-daddy` binary alongside a `pd` launcher instead of compiling the Bun executable directly as `pd`.
- Session list rows now include active file and note counts so `pd sessions --all-worktrees` can show real coordination state.
- Documented `windags_skill_induct` as the new repo/user/global skill-ingestion tool while preserving `windags_skill_graft` for phase/task grafting.

## [3.18.0] - 2026-06-05

This release makes the operator's machine **safe to run a swarm on** and the swarm
**drivable end-to-end**. The marquee is the **Coast Guard**: every agent `pd spawn`
launches now runs inside an OS sandbox that cannot read your secrets, holds no raw
API keys, and cannot outspend a hard egress cap — on by default. Alongside it: a
**tube router** that drives the whole fleet over `pd tube` with delegation-chain
loop detection and any backend; more **spawn backends** with backend-agnostic
**resilience**; seven agent-facing **cop-out exemptions converted to real MCP
tools**; honest **attestation** (`pd attest`); and a batch of **machine-checked
proofs** hardening the harbor envelope, the Arbiter, the Anchor protocol, and the
event relay.

### Added
- **The Coast Guard — agentic safety, default-on for every spawned agent (ADR-0050).**
  `pd spawn` now confines each agent in an OS sandbox (macOS Seatbelt / Linux
  Landlock) that **cannot read your secrets** — not `.env.local`, not `~/.ssh`, not
  any dotenv file outside the workspace — while normal project files keep working.
  A **secret broker** scrubs raw API keys from the agent's environment, a **hard
  egress meter** caps outbound provider spend, and the run ends with a signed
  receipt. On by default; opt out per-spawn with `PD_COAST_GUARD_OFF=1`. Defends the
  cooperative case (a same-UID malicious agent can still drop the proxy); a live
  Darwin test proves the exact `.env.local`/`~/.ssh` exfil is blocked.
- **Tube → spawner router with delegation-chain loop detection + multi-backend.**
  Drive the whole fleet over `pd tube` (not just Codex): the router carries a
  `delegationChain` and fails closed on five loop classes (depth, budget,
  structural-fingerprint ping-pong, upward delegation, global fan-out), with the
  daemon acting as notary to resolve common-knowledge/two-generals races.
- **More `pd spawn` backends + backend-agnostic resilience.** Cloudflare Workers
  AI, Gemini, and Groq backends with exact telemetry; the `cli:claude-code` /
  `cli:codex` subscription backends unblocked; and a shared resilience layer —
  full-jitter exponential backoff + a circuit breaker — wrapping every backend.
- **Worktree-isolation guard for `pd spawn`.** The daemon refuses to launch a
  file-writing agent into a repository's **main checkout** (where parallel agents
  steamroll each other), pointing at a worktree instead. The spawner-side twin of
  the harness pre-tool isolation hook.
- **Seven cop-out MCP exemptions are now real MCP tools.** Harbors, signals,
  roadmap, commitments, and knowledge surfaces that were CLI-only (or "deferred to
  v4") are first-class MCP tools — agents are first-class consumers of routed
  features, not second-class.
- **`pd periscope` — the Sight stage of the operator loop.** A read surface that
  surfaces what the fleet is doing at a glance; building it also fixed several live
  bugs it exposed.
- **`pd attest` — honest self-report + loud-fail invariants (ADR-0045).** Agents
  report what they actually did against named invariants, and a **mute CLI is
  detected as a liveness failure** (silence is not success).
- **Cohort-attention status state machine.** Session state moves through an
  explicit lifecycle/heat/health model (the "fridge" model) instead of ad-hoc flags.
- **Typed wire envelope + per-publisher monotonic sequence.** A structured event
  envelope with retryable `AgentError` and an ordering/completion contract closes
  the relay replay gap (the I2 wire half).
- **Inbound GitHub webhook route** (`POST /webhooks/github`, `routes/github-webhook.ts`)
  closes the GitHub App dispatch loop: the receiver Worker forwards a verified
  webhook, the daemon authenticates the forward (bearer `PD_GITHUB_FORWARD_TOKEN`
  or HMAC `PD_GITHUB_WEBHOOK_SECRET`), and publishes it onto the messaging bus as
  `github:webhook:<event>`, `github:webhook:<event>:<action>`, and
  `github:<owner>/<repo>:<event>`. Fleet ships subscribe with
  `trigger: global:github:webhook:<event>` in `pd-fleet.yml`. Per-project
  routing isolation remains a documented follow-up (needs a repo→project
  registry). 9 tests, including an end-to-end loop check over real messaging.

### Changed
- **One canonical daemon-connection resolver.** Three copy-pasted daemon-target
  resolvers (fetch / request / client) collapsed into a single
  `resolveDaemonTarget()` with a clear precedence (`PORT_DADDY_SOCK` →
  `PORT_DADDY_URL` → socket → TCP). One place to reason about where `pd` connects.
- **Sessions are durable work contexts — `begin` resumes, never forks.** Calling
  `pd begin` for an identity that already has an active session resumes it instead
  of silently creating a second, so coordination state stops fragmenting.

### Fixed
- **Release gate: a mute compiled `pd` can no longer ship.** The Homebrew `pd`
  is a `bun build --compile` binary, and bun auto-loads `.env.local` from the
  current working directory before any of our code runs. A shell-idiom value that
  nests a command substitution inside a default-expansion —
  `KEY="${KEY:-$(...)}"` — segfaults bun (exit 133) during that autoload, so `pd`
  was **totally mute** (zero bytes, nonzero exit) from any directory containing
  such a file. The CI compiled-CLI smoke ran from a clean cwd, so the mute binary
  shipped green. `scripts/smoke-compiled-cli-runs.sh` now also drives the compiled
  binary from a hostile-`.env.local` cwd (NODE_ENV dropped so bun actually
  autoloads it) and fails the build unless the binary speaks **or** `pd doctor`
  ships the named diagnostic — so the failure is loud, never silent.
- **`pd doctor`: new `Shell-idiom .env.local` check.** Detects a
  `${VAR:-$(...)}` value in the current directory's `.env.local` and warns that
  bun's dotenv autoload will crash `pd` from there, with the fix (drop the
  wrapper / move keychain resolution to the shell rc). It never edits secrets.
- Regression test under the real failing runtime
  (`tests/bun/env-local-autoload-crash.test.ts`, run by `bun test`/CI) proving
  the crash, the detector, and the safe-vs-hostile idiom distinction.
- **`/health` & `/status` verify their own routes are mounted.** The health check
  now fails loudly if its own route wiring regresses, instead of reporting healthy.
- **`cli:claude-code` backend captures CLI usage + a labelled estimate** so a
  subscription-backed spawn reports honest cost instead of a silent zero.

### Security
- **Harbor envelope enforcement — a fail-closed boundary (ADR-0047).** Cross-harbor
  messages are validated at the boundary and rejected by default; malformed or
  unauthorized envelopes never reach the interior.
- **Arbiter capability-attenuation monitor (runtime verification).** A pure-TS
  monitor enforces `CAP_ESCALATION` — delegated authority can only ever *shrink* —
  without needing the Rust FFI, so the invariant holds at runtime today.
- **Sound Anchor attenuation proof (ProVerif 2.05).** The previously *vacuous*
  attenuation proof is closed with a real `is_subset` and an escalation adversary —
  the property is now genuinely verified, not trivially true.
- **Event-relay secrecy + publisher authentication past a malicious relay
  (ProVerif).** End-to-end secrecy and publisher auth are proven even when the relay
  is adversarial; the replay gap is closed by a typed envelope + monotonic sequence.

## [3.17.0] - 2026-06-02

This minor release consolidates a large backlog of user-visible capabilities that
landed on `main` since 3.16.2 without an interim version — backup/restore, the
`pd backend` provider switcher, the dispatch/nightshift/review pipeline,
harbormaster, popper, transcripts, multi-subscriber tube fan-out, the fail-closed
test/prod DB guard plus a default tube TTL, CLI permission tiers, and the GitHub
App (Cloudflare Worker + Fleet App) — alongside an older unfolded backlog (Budget
UX, Bonds escrow + budget-guard, `pd setup` one-command onboarding, cost tracking,
observability routes, fleet config UI). The two accumulated `[Unreleased]` blocks
in this file have been folded into this section; no entry was dropped.

### Added
- **`pd backup` / `pd restore` — durable daemon-state snapshots.** Capture and restore the SQLite-backed daemon state (sessions, claims, notes, tuples, roadmap, wallets/bonds) as a portable snapshot, so coordination state survives machine moves, schema migrations, and disaster recovery. Unblocks promoting markdown triage clusters into the DB.
- **`pd backend` — provider/model switcher.** A single CLI surface to inspect and switch the active LLM backend (claude / claude-cli / ollama / gemini / cloudflare / custom) and model, resolving through the single `lib/llm-backend-resolver.ts` chokepoint rather than scattered `PD_*_BACKEND` env reads.
- **`pd dispatch` + nightshift + review pipeline.** Operator-direct dispatch of background work, a nightshift batch runner for unattended off-hours execution, and a review stage that gates outputs before they land.
- **`pd harbormaster` — fleet/port orchestration surface.** Operator command for marshalling daemons, harbors, and fleet lifecycle from one place.
- **`pd popper` — surfaces the next actionable item.** Pops the highest-priority pending item (inbox / roadmap / obligation) for the current agent.
- **`pd transcripts` — streamed sortie/agent transcript access.** Inspect captured agent run transcripts from the CLI.
- **`pd tube` is now multi-subscriber (fan-out).** Multiple listeners on one channel each receive every message; the resume cursor is namespaced per listener identity (`listen()` gains a `historyKey`, set by the CLI to `channel::<sender>`) so distinct `--as` identities keep independent cursors (true fan-out) while the same identity still resumes across invocations. Verified with three live `--tail` listeners all receiving one `--send`; covered by `tests/unit/tube.test.ts`.
- **CLI permission tiers.** Tiered command authorization so destructive/operator-only verbs are gated from routine read paths.
- **GitHub App — Cloudflare Worker + Fleet App.** A GitHub App backed by a Cloudflare Worker plus a Fleet App, extending PD coordination onto GitHub-hosted fleet work.
- **Budget UX (Track 1b.2).** Block-until-budget-set (spawner refuses any spawn for a project without `budget_usd_per_day`, pointing the operator at `pd wallet budget <project> --usd-per-day <N>`); pause-and-ask on budget breach (`lib/budget-pause.ts` interposes a 60s grace window, broadcasts on `budget:pending`, operator resolves with `raise`/`kill`/`grace`, max 2 extensions, expiry fires the backstop SIGTERM). New routes `POST /wallets/:project/budget`, `GET /budget/pending`, `GET /budget/pending/:agentId`, `POST /budget/pending/:agentId/resolve`; new CLI `pd wallet budget`, `pd wallet pending`, `pd wallet raise`; schema `project_wallets.budget_usd_per_day` (nullable REAL, idempotent ALTER); Bonds API `setBudget`/`getBudget`; README honesty paragraph (the wallet is a governance accounting unit, not money).
- **Bonds + Budget-Guard wiring (Track 1b).** Daemon escrows money before every spawn (`lib/bonds.ts`) and SIGTERMs live spawns at 100% of daily budget (`lib/budget-guard.ts`) — advisory-only enforcement is gone. New routes `GET /bonds`, `GET /bonds/:id`, `POST /bonds/:id/slash`, `GET /wallets`, `GET /wallets/:project`, `POST /wallets/:project/top-up`, `GET /fleet/panic`, `POST /fleet/panic` (two-step), `POST /fleet/unpanic`. New CLI `pd wallet show|top-up|history`, `pd bond list|slash`, `pd fleet panic|unpanic`. New SDK methods `listBonds`, `getBond`, `slashBond`, `listWallets`, `getWallet`, `topUpWallet`, `getPanicStatus`, `armPanic`, `disarmPanic`. Panic is two-step (arm + confirm), broadcasts on `fleet:panic` / `fleet:unpanic`, and refunds running bonds rather than slashing them. Shell completions updated in bash/zsh/fish; integration coverage in `tests/integration/bonds-wiring.integration.test.js` and `tests/integration/fleet-panic.integration.test.js`.
- **`pd setup` — one-command onboarding.** Single command installs daemon (launchd), configures MCP integration across 7 IDE platforms (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code Copilot, Continue, Cline), installs FleetBar (macOS), and initializes the current project. Flags: `--no-daemon`, `--no-mcp`, `--no-fleetbar`, `--no-init`, `--no-fleet`, `--no-hook`, `--project <dir>`. Auto-detects project directories via git root and 15+ language markers.
- **Cost Tracking System** (`lib/cost-tracker.ts`): per-spawn LLM cost recording with a model pricing table covering Claude Opus 4 / Sonnet 4.6 / Haiku 4.5, Gemini 2.0 Flash, GPT-4.1, and more. Exact cost from token counts (Claude SDK) or flat per-session estimates for opaque backends. Methods: `record()`, `total()`, `summary()`, `budgetStatus()`.
- **Operational Counters** (`lib/counters.ts`): ODS-style time-bucketed metrics with in-memory batching (flushes to SQLite every 10s), minute + hour indexing, auto-cleanup of rows older than 30 days. Methods: `bump()`, `summary()`, `query()`.
- **Observability Routes** (`routes/observability.ts`): golden signals (RED method) at `GET /metrics/golden`; cost endpoints `GET /metrics/cost`, `GET /metrics/cost/recent`, `GET /metrics/cost/budget/:project`; counter endpoints `GET /metrics/counters`, `GET /metrics/counters/top`.
- **Fleet Config Management endpoints**: `GET /fleet/prompt` (one-line shell-prompt status), `GET /fleet/config/:project` (raw YAML + parsed config + topology validation), `PUT /fleet/config/:project` (write YAML, validate, reload fleet), `GET /fleet/models` (backend + model catalog, probes Ollama live with 60s cache).
- **MCP Install expansion**: `pd mcp install` now supports 7 platforms (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code Copilot, Continue, Cline) with IDE auto-detection.
- **Path Centralization** (`shared/paths.ts`): all runtime files now live in `~/.port-daddy/` instead of `/tmp/` — survives `/tmp/` cleanup, eliminates symlink attacks, user-private permissions (0700). Exports `PD_HOME`, `DEFAULT_SOCK`, `DEFAULT_IPC`, `DEFAULT_PID_FILE`, `DEFAULT_PORT_FILE`, `UI_PREFS_FILE`; override via `PORT_DADDY_SOCK`, `PORT_DADDY_IPC`, `PORT_DADDY_PORT_FILE`.
- **FleetBar Auto-Launcher** (`lib/fleetbar-launcher.ts`): daemon auto-launches the FleetBar menu bar app on startup (macOS only), passing `PORT_DADDY_PORT` / `PORT_DADDY_URL`, respecting the `launchFleetBarOnDaemonStart` UI preference.
- **UI Preferences** (`lib/ui-preferences.ts`): persistent preference storage at `~/.port-daddy/ui-preferences.json`.
- **Fleet Config UI**: React app (`fleet-config-ui/`) for visual fleet management — YAML editor, agent cards, activity panel, channel log, DM panel, flow graph, project picker, sortie panel. Communicates with the daemon via REST + SSE.
- **FleetBar enhancements**: CostDashboard, CostStore, and FleetBarPreferences added to the SwiftUI menu bar app.
- **Context-Aware Salvage**: agent registration with `--identity` / `--purpose` auto-checks for dead agents in the same project and returns a salvage notice; `pd salvage --project <name>` filters by project; dashboard shows the salvage queue grouped by project.
- **CLI @clack/prompts makeover**: styled intro bars, spinners, log messages, boxed notes, and interactive prompts across all 58+ commands.
- **`pd spawn` — AI agent launcher**: launch local or cloud AI agents (`ollama`, `claude`, `claude-cli`, `gemini`, `aider`, `custom`) with Port Daddy coordination auto-wired. All spawned agents auto-register, heartbeat, start sessions, and enter the salvage queue on crash. `pd spawn -- <task>`, `pd spawned`, `pd spawn kill <id>`; SDK `pd.spawn()`, `pd.listSpawned()`, `pd.killSpawned()`; API `POST /spawn`, `GET /spawn`, `DELETE /spawn/:id`.
- **Fleet dogfooding**: all 8 fleet agents migrated from direct `claude -p` to `pd spawn --backend claude-cli`, gaining full PD coordination for free.
- **OpenAPI 3.1 specification**: full API spec at `docs/openapi.yaml` (96 paths, 125 operations).
- **Dashboard salvage panel upgrade**: groups dead agents by project, uses the primary `/salvage` routes, adds Claim/Dismiss action buttons per agent.
- **`pd watch` — ambient agent kernel**: react to pub/sub messages without polling. `pd watch <channel> --exec <script>` runs a script per message (receives `PD_MESSAGE`, `PD_MESSAGE_CONTENT`, `PD_CHANNEL`, `PD_TIMESTAMP`), auto-reconnects on SSE disconnect.
- **"Uncharted Waters" first-launch**: a compass rose ASCII banner with three offered commands when PD sees a new folder; `isNewFolder` / `uncharted_waters` fields added to `GET /launch-hints`.
- **Research reports** (`research/`) and an interactive synthesis report (`research/synthesis.html`).
- **Website docs overhaul**: Tutorial 06 (DNS Resolver) 129 → 398 lines; Tutorial 08 (Session Phases) 168 → 498 lines; `website/docs/api.html` full API reference (64 endpoints); `website/docs/index.html` docs home.

### Changed
- **Fail-closed test/prod DB guard + default tube TTL.** The daemon now refuses to run against a test database in a production context (and vice versa), failing closed rather than silently corrupting state, and `pd tube` channels carry a default TTL so stale channel state expires instead of accumulating.

### CI / Build
- **CI now hard-fails when the COMPILED CLI doesn't run.** The prior compiled-binary smokes set `PORT_DADDY_URL` explicitly and the single-binary smoke only exercised the `__daemon` entrypoint, so a compiled `pd` whose CLI path was dead (or that failed to bootstrap) shipped green. New `scripts/smoke-compiled-cli-runs.sh` boots the daemon from the compiled binary and drives the **bare** CLI via discovery (no URL override): `pd status` 3× must run and report a running daemon, `pd tube --send` must post, and a two-listener fan-out must deliver to both. Wired into the `compiled-daemon-smoke` CI job — a dead CLI now blocks the release.
- **Pinned `bun-version` to `1.2.21`** (was unpinned `latest`) in `ci.yml` and `release.yml`, so the compiled binary is built against a deterministic bun across CI and releases instead of whatever `latest` resolves to at release time.

## [3.16.2] - 2026-06-01

### Added
- **`pd tube` is now multi-subscriber (fan-out).** Multiple listeners on one channel each receive every message. Previously `pd tube CH --tail` keyed its resume cursor (`~/.port-daddy/tube-history-<channel>.json`) by **channel only**, so two listeners shared one cursor file and raced — whoever polled first advanced it and the others saw nothing (silent single-consumer). The cursor is now namespaced per listener identity (`listen()` gains a `historyKey`, set by the CLI to `channel::<sender>`): distinct `--as` identities keep independent cursors (true fan-out), while the same identity still resumes across invocations. Verified with three live `--tail` listeners all receiving one `--send`; covered by `tests/unit/tube.test.ts` (a multi-subscriber fan-out test + a single-consumer regression that documents the old behavior).

## [3.16.1] - 2026-06-01

### Fixed
- **`pd tube --send`/`--reply`, `pd feedback`, `pd tutorial` mis-behaved under the bun-compiled binary.** Same root cause as #205: under the Homebrew `bun build --compile` binary `process.stdin.isTTY` is falsy on a real terminal, so commands that gated interactivity on the stream flag mis-fired — `pd tube CH --send` with no pipe **hung forever** waiting on stdin EOF (instead of erroring), `pd feedback` mis-routed an interactive run into the pipe path, and `pd tutorial` auto-skipped every "Press Enter" prompt. All stdin interactivity now flows through a single canonical helper, `cli/utils/tty.ts` (`isStdinInteractive` via kernel-level `tty.isatty(0)`, plus `openControllingTerminalInput` for `/dev/tty`-backed prompts), and the central `IS_TTY`/`canPrompt` chokepoint uses `tty.isatty(2)`. Guarded by `tests/bun/tube-prompt.test.ts` (the no-hang contract under `bun test`), a new `scripts/smoke-compiled-cli-tube.sh` CI smoke (piped body posts; interactive PTY `--send` errors fast, never hangs), and a `tests/unit/no-raw-stdin-istty.test.js` regiment that bans raw `stdin.isTTY` in `cli/` so the class can't regress.
- **`pd secret set` silent no-op under the bun-compiled binary** (#205). The Homebrew `pd` ships as a `bun build --compile` binary, and in that runtime `process.stdin.isTTY` can be `undefined`/`false` on a real terminal (and `setRawMode` can be absent) — the same dev-runtime≠compiled-bun gap as the bun:sqlite bug. `cli/commands/secret.ts` keyed solely off `process.stdin.isTTY`, so an interactive `secret set` fell through to the pipe branch, hit immediate EOF, and aborted with no prompt ever drawn — the operator saw an instant return that stored nothing. Now TTY detection uses the kernel-level `tty.isatty(0)` as source of truth, `setRawMode` is guarded with a `/dev/tty` readline fallback, and the empty-value case always errors loudly (non-zero exit, "No value entered — aborted") rather than silently no-op'ing. The value is still never sourced from argv and never echoed. Covered by `tests/bun/secret-prompt.test.ts` (runs under `bun test`, where the bug lived) plus a new `scripts/smoke-compiled-cli-secret.sh` CI smoke that drives the compiled CLI's stdin path end-to-end.

## [3.16.0] - 2026-06-01

### Added
- **`pd secret` — keychain-backed secret store + CLI/routes** (#197). `pd secret set/list/reveal/rm` (value read from a hidden stdin prompt, never argv) over loopback-guarded `GET/POST/DELETE /secrets` + `POST /secrets/:key/reveal`. Provider secrets live encrypted-at-rest in the macOS Keychain (`lib/secret-env.ts`), fail-closed, never logged or echoed.
- **Durable commitments + obligation monitor — `pd commit` / `pd obligations`** (#192, ADR-0041). Substrate-level accountability: a commitment object with daemon-derived deadlines and oracle-bound closure, plus an obligation-monitor sweep (the dual of resurrection — it watches kept promises, not just heartbeats).
- **FleetBar Secrets pane** (#195). Menu-bar credential management — masked list, on-demand reveal, copy-to-clipboard with 45s auto-clear; accessible (Dynamic Type, VoiceOver, SF Symbols).
- **`pd attention` — first-command-of-every-session aggregator.** Returns unread inbox messages + new messages on subscribed channels for the current agent in one call, with mark-read-on-fetch semantics (`--peek` skips). Stable JSON schema in `lib/attention.ts` so harness SessionStart hooks (and any other integrator) can pin the result into prompt context. `.claude/settings.json`'s SessionStart hook wires it automatically for Claude Code. Subscriptions are durable in a new SQLite table (`attention_subscriptions`) keyed on `(agent_id, channel)` with a per-subscription cursor that advances on non-peek reads. New routes: `GET /attention`, `POST /attention/subscribe`, `POST /attention/unsubscribe`, `GET /attention/subscriptions`. AGENTS.md § Port Daddy First updated to make `pd attention` doctrine. Closes roadmap item `pd-attention-mailbox-for-harness-agents` (HIGH).

### Fixed
- **bun:sqlite NULL-bind on `@named` params → `SQLITE_MISMATCH` / `NOT NULL`** (#193, #200). The compiled daemon uses `bun:sqlite`, which (unlike better-sqlite3 under jest) rejects bare-key `@named` object binds — `GET /roadmap/items` 500'd and a latent `usage-telemetry` insert would have too. Converted to positional `?`; added bun-level regression tests plus a CI job that boots the compiled daemon and smoke-tests routes, so this class can't ship green again.
- **`pd roadmap` reads the `roadmap_items` SQL table, not markdown** (#191), with an idempotent markdown→table import that preserves existing entries. Ends the "markdown is the database" drift (ADR-0033).
- **Daemon refusal hints no longer leak `--allow-main-worktree`** (#186). A guardrail that advertised its own bypass; both refusal paths now point only to the correct action.

### Changed
- **`:9876` regiment + daemon-toolchain consolidation** (#203). Single `DEFAULT_DAEMON_PORT` + `resolveDaemonUrl()` in `shared/daemon-discovery.ts`, real call sites migrated off hardcoded ports, and a CI test that fails on any new literal `9876`. `pd install` now refuses to create a second daemon launchd job when Homebrew already supervises one; dead Barnacle references purged (ADR-0021).
- **Parity surfaces register `secret`/`secrets` + the roadmap import route** (#201).

### Docs
- **Canonical daemon/supervision topology map** (#202) — `docs/operations/daemon-and-supervision.md`: the two `pd` installs, every supervisor/watchdog, and the only correct redeploy path.
- **Agent-accountability research + ADR-0040 (non-forgeable identity) / ADR-0041 (durable commitments) / ADR-0042 (team secret sharing)** (#188, #196), and a cite-and-define house style for all technical docs (#188, #198).

## [3.15.0] - 2026-05-20

### Added
- **Multi-hop delegation chain walker — `lib/delegation-chain.ts`** (PR #66, closes A2 from the Anchor §3 attack catalog). Depth-N verifier that binds to the ProVerif proof at `proofs/anchor/delegation/chain-replay.pv`. Each hop signs `hopBind(nonce, prev_id, next_id, message_hash)` under Ed25519, the walker checks signatures + nonce freshness + `prev_id` continuity, rejects splices, replays, hop-swaps, and message substitution. Adversarial-review fixes (F1/F2/F3) landed before merge: deleted the redundant `kid` field so `prevId` is the single source of truth (signer identity is bound to chain identity by construction), added `HOP_BIND_DST = 'anchor.delegation.hopBind.v1'` domain-separation prefix to the signed payload (confused-deputy defense), and three new tests covering impersonation + DST. 21 unit tests pass. NonceTable is still in-memory and not persistent — a follow-up will move it behind SQLite with `(principal_id, nonce)` keying, TTL on `issued`, permanent `consumed` rows.
- **Three-tier memory vocabulary (Core / Recall / Archival) + `pd memory tiers`** (PR #114, ADR-0035). A Letta-style hierarchy that maps every PD storage construct — active sessions, file claims, notes, blobs, skill index, salvageable sessions — onto a uniform vocabulary with explicit eviction + access semantics. **Vocabulary overlay only — no new schema, no substrate change.** New CLI verbs: `pd memory tiers` prints the full table with live counts, `pd memory tier <construct>` returns the tier for one construct, `pd memory summary --json` is stable-schema and machine-parseable. 257 lines of test coverage in `tests/unit/memory-tiers-cli.test.js`.
- **Roadmap claims now link to sessions + agents** (PR #97, ADR-0034). `roadmap_claims` grew nullable `session_id` and `agent_id` columns plus an idempotent `ALTER TABLE` migration. `pd roadmap pop --begin` now writes the new session/agent IDs back onto the claim row, so `pd roadmap claims` surfaces "session: <id>" and a future `pd whois <slug>` can resolve cleanly. New route `POST /cartographer/roadmap-claim-link` exposes the rebind operation (idempotent; refuses to overwrite an existing link without `force: true`). New CLI verb `pd roadmap claim-link <slug> [--session <id>] [--agent <id>] [--force]`. Schema migration is safe for existing claims.
- **ADR-0029, ADR-0030, ADR-0031, ADR-0032, ADR-0037, ADR-0038** added under `docs/adr/`. ADR-0029 covers user accounts + Merkle audit forest, ADR-0030 the talent phonebook (`pd whois`) coordination router, ADR-0031 the Spider surface-finder, ADR-0032 the unSpider contradiction-finder, ADR-0037 git access control + pd feature verbs, ADR-0038 the claim tree multi-granularity coordination primitive.
- **`/landscape` multi-agent comparison page** (PR #116). New route with three screens: comparison table covering Port Daddy, Cursor 2.0, Claude Code Task, ccswarm, WinDAGs (with explicit "Composes with PD?" column and honest-framing footnote that none of these are direct competitors), a four-layer architecture diagram (Isolation / Communication / Coordination / Integration) positioning PD at the coordination layer, and a 60-second walkthrough of two agents touching the same repo (claim conflict + salvage). Nav link added to SiteHeader overflow menu, smoke test covers hero / table / four layers / identities. Sibling cross-link tile added beside "Read the review history" on `/whitepaper`.
- **Coordination cookbook — `docs/patterns/coordination-cookbook.md`** (PR #118). 991-line companion doc to the patterns work: five coordination topologies × seven repeatable patterns on Port Daddy primitives, each with verified command sequences. Wave 4.x from the 12-lens audit.
- **Fleet Control Center onboarding walkthrough** (PR #84). First-run onboarding GUI for new users, plus hardened onboarding setup routes (PR-internal follow-up).
- **Whitepapers v2.6: A5/A6 + Monte Carlo viz + algorithm diagrams** (PR #82, swarm/econ-v2). Adversarial-review v2.0 → v2.6: shipped five crypto sorties (magic-link recovery, delegation walker, cuckoo filter, Merkle EasyCrypt, Pareto/cartel sims) and rebuilt the whitepapers with nine algorithm diagrams + three Monte Carlo viz. A5 Sybil sims + A6 cartel folk-theorem sims extend §8.4.4.
- **Whitepaper Wave 1/2a/2b/3 polish passes** (PRs #101, #103, #104). Inline figures + reader map + A5 subsection (Wave 1), cuckoo primer + companion sidebar + taxonomy bridge (Wave 2a), related-work + governance/appeals + pull-quote sidebars (Wave 2b), worked example + exercise set (Wave 3). Refactor passes for inline appendices and present-tense voice.
- **CI: whitepaper metadata drift check + vitest coverage** (PR #117). New `website-v2/scripts/check-whitepaper-metadata.ts` asserts the `whitePapers` registry stays in sync with the published PDFs (slug, page count, last-modified, file existence). Wired into `pnpm --filter website-v2 test`.
- **Cockpit data source: markdown reader → roadmap_items (Phase 1)** (PR #113). Cockpit now reads structured roadmap data instead of parsing the markdown surface — first phase of the larger move to a SQLite-backed roadmap DB.
- **Cartographer + Spark state restored from retired stable branch** (PR #105). Brings the live state back into the canonical fleet after the stable-branch promotion arc concluded.

### Fixed
- **Bun-bundle path resolution — `isBunCompiledRuntime()` multi-signal probe + embedded version fallback** (PR #100, follow-up to issue #86). The 3.14.1 fix checked only `import.meta.url.includes('/$bunfs/')`, but bun's bundler may inline `import.meta.url` at build time so the check returns false at runtime in the compiled binary. Two consequences observed in the field: (1) `pd start` interactive failed with `ENOENT: posix_spawn '/node_modules/.bin/tsx'` because `attemptDaemonStart` fell into the source-mode branch; (2) `server.ts` couldn't read its own `package.json` from inside the bundle and fell back to the hardcoded `'2.0.0'` string, so `/health` and `pd version` reported the wrong version. New pure helper `isBunCompiledRuntime({versionsBun, importMetaUrl, errorStack, execPath})` returns true on any of three independent signals (bunfs in URL, bunfs in stack, or `execPath` basename not in the interpreter allowlist `bun|bun-<version>|bunx|node|tsx`). New `EMBEDDED_PACKAGE_VERSION` constant replaces the `'2.0.0'` fallback; `scripts/sync-version.ts` maintains it in lockstep with `package.json` under the existing `postversion` hook (now correctly stages `server.ts` too) and throws if the sentinel literal is removed. New `tests/unit/embedded-version-sync.test.js` catches manual `package.json` edits that bypass `npm version`.
- **Cloudflare Workers AI model route encoding** (PR #120). `lib/llm-call.ts::cloudflareAdapter` was running the full model id (e.g. `@cf/qwen/qwen3-30b-a3b-fp8`) through `encodeURIComponent`, which double-encoded the slashes and broke the Cloudflare route. New `cloudflareModelPath()` splits on `/`, encodes each segment, preserves `/` between segments, restores `@`, and rejects unsafe path components (empty / `.` / `..`) before sending the bearer token. Adds two new test cases for special-character segments and rejection.
- **Fleet gardener + spark cron → event-driven with cooldown** (PR #106). The cron-driven gardener and spark agents were respawning on the schedule even when there was no work, which (with the cloudflare adapter blocked behind a budget guard) produced a flood of `fleet_agent_failed` log lines on every tick. Now event-driven with a cooldown so a quiet day doesn't generate noise.
- **SEO quickwins — sitemap regenerated, `<lastmod>` for blog posts, Twitter Card duplicates removed, `index.html` fallback title aligned** (PR #102). Four risk-free fixes from the landing-page audit. `npm run generate:seo` produces 277 canonical URLs (was 276). Blog routes now emit `<lastmod>` derived from `publishedAt`. Duplicate `<meta property="twitter:*">` tags dropped from `inject-route-html.mjs` (kept the canonical `name="twitter:*"` form). `index.html` title and description aligned with `siteMetadata.ts` canonical to prevent fallback drift.
- **Blob GC unit-test timing boundary on `main`** (PR #98). Made the GC cutoff test deterministic — was flaky on fast runners where the test fixtures landed inside the GC window.
- **Whitepaper figure overflow + pacing** (PR #101). Inline figure layout fixes + reading-flow pacing adjustments uncovered by the Wave 1 review pass.

### Changed
- **Shipwright archetype catalog grew 12 → 20** (`lib/shipwright/archetypes.ts`). The 2026-05-20 fleet retool landed eight new archetypes alongside the original twelve: `cartographer` (promoted out of fleet-only into a first-class role, family `cartographic`), `spider` and `unspider` realizing ADR-0031/0032 as a generative/critical pair on the roadmap, plus the GitHub-output retool ships `code-reviewer` ↔ `red-team` (critical pair), `test-author` ↔ `tautology-sniffer` (generative/critical pair), and `tenderfoot` (observational, sui generis — the renamed retool-era "unspider"; ADR-0032 kept the historical name). The `Archetype` interface gained optional `family`, `pairsWith`, `description`, `triggers`, `outputs`, `costClass`, `backendDefault`, `backendEscalation` fields; existing entries default to `family: 'maintenance'` via `archetypeFamily()`. New `ARCHETYPES` export holds the canonical roster ordered family → alphabetical (generative, critical, maintenance, observational, cartographic). The `TriggerKind` grammar extended with `pull-request-merged`, `cartographer-write`, `sortie-completed`, and `claim-acquired` to back the new event-driven archetypes. Test suite grew six new assertions (count bump, ARCHETYPES ordering, pair symmetry, family taxonomy). Companion work in `pd-fleet.yml` and `fleet/ships/*.md` lives in the fleet-retool branch.
- **Blog system: widened content container + bigger byline + mandatory marketing-copy skill** (PR #67). Article container `max-w-prose` (~65ch / 600px) → `max-w-[80ch]` (~720px) in three places — the prior column-in-a-void desktop layout was too narrow. Byline `text-xs ... text-text-muted` (12px) → `text-sm sm:text-base ... text-text-secondary` (14-16px), author name promoted to `text-text-primary`, calendar/user icons 14 → 18px. Addresses the no-tiny-fonts user-level rule. AGENTS.md adds eight hard requirements for any PR touching `website-v2/src/data/blog/` (must run `port-daddy-marketing-copy` skill, cold-start framing in first three paragraphs, etc.).
- **Bond-pricing blog post rewrite under the new marketing-copy floor** (PR #69). 2853 words (was ~750), 2 Nano Banana custom images (hero + 4-panel rogues gallery), 2 mermaid diagrams (today-vs-tomorrow flowchart, insurer-market sequence), 11 deep links, concrete villains gallery (Hoarder, Slow Walker, Nuker, Petulant Quitter — four agent damage modes a daily budget cannot price).
- **Website SSR-safety prep** (PR #107). Two small refactors that defer browser-only APIs out of module/initializer scope — independent of which SSG framework we eventually pick (`vite-react-ssg`, `vike`, etc.). `src/lib/theme.tsx` extracted `initialTheme()` with `typeof window === 'undefined'` guard; `src/components/ui/Mermaid.tsx` replaced top-level `import mermaid` with a dynamic `import('mermaid')` inside an effect so the package's window-touching module evaluation can't break SSR.

### Docs
- **Brew reinstall required for plist-shape changes** (PR #123). 16-line note in `docs/RELEASING.md`: when the tap formula changes the LaunchAgent plist shape, `brew services restart port-daddy` is not enough — `brew reinstall` is required because brew regenerates the plist on install but not on restart.

## [3.14.1] - 2026-05-16

### Fixed
- **Compiled binary can now start the canonical daemon** (Issue #86). v3.14.0's `pd start` shelled out to `tsx server.ts` paths that don't exist inside a `bun build --compile` bundle, so `./pd start` and `brew services start port-daddy` both died with `ENOENT: posix_spawn '/node_modules/.bin/tsx'`. `cli/commands/daemon.ts` now detects a bun-compiled context (`process.versions.bun` set AND `import.meta.url` under `/$bunfs/`) and routes `pd start --foreground` to an in-process daemon via dynamic `import('../../server.js')` — the import side-effect binds the sockets and runs the event loop on the supervisor-managed PID. The interactive `pd start` path re-execs `process.execPath` with `['start', '--foreground']` detached when in a bun bundle, instead of trying to spawn `tsx`. Source-mode dev (`bun run server.ts` / `tsx server.ts`) is unchanged. Brew formula must be updated separately to invoke `pd start --foreground` so `brew services` supervises the daemon PID directly instead of a parent that exits.

## [3.14.0] - 2026-05-13

### Added
- **Metrics tab in `/fleet-ui/`** (PR #71). The React app FleetBar embeds now has a Metrics tab that iframes `/metrics.html` with reload and pop-out controls. The tab is visible even before a project is picked (alongside Flow and Shipwright), since request volume, latency, seasonality, and outliers are all daemon-wide. `MetricsPanel` takes `daemonUrl` as a prop so it re-renders correctly when the user switches daemons in the Header.
- **Always-visible TabBar in non-embedded `/fleet-ui/`** (PR #71). Previously the bar was gated to `(selectedProjectId || activeTab === 'Shipwright')`, which made daemon-level tabs unreachable from the default Flow view in all-projects mode. `visibleSurfaceTabs` already narrows to daemon-level tabs without a project, so the bar stays minimal there.
- **`/metrics/prom` + `/metrics.html` dashboard** (PR #44). Prometheus exposition + per-(method, route_template, status_class) HDR histograms in `lib/metrics-registry.ts`. New endpoints under `/metrics/*`: `prom`, `http/routes`, `http/outliers`, `http/now`, `annotations` (git commits + tags + pd notes + session purposes/telos). Vendored Chart.js under `/vendor/` (CSP-friendly, works offline). 30-second TTL cache + inflight coalescing on git annotations.
- **Sidebar Metrics link + command-bar Metrics button** on the legacy `/index.html` dashboard (PR #63, superseded by deprecation below).

### Changed
- **`X-Frame-Options: DENY → SAMEORIGIN`** and **CSP `frame-ancestors 'none' → 'self'`** in `server.ts` (PR #71). Required so `/fleet-ui/` can iframe `/metrics.html`. The daemon is already restricted to loopback hosts plus `.local` (mDNS / Bonjour) by the DNS rebinding hook, so `SAMEORIGIN` is the strictest framing policy compatible with the embedded Metrics tab. Regression test at `tests/unit/framing-headers.test.js` guards against accidental tightening.
- **Winston request firehose retired** (PR #44). The 625 MB unbounded log file was contributing to per-request slowness via synchronous JSON serialization. Replaced with bounded in-memory histograms + sampled error-only file logging. New `config.logging.{maxsize, maxFiles, requestSamplingRate}` knobs; sampling rate clamped to `[0, 1]`.

### Deprecated
- **Legacy `/index.html` daemon dashboard** (PR #71). Sticky red banner at the top of the page links users to `/fleet-ui/` and `/metrics.html`. The file stays reachable so existing bookmarks, MCP introspection probes, and the bijective-parity test suite keep working — it is read-only at this point and will not get new features. New control-surface work goes into `fleet-config-ui/`.

### Backfill — work that landed since 3.8.4 (not retroactively versioned)

The entries below shipped to `main` between 3.8.4 and 3.14.0 but were never assigned an interim version. They are listed here for an honest changelog rather than dropped on the floor.

### Added
- **`pd tube` — relay-independent conversational pipe** (Track B1 from the phone-integration master plan). Usage: `pd tube <channel> [--listen|--once|--since=<id>|--limit=N|--no-history|--send|--reply=<id>]`. Listen mode emits one JSON-line per message on stdout; `--send` / `--reply` read stdin to EOF and post via the daemon's existing `POST /msg/:channel`. File-based history guard at `~/.port-daddy/tube-history-<safe-channel>.json` (atomic write via tmp+rename) prevents re-emission across listen sessions; `--no-history` ignores it; `--since=<id>` overrides it. Threading via a small `{ v:1, kind:"tube.msg", body, inReplyTo? }` envelope since the daemon's messages table doesn't model thread parents natively. 26 unit tests; wired into bash/zsh/fish completions and `features.manifest.json`. Hands-on tutorial at `skills/pd-relay-zero-trust/examples/pd-tube-tutorial.md`. No daemon-side changes needed; works against the local PD daemon today and will compose unchanged with the future relay.
- **Per-publisher Merkle event chain library — `lib/merkle-chain.ts`** (Track B2). Pure-function TypeScript: `next_hash(prev_hash, event)`, `verify_chain(events)`, `sign_head(head, signing_key)`, `verify_head(signed_head, pub_key)`, plus `canonicalJson` matching RFC-8785-ish ordering. Uses `node:crypto` Ed25519 (no new top-level dependency). Byte-for-byte cross-language compatible with the Python reference scripts at `skills/pd-relay-zero-trust/scripts/{chain_verify,chain_anchor}.py` — verified end-to-end with shared golden vectors at `tests/fixtures/merkle-chain-golden.json`. Cross-language compat reference at `docs/merkle-chain-compat.md`; hands-on TypeScript tutorial (with cross-language demo) at `skills/pd-relay-zero-trust/examples/merkle-chain-typescript-tutorial.md`. 29 unit tests covering canonicalJson, next_hash, verify_chain (happy path + tamper detection at every position + equivocation), and sign/verify_head round-trip.  <!-- cite-exempt: historical entry — path as of that release -->
- **ADR-0025: Relay PKI Decision** at `docs/adr/0025-pki-decision.md`. Adopts an **OIDC-first hybrid, phased**: v0 = OIDC primary (GitHub Actions issuer at launch, allowlist expandable in config) + `--auth-mode=wot` escape hatch for air-gap; v1 = ACME (DNS-01) on a self-hosted `step-ca` for daemons wanting name-bound identity; v2 = self-hosted OIDC issuers + bring-your-own-domain ACME with EAB. Identity registry stores `(daemon_fingerprint, identifier, proof_method, proof_metadata, exp, revoked_at)` with `proof_method ∈ {oidc, acme, wot}` first-class from day 1. Default-weight scoring of the four candidates (ACME, OIDC, WoT, Hybrid) under `scripts/pki_decision.py` produced an exact tie at 153 between OIDC and Hybrid; tie-break per the matrix doc favored the more-reversible OIDC-first option. Decision deliberation honestly disclosed in the ADR's §Deliberation Summary: two attempts to dispatch the four canonical subagents (proponent / pragmatic / antagonist / acme-specialist) timed out before producing structured opinions, so the synthesis was written inline channeling each role from the canonical `agents/*.md` prompts. Hands-on walkthrough at `skills/pd-relay-zero-trust/examples/oidc-bootstrap-walkthrough.md`.  <!-- cite-exempt: historical entry — path as of that release -->
- **`pd-relay-zero-trust` skill — comprehensive zero-trust relay authority** at `skills/pd-relay-zero-trust/`. 13 references, 6 JSON schemas, 8 Python scripts (each with `--selftest`), 6 templates, 4 example walkthroughs, 4 deliberation subagent prompts, OpenAPI 3.1 surface for the relay endpoints. Skill canonical validator (`skills/skill-architect/scripts/validate_skill.py`) reports 0 errors / 0 warnings.
- **Quorum primitive — tuple-backed propose / vote / list / show**. `lib/quorum.ts` + `routes/quorum.ts` expose `POST /quorum/propose`, `POST /quorum/vote`, `GET /quorum/proposals`, `GET /quorum/proposals/:id`. Threshold-cross emits an idempotent `quorum:passed` tuple subscribers (and a future fleet-daemon auto-spawner) can react to. `pd quorum {propose,vote,list,show}` is the CLI surface. Phase 2 auto-spawn intentionally deferred. Landed in commit `cea02e1` despite the misleading title there ("Fix FleetBar empty-state popover collapse" — an auto-generated message; the actual diff is the quorum + daemon profiles slice).
- **Daemon profiles — named sidecar daemons**. `lib/daemon-profiles.ts` + `cli/commands/daemon.ts` + ADR-0024 add named sidecar daemon profiles beside the canonical daemon, with `PORT_DADDY_NO_FLEET` / `PORT_DADDY_NO_FLEETBAR` knobs so they cannot accidentally arm the same project fleet. Co-landed with the quorum slice.
- **Cartographer roadmap-progress endpoint surfaced via `pd roadmap`** (already shipped in `7ba8d84` + `ca8ffad`; the parity glue + manifest entry landed in this slice). One read-only structured payload spanning `ROADMAP.md` Next Cuts, `IDEAS-TROVE.md` `now` entries, `DOGFOOD-FEEDBACK.md`, current-work and cartographer-status excerpts, and freshness metadata. Kills the four-files-to-open FOMO problem.
- **Coordination Guard turned on for this repo** (`.portdaddy/coordination-guard.json`: `enabled: true, mode: enforce`). Pre-commit hook now blocks commits without an attached `pd begin` session.

### Fixed
- `lib/resolver.ts:setup()` refused to modify the hosts file under root unconditionally, which broke three resolver unit tests in CI sandboxes (which run as root) even when the test pointed `hostsFilePath` at a tempfile under `makeTmpDir()`. Scoped the root check to fire only when the resolved path is the system `/etc/hosts` (or `/private/etc/hosts` on macOS). Test paths are unaffected. Confirmed pre-existing on `origin/main` HEAD; the fix unblocked PR #5's unit-tests CI matrix on `ubuntu/macos × Node {20,22,24}`.
- `lib/quorum.ts`: passed-tuple emission had inverted logic (`if (!status.passed)` skipped emit on threshold cross). Replaced with passed-check + idempotency lookup against existing `quorum:passed` tuples in the same harbor.

### Changed
- Parity surfaces aligned for the new features: `features.manifest.json` (added `roadmap`, `quorum`, and `daemon`), all three completion files (bash/zsh/fish), `ALL_COMMANDS`, `ROUTE_TO_CLI_MAP`, and `MCP_EXEMPT_FEATURES`. `cartographer` and `quorum` are MCP-exempt for now; wrappers will follow once dashboard panels consume the endpoints.

## [3.8.4] - 2026-04-20

### Added
- **`pd say` — Consolidated Write Verb**: One command fans a finding out to multiple surfaces based on flags. Default writes a session note. `--pin` also writes a cross-session tuple. `--heat <path>[=N]` also sprays a pheromone (default strength 0.6). `--broadcast <channel>` also publishes to pub/sub. All fanouts run in parallel; partial failures report but don't fail the note. Replaces the `pd note … ; pd tuple out … ; pd pheromone spray … ; pd pub …` quadruple-call pattern with one call. (`--dm` flag deferred pending the inbox-targeting work in session 2471d576.)
- **`pd look` — Consolidated Read Verb**: Default is a sitrep synthesis across activity, notes, salvage queue, and spawned agents (last 60 minutes, bounded). `--heat` pivots to the file heat map. `--since N` widens the window. `--project` / `--stack` scope the salvage queue. `--json` and `--quiet` for machine-readable and one-line outputs (good for shell prompts).
- **`pd sitrep` — Explicit Maritime Alias**: Same implementation as `pd look`, kept as the maritime canonical name (fits `mayday`/`pan-pan`/`securite`). Both pointers stay — consolidated by convention, not by deprecation.
- **`pd pheromone` CLI**: Exposes the existing pheromone endpoints at the CLI for power users. Subcommands: `spray <table> <id> <key> <strength>`, `file <path> <strength>` (sugar for `spray files <path> heat`), `files [--path P] [--depth N]`, `show <table> <id>`, `ls`. Also aliased as `pd ph`.
- **`GET /sitrep` Route**: Server-side fan-out across `activityLog.getRecent()`, `sessions.getNotes()`, `resurrection.pending()`, `spawner.list()` with a single synthesis payload and a summary string. Query params: `since_minutes` (default 60, also accepts camelCase `sinceMinutes`), `project`, `stack`, `limit_activity` (default 30), `limit_notes` (default 20). The MCP `catch_me_up` tool now dispatches through this route and falls back to the legacy four-call pattern for pre-3.8.4 daemons.
- **MCP Tool Rename — `catch_me_up` → `sitrep`**: Canonical MCP tool name is now `sitrep` (matches CLI, matches maritime voice of the project). `catch_me_up` remains as a deprecated alias that delegates to the same handler. Existing MCP consumers keep working; new callers should use `sitrep`.

### Changed
- **§10.5 Cross-Session Coordination Paste-Block**: Rewritten in `docs/shipwright/NEXT-SESSION-PROMPTS.md` to use the new consolidated verbs (`pd say --pin --heat`, `pd look --since 2h`) in place of the quadruple-call pattern.

## [3.8.3] - 2026-04-06

### Added
- **Cost Tracking & Observability**: Per-spawn LLM cost recording with model pricing tables, budget enforcement per project, ODS-style time-bucketed operational metrics with in-memory batching. 6 new endpoints: `GET /metrics/golden` (RED signals), `GET /metrics/counters`, `GET /metrics/counters/top`, `GET /metrics/cost`, `GET /metrics/cost/recent`, `GET /metrics/cost/budget/:project`. Spawner automatically records cost + counter metrics for every spawn. Fleet engine blocks spawns when daily budget exceeded.
- **Fleet Config Management API**: `GET /fleet/config/:project` (raw YAML + parsed config + topology validation), `PUT /fleet/config/:project` (write YAML, validate, reload fleet), `GET /fleet/models` (available backend + model catalog with live Ollama detection).
- **`pd setup` — One-Command Onboarding**: Installs daemon, configures MCP in Claude Code/Desktop/Cursor, installs FleetBar (macOS), and initializes current project. Flags: `--no-daemon`, `--no-mcp`, `--no-fleetbar`, `--no-init`. Detects projects via `.git`, `pd-fleet.yml`, `package.json`, etc.
- **Agent Inbox Wake-on-Message**: `POST /agents/:id/inbox` now accepts `wake: true` + `project` fields. When wake is set, daemon calls `fleetDaemon.hailAgent()` to immediately activate a fleet-managed agent. Enables message-driven agent scheduling (vs. cron-only).
- **Fleet Singleton Enforcement**: Agents can declare `singleton: true` in `pd-fleet.yml` to prevent concurrent runs. Tracked via `activeAgentRuns` Set in fleet engine. All 6 sample fleet agents now declare singleton.
- **FleetBar Auto-Launch**: Daemon starts the FleetBar menu bar companion app on boot (macOS, if installed). Detects via `/Applications/FleetBar.app` or build artifacts. Silent on failure.
- **Handoff Note Encryption**: `endSession()` now encrypts handoff notes using the same AES-256-GCM layer as regular session notes (was plaintext).

### Changed
- **Spawner Dependency Injection**: Spawner is now injected via route dependencies (not module-level singleton). Enables testing and multiple spawner instances.
- **MCP Install Resilience**: `pd mcp install` now gracefully continues with skill installation even when no AI platforms are detected (was: early return).
- **Messaging `content` Fallback**: `POST /msg/:channel` now accepts both `payload` and `content` fields (`payload` takes precedence). Enables interop with systems that use `content`.
- **Fleet Prompt Name Resolution**: `pd fleet prompt` prefers explicit `name` field from `pd-fleet.yml`, falls back to git root basename.
- **Budgeted Agent Launches Are Now Mandatory**: `pd spawn`, `pd agent`, MCP `spawn_agent`, fleet auto-spawns, and the sortie launch UI now require a positive budget ceiling plus semantic identity, and they run through readiness/cost preflight before launch.
- **FleetBar Cost UI Uses Real Fleet Ceilings**: The FleetBar dashboard now reads per-project `budget_usd_per_day` from live fleet config instead of painting against a fake visual reference.
- **Website Spawn Docs Re-synced**: The website CLI, SDK, MCP, and tutorial pages for spawning now reflect the actual runtime contract and required budget/identity fields.

## [3.8.2] - 2026-03-30

### Added
- **Binary IPC Protocol (Phase 4B)**: High-frequency agent communication over Unix domain socket (`/tmp/port-daddy.ipc`) with MessagePack encoding. 7-byte header, 70-80% bandwidth reduction vs HTTP JSON. 13 FIPA performatives (INFORM, REQUEST, QUERY_REF, REFUSE, FAILURE, NOT_UNDERSTOOD, etc.). Fire-and-forget for heartbeats, pheromone sprays, pub/sub publish (~3us vs ~200us HTTP). Request-response with `conv_id` correlation for claims, locks, sessions. Pub/sub subscriptions with dead-man cleanup. Auto-reconnect client with subscription replay. SDK fast paths: `heartbeat()`, `pheromoneSpray()`, `publish()` auto-use IPC when available. 20 failure modes documented in ADR 0020.
- **IPC Security Hardening**: Rate limiting (500 frames/sec per connection), connection limit (256 max with REFUSE for excess), 3-strike protocol violation budget (malformed frames disconnect), backpressure via write queue + drain events. TOCTOU fix: `umask(0o077)` before socket bind. Performative type validation rejects unknown codes. Subscription limit: 64 per connection. Input validation: `asStringArray()` for array payload fields. Connect timeout on client prevents indefinite hang. Socket path length validation (macOS 104 / Linux 108 byte limits). Lock release on IPC disconnect (faster than heartbeat TTL). API surface enumeration removed from NOT_UNDERSTOOD responses.
- **API Reference Page**: `/docs/api` page with 93 REST endpoints, searchable, grouped by category, with curl examples. Docs sidebar gains "New in v3.8" section hoisted above Concepts. Dead search link (`/docs/concepts`) fixed. Sidebar highlight fix (exact path match, no `startsWith` overflow). CLI overview rewritten as clean grouped index.

### Fixed
- **Website Content Truth Audit**: 23 false claims removed (`brew install`, `pd daemon start`, `pd files claim`, etc.). 2 fictional tutorials rewritten (Pipelines to `pd watch`, RemoteHarbors to Coming in v4). 4 fake integrations replaced with real ones (Claude Code MCP, Aider, Ollama, custom). 38 CLI command syntax fixes across 16 files. SDK import path fixed (`@port-daddy/sdk` to `port-daddy`). Installation updated: `npm install -g` (no homebrew formula).
- **WCAG 2.1 AA Contrast Fixes**: `--text-muted`, `--text-secondary`, `--code-comment` tokens updated. Global `focus-visible` ring + `prefers-reduced-motion`. Responsive padding across 7 landing components. Touch targets bumped to 44px minimum (nav, copy buttons). Keyboard navigation for dropdown menus (`aria-expanded`, `role=menu`). IntentModal focus trap + `aria-modal`.
- **Terminal Component Consolidation**: 55 raw code blocks migrated to shared `CodeBlock` component. Syntax highlighting: commands (red/bold), flags (teal), strings (gold). 3 terminal components unified into 1.
- **Typography Fixes**: Heading line-heights, dark mode weight compensation, prose `max-width`. Search modal via portal (escapes sidebar overflow).

### Changed
- **Fleet QA Improvements**: Anti-tautology test rules for QA and test-hunter agents. Framework-agnostic quality rules (Jest/Vitest/pytest/Go).

## [3.8.1] - 2026-03-29

### Changed
- **Express → Fastify**: Complete HTTP framework migration. Same API surface, same endpoints, same behavior — faster engine. All 23 route files converted to Fastify plugins. `express`, `cors`, `express-rate-limit`, and `supertest` removed from dependencies.
- **Trie-accelerated query paths**: Wildcard service lookups (`myapp:*`) now use the semantic trie instead of SQL `LIKE` scans. O(k+m) vs O(n). Wired into `services.ts` find/release, `agents.ts` list/listStale.
- **1:N semantic trie**: Trie now supports multiple values per key via `entryId`. Agents sharing an identity are individually addressable. 14 new trie tests (40 total).
- **Trie sync on register/unregister**: Agent and session lifecycle events keep the semantic index in sync — `agents.ts` indexes on register, unindexes on unregister; `sessions.ts` indexes on start, unindexes on end.

### Fixed
- **BigInt serialization**: `lastInsertRowid` wrapped in `Number()` in `messaging.ts`, `changelog.ts`, `orchestrator.ts` — prevents `fast-json-stringify` errors.
- **Ephemeral port exhaustion**: `sdk-batch4.test.js` consolidated from 30+ Express servers to 1 shared server, then migrated to `fastify.inject()` (zero servers needed).
- **Missing briefing route**: `briefingPlugin` was absent from the Fastify route aggregator — added.
- **Duplicate /wait route**: `/wait/:id` existed in both health and services routes (shadowed in Express, error in Fastify). Removed from health; services owns the wait endpoints.

### Added
- **IPC Protocol Design**: `docs/IPC-PROTOCOL-DESIGN.md` — FIPA-grounded binary IPC design for Phase 4B. Covers communicative act mapping, 4 interaction protocols, MessagePack frame format (7-byte header, 70-80% bandwidth reduction), dual-socket architecture.

## [3.8.0] - 2026-03-27

### Added
- **The Arbiter**: Runtime invariant enforcement — 6 formally-derived rules check every state transition against the TLA+ specification. Rules: PID squatting, capability escalation, note monotonicity, escrow positivity, lock owner validity, heartbeat freshness. API: `GET /arbiter/status`, `GET /arbiter/violations`, `POST /arbiter/test-invariant/:name`. Subscribes to resurrection events. Strict mode triggers man-overboard salvage on critical violations.
- **Note Encryption (Escrow Secrecy)**: AES-256-GCM envelope encryption for session notes. Master key at `~/.port-daddy/master.key`. Per-session keys wrapped and stored in `sessions.wrapped_session_key`. Backward-compatible — existing plaintext notes remain readable. ProVerif-verified: `RESULT not attacker(note_content[]) is true`.
- **ProVerif Escrow Secrecy Model**: Fourth formal model (`analyses/harbor_card_v4_escrow_secrecy.pv`) proving note confidentiality and authentication under the Dolev-Yao adversary model.
- **ProVerif Results Captured**: All four models (v1 HS256, v2 Ed25519, v3 Delegation, v4 Escrow) executed in ProVerif 2.05. All queries return TRUE. Results saved to `analyses/harbor_card_v{1,2,3,4}_results.txt`.  <!-- cite-exempt: historical entry — path as of that release -->
- **"The Bonded Commons" White Paper** (16 pages, Erich Owens): Formal governance framework — Hobbes, Sen's Impossibility, collateralized work contracts. Three-layer trust: structural prevention (walls), immutable attribution (courts), economic alignment (insurance). TLA+ spec with escrow invariant.
- **Anchor Protocol White Paper Updated** (16 pages): Added Phase 2/3 ProVerif models to appendix, verbatim ProVerif output, Arbiter section, "Deployed" column in security table, actual Rust core code (not simplified).
- **V4 Unified Roadmap**: `docs/V4-UNIFIED-ROADMAP.md` — 6-phase plan with 16 appendix wild ideas preserved from original planning docs.
- **Economist Brief**: `docs/ECONOMIST-BRIEF.md` — Handoff document for mechanism design collaboration on bond pricing.
- **Note Encryption Design Doc**: `docs/NOTE_ENCRYPTION_DESIGN.md` — Full design, proof results, implementation, remaining gaps.
- **Semantic Trie** (`lib/trie.ts`): In-memory Adaptive Radix Tree for O(k) identity lookups. Replaces SQL `LIKE` scans. Supports exact, prefix, and wildcard match with harbor bitmask filtering. 26 unit tests, 10k entries in <10ms.
- **Semantic Index** (`lib/semantic-index.ts`): Live index that populates the trie from SQLite on startup (services, agents, sessions, harbors) and stays in sync on every register/claim/release.
- **Fleet Engine** (`lib/fleet-engine.ts`): Declarative fleet management from `pd-fleet.yml`. Cron-scheduled and event-triggered agents, pub/sub chaining (`on_success: publish channel`), template variable resolution, singleton mode, worktree isolation. Like docker-compose for AI agent swarms.
- **`pd-fleet.yml` schema**: Declarative YAML config for background agent fleets. Agents, watchers, and channels. Design: `docs/adr/0019-declarative-fleet-yaml.md`.
- **`pd fleet up/down/status`**: CLI commands for fleet lifecycle management. Loads `.env.local` for API keys, runs agents locally (not through daemon) for auth context.
- **Pheromone System** (`lib/pheromone.ts`): Stigmergic signal layer — spray/sniff/list with geometric read-time decay. File heat map via `GET /pheromone/files` aggregates session file claims into per-file contention scores. API: `POST /pheromone/spray`, `GET /pheromone/:table/:id`, `GET /pheromone`, `GET /pheromone/files`.
- **`pd dev start/stop/status`**: Isolated dev daemon via `PORT_DADDY_PREFIX` (nginx -p pattern). Runs alongside the stable daemon on port 9877 with separate DB and socket.

- **Spider Agent**: Fleet agent that finds combinatorial connections between existing features. Outputs syllogisms: "We have X AND Y, THEREFORE Z is now possible." Uses Sonnet model with high creativity. Produced 15 real connections (S1-S15) across two runs.
- **Spark-Spider Dialogue**: Asymmetric CSP pattern — Spider triggers on `spark:idea` (channel), Spark reads `.spider/connections/` (file). No cycles by construction. Ideas compound across runs.
- **Fleet Harbor**: `fleet.harbor` field in `pd-fleet.yml` — creates a named harbor on `pd fleet up`, auto-enrolls all agents. Shared semantic origin for trie lookups and scoped messaging.
- **Topology Validation**: `validateTopology()` in fleet-engine.ts — static DAG check on the trigger graph. Detects cycles, warns about orphan channels. 7 unit tests including real `pd-fleet.yml` validation.
- **CSP Protocol Specification**: `docs/FLEET-CSP-PROTOCOL.md` — formal process definitions for all fleet agents in CSP notation, channel topology properties, gather policies, TLA+ spec, Arbiter integration plan.
- **Fleet Live Dashboard** (`public/fleet-live.html`): 1322-line real-time dashboard for fleet monitoring. Fetches from 6 daemon endpoints, unified feed with time-period grouping, agent ribbon with clickable filters, expandable notes, SSE live updates. <!-- cite-exempt: surface retired by #652; historical entry -->
- **Fleet Live macOS App** (`fleet-live-app/`): SwiftUI menu-bar app wrapping WKWebView. SF Symbol in menu bar, 400x600 popover, daemon health check, no dock icon. Builds with `./build.sh`.
- **Git Post-Commit Hook** (`hooks/post-commit`): Publishes commit SHA, message, author, branch, and changed files to `git:committed` channel after every commit. Fire-and-forget (curl in background). Fleet agents trigger automatically.
- **Fleet Tutorial** (`website-v2/src/pages/tutorials/Fleet.tsx`): "Fleet: Agents That Run While You Sleep" — 7 sections covering YAML config, git hooks, triggers vs schedules, Spark-Spider dialogue, harbors, monitoring, and safety guardrails.
- **Build Verification Hook** (`.claude/settings.json`): Claude Code hook that runs `tsc --noEmit` on every Edit/Write to TypeScript files. Blocks edits that introduce type errors.

### Fixed
- **semantic-index.ts**: Fixed broken `find()` method (dead `identity()` closure instead of `pattern`), replaced 4x `as any[]` with typed row interfaces, replaced silent `catch {}` with diagnostic logging
- **fleet-engine.ts**: Replaced 5x `as any` with typed interfaces, fixed Bug 5 (`onSuccess` now fires on `status='spawned'`), fixed unsafe `pid!` assertion, removed invalid `--cwd` and `--max-tokens` CLI flags
- **fleet-engine.test.js**: Fixed fatal JSDoc `*/0 cron` that terminated comment block early (made entire suite unparseable)
- **routes/pheromone.ts**: Fixed `depth=0` falsy bug (`parseInt("0")||5`), fixed LIKE wildcard injection (escape `%` and `_`), fixed null-agent conflict detection (use `activeClaims` count, not `agents.length`)
- **Version consistency**: Bumped mcp/server.ts, plugin.json, mcp-server.json from 3.7.0 to 3.8.0
- **Parity gaps**: Added pheromone section to README, arbiter/pheromone endpoints to API reference, MCP exemptions for admin-only features
- **Spawner `.env.local` loading**: Spawned agents now inherit API keys from `.env.local` (searches cwd, parent, dev checkout, home). Augments PATH with `~/.local/bin` for `claude` binary discovery.
- **Dashboard identity resolution**: Both dashboards now resolve PIDs/spawned IDs to fleet agent names using identity map from `/agents`, `/spawn`, `/sessions` data
- **Dashboard expandable content**: Notes and purposes click-to-expand instead of truncating at 180 chars with no recourse
- **Dashboard eager loading**: All 11 data panels populate on page open (was showing "No data" until user clicked each tab)
- **Dashboard sparklines**: Stat cards now show 12-hour activity sparklines as inline SVGs
- **Dashboard fleet cards**: Agents panel uses status cards with heartbeat depletion bars instead of a flat table
- **Dashboard heat map**: Pheromone file heat map on overview panel, color-coded with CONFLICT badges
- **Dashboard consolidation**: Removed 3 dead panels (Integration, DNS, Inbox) — sidebar reduced from 15 to 12 items
- CLI unknown command tests: Updated to check both stdout and stderr (clack/prompts renders to stdout)
- Manifest enforcement: Added arbiter routes to `features.manifest.json`
- Missing `@clack/prompts` dependency added to package.json

## [3.7.0] - 2026-03-04

### Added
- **Dashboard WCAG AA accessibility**: ARIA landmarks, skip-nav link, keyboard navigation,
  modal focus traps, reduced motion support, toast live regions, SVG aria-hidden
- **Dashboard UX overhaul**: hash routing (back button works), 15s polling with live toggle,
  mobile responsive sidebar, daemon-offline banner, scroll overflow indicators
- **Dashboard nautical theme**: anchor/helm logo, wave-pattern card borders, maritime labels
  (Fleet, Salvage), signal flag status indicators, "Welcome aboard" empty-state onboarding
- **Dashboard SSE**: real-time updates via `/dashboard/events` endpoint, falls back to polling
- **Dashboard DNS panel**: view and manage local DNS records from the dashboard
- **14 new MCP tools**: set_session_phase, list_file_claims, who_owns_file,
  integration_ready, integration_needs, integration_list, briefing_generate, briefing_read,
  dns_register, dns_unregister, dns_list, dns_lookup, dns_cleanup, dns_status (44 total)
- **MCP instructions field**: key concepts (identities, salvage, file claims) for LLM context
- **MCP tool tiers**: [Essential], [Standard], [Advanced] labels in tool descriptions
- **CLI `pd help <topic>`**: focused help for sessions, locks, agents, sugar, dns, orchestration, tutorial
- **CLI compact help**: 25-line summary replacing 196-line wall of text, sugar commands first
- **CLI `pd learn` hint**: appears in default help, unknown command errors, first-run detection
- **SKILL.md**: with-lock, integration signals, briefing documentation
- Fish completions: dns, files, who-owns, integration, briefing, history, tutorial commands
- Examples: `examples/war-room/run.sh` (3-agent pub/sub demo), `examples/ci/github-actions.yml`
- Resource bounds: max agent inbox (1000), DNS per identity (50), notes per session (500)

### Fixed
- **MCP route bugs**: register_agent now POST /agents with body (was /agents/:id),
  heartbeat now POST (was PUT), salvage now GET /resurrection/pending (was /salvage),
  claim_salvage now POST /resurrection/claim/:id (was POST /salvage)
- **Dashboard old API patterns**: /claim/:id and /release/:id updated to v3.4 body-based API
- **Ghost CLI commands**: `b`→begin and `w`→whoami aliases now wired in the CLI parser
- **Fish completions**: added missing commands for dns, file_claims, integration, briefing, tutorial

### Changed
- **Performance**: SQLite WAL synchronous=NORMAL (11x throughput), WAL checkpoint in cleanup,
  4 inline statements moved to prepared, sessions index on status+updated_at,
  N+1 endpoint queries batched, O(N^2) log cleanup → OFFSET-based, messaging LIMIT 200,
  health endpoint COUNT(*) instead of full scan, O(N*M) cleanup loop → single JOIN
- **Dashboard polling**: 5s → 15s default with pause during interaction
- **CLI help**: restructured with topic maps, context-aware next-step hints
- Version bumped to 3.7.0 across package.json, mcp-server.json, plugin.json
- All 1870 unit tests passing across 33 suites, 105 parity tests green

## [3.6.0] - 2026-03-03

### Added
- **Named flag alternatives** for all text-accepting commands — no more guessing positional args
  - `pd begin --purpose "text"` / `-P "text"` (also `--identity`/`-i`, `--type`/`-t`, `--agent`/`-a`)
  - `pd done --note "text"` / `-n "text"` (also `--status`/`-s`)
  - `pd note --content "text"` / `-c "text"` (also `--type`/`-t`)
  - `pd pub <ch> --message "text"` / `-m "text"`
  - `pd session start --purpose "text"` / `-P "text"`
  - `pd integration ready <id> --description "text"` / `-d "text"`
- **Interactive mode** — run any sugar command with no args in a TTY and get maritime-themed prompts
  - `pd begin` → wizard for purpose, identity, file claims
  - `pd done` → prompts for final note and status
  - `pd note` / `pd n` → prompts for content and note type
  - Auto-skipped in CI, non-TTY, and `PORT_DADDY_NON_INTERACTIVE` environments
- **`pd learn`** — Interactive tutorial that teaches Port Daddy using real daemon commands (8 lessons)
- **Dynamic port resolution** — CLI reads `/tmp/port-daddy-port` instead of hardcoding port 9876

### Changed
- All positional text args remain backward-compatible — flags are a new alternative, not a replacement
- Shell completions updated in all three shells (bash, zsh, fish) with new flags and `learn` command
- 11 new CLI integration tests for flag alternatives and backward compatibility

## [3.5.0] - 2026-03-02

### Added
- `pd begin` — Register agent + start session in one command (replaces 3-command ceremony)
- `pd done` — End session + unregister agent atomically
- `pd whoami` — Show current agent and session context
- `pd with-lock <name> <cmd>` — Execute command under distributed lock with auto-release
- CLI aliases: `n` (note), `u` (up), `d` (down)
- Sugar REST endpoints: `POST /sugar/begin`, `POST /sugar/done`, `GET /sugar/whoami`
- SDK methods: `pd.begin()`, `pd.done()`, `pd.whoami()`
- MCP tools: `begin_session`, `end_session_full`, `whoami`
- Dashboard redesigned: sidebar navigation, glassmorphism theme, 3 new panels
- Distribution freshness tests (51 tests ensuring all surfaces stay in sync)

### Changed
- Dashboard reduced from 2287 to 371 lines with modern glassmorphism design
- Agent sessions now use `.portdaddy/current.json` for local context tracking

## [3.4.0] - 2026-03-01

### Added
- **Local DNS records** (`lib/dns.ts`): Map service identities to `.local` hostnames for human-friendly URLs
  - `pd dns register myapp:api api.myapp.local` — create a DNS record
  - `pd dns list` — list all records; `pd dns lookup <hostname>` — resolve hostname to port
  - `pd dns cleanup` / `pd dns status` — maintenance commands
  - API: `POST/GET/DELETE /dns`, `GET /dns/lookup/:hostname`, `POST /dns/cleanup`, `GET /dns/status`
  - MCP: `dns_register`, `dns_lookup`, `dns_list`, `dns_cleanup`, `dns_status` tools
  - SDK: `dnsRegister()`, `dnsLookup()`, `dnsList()`, `dnsUnregister()`, `dnsCleanup()`, `dnsStatus()` methods
  - 75 unit tests
- **Briefing system** (`.portdaddy/`): Project-local agent intelligence layer
  - `pd briefing generate` — generate a briefing from project context
  - `pd briefing read` — read the current briefing
  - MCP: `briefing_generate`, `briefing_read` tools
  - 40+ unit tests
- **Session phases**: Track session lifecycle stages (`planning`, `in_progress`, `testing`, `reviewing`, `completed`, `abandoned`)
  - `pd session phase <session-id> <phase>` — set session phase
  - Shell completions in bash, zsh, fish
- **Global file claim view**: See all file claims across all sessions
  - `pd files` — list all claimed files
  - `pd who-owns <file>` — find which session owns a file
- **Integration signals** via pub/sub: Coordinate readiness between agents
  - `pd integration ready <service>` — signal a service is ready
  - `pd integration needs <service>` — request a dependency
  - `pd integration list` — list integration status
- **Parity enforcement** (3 new test suites):
  - `manifest-enforcement.test.js`: bidirectional feature-to-code parity checks
  - `mcp-parity.test.js`: MCP tool-to-manifest route coverage
  - `endpoint-parity.test.js`: CLI/MCP calls-to-server routes with regression guards

### Changed
- **API route consolidation**: `POST /claim` and `DELETE /release` now accept `id` in request body (no longer in URL path) for consistency with `POST /agents`
- **Agent heartbeat**: Route is now `POST /agents/:id/heartbeat` (was incorrectly documented as PUT)
- **Lock extend**: Now cleans expired locks before checking existence (consistent with acquire/check/list)
- **Rate limiter**: Skip rate limiting for Unix socket connections (local-only tool)

### Fixed
- **Daemon resilience — sleep detection**: Detect macOS sleep via timestamp gaps, pause agent reaper during 5-minute grace period to prevent false-positive agent deaths
- **TCP port fallback**: Try ports 9876–9886 if preferred port is busy; write actual port to `/tmp/port-daddy-port` for CLI discovery
- **SQLite integrity**: Verify WAL mode on init, run `PRAGMA integrity_check` on startup, `closeDatabase()` with WAL checkpoint on clean shutdown
- **Duplicate daemon detection**: Socket liveness probe + PID file prevents spawning multiple daemons
- **Non-blocking system ports scan**: Replaced `spawnSync('lsof')` with async background refresh (root cause of daemon freeze when lsof hangs system-wide)
- **Non-fatal TCP listener**: `EADDRINUSE` on port 9876 no longer crashes daemon (socket stays active)
- **Startup self-healing diagnostics**: `pd doctor` — 4 new checks (SQLite integrity, stale socket, PID staleness, stuck lsof processes)
- **MCP bug fixes**: `register_agent` uses `POST /agents` with id in body; `check_salvage` calls `/resurrection/pending`; `claim_salvage` calls `/resurrection/claim/:id`
- **Agent inbox**: `markAllRead` now only updates unread rows (accurate change count)
- **Adversarial integration tests**: Fixed 54 test failures — updated route patterns for v3.4 API, fixed hardcoded assertions, converted direct fetch calls to Unix socket helper, corrected API behavior expectations (idempotent release, lock TTL normalization, agent upsert)

### Tests
- 6 new unit test suites: `resurrection.test.js` (49), `tunnel.test.js` (29), `changelog.test.js` (54), `inbox.test.js` (48), `dns.test.js` (75), `briefing.test.js` (40+)
- 3 new parity enforcement suites
- Total: 1961 tests across 36 suites (all passing)

## [3.3.0] - 2026-02-27

### Added
- **Tunnel integration**: Expose local services to the internet via ngrok, cloudflared, or localtunnel
  - `pd tunnel start <service> --provider cloudflared|ngrok|localtunnel` — start a tunnel
  - `pd tunnel stop <service>` — stop a tunnel
  - `pd tunnel status <service>` — get tunnel status
  - `pd tunnel list` — list all active tunnels
  - `pd tunnel providers` — check which providers are installed
  - API: `POST/DELETE/GET /tunnel/:id`, `GET /tunnels`, `GET /tunnel/providers`
  - SDK: `tunnelStart()`, `tunnelStop()`, `tunnelStatus()`, `tunnelList()`, `tunnelProviders()` methods
  - Shell completions: tunnel subcommands in bash, zsh, fish
- **Context-aware salvage UX**: Agent identity (`--identity project:stack:context`) enables smart filtering
  - `pd agent register --identity myapp:backend:main` — semantic identity for agents
  - Auto-salvage notice: when registering, check for dead agents in the same project and show notice
  - `pd salvage --project myapp` — filter resurrection queue by project (default behavior)
  - `pd salvage --stack api` — further filter by stack
  - `pd salvage --all` — show global queue (requires explicit opt-in, shows warning)
  - SDK: `salvage()`, `salvageClaim()`, `salvageComplete()`, `salvageAbandon()`, `salvageDismiss()` methods
  - Dashboard: Identity column in salvage table
  - Shell completions: `--project`, `--stack`, `--all`, `--limit` flags for salvage; `--identity`, `--purpose`, `--worktree` flags for agent register

## [3.2.0] - 2026-02-23

### Added
- **Sessions & Notes system** (`lib/sessions.ts`): Structured multi-agent coordination replacing flat-file `.CLAUDE_LOCK` / `.CLAUDE_NOTES.md` patterns — session lifecycle (start, end, abandon, remove), immutable append-only notes with types (note/handoff/commit/warning), and advisory file claims with conflict detection
- **Session schema**: `sessions`, `session_files` (with `released_at` audit trail), `session_notes` tables with CASCADE deletion
- **Auto-session**: `quickNote` creates an implicit session for agents that skip explicit `session start`
- **Session garbage collection**: `cleanup(olderThan?, status?)` for removing stale sessions
- **Session HTTP routes** (`routes/sessions.ts`): 11 endpoints — `POST/GET /sessions`, `GET/PUT/DELETE /sessions/:id`, `POST/GET /sessions/:id/notes`, `POST/DELETE /sessions/:id/files`, `POST/GET /notes`
- **Session CLI commands**: `pd session start/end/done/abandon/rm`, `pd session files add/rm`, `pd sessions [--all] [--status] [--files]`, `pd note <content> [--type TYPE]`, `pd notes [session-id] [--limit N] [--type TYPE]` — all with `--quiet/-q` and `--json/-j` output modes
- **Session SDK methods**: 10 new methods on `PortDaddy` class — `startSession`, `endSession`, `abandonSession`, `removeSession`, `note`, `notes`, `sessions`, `sessionDetails`, `claimFiles`, `releaseFiles`
- **SDK type honesty**: 42 typed response interfaces replacing every `Record<string, unknown>` — `ClaimResponse`, `ReleaseResponse`, `LockResponse`, `ServiceEntry`, `AgentDetail`, `WebhookEntry`, `ActivityEntry`, and 8 new session-related interfaces
- Activity logging for `session_start`, `session_end`, `session_note`, `file_claim`, `file_release` events
- 110 new unit tests for sessions module; test suite now at 1283 tests across 19 suites
- **SDK reference doc** (`docs/sdk.md`): full SDK documentation moved out of README into dedicated reference

### Changed
- **README restructured for layered audiences**: Layer 1 (solo devs — stable ports), Layer 2 (teams — orchestration), Layer 3 (agents — sessions, locks, pub/sub). Non-technical summary above the fold. README reduced from 1187 to ~470 lines
- **Sessions & Notes documented** as headline feature with `.CLAUDE_LOCK` comparison table
- **"When NOT to Use Port Daddy" section** added for honest self-selection
- **`pd` alias** prominently documented throughout (previously buried)
- **Colon syntax** explained inline in Quick Start: `myapp:api:main` = project:stack:context
- Shell completions: added `up`, `down`, `diagnose` commands to all 3 completion files (zsh, bash, fish); added `--from`/`--to` flags for `log` command in fish; normalized quiet flag handling in CLI

### Fixed
- **GC zombie cleanup**: removed dead agents-to-services cleanup path (services lack `agent_id` column); added PID liveness checking via `process.kill(pid, 0)` to `services.cleanup()`; only checks running services (assigned services preserved)
- **Stale agent lock release**: agents that disappear now have their held locks properly released
- **Jest open handle leak**: `unref()` webhook retry timers to prevent Jest worker hang; added `messaging.destroy()` for clean subscriber teardown
- **Shell completions**: `handlePorts()` now distinguishes empty results from API errors
- **6 crash/corruption defects**: operator precedence in `orchestrator.ts` skip-logic; systemic `safeJsonParse` across 13 `JSON.parse` call sites on DB TEXT columns so a single corrupted row no longer crashes the daemon; defensive optional chaining on `SqliteError` in `locks.ts`

## [3.1.0] - 2026-02-22

### Added
- **SDK parity**: methods for every API endpoint — `scan`, `listProjects`, `getProject`, `deleteProject`, webhook CRUD (`get`, `update`, `test`, `deliveries`, `events`), `metrics`, `getConfig`, activity range/summary/stats, service health checks, port listing (active, system)
- **CLI parity**: commands for every API endpoint — `dashboard`, `channels`, `webhook`, `metrics`, `config`, `health`, `ports`; `lock extend` subcommand; `log --from/--to` time-range flags
- **Shell completions** (`completions/`): zsh, bash, and fish completions for all new CLI commands — dashboard, channels, webhook, metrics, config, health, ports, lock extend, log --from/--to
- **Claude Code plugin** (`.claude-plugin/`): agent skill manifest for Claude Code and Vercel AI SDK integration
- **OIDC npm publishing**: GitHub Actions workflow for trusted npm publishing via OpenID Connect (no stored tokens)
- `pd` alias for `port-daddy` CLI binary
- Complete SDK and API reference documentation in README

### Changed
- **CLI syntactic sugar**: single-letter command aliases (`c`=claim, `r`=release, `f`=find, `l`=list, `s`=scan, `p`=projects); `--export` flag on claim prints `export PORT=XXXX` for shell eval; TTY-aware output suppresses decorative text when piped
- UX friction points addressed from product analysis
- README rewritten for clarity — agentic coordination story above the fold, one-liner skill install, Vercel Agent Skill compatibility surfaced
- Dashboard updated to reflect full v3.1 command surface

### Fixed
- CLI binary broken after TypeScript migration (`d62cb92`)
- Package publishable: `dist/` exports, `types` field in package.json, `pd` bin alias
- REST cover art and centered branding header in README

### Removed
- **`detect` and `init` commands**: deprecated in favor of `scan` (which combines detection + registration)

## [3.0.0] - 2026-02-19

### Added
- **TypeScript rewrite**: all 32 source files migrated from `.js` to `.ts` with full type annotations — 18 lib modules, 11 route files, 3 entry points (server, CLI, install-daemon)
- **Framework detection expanded to 58 stacks** (`lib/detect.ts`): added `stackType` property and 36 new framework signatures — Gatsby, Docusaurus, Eleventy, TanStack Start, Koa, Hapi, AdonisJS, Strapi, KeystoneJS, RedwoodJS, Elysia, Blitz.js (Node.js); Streamlit, Gradio, Starlette (Python); Rails, Sinatra with Gemfile parser (Ruby); Laravel, Symfony, WordPress with composer.json parser (PHP); Spring Boot, Quarkus, Micronaut with pom.xml/gradle parser (Java/JVM); Phoenix with mix.exs parser (Elixir); Deno, Fresh (Deno); ASP.NET, Blazor with *.csproj parser (.NET); Expo, Tauri, Electron (Mobile/Desktop); Hugo, Jekyll, Zola (SSGs); Bun, Webpack Dev Server
- **Ephemeral test daemon**: Jest `globalSetup`/`globalTeardown` spawns fresh daemon with temp SQLite DB and temp Unix socket per test run — no dependency on running daemon, fully CI-friendly
- **Unix socket support**: SDK (`lib/client.ts`) and CLI use `http.request` with Unix socket for daemon communication
- `import type` used for type-only imports throughout
- `tsx` runtime replaces `node` in all scripts and test helpers

### Changed
- **BREAKING**: Node.js 18 dropped (EOL); now tested on Node 20, 22, and 24
- **BREAKING**: All imports are `.ts` source files (NodeNext resolution); consumers must use `dist/` compiled output
- better-sqlite3 upgraded to v12 for Node 24 compatibility
- Security audit findings addressed: expanded SSRF protection (IPv4-mapped IPv6, CGN RFC 6598, multicast, `.local`/`.localhost`/`.internal` hostnames); replaced `as any` casts with bounded `as unknown as Parameters<>` casts; error logging in shutdown catch block
- Flaky rate-limit test stabilized
- Orchestrator daemon requests routed through Unix socket instead of TCP fetch

### Fixed
- `port-daddy down` now uses PID-based orphan cleanup — previous snapshot-diffing approach skipped force-release when daemon was unreachable, root cause of CI flakes on macOS
- `port-daddy down` waits for shutdown and verifies port release before returning
- Process groups killed in up-down tests to prevent orphaned children on Linux
- Up-down test cleanup scoped to own projects only (was interfering with parallel test workers)
- `api.test.js` isolated with in-memory SQLite DB (was sharing file-based DB across parallel Jest workers)

## [2.0.0] - 2025-02-17

### Added
- **Service orchestration**: `port-daddy up` / `port-daddy down` — start your entire stack with dependency ordering, health checks, and colored multiplexed output (like `docker-compose` for local dev)
- **Orchestrator engine** (`lib/orchestrator.js`): Topological sort via Kahn's algorithm, port claiming, env injection, graceful SIGTERM shutdown in reverse dependency order  <!-- cite-exempt: historical entry — path as of that release -->
- **Service discovery** (`lib/discover.js`): Auto-discovers services in monorepos (npm/yarn/pnpm workspaces, lerna) and generates semantic identity suggestions  <!-- cite-exempt: historical entry — path as of that release -->
- **Log prefixer** (`lib/log-prefix.js`): Docker-compose-style colored output — 10-color palette, padded service names, dim stderr  <!-- cite-exempt: historical entry — path as of that release -->
- **Framework auto-detection**: `port-daddy detect` identifies 16 frameworks (Next.js, Vite, Express, FastAPI, Django, Angular, SvelteKit, Remix, Astro, Nuxt, Vue CLI, CRA, Fastify, Hono, NestJS, Flask)
- **Environment diagnostics**: `port-daddy doctor` checks daemon connectivity, port range, `.portdaddyrc` validity, Node.js version, and system port conflicts
- Unified CLI: Single `port-daddy` command with subcommands replacing separate shell scripts
- Semantic identities: `project:stack:context` naming for all services (e.g., `myapp:api:main`)
- JavaScript SDK (`lib/client.js`): Zero-dependency programmatic API for Node.js  <!-- cite-exempt: historical entry — path as of that release -->
- Pub/sub messaging: Real-time inter-service messaging with SSE subscriptions
- Distributed locks: Atomic lock/unlock with TTL and auto-cleanup
- Agent registry: Register, heartbeat, and discover active agents
- Webhooks: Subscribe to events with HMAC-signed payloads
- Activity logging: Full audit trail of all operations
- `.portdaddyrc` project config: Per-project service definitions with `needs` dependency graph, `env` injection, `healthPath`, `noPort` workers
- Dashboard: Dark-themed real-time web UI at `http://localhost:9876`
- Shell completions for bash and zsh
- Input validation with shared validation module
- Rate limiting: 100 req/min per IP, 10 concurrent SSE connections
- SSRF protection on webhook URLs
- 1078 tests across 19 suites (unit + integration)
- GitHub Actions CI across Node 18/20/22 on Ubuntu and macOS

### Changed
- Complete architectural rewrite from monolithic server.js to modular lib/ + routes/
- CLI rewritten from bash wrapper scripts to unified Node.js CLI
- Port assignment now uses semantic identity parsing
- All state in SQLite with WAL mode
- ESM throughout (import/export)

### Removed
- Separate `get-port`, `release-port`, `list-ports` shell scripts (replaced by unified CLI)
- `VERSION` file (version now in package.json)
- `migrations/` directory (schema inline in server.js)

## [1.2.0] - 2025-01-15

### Added
- Security hardening: input validation, rate limiting, parameterized queries
- npm packaging with cross-platform CLI tools
- GitHub Actions CI and release workflows

### Changed
- Improved error handling across all endpoints

## [1.1.0] - 2025-01-10

### Added
- Initial release
- Port assignment via HTTP API
- SQLite-backed persistence
- Process tracking with auto-cleanup
- Basic web dashboard
- Bash CLI tools (`get-port`, `release-port`, `list-ports`)
- macOS launchd daemon installer
