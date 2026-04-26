# Current Recovery Work

Last updated: 2026-04-24
Owner: Codex working session

This is the active execution ledger. If a task is in flight, it belongs here before it belongs in chat.

## Active Side Thread

Public-site direction is now a hybrid preservation pass, not an `agentsd.ai` replacement:

- do not erase the current broad `website-v2` route surface
- keep the existing home page and current top-level pages reachable
- treat the newer docs-family shell, structured docs content, and shared site primitives as additive improvements
- strip active `agentsd` branding from the live website shell
- keep the `docs/AGENTSD_*` documents as quarantined research, not as implementation authority for the active site

## Quarantined Reset Research

New public-site reset work for `agentsd.ai` is now captured on disk:

- `docs/AGENTSD_AI_SITE_CONTRACT.md`
- `docs/AGENTSD_BRAND_IDENTITY.md`
- `docs/AGENTSD_DEVELOPER_DOCS_SYSTEM_PLAN.md`

This research thread remains on disk, but it is not the current implementation direction. The user explicitly rejected using it to replace the active site.

Key constraints now captured there:

- `agentsd.ai` gets a tiny public route surface (`/` and `/docs/**`)
- no migration of the old `portdaddy.dev` page tree
- no hand-wired route jungle like the current `website-v2/src/main.tsx`
- no ad hoc page markup outside the React component library
- Storybook, semantic tokens, Radix primitives, dark mode, and accessibility are ship gates
- public `agentsd` brand is distinct from internal `Port Daddy` lineage
- maritime language survives in-product, not as the homepage identity

Implementation truth now also exists in the working tree:

- `website-v2/src/main.tsx` is cut down to `/` plus `/docs/**` with fallback redirects
- new public shell components live under `website-v2/src/components/site/`
- `website-v2/src/data/publicSite.ts` is the generated docs/landing content registry for the new shell
- `website-v2/src/styles/tokens.css` now carries the new paper/ink/blue/lime public token system instead of the old harbor-heritage palette
- the landing page is now rebuilt against the `v0-agentsd-main` composition language: hard color blocking, proof terminals, architecture diagram, open-core pricing grid, and docs mosaic
- homepage copy is now product-facing instead of repo-facing: no `portdaddy.dev` references, no self-referential "public shell" language, and no cleanup-ticket tone on the public surface
- public docs are reduced to the approved section set via `DocsOverview` + `DocsSectionPage` instead of the previous route forest
- the next docs-system phase is now explicitly planned around a Cloudflare-style developer-docs IA: overview, get started, concepts, best practices, examples, tutorials, reference architectures, reference, and LLM exports
- docs discovery is now complete enough to move from analysis into execution:
  - `docs/AGENTSD_DEVELOPER_DOCS_SYSTEM_PLAN.md` now carries a salvage-now / salvage-later / quarantine map
  - the same plan now carries a concrete backlog `D1` through `D7` for registry, overview, get started, concepts, examples, tutorials/architectures, and LLM/reference exports
  - the plan also now force-ranks publication order: `Get Started`, `Whitepaper`, `Examples`, `Best Practices`, `Concepts`, `Reference`, `Reference Architectures`, then `Tutorials`
  - implementation ownership is intentionally split across disjoint write scopes instead of another monolithic docs rewrite
- current docs-system worker assignments:
  - `Carver`: docs registry and `/docs/**` route model
  - `Singer`: get-started and best-practices outline, source-truthed against code
  - `Tesla`: examples/tutorials/reference-architectures curation matrix with promote/rewrite/archive/delete classification
- integrated worker outputs now present in-tree:
  - `website-v2/src/docs-content/` contains structured source-backed `Get Started` and `Best Practices` section content
  - `docs/reports/D5-D6-PROMOTION-MATRIX.md` classifies examples/tutorials/reference-architectures into promote/rewrite/archive/delete
  - the active docs shell now uses the canonical docs-family model instead of rendering legacy section aliases like `guides` and `operations` as if they were canonical public sections
  - `/docs/get-started/*` and `/docs/best-practices/*` now have real leaf-page rendering driven by `website-v2/src/docs-content/` instead of static family-only placeholders
  - the docs rail and family landing pages now expose clickable subpage navigation for those two families
  - the `website-v2` shell contract test now enforces the leaf-content integration, and `website-v2` currently builds cleanly after the route/data rewrite
- Storybook coverage now exists for the new public shell primitives/header
- dark-mode bright-surface contrast failures have been corrected in the active shell by adding explicit blue/lime foreground tokens and moving terminal-style panels onto stable code-surface tokens
- routed docs status language is now `Live` / `Compatibility` / `Roadmap` with an in-page legend so module-state chips read as runtime truth, not fake links
- persona + appeal audit for the routed shell now lives at `docs/reports/AGENTSD_PUBLIC_SHELL_AUDIT_2026-04-11.md`

## Public Site Reset (2026-04-11, Quarantined)

The `agentsd.ai` public-site reset is now explicit repo work, not chat residue.

- New authority docs:
  - `docs/AGENTSD_AI_SITE_CONTRACT.md`
  - `docs/AGENTSD_BRAND_IDENTITY.md`
- These documents exist to prevent `portdaddy.dev`-style page sprawl, layout drift, mascot bleed-through, and public runtime overclaims from reappearing under the `agentsd` brand.
- Do not treat the old public site as a failure case or migration anti-target for active implementation.
- Future public-site work should preserve the current public surface unless a deliberate migration plan is approved and implemented.

## Current Thread

### Port Daddy Website Ideal-Web-App Rehab Handoff (2026-04-24)

The active public-site thread is now an `ideal-web-app-builder` rehabilitation
handoff for `website-v2`, not another broad replacement reset.

- New authority plan: `docs/plans/port-daddy-website-ideal-web-app-rehab.md`
- Visual decision board: `docs/plans/port-daddy-website-visual-decision-board.md`
- Screenshot baseline: `docs/reports/website-rehab-screenshots/`
- Port Daddy session used for the handoff: `session-80296aef-bf46-4457-b900-b7c9ca9c92fe`
- Baseline truth:
  - `npm run build` passes, but warns on a 1.99 MB main chunk
  - `npm run build-storybook` passes, but warns on a 1.08 MB iframe chunk
  - `npm run test` fails in `src/data/tutorials.test.ts` because tutorial order, totals, prev/next, title, numeric prop, and orphan route truth have drifted
  - `npm run lint` fails on real source issues and because ignored `storybook-static` output is still in the lint scope
- Do not start broad visual or route rewrites until the user approves or amends
  the visual decision board.
- The recommended direction is signal-grade infrastructure editorial: preserve
  the distinct paper/ink/blue/lime identity, normalize it into a three-layer
  token contract, repair tests/lint first, then rebuild the high-drift MCP page
  as the first proof slice.

### Cartographer Roadmap Actor (2026-04-24)

The current uncommitted slice now promotes Cartographer from a commit-triggered docs updater into the first concrete maritime actor surface:

