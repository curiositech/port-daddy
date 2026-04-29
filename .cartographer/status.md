# Cartographer Status

**Last updated:** 2026-04-29
**Updated by:** Codex commit-and-push closeout
**HEAD:** `629de64`
**Stable:** `40cf79d` — promoted from `main@717f4f4` and pushed to `origin/stable`
**Previous HEAD:** `a1dc622` — `pd-fleet.yml` hardened with fallbacks, throttles, and watcher fixes before the latest maritime / website polish burst

---

## Current Phase

**Recovery Track dominates. V4 roadmap phases are secondary.**

Active work ledger lives at `docs/recovery/CURRENT-WORK.md`. Keep the in-flight queue there, then reflect major closures or drift here.

The latest committed work still maps overwhelmingly to the Recovery Roadmap (`docs/recovery/UNIFIED-ROADMAP.md`), not the V4 phase structure. Track 1 (Cost & Observability) is closed. Tracks 2 (FleetBar) and 3 (Fleet Config UI) remain active. The freshest commit stream is mostly unplanned website / release-surface / phone-integration work, plus maritime actor / launchability hardening. Within V4, Phase 3 is still the hottest mapped phase, Phase 2 is the closest to a closure point, Phase 1 remains in-tree but not fully promoted, and Phase 5/6 are stale.

## Snapshot

- Velocity: 174 commits in the last 7 days = 24.9/day.
- Closest to completion:
  - `claim-preserving-git-safety`
  - `fleet-launchability-and-cadence`
  - `coordination-guard-extended-enforcement`
- Blocked or drifting:
  - Phase 5 network / remote harbors
  - Phase 6 connectors / coaching
  - Phase 4E `pd self-test --adversarial` / 4F Windows IPC
- Open dogfood now: 3 slugs (`claim-preserving-git-safety`, `fleet-launchability-and-cadence`, `session-context-cwd-reset`)

### Cartographer Refresh (2026-04-29)

- `cartographer-roadmap-progress-screen` moved out of Immediate Implementation Candidates; the progress/feedback route is shipped and no longer a next cut.
- `629de64` — website content, proof media, terminal recordings, examples, and FleetBar preview package metadata were committed and pushed.
- `4dba2a3` — the Port Daddy agent skill bundle was published into repo and tool-specific mirrors.
- `eac3fc3` — live tuple-backed feedback now surfaces in roadmap progress, CLI, and Fleet Control Center roadmap UI.
- `5f01294` — Agents pages gained Flow / Coordination Guard / Smart Resources expansions and generated session/agent IDs became human-readable.
- `9e7d458` — maritime layer dropped: actor IDs are fleet agent names.
- `a1dc622` — `pd-fleet.yml` hardened with fallbacks, throttles, and watcher fixes.
- `68753a9` — `pd-fleet.yml` plus git-hygiene guidance landed in the `port-daddy-cli` skill.
- `0718477` — website distribution commands polished.
- `d5c05aa` — coordination guard audited after commits.
- `3214576` — MCP and Mac preview surfaces polished.
- `8c65932` — MCP catalog docs refreshed.
- `e9b57b3` — `pd tube` tutorial merged.
- `5db90d7` — SPA hash anchor navigation landed.
- `adcc608` — examples clarified as buildable tools.

Active threads, ranked by commit recency:

Newest committed truth since the last cartographer refresh:

- `40cf79d` — stable promotion commit for `main@717f4f4`; pushed to `origin/stable`. Promotion gate passed `147/147` Jest suites, `5019` tests, `1` skip, then rebuilt/reinstalled the stable daemon.
- `717f4f4` — promotion verification wait loops now use explicit `/bin/sleep` so daemon port/runtime verification actually waits instead of failing red after a healthy install.
- `fccce3a` — actor inbox acknowledgement and salvage summary release surfaces are documented in OpenAPI and the Port Daddy skill/API reference.
- `806bb8a` — Coordination Guard hooks now fail closed when `pd guard check` fails instead of printing ENFORCE errors and falling through to a later `exit 0`.
- `41eb63f` — stale-work visibility improved: `pd salvage --summary`, encrypted salvage-note redaction, actor inbox mark-read route/CLI, parity surfaces, and docs recovery updates.
- `b9ea3bb` / `8630817` — Shipwright view coverage and Coordination Guard hook checks landed from peer sessions.
- `7a65e5d` — fleet launchability surfaces now expose backend/readiness blockers; `@anthropic-ai/sdk` is installed and Cartographer moved onto Claude Haiku with explicit status/health/preflight signals.
- `7b91e37` — Shipwright component review shots are committed.
- `28cbfe2` — FleetBar now surfaces project readiness.
- `57b51ca` — tracked Python bytecode artifacts were removed.
- `295854d` — stale fleet leases are reclaimed on daemon restart. Stable was
  promoted from `main@295854d`, and the live daemon reports version `3.11.0`
  from `/Users/erichowens/port-daddy-stable`.
- `f689337` — Shipwright is now a real Fleet Control Center surface. The app
  accepts `surface=shipwright`, renders an all-project fixture-backed workbench,
  shows fixture labels instead of pretending daemon truth, and ships a rebuilt
  `public/fleet-ui` bundle. Validation: Fleet UI lint/build, focused
  ship-grammar test, browser smoke via Chromium CDP, and broad `npm test`
  (`143/143` suites, `4981/4982` passing, `1` skip) are green.
- `2cc9fee` — Fleet UI served bundle was rebuilt for the first Shipwright
  grammar/API/fixture slice.
- `f45b751` — CLI session/sugar/tuple typecheck debt is closed; `npm run typecheck` is green again.
- `8cddbca` — git-sensitive channel discovery is committed.
- `8236119` — curated workgroup-ai skills import is committed.
- `0f77491` — stable cost-tracker migration fix is committed.
- `175210f` — fail-closed spawn telemetry is committed.
- `278fa47` — `with-lock` bare `--` parsing fix is committed.
- `961a41c` / `4765090` — tunnel TTL/orphan cleanup and startup-timeout hardening are committed.

Current validation truth on 2026-04-18:

- broad `npm test` is green at `123/123` suites and `4689/4690` passing tests with `1` intentional skip.
- focused tuple/semantic suites (`semantic-terms`, `episodic-memory`, `merge-queue`, `fleet-engine`, `fleet-daemon`) are green.
- `npm run typecheck` is red, but the remaining failures are confined to the pre-existing `cli/commands/diagnostics.ts` `{}`-typing hole rather than this working-tree tuple slice.

Current Compass advisor validation truth on 2026-04-26:

- focused advisor/parity bundle is green: `tests/unit/advisor.test.js`, `tests/unit/bijective-parity.test.js`, `tests/unit/mcp-parity.test.js`, `tests/unit/manifest-enforcement.test.js`, and `tests/unit/endpoint-parity.test.js`.
- `npm run typecheck` is green.
- focused `sessions` + advisor/parity bundle is green at `572/572` tests after adding inactive-session claim regression coverage.
- broad `npm test -- --no-coverage` reached green counts at `139/139` suites and `4919/4920` passing tests with `1` intentional skip, then hung after Jest's open-handle warning.
- remaining caveat: the broad-run exit blocker is the integration harness daemon process tree (`jest -> tsx -> server.ts`) on files actively claimed by the Bosun session `session-c4cc1a46-77ba-4c72-85cf-9ce13637cc97`. Compass recorded tuple `5474`, inboxed `agent-e802a389`, and cleaned up its own hung PIDs rather than editing across that active claim.