- `docs/adr/0023-cartographer-roadmap-actor.md` defines the target actor: durable identity, mailbox, roadmap/work-slice read model, tuples, graph edges, and evidence links across docs, sessions, claims, commits, tests, and promotion attempts.
- `.cartographer/README.md` now defines the operating contract for bootstrap reconciliation, document authority classes, tuple vocabulary, graph vocabulary, and patch policy.
- `pd-fleet.yml` now gives the compatibility `cartographer` fleet agent Port Daddy-first instructions and a stricter event/upkeep contract.
- `lib/maritime-actors.ts` defines the canonical maritime actor roster and projects live body / compatibility fleet status from existing daemon state.
- `routes/actors.ts` exposes `GET /actors` and `GET /actors/:id`; `cartographer` currently resolves to `navigator`.
- `features.manifest.json`, `docs/openapi.yaml`, and the Port Daddy skill API reference now know about the new `/actors` surface.
- The initial batch step is explicitly a report-first reconciliation pass. It inventories and classifies extant documents, extracts work items and evidence, emits structured state, and proposes cleanup patches. It must not blindly rewrite every document.
- The sibling systems discussed in this thread are also actor-shaped and now have canonical maritime names: Navigator for roadmap/recovery state, Coxswain for claims/locks/stale work, Signalman for validation evidence, Harbormaster for promotion readiness, Sounder for semantic graph/synonymy, Lookout for docs/API/skill drift, Breaker for failure propagation, Caulker for robustness repair, and Quartermaster for cost/resource governance. They should all become durable actors with deterministic projectors and optional LLM bodies.

### Tree-Sitter Symbol Refresh From Repo Events (2026-04-24)

The current uncommitted runtime slice makes tree-sitter symbol indexing event-driven instead of requiring manual `/symbols/parse` calls:

- `server.ts` now passes the live `symbolIndex` into the fleet daemon.
- `lib/fleet-daemon.ts` subscribes managed projects to project-scoped `git:committed` messages and debounced source-file watcher events, then refreshes only supported in-project code files (`ts`, `tsx`, `js`, `jsx`, `mjs`, `cjs`, `py`).
- The daemon subscribes to both the fleet-config-name scoped channel and the repo-basename hook channel because the current hook computes scope from `basename(projectDir)` while this repo's fleet name is `port-daddy-dev`.
- New regression coverage in `tests/unit/fleet-daemon.test.js` proves hook-style commit payloads and source watcher events refresh symbols while ignoring docs, generated directories, and outside-project paths.
- Validation truth: focused `npm test -- tests/unit/fleet-daemon.test.js` is green, `npm run typecheck` is green, and broad `npm test` is green at `132/132` suites and `4816/4817` passing tests with `1` intentional skip.
- Runtime caveat: the live daemon must be rebuilt/relaunched/promoted before this dogfood path is active in the canonical runtime.

## Ledger Drift Correction (2026-04-12)

The ledger had fallen behind the actual branch state. Current committed truth is:

- `f45b751` — Fix CLI typecheck debt for sessions and tuples
- `8cddbca` — Add git-sensitive channel discovery
- `8236119` — Import curated workgroup-ai skills
- `0f77491` — Fix cost tracker migration for stable daemon
- `175210f` — Enforce fail-closed spawn telemetry by default
- `278fa47` — Fix with-lock option separator parsing
- `961a41c` — Add tunnel TTL and orphan cleanup safeguards
- `4765090` — Fix tunnel startup timeout leak

Validation truth as of 2026-04-12:

- `npm run typecheck` is green again after `f45b751`; older notes below about broad CLI/client/IPC typecheck debt are now historical, not active.
- broad `npm test` is green at `117/117` suites and `4662/4663` passing tests with `1` intentional skip.
- focused `npm test -- --runInBand --detectOpenHandles tests/integration/cli.test.js tests/unit/current-context.test.js` is green with no open-handle report.
- the older parallel worker-force-exit warning was not reproduced in the latest broad run or the focused handle hunt above, so that debt should now be treated as stale until reproduced again.

Newest active uncommitted slice:

- recovery-ledger reconciliation plus integration-context isolation hardening in:
  - `docs/recovery/CURRENT-WORK.md`
  - `.cartographer/status.md`
  - `tests/helpers/integration-setup.js`
  - `tests/integration/cli.test.js`
- the CLI integration harness now writes current-context through an explicit isolated helper and clears isolated context state after each test, instead of relying on implicit process-env side effects.
- new regression coverage now asserts those integration-context writes stay out of repo-local `.portdaddy/contexts/<slot>.json`.

The live recovery thread has split into two coupled slices:

1. Keep the operator loop truthful so one daemon, one fleet runtime, one control plane, and one native companion all tell the same story.
2. Capture the newer uncommitted semantic-memory slice honestly instead of pretending Phase 1 / memory work is still dormant.

Latest committed slice: `6d136cc` — Harden sugar session fallback and filepath locks.
Current uncommitted slice: IPC lock lifetime fix plus isolated IPC regression coverage for filepath locks:
- `server.ts` no longer auto-releases every lock owned by an agent when an IPC socket disconnects; the SDK uses short-lived IPC request clients for lock operations, so transport teardown is not valid ownership loss
- `tests/helpers/ephemeral-daemon.js`, `tests/helpers/global-setup.js`, `tests/helpers/global-teardown.js`, and `tests/helpers/integration-setup.js` now expose an isolated ephemeral `ipcPath` (plus isolated HOME for CLI IPC coverage) so integration tests can exercise real IPC without leaking onto the operator's canonical daemon
- `tests/integration/cli.test.js` now proves that owner-driven IPC lock acquisition on a filepath remains exclusive across separate CLI invocations and unlocks cleanly afterward
- validation truth on 2026-04-11:
  - focused `tests/integration/cli.test.js` + `tests/unit/locks.test.js` are green
  - broad `npm test` is green at `114/114` suites and `4616/4617` passing tests with `1` intentional skip
  - the older parallel Jest worker-force-exit warning still remains, so this slice fixed lock lifetime truth but not the residual suite teardown debt

Previous committed slice retained for context: `df4c351` — Track session region claims by symbol path.
Current uncommitted slice: direct-mode and implicit note/whoami scoping hardening after live stale-context drift:
- `bin/port-daddy-cli.ts` now validates repo-local current context against the direct DB before `pd note --direct` reuses an implicit session/agent scope
- `cli/commands/sessions.ts` now validates repo-local current context against the active backend before implicit `pd note` scoping, so stale local context falls back to the normal closed-fail path instead of surfacing `session ... not found`
- `lib/db.ts` now matches the committed `session_files.symbol_path` schema so fresh direct-DB initialization stays in sync with the committed session-claim model
- `lib/sugar.ts`, `routes/sugar.ts`, `lib/client.ts`, and `cli/commands/sugar.ts` now let `pd whoami` fall back to an explicit active `sessionId` when the agent row has already been reaped, instead of falsely declaring the operator inactive just because the weaker registry key disappeared first
- the same `lib/sugar.ts` slice also fixes explicit `done(agentId + sessionId)` ownership checks to use the actual camelCase session field, and `/sugar/done` now returns `409 SESSION_OWNERSHIP_MISMATCH` instead of collapsing that path into a generic `500`
- validation truth on 2026-04-11:
  - `tests/integration/direct-mode.test.js` is green again
  - focused `client` / `sugar` / CLI integration regressions covering stale-agent `whoami` and explicit-session ownership are green
  - full `npm test` was green at `114/114` suites and `4611/4612` passing tests with `1` intentional skip when this slice landed; newer validation is now above
  - `npm run typecheck` is still red, but the failures are the same broader pre-existing CLI/client/IPC typing debt family rather than a new regression from this slice

Newest committed semantic-claim slice now on `HEAD`:
- `lib/sessions.ts` / `routes/sessions.ts` / `tests/unit/region-claims.test.js` now carry canonical `symbolPath` claim identity with line-range fallback
- current `HEAD` also includes `30737e0` (`Enforce public repo boundary for local residue`), so recovery docs that still describe symbol-backed claim authority as future work are now wrong

Still-active larger uncommitted slice: tuple-first coordination and semantic graph harmonization:
- new durable graph surface: `lib/graph-edges.ts`, `routes/graph.ts`, `tests/unit/graph-edges.test.js`
- new episodic memory surface: `lib/episodic-memory.ts`, `routes/memory.ts`, `tests/unit/episodic-memory.test.js`
- new operator UI surface: `fleet-config-ui/src/components/MemoryPanel.tsx` plus FleetBar route/tab wiring
- tuple space is now a real coordination substrate instead of a side primitive:
  - `lib/fleet-engine.ts` accepts `trigger_tuple` in fleet YAML, drains tuple mailboxes as launch inputs, and emits semantic alias tuples from fleet work items
  - `lib/fleet-daemon.ts` projects fleet lifecycle into `fleet:event` tuples so downstream systems can consume run truth without scraping logs or channels
  - `lib/merge-queue.ts` projects merge lifecycle into `merge:event` tuples and emits semantic alias tuples from branch / claim / task metadata
  - `lib/episodic-memory.ts` projects remembered episodes into `memory:episode` tuples and semantic alias tuples
- integration glue now writes graph/memory truth from existing systems:
  - `lib/symbol-index.ts` writes file/symbol/dependency edges
  - `lib/merge-queue.ts` writes merge-entry / branch / file / status edges plus `alias_of` / `about` joins onto canonical semantic terms
  - `lib/sessions.ts` promotes handoffs/findings/decisions/results/failures into episodic memory
  - `lib/sorties.ts` promotes blocked/completed/failed mission moments into episodic memory
  - `routes/tuples.ts` gained filtered tuple scanning so the new Memory view can search live tuple state
- semantic nomenclature harmonization is now explicit in code:
  - `lib/semantic-terms.ts` canonicalizes freeform labels into stable token sets, fingerprints them, and emits `semantic:alias` tuples plus `semantic_term --alias_of--> semantic_term` graph edges
  - `lib/semantic-resolver.ts` now adds the embedding-backed join layer on top using local Transformers.js inference with `Xenova/all-MiniLM-L6-v2`
  - embeddings are cached under `.cache/transformers/` after the first machine-local download, so semantic resolution is offline-cheap on subsequent runs
  - thresholds are no longer magic folklore:
    - auto-join threshold defaults to `0.88`
    - review threshold defaults to `0.80`
    - boundary monitoring margin defaults to `0.02`
  - operator visibility now exists through:
    - `GET /semantic/stats`
    - `GET /semantic/resolutions`
    - `GET /semantic/search`
    - Fleet Control Center `Memory` panel semantic cards / recent decision feed
  - near-threshold counts, review backlog, emitted `semantic:resolution` tuples, and persisted `semantic_resolution_events` are the current guardrails against silent threshold drift
- docs/skill drift also landed in this same working tree: `AGENTS.md` and `skills/port-daddy-cli/SKILL.md` now explicitly require Port Daddy-first coordination on this computer
- validation truth on 2026-04-18:
  - broad `npm test` is green at `123/123` suites and `4689/4690` tests with `1` intentional skip
  - focused tuple/semantic suites (`semantic-terms`, `episodic-memory`, `merge-queue`, `fleet-engine`, `fleet-daemon`) are green
  - `npm run typecheck` is still red, but the remaining failures are the pre-existing `cli/commands/diagnostics.ts` `{}`-typing hole rather than regressions from this tuple/graph slice
- teardown / runtime hardening just validated cleanly in the working tree and should be cut next:
  - `lib/ipc-client.ts` now `unref()`s connect, reconnect, and request timeout timers so local IPC clients do not pin Jest workers
  - `lib/client.ts` now `unref()`s the SDK heartbeat interval for the same reason
  - `lib/webhooks.ts` now owns retry timers, supports `dispose()`, and fences off post-dispose writes/retries
  - `tests/unit/webhooks.test.js` now closes webhook/db state explicitly and covers retry cancellation on dispose
  - validation truth on 2026-04-11: `npm test -- --runInBand --detectOpenHandles` is green (`109/109` suites, `4523/4524` tests, `1` intentional skip) with no open-handle report
- newest validated runtime slice after that teardown work:
  - IPC router now exposes `sugar.whoami` and `fleet.prompt`
  - SDK one-shot request/response flows (`done`, `whoami`, `note`, `claimFiles`, `releaseFiles`) now use ephemeral IPC clients when talking to the canonical local daemon, then fall back cleanly for explicit TCP / alternate-socket targets
  - CLI `pd done`, `pd whoami`, and `pd note` now ride those SDK fast paths instead of duplicating raw HTTP behavior
  - `pd fleet prompt` now prefers IPC only for the canonical local daemon and otherwise stays on HTTP so alternate daemon targets do not drift
  - validation truth on 2026-04-11:
    - targeted router/client/CLI tests are green
    - `tests/integration/cli.test.js` is green
    - `npm test` passes `109/109` suites and `4529/4530` tests, but the old parallel Jest worker-force-exit warning still appears, so teardown debt is reduced but not fully closed
- newest committed operator-transport slice after that:
  - session SDK flows now cover `startSession`, explicit `endSession`, `sessions()`, and `removeSession()` through canonical-local IPC fast paths, while still falling back cleanly for explicit TCP / alternate-socket targets
  - CLI `pd session start/end/files/rm/sessions` now delegates to the SDK instead of hand-rolling raw HTTP around mismatched response contracts
  - operator-visible session parity bugs are fixed in the working tree:
    - conflict rendering uses `filePath` instead of the stale `file` key
    - `session done` reads `releasedFiles`
    - `session files rm` reads `released`
  - `pd with-lock` now routes through the SDK lock helpers instead of duplicating raw lock acquire/release fetch logic
  - validation truth on 2026-04-11:
    - targeted `client` / `ipc-router` / CLI tests are green
    - `npm test -- --detectOpenHandles --runInBand tests/unit/client.test.js tests/unit/ipc-router.test.js tests/integration/cli.test.js tests/unit/sugar.test.js tests/unit/sessions.test.js` is green with no open-handle report (`5/5` suites, `377` tests)
    - broad `npm test` is green at `111/111` suites and `4592/4593` tests, but the old parallel Jest worker-force-exit warning still appears, so that residual teardown debt is broader than this slice
  - discovered but not fixed in this slice: bare `--` is still not treated as end-of-options by `bin/port-daddy-cli.ts` even though the tutorial teaches `pd with-lock ... -- ...`; that parser file is currently claimed by another active session, so this follow-up is blocked on coordination rather than forgotten

Sequencing note for the active recovery thread:
- finish the remaining locks / tuples coordination tranche first
- the symbol-backed session/file-claim authority upgrade is now committed on `HEAD` at `df4c351`
- next polish after locks / tuples is to feed that committed symbol-backed truth consistently into graph edges, episodic memory, merge/conflict prediction, and the control plane instead of leaving any line-range-only holdouts

## New Product-Direction Intake (2026-04-10)

Captured from the docs-redesign/operator vision thread and now tracked as roadmap-grade work, not chat residue:

1. Human-in-the-loop is a first-class protocol, not a side path:
   - add explicit approval/pause/resume hooks inside long-running agent and sortie execution
   - expose HITL tool patterns in docs and product UI (operator can be requested mid-run, not only post-failure)
2. Queue-first fleet operation:
   - operators should enqueue work for fleets and walk away
   - Port Daddy should route queued jobs to the right agent/role based on roster + availability
3. Default background-agent throttle policy:
   - background agents should run in a conservative default cadence (for example, ~4 runs/hour) unless explicitly elevated
   - uplift windows should be explicit and time-bounded (for example 1-3 hour high-engagement windows)
4. FleetBar first-run and project onboarding:
   - from native shell, pick a local project, generate a recommended fleet roster, and launch tasks immediately
   - include an AI-assisted "design my fleet for this repo" path
5. DAG-native task decomposition in operator UX:
   - task entry should produce inspectable plan/DAG slices and let humans approve before dispatch
   - each agent/run must report structured state transitions (`pending`, `running`, `done`, `error`, `blocked`)