Stale-work visibility truth on 2026-04-27:

- `pd salvage --project port-daddy --summary` now makes the salvage queue legible as non-live triage instead of a wall of zombie rows: status counts, age buckets, project scope, encrypted-note redaction counts, and active-work comparison commands.
- Encrypted salvage notes are redacted in CLI output. Current post-promotion dogfood truth: 57 non-live `port-daddy` entries, 60 encrypted notes redacted, 6 entries under 2 hours, 44 from 2-24 hours, and 7 over 24 hours.
- Actor inboxes now have an explicit acknowledgement route and CLI path: `PUT /actors/:id/inbox/read-all` and `pd actor <id> --inbox --mark-read`. The messages remain stored; only unread state changes.
- Navigator inbox was read but not acknowledged. It currently has 6 unread messages; at least two are still meaningful roadmap/promotion coordination requests.
- Validation: focused salvage/actor route tests passed, `npm run typecheck` passed, `git diff --check` passed, and source CLI dogfood for salvage summary and Navigator inbox reads succeeded.

Promotion/hygiene truth on 2026-04-27:

- Current `main` was pushed to origin at `89f17ac`; stable was promoted through `65f2b4e` after `./scripts/promote-stable.sh` passed `5025` tests with `0` failures.
- Live daemon truth after that promotion: Port Daddy `3.11.0`, PID `13470`, health `ok`, runtime `nominal`, install dir `/Users/erichowens/port-daddy-stable`.
- FleetBar was rebuilt, reinstalled, and launchd-kickstarted; live process PID `14267`.
- Promotion exposed a build hygiene bug: `scripts/build-core.sh` built inside the tracked `core/harbor-card-rs/target/release/**` tree, leaving stable dirty after a successful promotion.
- The fix now builds the Rust FFI core via an external Cargo target directory and copies only the resulting shared library into `dist/core`; a follow-up promotion passed the same `5025`-test gate and left the stable checkout clean at `418a1d0`.

Historical promotion recovery truth on 2026-04-27:

- The official promotion rerun was owned by the Harbormaster path under `pd with-lock stable-promotion`; the lock released after completion.
- Remote `main` is `717f4f49bbb382851fe582b926ce88dc2f06b69f`; remote `stable` is `40cf79d9f5846986fc6ed8ed696061fd2268a856`.
- Live daemon truth after promotion: Port Daddy `3.11.0`, code hash `ce3faf8fb34e`, install dir `/Users/erichowens/port-daddy-stable`, health `ok`, runtime `nominal`.
- Stable checkout had generated Rust target dirt under `core/harbor-card-rs/target/release/**`; do not mistake that class of artifact for source work.
- `pd sessions --active` and actor projections still disagree with `pd agents --active --json` after daemon restart. This is now an explicit Coxswain coordination debt item, not a private observation.

Skill-governance truth on 2026-04-26:

- The active Port Daddy skill repair session is
  `session-a7366433-5e18-4deb-b78a-561b77163e23`.
- `pd actor cartographer` now resolves live to the durable `navigator` actor,
  which owns roadmap, recovery-ledger, work-slices, and cartographer-status.
- The `port-daddy-cli` skill now tells agents to query `pd actor
  cartographer`, `pd actor navigator --inbox*`, and `pd actor lookout
  --message` for roadmap/what-next and skill/docs drift before trusting stale
  prose.
- `AGENTS.md` and the `port-daddy-cli` skill now define ambient collaboration:
  agents should publish structured facts through notes, claims, tuples, scoped
  channels, and actor inboxes; durable actors/watchers should escalate only
  material inconsistencies instead of forcing constant peer chat.
- The collaboration policy now covers implied operator goals, not just bugs:
  security/auth/privacy/trust-boundary/API-shape drift, public product or UX
  contradictions, and locally correct work that violates strong inferred
  direction should be surfaced through `coordination:inconsistency`.
- The `coordination:inconsistency` worktree channel and tuple `6213` capture
  that operator-worthy callout policy for live tooling.
- Tuple `6249` records the example policy that a raw text API can conflict with
  adjacent authenticated secure API work even when no one explicitly asked
  whether the raw endpoint should be secure.
- A fresh live read showed the coordination gap directly: `pd sessions
  --active` listed two active sessions, while `pd agents --active --json`
  returned zero live registered agents and `/operator/actors` classified the
  same sessions as stale/salvaged. That mismatch belongs in Coxswain/Lookout
  follow-up work.
- `tests/unit/port-daddy-skill-authority.test.js` now guards both first-party
  metadata and this live actor consultation path.
- `scripts/audit-skills.mjs` now records skill governance deterministically.
  Current scan: 109 visible skills under `skills/` and `.codex/skills/`, 70
  missing at least one of `license`, `allowed-tools`, or `metadata`, 4
  first-party skills, and 19 imported-literature skills.
- The validated user-level installed copy at
  `/Users/erichowens/.agents/skills/port-daddy-cli/` was mirrored from the repo.
  The workgroup `port-daddy` skill has now been adapted at
  `/Users/erichowens/coding/workgroup-ai/skills/port-daddy/` without renaming
  the package surface: the body is aligned with the current runbook, the
  changelog records the merge, and references match the repo skill references.
- Difference check: repo and user installed `port-daddy-cli` were already
  identical at 729 lines; the workgroup copy was an older 409-line surface with
  a 546-line diff, missing briefing/advise/ambient coordination/actor truth and
  current backend/delegation guidance. Its API reference was stale by 755 diff
  lines and its SDK reference by 49 diff lines.
- Fleet Control Center did use coordination primitives generically through
  actors, channels, tuples, graph, and memory, but not the new
  `coordination:inconsistency` policy specifically. The web control plane now
  renders project-level callouts for that channel; FleetBar native still needs a
  dedicated popover alert if the operator wants the warning outside the embedded
  web control plane.
- Validation on the continuation session
  `session-d50ed49e-60b5-4e0a-8387-50884f127176`: focused skill-governance tests
  passed, `pd fleet validate` passed, `git diff --check` passed, and
  `fleet-config-ui` production build passed with the known large-chunk warning.

Actor-model reconciliation truth on 2026-04-23:

- `docs/adr/0022-durable-actor-souls-and-body-leases.md` now captures the target runtime model: durable actor souls plus ephemeral body leases.
- The key warning is explicit: do not preserve agent history by merely disabling row deletion. Agent-row deletion currently carries cleanup and authorization semantics, so the migration needs lease/incarnation state first.
- `/agents` should remain the live-body compatibility view while `/actors` becomes durable identity truth.
- Inbox, salvage, lock ownership, IPC auth, Arbiter checks, Fleet Control Center, FleetBar, SDK docs, and OpenAPI all need coordinated migration from "registered agent" to `actor exists` plus `body lease is live`.