6. Session/agent lifecycle hooks:
   - ship explicit start/stop event handlers that publish into channels/tuples and can trigger downstream automation
   - treat these hooks as contract-level surfaces for integrations and observability
7. Docs IA/productization implications:
   - first-class docs pages for prompting, template quickstarts, and protocol/state
   - de-emphasize standalone template/blueprint marketing routes in favor of docs-native guided flows
   - add `llms.txt` + `llms-full.txt` to the docs website surface for LLM-readable navigation

## New Architecture Intake (2026-04-11)

Captured from the spawn-storm / remote-harbor thread plus `docs/plans/agentsd_ai_technical_architecture.md`:

1. Virtual-actor scheduling layer:
   - stop treating every watcher/subscriber as a peer that can wake every other participant
   - make `project`, `fleet`, `agent`, `harbor`, `sortie`, and trigger keys addressable virtual actors with single-mailbox semantics
   - keep tuples/pubsub/trie/graph as the shared medium, but gate activation through actor mailboxes so cooldown, dedupe, backoff, singleton, and budget policy live in one place
2. Spawn-discipline hardening:
   - first concrete step is per-agent cooldown, trigger dedupe, and exponential backoff in the fleet engine
   - next step is actor-native queueing / escalation so repeated triggers can collapse to cheap local review, defer, or upgrade instead of always spawning
3. Cloudflare support roadmap:
   - immediate runtime slice: first-class Cloudflare Workers AI backend support in spawn/fleet surfaces
   - next infra slice: AI Gateway for spend/control-plane policy, Vectorize + AI Search for shared retrieval surfaces, and a deliberate evaluation of AutoRAG where it actually reduces glue code
4. Remote harbor / lighthouse groundwork:
   - centralized human auth dispenser and daemon attestation remain the long-pole trust surface
   - remote harbor design should assume key issuance, registry, Merkleized evidence exchange, and revocation-friendly filters (cuckoo/bloom/Merkle proof path), not just "ship messages over the network"

### Actor-Model Reconciliation (2026-04-23)

Architecture decision now captured in `docs/adr/0022-durable-actor-souls-and-body-leases.md`.

The core conclusion: do not "fix" agent history loss by simply stopping row deletion. The current runtime uses agent-row deletion as part of orphan detection, lock cleanup, IPC authorization, Arbiter checks, and salvage visibility. The correct migration is a durable actor soul plus an ephemeral body lease:

- actor soul: stable identity, mailbox, archetype, belief state, history, and operator-visible addressability
- body lease: heartbeat, PID/process or transport attachment, incarnation/generation, and authority to perform protected actions
- salvage: adoption or recovery of a dead/revoked body lease attached to a durable soul, not resurrection of a deleted identity
- inbox: actor-scoped mailbox; wake status is a separate live-runtime concern
- auth: protected IPC/HTTP actions require a live lease or delegated token, not mere actor existence

Implementation roadmap additions:

1. Add `/actors`, `/actors/:id`, and `/actors/:id/message` as additive durable-soul surfaces while `/agents` remains the live-body compatibility view.
2. Add explicit lease/incarnation state before changing cleanup semantics:
   - `attached`, `draining`, `detached`, `dead`, `revoked`
   - heartbeat timestamp, PID/process/transport metadata, optional local lease token
3. Change `pd done`, spawner cleanup, and stale-agent cleanup to detach/revoke body leases instead of deleting durable identities.
4. Replace `sessions.abandonOrphanedActive()` missing-row logic with dead/revoked-lease detection.
5. Move lock/file/session/merge authority checks to live leases while preserving durable soul attribution for audit and handoff.
6. Reframe salvage queue entries as lease recovery/adoption state on an actor soul.
7. Update Fleet Control Center and FleetBar:
   - actor directory is durable identity truth
   - live registry becomes deployment/lease state
   - salvage ghosts become actor recovery states
   - direct messages can queue for dormant actors and separately report wake success/failure
8. Update SDK/OpenAPI/site docs and tests that still say "done unregisters the agent" or "only registered agents have inboxes."
9. Treat configured fleet agents, projects, harbors, sorties, and trigger keys as mailbox-owning actors so cooldown, dedupe, backoff, singleton, and budget policy have one home instead of being spread across watchers and subscribers.

Unintended consequences to guard against:

- stale processes must not retain lock/session/salvage authority just because their soul persists
- random `spawned-*` jobs must not pollute the durable actor directory without an archive/retention policy
- UI counts must not inflate by treating every historic lease as a live agent
- compatibility fields like `agentUnregistered` need a deprecation window, not a silent shape break
- inbox persistence needs quota and retention policy once dormant actors become addressable

## Latest Landed Slice (2026-04-11)

The current-session drift investigation now has a concrete working-tree fix:

- local CLI context is no longer modeled as one mutable repo-global `.portdaddy/current.json`
- `pd begin` now writes slot-scoped context files under `.portdaddy/contexts/<slot>.json`, while `current.json` is retained only as a compatibility pointer
- slot reads are fail-closed: a shell/agent no longer falls through into some other slot's latest context just because `current.json` was written last
- `sessions.quickNote()` now accepts explicit `sessionId`, respects explicit session targeting, and fails closed on ambiguous unscoped worktree state instead of drifting to global "most recent active"
- direct-mode `pd note` now forwards slot context (`sessionId`/`agentId`) instead of relying on unscoped quick-note fallback
- regression coverage now exists for slot isolation plus ambiguous quick-note rejection

## Latest Validated Working-Tree Slice (2026-04-11)

Tunnel cost-safety hardening is now real in the working tree:

- `lib/tunnel.ts` now treats tunnels as budgeted managed resources instead of loose child processes:
  - default max-active tunnel cap
  - default tunnel TTL / expiry
  - persisted tunnel metadata for restart reconciliation
  - periodic cleanup plus synchronous stale-state sweeps
  - safe orphan cleanup only when the persisted PID still matches the expected provider/port command line
- `server.ts` now stops all managed tunnels during graceful daemon shutdown and disposes the tunnel reaper, so shutdown does not leave Port Daddy-managed tunnels behind
- `routes/tunnel.ts`, `cli/commands/tunnel.ts`, and `lib/client.ts` now surface expiry metadata / cleanup reasons so operator output does not hide the safety policy
- regression coverage now exists in `tests/unit/tunnel.test.js` and `tests/unit/tunnel-lifecycle.test.js` for:
  - tunnel budget exhaustion
  - TTL reaping
  - stale DB-record cleanup
  - orphan-process cleanup
- validation truth on 2026-04-11:
  - focused `npm test -- tunnel-lifecycle tunnel.test` is green
  - broad `npm test` is green at `114/114` suites and `4627/4628` passing tests with `1` intentional skip
  - `npm run typecheck` is still red, but the failures are the same broader pre-existing CLI/client/IPC typing debt family; this slice only added and fixed its own new tunnel CLI typing edges

## Active Tasks

This is the normalized remaining-slice inventory as of 2026-04-24. It supersedes the older duplicate-numbered queue below this point in git history, but the detailed evidence remains in the surrounding sections.

### A. Cut, Commit, Promote, And Keep Runtime Truth Aligned

1. Split the dirty working tree into coherent promotable slices instead of one mega-commit:
   - maritime actor foundation (`/actors`, `pd actor(s)`, manifest/OpenAPI/completions/skill docs, tests)
   - event-driven Tree-sitter symbol refresh
   - tuple/graph/memory/semantic harmonization
   - spawn-discipline and Cloudflare backend work
   - FleetBar/control-plane project truth and operator UX work
   - public website/docs/distribution changes
2. For every runtime-serving slice, run focused tests, `npm run typecheck`, `npm test`, `npm run build`, then promote with `./scripts/promote-stable.sh` before claiming live operator truth.
3. Keep `/Users/erichowens/port-daddy-stable` clean and non-dogfood-only; no `.spark/`, `.spider/`, daemon DBs/logs, fleet output, or build garbage should accumulate there.
4. Continue using Port Daddy notes, file claims, tuples, and briefing/salvage for every recovery step so future sessions can reconstruct work without chat archaeology.
5. Keep release surfaces synchronized in the same slice: README/help, `AGENTS.md`, skills, OpenAPI, MCP parity, completions, website docs, and FleetBar/native affordances.

### B. Navigator And Cartographer

1. Finish the Navigator/Cartographer bootstrap pass as a report-first reconciliation:
   - inventory authority surfaces
   - classify docs as authoritative, active-ledger, release-surface, historical, quarantined-research, generated-artifact, stale, or conflicting
   - extract roadmap items, work slices, blockers, dependencies, evidence, stale claims, and supersession edges
   - emit `roadmap:item`, `work:slice`, `doc:authority`, `evidence:*`, `blocker`, `depends_on`, and `supersedes` tuples before prose rewrites
2. Add the durable read model behind the human `.cartographer/status.md` projection:
   - actors/sessions/claims/files/symbols/commits/tests/promotions graph joins
   - work-slice status and evidence links
   - stale/conflicting document report
   - periodic refresh with cooldown/dedupe/backoff
3. Decide the first persisted shape: SQLite tables now versus `.cartographer/bootstrap-report.json` plus tuples first.
4. Decide patch authority: which docs Navigator may update automatically, which require human approval, and which must only receive proposed cleanup patches.
5. Coordinate ownership with Harbormaster: promotion truth probably belongs to Harbormaster, with Navigator projecting it into the recovery map.

### C. Durable Actor Souls And Body Leases

1. Move beyond the current static `/actors` projection:
   - add `POST /actors/:id/message`
   - expose mailbox depth, recent sessions, recent salvage state, last activation, and live lease state
   - add SDK/CLI/docs surfaces for actor messaging
2. Add explicit body lease/incarnation state before changing cleanup semantics:
   - status: `attached`, `draining`, `detached`, `dead`, `revoked`
   - heartbeat and PID/process/transport metadata
   - incarnation/generation number
   - optional local lease token for protected actions
3. Change normal completion so `pd done`, spawner cleanup, and stale cleanup detach/revoke body leases instead of deleting durable souls.
4. Replace missing agent row orphan logic with dead/revoked lease detection.
5. Move protected operations to lease-aware authority:
   - IPC auth
   - lock/file/session mutation
   - merge submission
   - salvage adoption
   - Arbiter checks
6. Keep `/agents` as the live-body compatibility view while Fleet Control Center and FleetBar migrate toward actor-directory truth.
7. Add tests that prove actor souls survive `done`, inbox survives detachment, stale leases cannot perform protected actions, and stale cleanup releases only lease-owned resources.

### D. Coxswain: Claims, Locks, Stale Assets, And Symbolic Coordination

1. Make file path locks work directly or make the required semantic syntax unambiguous in CLI/help/tests.
2. Make `who-owns` lease-aware:
   - last claimed by whom and when
   - current lease/body status
   - last edit/mutation evidence
   - attempted claims/edits
   - stale/zombie classification and reclaim affordance
3. Add stale asset salvage, not just stale session salvage:
   - zombie `session_file` claims must not cripple coordination files
   - reclaim should be explicit, audited, and evidence-backed
4. Finish Tree-sitter-backed claim authority:
   - use canonical `symbolPath` where symbol data exists
   - keep line ranges only as fallback/display
   - index non-code coordination documents by section anchors if they are claim hotspots
   - expose first-class CLI/MCP symbol discovery and claim-refinement affordances, not only region-claim pass-through
   - make symbol freshness automatic in the promoted daemon; the event-driven refresh design exists in recovery notes/stash residue but is not current committed runtime truth
5. Wire claims into graph/memory:
   - `session --claims--> file`
   - `session --claims_symbol--> symbol`
   - `actor/session --attempted_claim--> resource`
   - `session --mutated--> file/symbol`
6. Feed symbolic-claim truth into merge/conflict prediction and control-plane visualization instead of resting on lossy line spans.

### E. Sounder: Tuple, Graph, Memory, And Semantic Collapse

1. Decide whether the graph + episodic-memory slice is the next real cut or quarantine; do not leave it half-landed.
2. Finish tuple-first coordination:
   - `trigger_tuple` fleet inputs
   - fleet lifecycle as `fleet:event`
   - merge lifecycle as `merge:event`
   - memory episodes as `memory:episode`
   - tuple-triggered fleet agents and IPC tuple fast path if still missing after review
3. Finish graph/memory runtime surfaces:
   - `graph_edges`
   - `episodic_memory`
   - symbol/file/dependency edges
   - session/sortie/merge/claim memory promotion
   - Fleet Control Center Memory panel
4. Keep synonymy collapse disciplined:
   - deterministic lexical canonicalization first
   - embedding-backed near-neighbor suggestions second
   - review queue for boundary cases
   - no arbitrary “sounds good” threshold without calibration, examples, and operator-visible review statistics
5. Add evaluation fixtures for synonym classes that matter to this repo: website/docs/design-system terms, actor/agent/body terms, fleet/project/runtime terms, claim/lock/mutation terms, harbor/lighthouse/remote terms.
6. Decide whether WordNet is useful only as a weak lexical feature. It should not be the sole authority for repo-specific semantic collapse.

### F. Signalman, Breaker, And Caulker: Validation, Robustness, Failure Propagation

1. Keep adding regression tests for every newly discovered bug that existing tests missed.
2. Preserve the full-suite discipline: focused tests for iteration, full `npm test` before broad health claims.
3. Treat any future `A worker process has failed to exit gracefully` warning as real teardown debt even if exit code is green.
4. Use the Nygard resilience skill for failure propagation, circuit breakers, bulkheads, timeouts, retry storms, and cascading failure work.
5. Build failure-propagation observability:
   - failed spawn chains
   - IPC disconnect cascade cleanup
   - tunnel/provider failures
   - retry/backoff state
   - open circuit state
6. Add forensic context windows to Arbiter violations so failures include nearby session, tuple, graph, mutation, and process evidence.
7. Finish any remaining CLI command help hazards such as `pd done --help` performing the command.
8. Keep WAL health visible: WAL is already enabled in `lib/db.ts`, but diagnostics/doctor should prove journal mode, busy timeout, checkpoint behavior, and DB path truth against the live daemon.

### G. Quartermaster: Spawn Discipline, Costs, Backend Policy, And Fleet Activation

1. Finish default fleet spawn controls:
   - per-agent cooldown
   - trigger dedupe
   - exponential backoff
   - singleton enforcement
   - project-level caps
   - spawn-per-hour caps
2. Expose those controls in operator surfaces, not only in logs.
3. Implement actor-style mailboxes so repeated triggers collapse to one queued activation instead of many independent spawns.
4. Make manual upkeep runs possible even under active-agent pressure; `pd fleet run documentarian` and `pd fleet run cartographer` should not starve behind the always-on fleet.
5. Separate cheap local upkeep from hosted model escalation:
   - broad low-signal sweeps default to Ollama/local
   - operator-triggered high-signal work may request Codex/Claude with an explicit budget
6. Keep Codex backend spend-aware:
   - low: `gpt-5.4-mini`
   - mid: `gpt-5.3-codex`
   - high: `gpt-5.4`
7. Keep all-backend tier truth consistent across daemon, CLI, SDK, MCP, fleet model catalog, readiness, and UI.
8. Keep telemetry fail-closed: no operator launch is acceptable without exact token counts, exact nonzero model rate, and persisted exact nonzero cost unless there is explicit HITL bypass metadata.