Task-inventory truth on 2026-04-24:

- `docs/recovery/CURRENT-WORK.md` now has a normalized remaining-slice inventory under `## Active Tasks`.
- The queue is grouped by actor/domain instead of a duplicate-numbered mixed list: cut/promote discipline, Navigator, durable actors, Coxswain, Sounder, Signalman/Breaker/Caulker, Quartermaster, Harbormaster, Lookout, FleetBar/control plane, sorties/HITL, Cloudflare/remote harbor, archaeology, and skills/research.
- WAL is already enabled and verified in `lib/db.ts`; the remaining WAL-related task is live diagnostics/doctor visibility, not basic enablement.
- No brand-new skill blocks the next implementation cut. Useful existing skills include Nygard resilience, Agha actor model, Cloudflare Worker/Pages, agentic zero-trust, FIPA agent management, runtime verification, observability, and cost verification. Proposed future skills are `cloudflare-ai-platform`, `port-daddy-actor-runtime`, `symbolic-coordination`, and `cartographer-bootstrap`.
- Google Agents CLI research is now captured at `docs/reports/GOOGLE_AGENTS_CLI_RESEARCH_2026-04-24.md`. The important import is lifecycle-first IA and primitives: setup, scaffold/create, enhance, upgrade, run, eval, deploy/promote, publish, observe, plus first-party coding-agent skill bundles. The recovery queue now tracks turning that into a Port Daddy lifecycle/docs/skill proposal instead of copying Google Cloud assumptions blindly.

Newest validated working-tree slice before the next commit:

- **Compass / coordination advisor suggestibility** — uncommitted CLI/MCP/API slice. The repo now has a deterministic first pass at telling agents and humans which coordination primitives to use before editing:
  - `lib/advisor.ts` emits evidence-backed recommendations over session context, file claims, symbol freshness, salvage, declared channels, tuple-worthy facts, and true lock candidates
  - `routes/advisor.ts` exposes `GET /advisor` and `POST /advisor`
  - `pd advise`, `pd preflight`, and `pd compass` render the advice for humans
  - MCP exposes `coordination_preflight` as an essential agent tool
  - parity surfaces were updated in the feature manifest, completions, tests, skill docs, and API reference
  - dogfooding exposed and repaired inactive-session file-claim zombies in `lib/sessions.ts`; `tests/unit/sessions.test.js` now asserts inactive sessions cannot claim files, inactive unreleased rows do not block conflicts, and terminal sessions cannot be moved back to nonterminal phases
  - important limit: this is deterministic advice only; FleetBar/Fleet Control Center cards, graph edges for recommendations, stale asset reclaim actions, and optional LLM ranking remain follow-up work

- **Cartographer / Navigator maritime actor foundation** — uncommitted runtime + CLI/docs slice. The repo now has the first additive `/actors` read surface instead of only a prompt-level roadmap updater:
  - `docs/adr/0022-durable-actor-souls-and-body-leases.md` defines durable actor souls versus live body leases
  - `docs/adr/0023-cartographer-roadmap-actor.md` defines Cartographer as a durable roadmap/recovery-map actor with a mailbox, read model, tuples, graph edges, and evidence links
  - `.cartographer/README.md` defines bootstrap reconciliation, document authority classes, tuple vocabulary, graph vocabulary, and patch policy
  - `lib/maritime-actors.ts` defines the canonical maritime roster and projects live body, recent session, and salvage evidence
  - `routes/actors.ts` exposes `GET /actors`, `GET /actors/:id`, and `POST /actors/:id/message`; `cartographer` resolves to `navigator`, and actor messages queue to `actor:<id>` inbox targets without granting dormant actors live mutation authority
  - `pd actors` and `pd actor <id-or-alias>` expose the actor directory in the CLI; `--inbox` and `--inbox-stats` expose durable mailbox state separately from live-body wake status
  - README, completions, `features.manifest.json`, `docs/openapi.yaml`, MCP, and the Port Daddy skill API/SDK references now include the `/actors` and actor-inbox surfaces
  - `PortDaddy` SDK clients now have `listActors()`, `getActor()`, `messageActor()`, `actorInboxList()`, and `actorInboxStats()` helpers, with SDK reference docs and request-formation regression coverage
  - the initial batch cleanup step is explicitly report-first: inventory, classify, extract work/evidence, emit structured state, then propose narrow cleanup patches
  - sibling systems now have canonical maritime actor names: Navigator, Coxswain, Signalman, Harbormaster, Sounder, Lookout, Breaker, Caulker, and Quartermaster; most should be deterministic projectors with optional LLM bodies
  - validation on 2026-04-26: focused actor + SDK + MCP + parity bundle is green at `551/551`, and `npm run typecheck` / `npm run build` are green
  - broad `npm test -- --no-coverage` reached green counts at `142/142` suites and `4973/4974` tests with `1` intentional skip, then hit the known Jest open-handle warning; the hung `--no-coverage` process tree was cleaned up manually

- **Promotion-gated release-surface review** — new uncommitted Harbormaster/Lookout slice. `promote-stable.sh` now emits a structured `promotion:release-surfaces` tuple and pub/sub signal after tests pass and before stable merge. The fleet `documentarian` now listens to that promotion channel instead of every `git:committed`, with singleton/cooldown/dedupe/backoff controls so docs/website/SDK/CLI/tutorial/README/skill review happens at the high-signal release boundary without directly spawning a swarm. `PORT_DADDY_PROMOTION_REVIEW_REQUIRED=1` can make emission fail-closed; `PORT_DADDY_PROMOTION_REVIEW_ONLY=1` stops before merge so release-surface agents can work first. Regression coverage lives in `tests/unit/promotion-release-review.test.js`. Validation on 2026-04-26: focused tests, typecheck/build, source `pd fleet validate`, and broad in-band Jest are green (`143/143` suites, `4980/4981` tests, `1` intentional skip).

- **Port Daddy skill happy path polish** — new uncommitted Lookout slice. `skills/port-daddy-cli/SKILL.md` now opens as a runbook with one default sequence (`pd status` -> `pd briefing` -> optional salvage -> `pd begin` -> `pd advise` -> `pd note` -> precise claims -> result note -> `pd done`) before any advanced surface catalog. A small decision table gates ports, locks, tuples, inbox/actors, delegation, integration signals, and DNS. `tests/unit/port-daddy-skill-authority.test.js` now guards the ordered happy path so the skill cannot silently drift back into command soup.

- **Tree-sitter symbol refresh from repo events** — uncommitted working tree. The live server now passes `symbolIndex` into the fleet daemon, and managed projects refresh symbols from existing Port Daddy infrastructure instead of manual `/symbols/parse` calls:
  - project-scoped `git:committed` messages are consumed by the daemon and normalized to in-project code files
  - source-file watcher events are debounced and filtered before calling `symbolIndex.parseFile()`
  - the daemon subscribes to both fleet-name scoped and repo-basename hook channels to survive the current `port-daddy-dev` vs `port-daddy` channel mismatch
  - validation on 2026-04-24: focused `fleet-daemon` tests are green, `npm run typecheck` is green, and broad `npm test` is green at `132/132` suites and `4816/4817` tests with `1` intentional skip
  - runtime caveat: the canonical daemon still needs rebuild/relaunch/promotion before this new event-driven symbol refresh is live