### H. Harbormaster: Promotion, Distribution, Daemon Freshness, And Runtime Truth

1. Continue treating promotion as normal runtime hygiene, not a rare ceremony.
2. Verify live truth after every runtime slice:
   - socket path
   - TCP/browser path
   - FleetBar embedded bundle
   - live daemon install root
   - CLI shim path
3. Finish daemon discovery/loopback cleanup:
   - no new hardcoded `localhost:9876`
   - docs/templates/operator labels cleaned up
   - diagnostics/startup doctor wording honest about preferred versus actual daemon port
4. Finish fleet lease recoverability verification: `lock not held` plus no holder should reacquire instead of leaving a project skipped.
5. Kill or replace leaked legacy watchers that still publish naked `git:committed`.
6. Make project-scoped hook replacement complete in `pd init` / `pd fleet init`.
7. Finish distribution slices:
   - packaging docs and package assets
   - release workflow
   - macOS pkg signing/notarization path
   - FleetBar cask/pkg parity
   - landing-page download truth
8. Finish Bosun/Barnacle consolidation:
   - V2 `bin/watchdog.ts` / `daemon:watch` are removed in the active Bosun slice
   - daemon heartbeat writer and `core/pd-bosun/` std-only supervisor scaffold are in-tree
   - remaining: distribute `dist/core/pd-bosun`, promote `com.portdaddy.bosun`, then remove legacy Barnacle crate/client/compat field after the compatibility window

### I. Lookout: Docs, Skills, OpenAPI, Website, And Product Truth

1. Keep the Port Daddy-first cooperation instruction synchronized across `AGENTS.md`, skills, README/docs, and generated release surfaces.
2. Finish docs around slot-scoped `.portdaddy/contexts/<slot>.json`; stop describing `current.json` as the only current-context truth.
3. Keep `pd fleet validate`, `pd actor(s)`, Cloudflare backend support, actor/body terminology, and backend tier ladders reflected in skill/API/docs surfaces.
4. Keep public-site work honest:
   - active site is a hybrid preservation pass, not an `agentsd.ai` replacement
   - `docs/AGENTSD_*` remains quarantined research unless explicitly promoted
   - no route jungle regression
   - no public runtime overclaims
5. Finish website docs IA only where it supports operator truth:
   - docs registry
   - get started
   - examples
   - best practices
   - concepts
   - reference
   - LLM exports
6. Add Lookout drift checks for parity between routes, manifest, OpenAPI, CLI, completions, MCP, website docs, and skill reference.
7. Translate the Google Agents CLI research into a lifecycle-first Port Daddy docs/CLI proposal:
   - `setup`
   - `scaffold create`
   - `scaffold enhance`
   - `scaffold upgrade`
   - `run`
   - `eval`
   - `deploy` / `promote`
   - `publish`
   - `observe`
   - agent-engineering skill bundles as a release surface, not loose prose

### J. FleetBar And Fleet Control Center

1. Verify the live native shell after promotion, not only screenshots or dev bundles.
2. Keep FleetBar opening the real control plane, with no duplicate embedded chrome.
3. Add a native project switcher and avoid auto-stranding the operator on the first project.
4. Preserve the selected surface across project changes.
5. Make Activity, Channels, Inbox, Sorties, Memory, and YAML real full-width top-level pages.
6. Fix Activity truth:
   - structured project activity
   - per-agent last-active
   - non-empty messages
   - recent mutations
   - touched files and artifacts
7. Add an explicit ad hoc jobs lens for `pd agent` and raw `pd spawn` runs that exist in spawned/session history but not the live fleet registry.
8. Remove inspector/focus confusion:
   - Activity focuses agents in-page
   - global slide-in inspector stays a Flow tool
   - no persistent detail drawer across unrelated tabs
9. Keep file actions truthful:
   - resolve relative paths against the correct project/workdir
   - expose Finder/default-editor actions
   - never degrade known context to bare `Not Found`
10. Make FleetBar popover show recent per-agent summaries, touched files, salvage hints, suspicious stale-active sessions, resume-worthy history, and recent non-trivial notes.
11. Add obvious project onboarding:
   - `pd init`
   - `pd fleet init`
   - `pd fleet up`
   - `pd mcp install`
   - curated starter fleets
   - “design my fleet with AI” only after budget/readiness gates are clear
12. Fix native-shell ergonomics:
   - singleton Fleet Control Center window
   - sane Dock activation behavior
   - obvious start/stop/pause/enable controls
   - per-agent run/pause/stop controls
   - deployable fleet subsets
   - resizable split panes where density demands it

### K. Sorties, HITL, DAG UX, And Delegation Modes

1. Verify sortie launch end-to-end against the live daemon and installed CLI.
2. Preserve chosen backend/model/budget after launch attempts.
3. Surface daemon `/spawn` or preflight errors inline with exact error text.
4. Root-cause the Claude SDK readiness/reset path where UI said ready, attempted launch, then reverted to `claude-cli`.
5. Define sortie recipes like `investigate`, `fix`, `review`, and `creative` in product docs and UI, not only cards.
6. Make sortie roster selection real and editable against explicit agent definitions.
7. Add sortie status and results pages:
   - steps
   - artifacts
   - messages
   - mutations
   - budget state
   - drill-in outcomes
8. Add explicit human-in-the-loop controls for approval, pause, resume, intervention, and result acceptance.
9. Build DAG-native task decomposition in operator UX with inspectable slices and human approval before dispatch.
10. Keep `pd agent`, `pd spawn`, `pd sortie`, fleet agents, and harbor missions distinct in product language and history surfaces.

### L. Cloudflare, Remote Harbor, Lighthouse, And Distributed Trust

1. Finish Cloudflare Workers AI as a real backend family:
   - runtime execution
   - readiness
   - model catalog
   - spawn/fleet CLI
   - SDK/MCP/OpenAPI/docs
   - exact telemetry and cost attribution
2. Add AI Gateway planning and eventual implementation for centralized policy, observability, caching, request retry, model fallback, and provider routing.
3. Evaluate Vectorize and AI Search for shared retrieval:
   - remote harbor memory
   - documentation search
   - graph/tuple-backed retrieval
   - controlled RAG pipelines
4. Evaluate AutoRAG/AI Search as managed infrastructure only where it reduces glue code without replacing Port Daddy’s graph/tuple-native memory authority.
5. Plan remote harbor/lighthouse as a trust and registry system:
   - centralized user auth dispenser
   - daemon attestation
   - local keychain-backed signing keys
   - registry for lighthouses and capabilities
   - Merkleized evidence exchange
   - revocation filters and definitive proofs
   - capability attenuation for child agents
6. Keep Cloudflare research current against official docs before implementation because Workers AI, AI Gateway, Vectorize, and AI Search are moving targets.
7. Treat Cloudflare tunnels as cost/safety-managed resources, not free background processes.

### M. Archaeology, Ideas, And Roadmap Curation

1. Curate stable-only Spark/Spider residue through `docs/recovery/IDEAS-TROVE.md`, not by promoting raw generated markdown.
2. Elevate only surviving ideas that still matter:
   - capability-aware DNS/harbor discovery
   - persistent fleet run journal / `pd fleet history`
   - forensic context windows on Arbiter violations
   - IPC disconnect to immediate salvage/cascade cleanup
   - tuple-triggered fleet agents
   - IPC tuple fast path
   - merge queue event bus bridge
   - symbol-aware spawn preflight and hot-zone signals
3. Keep `.spark/`, `.spider/connections/`, and `.dogfood/` ignored local residue unless explicitly curated into real docs/features.
4. Reject redundant bug batteries that freeze known-bad behavior; fold durable assertions into canonical tests.

### Skills And Research Needed

1. No brand-new skill is strictly blocking the next implementation cut. Existing local skills cover the biggest upcoming domains:
   - `nygard-2018-release-it-2nd-edition` for Breaker/Caulker resilience and circuit-breaker work
   - `agha-actor-model` for actor mailbox/lease/runtime modeling
   - `cloudflare-worker-dev` and `cloudflare-pages-cicd` for Cloudflare runtime and deploy surfaces
   - `agentic-zero-trust-security`, FIPA agent-management skills, and `proverif-tamarin-protocol-modeling` for remote harbor identity/capability/revocation design
   - `event-driven-architecture-expert`, `runtime-verification-for-agents`, `observability-apm-expert`, and `cost-verification-auditor` for Signalman/Breaker/Quartermaster work
2. Skill additions that would help but are not mandatory:
   - a first-party `cloudflare-ai-platform` skill focused specifically on Workers AI, AI Gateway, Vectorize, AI Search, pricing/limits, and telemetry integration
   - a first-party `port-daddy-actor-runtime` skill encoding ADR-0022/0023, maritime actor names, lease invariants, and migration traps
   - a first-party `symbolic-coordination` skill for Tree-sitter claims, symbolPath identity, graph edges, and merge-conflict prediction
   - a first-party `cartographer-bootstrap` skill for document authority classification, tuple vocabulary, and recovery ledger cleanup policy
   - a first-party `port-daddy-agent-lifecycle` skill inspired by Google's `agents-cli` skill split, covering setup/scaffold/enhance/upgrade/eval/deploy/publish/observe for Codex, Claude, Gemini, and other skill-aware agents
3. Research required before the relevant slices:
   - official Cloudflare docs refresh for Workers AI, AI Gateway, Vectorize, AI Search, model catalog, auth scopes, pricing/limits, and OpenAI-compatible endpoint behavior
   - actor runtime literature/practice review using Agha plus FIPA AMS/DF separation before schema-locking actor souls and body leases
   - semantic collapse evaluation design before changing thresholds: labeled examples, false-merge/false-split metrics, review queues, and repo-specific vocabulary
   - remote harbor threat model before lighthouse implementation: key custody, attestation, delegated tokens, Merkle receipts, revocation filters, and replay resistance
   - resilience pattern pass using the Nygard skill before adding circuit breakers/backpressure across spawn, tunnel, Cloudflare, IPC, and webhook integration points
   - deeper implementation read of `google/agents-cli` templates, skill files, eval result formats, and upgrade/merge behavior before copying any lifecycle surface

## Immediate Next Cuts

1. Cut and validate the maritime actor foundation slice, then promote/restart so live `/actors` and `pd actor(s)` match source.
2. Cut and validate the event-driven Tree-sitter symbol refresh slice, then verify it against the live daemon with real git and watcher events.
3. Decide commit-versus-quarantine for the tuple/graph/memory/semantic slice; do not leave it as ambiguous crash residue.
4. Fix Coxswain coordination debt next: filepath locks or explicit semantic syntax, lease-aware `who-owns`, stale asset reclaim, and claim/mutation graph edges.
5. Finish spawn discipline in the live fleet: cooldown, dedupe, backoff, singleton, project caps, visible queue state, and manual upkeep room.
6. Verify FleetBar/control-plane project truth after promotion: registered dormant projects must show up, embedded chrome must stay collapsed, and project switching must not strand the operator.
7. Verify sortie launch end-to-end from installed CLI and live UI; capture the exact Claude SDK readiness/reset path if it still reproduces.
8. Repair remaining file-action truth where relative mutation paths still fail to resolve in web or native surfaces.
9. Root-cause active-port/zombie-claim inflation if `port-daddy status` reports rows that cleanup cannot free.
10. Add Cloudflare research notes before expanding beyond Workers AI runtime support: official Workers AI, AI Gateway, Vectorize, AI Search, auth, limits, pricing, and telemetry behavior.
11. Fold `docs/plans/agentsd_ai_technical_architecture.md` into the live recovery story by mapping each shared-medium, actor, revocation, graph-memory, and remote-harbor idea to a concrete queue item.
12. Convert `docs/reports/GOOGLE_AGENTS_CLI_RESEARCH_2026-04-24.md` into a concrete Port Daddy lifecycle IA proposal before the public/operator docs split drifts further.
13. Keep the full test suite in the operator loop: focused bundles for iteration, full `npm test` before broad health claims, and failing files/root-cause hypotheses recorded here when the suite fails.

## Newly Confirmed Truths

- The operator surface now has a proper machine action for files, not just text: the daemon exposes `/operator/open-file`, the web control plane calls it, and FleetBar mirrors the same two affordances natively (`Open in Finder`, `Open with default editor`).
- Fleet project truth was one of the remaining big operator lies. `/fleet` only described live loaded fleets, while the UI treated that as the complete project universe. The current working tree now merges `/projects` with `/fleet` in both FleetBar and the web control plane, and `/fleet/config/:project` can resolve a registered stopped project instead of only a running fleet.
- `tests/unit/semantic-index.test.js` and `tests/unit/tunnel-lifecycle.test.js` were legitimate archaeology, not dead scratch. They passed and are now committed.
- The old `tests/unit/spawner-commit-0df9155-bugs.test.js` archaeology file was retired instead of promoted. The only useful assertions were folded into `tests/unit/spawner.test.js`; the rest duplicated existing coverage or canonized known-bad behavior.
- The spawner heartbeat timer was another real Jest open-handle culprit. `lib/spawner.ts` now `unref()`s that interval so blocked-spawn tests do not hold the process open just by reaching the concurrency ceiling.
- Port Daddy now has a real `codex` backend path in source. It shells out to `codex exec`, captures the final assistant message from `--output-last-message`, and unit coverage now exercises readiness, spawn dispatch, model catalog, and opaque-cost estimation for that backend.
- The first live Codex dogfood launch succeeded end-to-end through Port Daddy after replacing the stale manual daemon on `127.0.0.1:9876`: backend `codex`, model `gpt-5.4-mini`, output `codex backend smoke from port-daddy`.
- A second live Codex smoke now also proves the tier plumbing through the daemon, not just the runner: `port-daddy spawn --backend codex --tier low ...` returned `codex tier smoke through port-daddy`.
- Distinct low/mid/high model tiers now exist for every backend instead of only the hosted runtimes:
  - Claude SDK: Haiku / Sonnet / Opus
  - Claude CLI: haiku / sonnet / opus
  - Gemini: 2.0 Flash / 2.5 Flash / 2.5 Pro
  - Codex: gpt-5.4-mini / gpt-5.3-codex / gpt-5.4
  - Ollama: qwen2.5-coder:7b / llama3.1:8b / qwen2.5-coder:14b
  - Aider: gpt-4.1-mini / gpt-4.1 / gpt-5
  - Custom: custom-low / custom-mid / custom-high (forwarded via env so wrappers can honor it)
- The live Codex dogfood also surfaced two operator bugs that belong in the recovery queue, not chat memory:
  - file actions still fail on some relative mutation paths (`Not Found`)
  - fleet spawn counts can still run too hot for real model-usage scarcity