- **Tuple-first coordination + semantic harmonization** — uncommitted working tree. Tuple space is now a real first-class coordination fabric for fleet/memory/merge activity instead of a side primitive:
  - `lib/fleet-engine.ts` accepts `trigger_tuple`, drains tuple mailboxes as launch inputs, and emits semantic alias tuples from fleet work items
  - `lib/fleet-daemon.ts` emits `fleet:event` tuples for lifecycle truth
  - `lib/merge-queue.ts` emits `merge:event` tuples plus semantic alias tuples and `alias_of` / `about` graph joins
  - `lib/episodic-memory.ts` emits `memory:episode` tuples plus semantic alias tuples
  - `lib/semantic-terms.ts` now provides the deterministic lexical canonicalization layer that collapses phrasing drift like `website design system`, `site design-system`, and `website design tokens` onto the same canonical semantic term
  - important limit: this is not embedding-backed resolution yet; semantic joins are now explicit and deterministic, but deeper synonym/near-neighbor resolution via Ollama/vector search remains future work

- **Tunnel cost-safety hardening** — uncommitted working tree. Port Daddy-managed tunnels are no longer treated as fire-and-forget child processes:
  - `lib/tunnel.ts` now enforces a default max-active tunnel budget, assigns a default TTL, persists tunnel metadata for restart reconciliation, and periodically sweeps stale/expired tunnel state
  - stale tunnel DB records are now fail-closed instead of being reported as ghost-running history, and best-effort orphan cleanup only kills a persisted PID when the live command line still matches the expected provider + port
  - `server.ts` now stops all managed tunnels during graceful shutdown and disposes the tunnel reaper
  - `routes/tunnel.ts`, `cli/commands/tunnel.ts`, and `lib/client.ts` now surface expiry metadata / cleanup reasons so the operator sees the policy instead of silent cleanup
  - regression coverage now exists in `tests/unit/tunnel.test.js` and `tests/unit/tunnel-lifecycle.test.js` for budget exhaustion, TTL reaping, stale-record cleanup, and orphan-process cleanup
  - validation truth on 2026-04-11: focused tunnel tests are green, and broad `npm test` is green at `114/114` suites and `4627/4628` tests with `1` intentional skip
  - `npm run typecheck` remains red from the same broader pre-existing CLI/client/IPC typing debt family; this slice fixed the new tunnel CLI typing errors it introduced

0. **agentsd.ai site reset contract** — new planning authority on 2026-04-11. The repo now has explicit anti-drift documents for the public rebrand:
   - `docs/AGENTSD_AI_SITE_CONTRACT.md` defines the route budget, template budget, component-system rules, truth labels, and deletion policy for the new public site.
   - `docs/AGENTSD_BRAND_IDENTITY.md` defines the brand constraints, visual direction, and logo boundaries for `agentsd`.
   - Important truth: `portdaddy.dev` is now treated as a failure case, not a migration template. The public `agentsd.ai` shell should be rebuilt against the new contract rather than inheriting the old page forest.
   - That rebuild is now real in the working tree: `website-v2/src/main.tsx` is reduced to `/` + `/docs/**`, public shell components live under `website-v2/src/components/site/`, `website-v2/src/data/publicSite.ts` now drives the landing/docs content, and Storybook coverage exists for the new public primitives/header.
   - The visual direction has also been corrected in-code: the landing page now follows the stronger `v0-agentsd-main` composition language (blue/lime color blocking, proof terminals, architecture diagram, open-core pricing, docs mosaic) instead of the interim generic/brutalist drift.
   - New truth from the latest pass: the dark-mode shell had real WCAG failures on bright blue/lime surfaces. The working tree now fixes those at the token/component layer, shifts docs module chips from `Available Now` / `Planned` into `Live` / `Roadmap`, and records the resulting persona/friction/appeal analysis at `docs/reports/AGENTSD_PUBLIC_SHELL_AUDIT_2026-04-11.md`.

1. **IPC lock lifetime fix + real IPC regression coverage** — uncommitted working tree. Dogfooding the promoted filepath-lock slice exposed a transport-coupling bug: owner-driven `pd lock <filepath>` calls were succeeding over IPC and then vanishing immediately because daemon disconnect cleanup treated every IPC socket close as agent death. The working tree now removes disconnect-time lock release from `server.ts`, leaving TTL expiry and stale-agent cleanup as the real recovery paths, and the integration harness now exposes an isolated ephemeral IPC socket plus isolated HOME so CLI tests can exercise IPC without falling onto the operator's live daemon.
   - New regression truth on 2026-04-11: `tests/integration/cli.test.js` now proves that filepath locks acquired over IPC remain exclusive across separate CLI invocations and unlock cleanly afterward.
   - Validation truth on 2026-04-11: focused `cli` + `locks` coverage is green, and broad `npm test` is green at `114/114` suites and `4616/4617` tests with `1` intentional skip. The old worker-force-exit warning still remains, so this slice fixed lock lifetime truth, not the broader Jest teardown debt.

2. **Session fallback / ownership hardening** — now committed at `6d136cc`, with adjacent doc drift still active. The operator-visible session-instability path turned out to be real: `pd whoami` trusted `agentId` first, so stale agent cleanup could make an active session look dead, and explicit `done(agentId + sessionId)` ownership checks were reading the wrong session field. The committed slice lets `whoami` recover from an explicit active `sessionId`, preserves useful local `purpose` / `identity` context in the CLI when daemon reconstruction is session-only, and returns `409 SESSION_OWNERSHIP_MISMATCH` for explicit foreign-session `done` calls instead of a generic `500`.
   - Validation truth on 2026-04-11: focused `client` / `sugar` / CLI integration regressions are green, and broad `npm test` is green at `114/114` suites and `4611/4612` tests with `1` intentional skip. The older Jest worker-force-exit warning still remains.
   - New residual truth from that verification pass: the CLI integration suite still pollutes repo-local `.portdaddy/current.json` / slot files, which stomped a real operator session after the suite completed. That is now explicit cleanup debt, not invisible test collateral.

3. **Direct-mode stale-context fail-closed cleanup** — committed inside `6d136cc`, with follow-on cleanup still relevant. A fresh full-suite run after `df4c351` exposed a real regression that matches live dogfood: `pd note --direct` was still trusting repo-local current context even when that session belonged to a different backend/DB, so the operator got `session ... not found` instead of the intended closed-fail `no active session found`. The committed slice now validates local context against the direct DB before reusing implicit session/agent scope, and the shared CLI note path validates local context against the active backend before auto-scoping implicit `pd note`.
   - Validation truth on 2026-04-11: `tests/integration/direct-mode.test.js` is green again, and broad `npm test` is green at `114/114` suites and `4611/4612` tests with `1` intentional skip. The older Jest worker-force-exit warning still remains.

4. **Semantic graph + episodic memory slice** — uncommitted working tree. The repo now has a real `graph_edges` implementation plus an `episodic_memory` store, HTTP routes for both, tests for both, and a new Memory surface in `fleet-config-ui` / FleetBar. Existing systems are being wired into it: symbol indexing writes file/symbol/dependency edges, merge-queue writes merge-entry/branch/file/status edges, sessions promote handoffs/findings/decisions/results/failures into episodes, sorties promote blocked/completed/failed mission moments into episodes, and tuple scanning now supports filtered search for the Memory view.
   - This means the live working tree has already crossed the boundary from “Phase 1 is blocked on `graph_edges`” into “Phase 1 plumbing exists but is uncommitted and undocumented.”
   - The immediate truth task is no longer inventing the feature; it is deciding whether this slice is the next real cut or crash residue that needs quarantine.
   - `docs/recovery/CURRENT-WORK.md` and this status file both needed an honesty update because they were still describing the pre-graph state.
   - That symbol-backed claim-authority cut is no longer queued future work; it landed at `df4c351`. The next queued polish after locks / tuples is to propagate that committed symbol-backed truth consistently into graph edges, episodic memory, merge/conflict prediction, and the control plane.

5. **Recovery docs/runtime truth sync** — still active, now partly committed and partly merged with the graph/memory slice. README, MCP docs, OpenAPI, the Port Daddy skill bundle, and the website’s core spawn/fleet/tutorial surfaces were being pushed onto the same local-first contract: Ollama + Codex as first-class backends, mandatory budget ceilings, explicit model tiers, and “9876 is the default, not a universal truth.” The same slice also fixed `pd fleet run <agent>` so one-shot fleet runs inherit a real budget ceiling instead of hard-failing preflight.
   - `pd fleet validate` is live again in the CLI. It parses YAML, resolves templates, checks trigger topology, and exits without spawning agents. The remaining work there was discoverability drift: README, skill docs, and the website CLI page all needed to mention it again.
   - Port Daddy dogfooding surfaced another live drift: `port-daddy sortie run ...` from the installed shim returned `ERROR: Not Found`. Treat that as a runtime-route availability bug in the canonical daemon path until proven otherwise.
   - The session-context hardening cut is now committed at `50fe92f`: slot-scoped `.portdaddy/contexts/<slot>.json`, compatibility-only `current.json`, and fail-closed explicit note/session targeting.
   - The lingering Jest teardown debt is also now repaired in the working tree: IPC client timeout/reconnect timers and the SDK heartbeat are `unref()`ed, webhook retries are owned/disposable, and the serialized handle hunt is clean on 2026-04-11 (`npm test -- --runInBand --detectOpenHandles` => `109/109` suites, `4523/4524` tests, `1` intentional skip, no open-handle warning).
   - The next runtime cut after the session-context hardening pushed IPC into the real operator loop instead of leaving it as a niche agent path: router support for `sugar.whoami` + `fleet.prompt`, SDK ephemeral IPC request fast paths for `done`/`whoami`/`note`/file claims, and CLI delegation to those SDK paths. The important constraint is now explicit in code: IPC is only allowed when talking to the canonical local daemon. Explicit TCP URLs or alternate socket targets must stay on their declared transport.
   - The latest committed operator transport cut at `3940093` extends that same rule into sessions and `with-lock`: SDK fast paths now cover `startSession` / explicit `endSession` / `sessions()` / `removeSession()`, CLI `pd session ...` consumes the real response keys (`filePath`, `releasedFiles`, `released`) instead of stale ghosts, and `pd with-lock` now uses SDK lock helpers instead of duplicating raw fetches.
   - Focused validation on that session/with-lock slice is clean: targeted router/client/CLI tests are green, `tests/integration/cli.test.js` is green, and `--detectOpenHandles --runInBand` across `client` / `ipc-router` / `cli` / `sugar` / `sessions` is green (`5/5` suites, `377` tests) with no open-handle report.
   - Broad test truth after that IPC tranche is now `111/111` suites + `4592/4593` tests on `npm test`. The parallel suite still prints `A worker process has failed to exit gracefully`, so unresolved worker-teardown debt remains, but the current session/SDK/CLI slice does not appear to be the source.
   - A new follow-up bug was also surfaced honestly instead of papered over: bare `--` is still not treated as end-of-options in `bin/port-daddy-cli.ts` even though tutorial/help text teaches `pd with-lock ... -- ...`. That parser file was already claimed by another active session, so this follow-up is blocked on coordination, not forgotten.
   - Stable checkout archaeology is now explicitly recognized as operator contamination. `/Users/erichowens/port-daddy-stable` was being used as a live daemon/fleet workspace, so its `.spark`, `.spider`, logs, DB, and tracked build outputs are not authoritative. Unique Spark/Spider markdowns have been copied into the active checkout so further curation can happen in one place.

5. **Recovery Track 2 / 3 — FleetBar + control plane truth** — `a41f18f`, `e82f096`, `1aeb2b1`, `809816e`, `e7eba7b`, `1ebe6e6`, `853cc57`, `83d1a22`, and the current uncommitted Memory tab wiring continue pushing the runtime and UI toward one truthful control plane. The latest UI drift is no longer only chrome/activity polish; it now includes exposing semantic memory as a first-class operator surface.
   - The latest uncommitted operator-truth fix closes a real product lie: FleetBar and the web control plane were deriving “projects” from `/fleet`, so “no running fleets” rendered as “no projects.” The working tree now merges registered `/projects` with live `/fleet` state and broadens `/fleet/config/:project` so stopped registered projects still resolve.

6. **Spawn discipline + virtual-actor scheduling direction** — newly active in the working tree after the “190 spawns today” thread and cross-check against `docs/plans/agentsd_ai_technical_architecture.md`. The repo now has a first concrete pass on per-agent cooldown, trigger dedupe, and exponential backoff in `lib/fleet-engine.ts`, with regression coverage in `tests/unit/fleet-engine.test.js`.
   - This is not the whole answer. The deeper architectural move is to stop letting every watcher/subscriber behave like an equal peer and instead introduce actor-like mailboxes for `project`, `fleet`, `agent`, `harbor`, `sortie`, and trigger keys. The shared medium primitives (pub/sub, tuples, trie, graph, pheromones) stay; activation policy moves into mailbox-owned scheduling.
   - The recovery implication is clear: cooldown/dedupe/backoff are no longer isolated safety hacks. They are the first production cuts toward an actor-governed fleet runtime that can collapse repeated wakes, preserve budgets, and stop spawn storms by construction.

7. **Cloudflare AI backend adoption** — newly active in the working tree as an immediate runtime slice, with the broader infra follow-on still queued.
   - The source now has a first Cloudflare Workers AI backend path: model tiers in `lib/fleet-engine.ts`, runtime execution in `lib/spawner.ts`, readiness in `lib/backend-readiness.ts`, and operator/backend catalog updates in `routes/fleet.ts`, `routes/spawn.ts`, `cli/commands/spawn.ts`, `mcp/server.ts`, and `docs/openapi.yaml`.
   - This is intentionally scoped to the runtime path first. The larger Cloudflare opportunity set still needs explicit planning: AI Gateway for centralized policy/observability/caching, Vectorize + AI Search for retrieval surfaces, and remote-harbor-friendly auth/key/registry patterns that align with the TAD's delegated PKI story.