- Port Daddy's own `pd-fleet.yml` is now local-first by default: background/read-only agents use Ollama, code-changing agents use cheaper Codex tiers, and hosted backends are opt-in instead of the silent default.
- The local runtime ladder is now actually provisioned on this machine: Aider is installed, Ollama is healthy again, and the recommended Ollama models (`qwen2.5-coder:7b`, `llama3.1:8b`, `qwen2.5-coder:14b`) are pulled locally.
- Source truth and live-daemon truth still have to be checked separately for Ollama tiers. The repo now points mid-tier Ollama to `llama3.1:8b`, but stale manual daemons can still serve the old invalid `llama3.2:8b` mapping until the canonical runtime is restarted.
- Embedded FleetBar routing needs two signals, not one: query-param embed plus an explicit WebView identity. Relying on `?embed=fleetbar` alone is brittle enough that duplicate chrome can come back.
- The modern fleet engine already scopes logical channels like `git:committed` through `lib/fleet-channels.ts`. If cross-project triggers still bleed, the likely culprit is leaked legacy detached watcher processes, not missing scoping code in the current runner.
- `port-daddy status` and browser reachability are separate truths. The CLI can look healthy over the Unix socket while TCP/browser consumers are still pointed at a brittle loopback URL or stale port assumption.
- The daemon should not permanently skip a project when lease renewal returns `lock not held` and `locks.check()` reports no holder. That is an empty-holder recovery case, not proof another daemon owns the fleet.
- The richer native/control-plane detail views need briefing payloads to carry explicit `summary` and `files`, not just raw activity prose.
- The current daemon-served bundle now renders embedded `Flow` and `Activity` without the inner header/tab stack. The native shell owns surface navigation, theme, and daemon chrome.
- Activity is no longer the empty liar from the earlier screenshot. The served `Activity` surface now shows project-scoped notes again after restoring `story.agentId` attribution and surfacing meaningful event types.
- The concrete Activity bug was project filtering: story notes were still being matched on free text and `identityProject`, but not `story.agentId`, so valid project-scoped handoffs could disappear from the main timeline.
- `pd init` was still writing its own bespoke post-commit hook body. The installer now copies the shared scoped hook template so hook behavior can stop drifting by command surface.
- `pd fleet` status was still sampling naked logical channels like `git:committed`. The operator-facing recent-event check now resolves those through the project-scoped physical channel path.
- Remaining `9876` drift still exists in docs/templates and some operator labels even after the runtime callers were cleaned up.
- The earlier `embed-flow-after` proof was wrong because it captured a loading state. A fresh settled screenshot now confirms embedded `Flow` does render the graph and agent cards correctly from the daemon-served bundle.
- Session notes already carry `agentId` and `identityProject` on the backend; the remaining bug is frontend attribution code still dropping that metadata and guessing from content.
- The activity bug was deeper than the UI. Recent project activity was being queried by `target_id` prefix even though real session and sugar rows often had `target_id = null`, so project-scoped Activity and FleetBar recent work could lie by omission.
- The live installed `.git/hooks/post-commit` in this checkout was still the pre-scope Port Daddy hook, publishing naked `git:committed`. Shared templates were correct, but installers were treating any hook mentioning `git:committed` as already upgraded.
- The fix is now source-level, not cosmetic:
  - session/file/sugar activity stamps `agentId`, `targetId`, and `identityProject`
  - briefing rebuilds project activity from structured metadata, session membership, and active agents
  - legacy Port Daddy hooks auto-upgrade in `pd init` / `pd fleet init`
- The monolithic CLI still had an old freshness auto-restart path in `bin/port-daddy-cli.ts`. Without a same-install-root guard, stale watcher processes from another checkout could decide the canonical daemon was "stale" and SIGTERM it. That path now only restarts for interactive commands from the same checkout as the live daemon.
- Detached watcher archaeology is real. Killing the old top-level `port-daddy-cli watch ...` roots removed the repeated cross-checkout daemon killings; background commands must not get daemon freshness authority back.
- Daemon-owned fleet watchers were still spawning detached `pd watch ... --exec` children for YAML watcher entries. That is now treated as a runtime-hardening bug, not normal fleet behavior: daemon-managed watchers should subscribe through the in-process message bus and spawn only the configured one-shot exec on actual messages.
- Standalone `pd watch` clients must not reset reconnect backoff on denied SSE responses. A 429 from `/msg/.../subscribe`, `/fleet/events`, or `/activity/subscribe` now carries `Retry-After`, and watch clients preserve backoff pressure unless they establish a real `text/event-stream` connection.
- The daemon's Bosun heartbeat interval is mandatory liveness and must stay referenced. SDK/spawner helper heartbeats may use `unref()` to avoid test/process leaks; the daemon heartbeat cannot, because a stale heartbeat makes Bosun kill the canonical runtime.
- FleetBar hits `/projects` during startup, so that route is heartbeat-critical. Default project discovery must stay bounded, must not scan the user's home directory from the stable checkout, and must stop at Port Daddy project boundaries instead of walking repo caches or generated work dirs.
- Runtime discovery now drives more of the real product surface: the JS SDK, MCP server, and FleetBar stores no longer default inline to `http://localhost:9876`; they resolve the live daemon URL through the shared discovery path or the user port file.
- A fresh control-plane load now resolves logical channel names like `git:committed` to physical project-scoped channels before polling or publishing. Older already-open FleetBar/browser clients can still hit naked channels until they reload, so mixed daemon logs after a bundle change do not automatically mean the new bundle is wrong.
- Only `Flow` still warrants the persistent project rail. `Activity`, `Channels`, `Inbox`, `Sorties`, and `YAML` behave better as full-width top-level pages.
- FleetBar popover usefulness is now part of the active scope: recent per-agent summaries and touched files belong in the menu bar companion, not only in the full control center.
- Current build state after the latest control-plane and FleetBar edits: root `npm run typecheck`, `cd fleet-config-ui && npm run build`, and `cd apps/FleetBar && env CLANG_MODULE_CACHE_PATH=/tmp/clang-module-cache swift build` all passed.
- The sortie composer had a truth bug: after launch it recreated a fresh draft with the hardcoded `claude-cli` default, which made a Claude SDK attempt look like it silently reverted runtimes even when the real outcome was elsewhere.
- Generic `POST /spawn: 400 Bad Request` UI errors are not acceptable operator feedback. The control plane must surface the daemon’s actual `error` / preflight blocked reason inline.
- Claude SDK readiness was also lying by omission: env presence alone was enough to show “ready” even when `@anthropic-ai/sdk` was not installed.
- Activity cannot key its entire left rail off “agents with signals” only. If the project log has meaningful work but the left rail says “no signals,” the operator experience is lying by omission.
- Activity click behavior should focus the in-page activity view, not reopen the global slide-in Flow inspector. Overlapping detail surfaces are harder to reason about than one truthful one.
- Spark scratch was already correctly treated as local residue via `.gitignore`; the analogous spider connection note pile belongs in the same default-ignore bucket unless later curated intentionally.
- `.dogfood/` is the same class of residue as `.spark/` and `.spider/connections/`: useful locally, not repo truth by default.
- We copied the unique stable-only Spark/Spider markdown outputs into this checkout so idea archaeology now lives in one place. That does not make every copied file roadmap truth; it just removes the excuse to keep mining the stable repo for “one more missing note.”
- `/Users/erichowens/port-daddy-stable` was used as a live Port Daddy workspace. It has its own `pd-fleet.yml`, daemon DB/logs, `.spark/`, `.spider/`, and tracked build garbage. Promotion failures there are partly operator contamination, not just merge luck.
- The stable checkout is not secretly better than current main. The salvageable pieces are discrete Spark/Spider ideas and maybe a few source edits, not the checkout as a whole.
- The full Jest suite is green again as of `2737816`: `103/103` suites, `4510/4511` tests, `1` skipped. The remaining lie to hunt is the parallel-run worker-force-exit warning, not red suite failures.

## Explicit Non-Goals For This Pass

- New speculative agent products
- More website polishing unless it fixes a lie about live behavior
- Broad economy work beyond budget/cost truthfulness

## Operator Rules

- Update this file when the active recovery queue changes.
- Update `.cartographer/status.md` when the center of gravity moves or a track closes.
- If chat and this file disagree, fix this file first.