8. **Current-session drift hardening** — newly active and now partly fixed in the working tree.
   - Root cause was architectural, not incidental: CLI sugar/session commands treated `.portdaddy/current.json` as one mutable repo-global truth, so concurrent shells or agents in the same checkout could overwrite each other's current agent/session identity.
   - The working tree now replaces that with slot-scoped local context under `.portdaddy/contexts/<slot>.json`, keeps `current.json` only as a compatibility pointer, and prevents slot readers from falling through into some other slot's latest context.
   - The note path is also stricter now: `sessions.quickNote()` accepts explicit `sessionId`, direct-mode `pd note` forwards current slot context, and ambiguous unscoped worktree notes fail closed instead of drifting to global "most recent active".
   - Live-path verification already passed against the canonical daemon with two concurrent slots in one checkout (`live-a`, `live-b`): `pd whoami` and `pd note` stayed bound to the correct session in each slot.
   - The newest follow-up in the working tree is smaller but important: direct-mode and shared CLI note paths now validate local context against the current backend before reusing it, so stale context degrades to the intended closed-fail path instead of leaking `session ... not found`.
   - The next honesty task is docs/help alignment: installed CLI behavior is now ahead of user-facing prose that still describes `current.json` as the sole authority.

8. **Recovery Track 1 — CLOSED** — `8744e14` committed `lib/counters.ts`, completing the observability trifecta (cost-tracker + counters + observability routes). All `/metrics/*` endpoints are now populated with real data. Fleet budget gates actively stop spawns. Released as v3.8.3.

9. **Fleet/runtime archaeology rehab** — `3ece95a` promoted long-dirty roadmap/docs changes and two substantive untracked test suites (`semantic-index`, `tunnel-lifecycle`). It also shipped a small but real runtime hygiene fix: the spawner heartbeat interval now `unref()`s so blocked-spawn tests do not hold Jest open just by hitting the concurrency ceiling.

10. **Residual archaeology still on disk** — now down to residue policy, not test limbo:
   - the spider connection note pile under `.spider/connections/` is now explicitly moving into `.gitignore` rather than pretending to wait for promotion
   - the redundant `spawner-commit-0df9155-bugs` battery was retired after folding its only useful assertions into `tests/unit/spawner.test.js`
   Everything else from the previously dirty runtime/test/doc slices has now been either committed, merged into normative coverage, or explicitly quarantined.

V4 Phase activity:
- **Phase 1 (Semantic Graph):** No new committed slice yet, but the working tree now contains real `graph_edges` + semantic-memory plumbing. The stale-clock concern has changed from “nobody started this” to “this is half-landed and needs an explicit commit-or-quarantine decision quickly.”
- **Phase 2 (Economy):** `lib/counters.ts` committed — observability trifecta complete. Pricing function still blocked on economist.
- **Phase 3 (Fleet & Memory):** 3A/3D active via Recovery tracks. 3B (episodic memory) and 3C (deep scan) untouched.
- **Phase 4 (Resilience):** No new commits. Bun binary stalled since 2026-04-01 (5 days). 4B/4C complete. 4E/4F not started.

---

## Velocity

**62 commits in the 7-day window** (2026-03-30 to 2026-04-06)
**8.9 commits/day** average (up from 8.4 — the Apr 5-6 burst added 11 commits)

| Date | Commits | Driver |
|------|---------|--------|
| 2026-03-30 | 31 | IPC Waves 1-4, security hardening, parallel agents, website compression |
| 2026-03-31 | 6 | Security fixes, fleet daemon, FleetBar app |
| 2026-04-01 | 10 | Bun binary, `pd mcp install`/`pd init`, FleetBar, blog content, CTA redesign |
| 2026-04-02 | 0 | -- |
| 2026-04-03 | 0 | -- |
| 2026-04-04 | 1 | CLI aliases + test hardening |
| 2026-04-05 | 11 | Cost-tracker, fleet safety, recovery docs, tutorials, blog, hero, VHS GIFs |
| 2026-04-06 | 4 | Track 1 closure, FleetBar unification, sortie surfaces, control plane hardening |

Burst-cool-burst pattern continues: 37 commits (Mar 30-31), 2 zero-commit days (Apr 2-3), then 15 commits (Apr 5-6). The Apr 5-6 burst was tightly focused on Recovery Track work — less scattered than the Mar 30 sprint.

### Energy Distribution (8-day window, Mar 30–Apr 6, 66 commits)

| Category | Commits | % | Roadmap Phase |
|----------|---------|---|---------------|
| Phase 4 (Fastify, IPC, Bun) | ~20 | 30% | 4A, 4B, 4C, 4D |
| Phase 3 extensions (fleet daemon, FleetBar, safety) | ~10 | 15% | 3A, 3D |
| Phase 2 (cost-tracker, counters, observability) | ~3 | 5% | 2A infrastructure |
| Recovery tracks (setup, readiness, sortie, unification) | ~5 | 8% | Recovery 3.8.3/3.8.4 |
| Security hardening | ~5 | 8% | Unplanned |
| Website / marketing / docs | ~15 | 23% | Unplanned |
| Maintenance / CI / test hardening | ~8 | 12% | Unplanned |

**Planned vs. unplanned: 58% / 42%.** Improvement over last run (was 35%/65%). The Recovery Roadmap's existence is helping — "recovery work" is now counted as planned.

**Uncommitted inventory is no longer just cleanup.** The main in-flight slices are now: semantic graph + episodic-memory plumbing, lease self-healing verification, loopback host / daemon discovery cleanup, project-scoped trigger archaeology, FleetBar/control-plane density work, and native-shell/operator-ergonomics fixes. Treat `docs/recovery/CURRENT-WORK.md` as the operational source of truth instead of mentally diffing `git status`.

---

## Top 3 Closest to Completion

1. **Fleet Config UI v0.1** *(Mostly committed, still iterating)*
   - Backend endpoints committed (`8744e14`): `GET/PUT /fleet/config/:project`, `GET /fleet/prompt`, `GET /fleet/models`
   - FleetBar unified to consume this surface (`a41f18f`)
   - explicit file actions shipped (`83d1a22`)
   - Activity/Sortie truth fixes shipped (`853cc57`)
   - **Remaining: higher-level product/UX cleanup, not core wiring.**

2. **Daemon discovery + lease recoverability cleanup** *(UNCOMMITTED, high leverage)*
   - `shared/daemon-discovery.ts` now carries the shared loopback host
   - `cli/utils/fetch.ts`, `server.ts`, FleetBar `DaemonLocation.swift`, and fleet-ui API defaults were updated to stop sprinkling new `localhost:9876` assumptions
   - `lib/fleet-daemon.ts` now attempts lease reacquisition when renewal sees `lock not held` and no competing holder exists
   - regression coverage added in `tests/unit/fleet-daemon.test.js`
   - **Remaining: restart the live daemon and verify `/fleet` actually recovers instead of sitting in `skipped` with `owner: null`**

3. **Recovery 3.8.3 release cut** *(CRITERIA MOSTLY MET)*
   - Daemon startup: stable (committed)
   - Fleet backend/model selection: explicit with fallbacks (committed `3b818d2`)
   - Readiness/auth preflight: committed (`3b818d2`)
   - Cost/counter/observability: populated with real data (committed `8744e14`)
   - Fleet singleton enforcement: committed
   - **Remaining: verify all uncommitted test files pass, commit completions updates, cut the release. Most criteria from the Recovery Roadmap are satisfied.**

4. **Residual test archaeology** *(MOSTLY RESOLVED)*
   - The redundant `spawner-commit-0df9155-bugs` battery was not promoted as-is
   - Its missing normative assertions now live in `tests/unit/spawner.test.js`
   - **Remaining: keep trimming any future archaeology down to durable contract tests instead of one-off bug museums.**

---

## Top 3 Blocked or Drifting

1. **Phase 1 — Unified Edge Table (1A)** *(DRIFTING — 7 days, 7 days to stale threshold)*
   - Three Phase 1-adjacent modules on disk (~2500 lines): symbol-index, merge-queue, orchestrator-plugins
   - All wired into `server.ts` (committed `0ae2df6` on 2026-03-30)
   - But they depend on `graph_edges` table which has no migration
   - `tests/unit/semantic-index.test.js` (453 lines, uncommitted) validates symbol index
   - **The Apr 5-6 burst (7 commits) touched `server.ts` and `routes/index.ts` — the same files these modules are wired into. Merge friction risk is now elevated.**
   - **One migration away from activating ~2500 lines. 7 days to stale threshold.**

2. **Phase 2 — The Economy** *(BLOCKED on economist, infrastructure now complete)*
   - Bond pricing function pi is the open problem
   - Thomas Youle (Indiana U) proposed insurer-agent auction 2026-03-30 — no follow-up in 7 days
   - The observability trifecta gives real cost data to calibrate against
   - Fleet budget gates are enforced but use static pricing
   - **Unblocked path: export cost data from `/metrics/cost` and send to Youle. Real numbers accelerate the conversation.**

3. **Phase 4A — Bun binary** *(STALLED — 5 days since last commit)*
   - `6a8c8bb` (Apr 1) added build scripts and GH Actions workflow
   - `db4c315` (Apr 4) included "Bun prep"
   - No confirmed working single-file binary distribution
   - No commits since Apr 4
   - **Not yet at stale threshold, but the Apr 5-6 burst went to Recovery work, not Bun. If the next burst also skips Bun, it risks stalling permanently.**

---

## Observations

- **The actor model is now a runtime migration, not just a Shipwright metaphor.** The repo had been using "agent" for durable identity, live process lease, inbox target, salvage target, and authorization principal. ADR-0022 separates those concerns: souls persist; body leases attach, expire, and carry authority. This is now the governing frame for future `/actors`, salvage, IPC auth, Fleet Control Center, and FleetBar work.
- **The dangerous shortcut is "just stop deleting agents."** That would preserve history while breaking orphan detection, stale lock cleanup, IPC authorization, and Arbiter assumptions. Any implementation that changes deletion before adding lease/incarnation state should be treated as suspect.
- **The Recovery Roadmap is the real execution authority.** 5 of 7 new commits map directly to Recovery Track criteria (Track 1 closure, Track 2 FleetBar, 3.8.3 runtime safety). The V4 phase structure is becoming a reference taxonomy rather than an active execution plan. This is fine — as long as both documents are maintained. The cartographer should update both.
- **The full-suite red slice was mostly parity drift plus one real transport edge.** The repaired failures were not random: `routes/messaging.ts` had stopped honoring `body.message`, the client test still assumed a hardcoded daemon URL, completions/manifest/MCP parity did not fully know about `sortie`, stale spawner mocks no longer matched the `node:fs` import surface, and the Unix-socket integration helper needed to normalize oversized-body `EPIPE` / `ECONNRESET` into the daemon's actual 413 intent.
- **The orchestrator leak was real runtime debt, not just Jest drama.** Reactive `exec` rules spawned child processes with no cleanup contract and piped their output under Jest, which produced late console logs and open pipe handles. The current working tree now suppresses piped stdio under Jest, `unref()`s child handles, and exposes a shutdown path for the reactive orchestrator. The remaining full-suite worker-force-exit warning is now a different leak, not the same one.

- **Track 1 closure broke a 3-run pattern.** `lib/counters.ts` was flagged as "one commit away" in three consecutive cartographer runs (Apr 5 first run, Apr 5 second run, and the manual sync note). It finally shipped in `8744e14`. The pattern suggests: cartographer flagging alone doesn't drive commits, but having a "Recovery Track" with explicit closure criteria does. Recovery Tracks are more motivating than cartographer warnings.

- **FleetBar architecture is now correct.** `a41f18f` eliminated the "shadow dashboard" anti-pattern — FleetBar shells the daemon's fleet-config-ui instead of reimplementing it in SwiftUI. One fleet UI, two consumers (browser + native). This is the architecture that should have been built from the start. The hardening commit (`e82f096`) immediately followed, which is good discipline.
- **The deeper Activity bug was backend attribution, not just UI layout.** Briefing and project-scoped activity views were querying by `target_id` prefix even though real `session.start`, `session.end`, `session.note`, and sugar rows often had `target_id = null`. The active fix is to stamp scope into the activity writers and read structured metadata back out, rather than teaching more UI code to regex prose.
- **The channel scoping bug is now split into “engine” versus “archaeology.”** `lib/fleet-channels.ts` already scopes logical fleet channels by `projectDir`, and current tests cover `global:` bypass semantics. The reactive dashboard now also resolves logical names to physical scoped channels before polling/publishing. If `expunge-my-arrest` still wakes on a Port Daddy website commit, stale detached watcher processes or already-open stale UI clients are the first suspects, not missing scoping in the modern fleet engine.
- **Fleet YAML watchers should not be daemon-owned `pd watch` children.** A promoted daemon was restarting under Bosun while detached `pd watch ... qa:findings` subscribers from the working checkout survived each restart and hammered SSE. The current hardening slice moves daemon-owned YAML watchers onto in-process messaging and makes standalone watch clients preserve backoff on 429/denied SSE responses.
- **Socket truth and TCP truth can diverge.** `port-daddy status` talks over the Unix socket and can report healthy while browser/FleetBar TCP consumers still fail or drift. Operator validation now needs both surfaces checked, not just the CLI.
- **Freshness authority was too broad.** The monolithic CLI still had an old freshness auto-restart path that could SIGTERM the canonical daemon from foreign checkouts or non-interactive watcher commands. `1ebe6e6` narrowed that authority to interactive commands from the same install root as the live daemon.
- **The next UI truth bug is still sortie-specific.** The control plane no longer resets runtimes after launch, but the end-to-end sortie path still needs fresh live verification now that daemon-side errors surface inline.
- **Backend-tier truth is now wider than the UI currently shows.** The runtime now carries low/mid/high ladders for Claude SDK, Claude CLI, Gemini, Codex, Ollama, Aider, and Custom. `aider` now honors the selected model at execution time, and `custom` receives the resolved model/tier via env so wrappers can act on it. The next honesty task is exposing that same tier truth clearly in operator surfaces, not letting it stay backend-only knowledge.
- **Port Daddy's own fleet now embodies the budget doctrine in source.** `pd-fleet.yml` is switched to local-first defaults: Ollama for background/read-only agents, cheaper Codex tiers for code-changing agents, and hosted backends as opt-in. The next operator truth task is keeping the live daemon aligned with that source choice instead of letting stale manual runtimes serve outdated model mappings.
- **Local model provisioning is now real, not aspirational.** Aider is installed, Ollama has been upgraded back to a healthy daemon, and the recommended local ladder models are present on this machine. The remaining gap is live-daemon alignment and UI/operator truth, not missing local runtimes.
- **Claude SDK readiness was lying by omission.** The readiness probe only checked `ANTHROPIC_API_KEY`, not whether `@anthropic-ai/sdk` was installed, so the UI could honestly-ish say “ready” and then fail at launch for a missing package. The active fix makes dependency presence part of readiness.
- **Activity had a second lie after project attribution was fixed.** Even when the project log had meaningful work, the left rail could still say “No non-empty agent signals yet” because it only rendered agents with precomputed signals. The current UI patch switches Activity to always list configured agents and use feed fallback when structured signals are sparse.
- **Operator file affordances were too vague.** Showing touched files without explicit machine actions forced operators back into manual path copying. The control plane and FleetBar now expose Finder/editor actions directly off surfaced file mentions.
- **Manual fleet upkeep had a hidden budget bug.** `pd fleet run documentarian` and friends were still launching through `/spawn` without a budget even after global budget enforcement landed. The CLI now forwards `limits.budget_usd_per_day`, and a regression test covers that path.
- **Selective fleet upkeep now exposes the next bottleneck instead of silently failing.** After the budget fix, `pd fleet run cartographer` was blocked by the live active-agent cap (20 running agents), and the cheap local `documentarian` pass timed out on a broad docs sweep. That is product signal: subset deployment / pause controls and a better cheap-vs-expensive maintenance-agent policy belong in the recovery queue.
- **Lease loss with `owner: null` is recoverable, not terminal.** The daemon should reacquire in that case instead of leaving the project permanently skipped. That fix is now in the working tree with regression coverage.
- **Shared hook templates were ahead of live installs.** The repo templates already published scoped `project:<slug>:<hash>:git:committed`, but existing checkouts were still carrying the pre-scope Port Daddy hook in `.git/hooks/post-commit`, and installers were treating any hook mentioning `git:committed` as already current. The active fix is legacy-hook replacement in `pd init` / `pd fleet init`, not more template churn.
- **Daemon logs can mix generations of client truth.** After the latest `fleet-ui` channel fix, a fresh Playwright-driven load polled `/msg/project:...:` channels correctly, while older already-open clients continued to hit naked logical channels until they reloaded. Log archaeology now has to distinguish stale client traffic from current bundle behavior.
- **Not all repo dirt deserves promotion.** The spider markdown pile is generated research output and now belongs in `.gitignore` by default, not in suspense as pseudo-canonical docs. The extra spawner bug-battery test proved that the right move is often to merge missing assertions into the canonical suite and delete the museum piece.

- **Phase 1 stale clock: 7 days.** Equal to the time remaining before the threshold. The `graph_edges` migration is a 1-hour task. Every commit to `server.ts` (2 this burst) increases friction. The symbol index test suite sitting uncommitted for 7 days is a smell — someone validated the code but didn't commit the validation.

- **Feedback audit surfaced a real ledger gap.** Several operator asks were implemented or discussed in chat but were not explicitly captured in the recovery queue: singleton Fleet Control Center behavior, Dock/native-window expectations, obvious stop/start controls, split-pane resizing, scheduled-job vs agent taxonomy, and concrete event-source examples/snippets. Those are now promoted into `docs/recovery/CURRENT-WORK.md` instead of relying on memory.
- **Dogfooding exposed a fourth runtime truth surface.** `pd agent` is not just “sortie lite.” It creates a sugar session plus a single spawned-agent record and can disappear from the live agent registry immediately after completion/failure. The control plane therefore needs to distinguish configured fleet agents, ad hoc manual jobs (`pd agent` / direct `pd spawn`), and sorties instead of flattening them into one generic “agent” concept.
- **The Fleet Control Center regression was architectural, not cosmetic.** Embedded mode was auto-selecting the first project while the native shell exposed no real project chooser, so operators could get stranded on one project with no way back to all-projects or sibling fleets. The fix belongs in native chrome plus embedded routing behavior, not just React styling.
- **Add-project flow is now a first-class recovery item.** “Project exists on disk” and “project is real in Port Daddy” are different states. The latter needs a starter fleet, MCP/skill install guidance, and an explicit `pd fleet up`/registration moment that the UI teaches instead of hiding.
- **Project truth is now split correctly in source, but still needs relaunch verification in the live app.** `/projects` is the durable registry, `/fleet` is live runtime state, and operator surfaces must combine them instead of conflating them. The current working tree does that in FleetBar and the React control plane; the next verification step is to relaunch the daemon/UI and confirm the live shell stops saying “no projects” when the registry is non-empty.
- **Docs drift around `pd fleet validate` was real.** ADRs and help text had described a validate/dry-run command that the installed CLI did not actually ship. That is a product lie, not an optional enhancement.
- **The strongest Spark/Spider suggestions have converged on operator leverage, not novelty.** The suggestions worth promotion are the ones that tighten fleet identity, event propagation, durable service offers, pre-dispatch invariant gating, dead-agent merge suspension, and spawn preflight/hot-zone awareness. Those are now roadmap material, not just creative residue.
- **Hidden scratch dirs need a sharper rule than “ignore dot folders.”** `.spark/`, `.spider/connections/`, and now `.dogfood/` are local residue and belong in `.gitignore` by default. But tracked dotdirs like `.cartographer/` and `.claude-plugin/` are canonical repo surfaces, so a blanket `.*` ignore rule would be self-sabotage.

- **Document authority: now clearer.** The Recovery Roadmap at `docs/recovery/UNIFIED-ROADMAP.md` is the execution authority (with explicit release criteria). The V4 Roadmap at `docs/V4-UNIFIED-ROADMAP.md` is the strategic context (phase structure, appendix, unplanned work log). This division is workable as long as the cartographer maintains both. The V4 roadmap's redirect header to the recovery docs is appropriate.

- **Uncommitted file count trending down: 103 → 76 → 50.** Two consecutive cartographer runs showing improvement. The Track 1 closure committed the most structurally important changes. Remaining uncommitted work is mostly UI refinement (fleet-config-ui, FleetBar Swift) and test files — lower risk than the `server.ts` + `routes/*.ts` changes that were in the previous batch.
