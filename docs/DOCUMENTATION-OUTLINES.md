# Documentation Outlines

**Status:** Outlines only -- to be fleshed out when orchestrator plugins, merge queue, and symbol index are wired into server.ts
**Created:** 2026-03-30
**Context:** These six documents cover the documentation surface area for three new modules: `lib/orchestrator-plugins.ts`, `lib/merge-queue.ts`, and `lib/symbol-index.ts`. The modules exist and have unit tests, but are not yet registered in `routes/index.ts` or wired into `server.ts`. These outlines are complete enough that a future session can expand each into its full document without additional context.

**Related documents:**
- `docs/MERGE-INFRASTRUCTURE-PLAN.md` -- full engineering spec for these modules
- `docs/VISION-AND-PERSPECTIVES.md` -- strategic framework (building department model, pricing, ologs)
- `docs/ECONOMIST-BRIEF-2-ORCHESTRATORS.md` -- economic model for orchestrator competition
- `docs/V4-UNIFIED-ROADMAP.md` -- timeline and phasing

---

## Document 1: CLAUDE.md Updates

**What:** Additions and modifications to the project's `CLAUDE.md` so that future sessions understand these modules without reading source.

### New Section: "The Building Department Model"

Position: After the "Architecture" section, before "Always-On Daemon."

Content outline:
- Opening statement: PD = building department. It issues permits, enforces code, inspects outcomes, maintains records. It never decides the floor plan.
- Table mapping construction roles to PD concepts:
  - Issue permits -> claims, agent registrations, merge queue slots
  - Enforce code -> Arbiter invariants (non-negotiable structural rules)
  - Inspect -> post-merge verification, test gate enforcement
  - Maintain records -> sessions, notes, activity log, immutable audit trail
- Orchestrators = architects. They provide intelligence: task decomposition, agent assignment, merge ordering, failure recovery.
- Default FIFO orchestrator ships with PD. Deliberately simple. No domain knowledge.
- Users bring private orchestrators as plugins. Competitive advantage IS domain knowledge.
- Trust spectrum (brief):
  - Dev mode (solo dev, trusted fleet): daemon decides, no pricing. Strong leader model.
  - Trust boundaries (marketplace agents, cross-org): pricing internalizes externalities. Conflict surface premiums, broadcast credits, merge slot auctions, quality bonds.
- Reference `docs/VISION-AND-PERSPECTIVES.md` for full strategic framework.
- Reference `docs/ECONOMIST-BRIEF-2-ORCHESTRATORS.md` for the economic model.

### New Section: "Orchestrator Plugin Interface"

Position: After "The Building Department Model."

Content outline:
- The `OrchestratorPlugin` interface (`lib/orchestrator-plugins.ts`):
  - **Required methods:**
    - `onMergeSubmitted(submission: MergeSubmission) -> MergeDecision` -- approve/reject/conditionally approve a merge submission
    - `computeMergeOrder(queue: MergeQueueEntry[]) -> MergeSequence` -- return ordered array of entry IDs for execution
    - `onMergeFailure(failure: MergeFailure) -> RecoveryAction` -- decide: revert, retry, park, or reassign
  - **Optional hooks:**
    - `onTick(state: SystemSnapshot) -> OrchestratorAction[]` -- periodic adaptive behavior (reorder, park, notify, spawn)
    - `onAgentRegistered(agent: AgentInfo) -> void` -- track agent pool changes
    - `onAgentDied(agent: AgentInfo, session: SessionInfo | null) -> SalvageStrategy` -- decide how to handle dead agent's work
- How to register: `POST /merge/plugins` or `pd merge plugin register --name <name> --module <path>`
- How to list: `GET /merge/plugins` or `pd merge plugins`
- Hot-swap: `PUT /merge/plugins/active` or `pd merge plugin activate <name>` -- change active orchestrator without daemon restart
- Default FIFO plugin (`__fifo__`): cannot be unregistered, always available as safety net
- Plugin storage: `orchestrator_plugins` table in SQLite, plugin code loaded via dynamic import
- Event emission: registry emits `plugin:registered`, `plugin:activated`, `plugin:deactivated` events

### New Section: "Merge Queue"

Position: After "Orchestrator Plugin Interface."

Content outline:
- What: SQLite-backed merge queue with orchestrator-delegated ordering and pluggable `MergeExecutor` for git operations
- Lifecycle diagram: `submit -> approved -> merging -> inspecting -> merged` (happy path) with failure branches to `failed -> (revert|retry|park|reassign)`
- API endpoints (table format):
  - `POST /merge/submit` -- submit a merge to the queue (body: agentId, branch, repository, baseBranch, claims, metadata)
  - `GET /merge/queue` -- list queue entries (query: status, repository, limit)
  - `GET /merge/queue/:id` -- get a single entry
  - `DELETE /merge/queue/:id` -- cancel a pending merge
  - `POST /merge/queue/reorder` -- explicit position override (body: ids[])
  - `POST /merge/execute/:id` -- trigger execution of a specific merge
  - `POST /merge/execute/next` -- execute next merge per orchestrator ordering
  - `GET /merge/predict` -- predict conflicts for all pending merges in a repo (query: repository)
  - `GET /merge/predict/:id` -- predict conflicts for a specific merge
  - `GET /merge/stats` -- queue statistics (depths, avg wait, failure rate)
  - `GET /merge/plugins` -- list registered orchestrator plugins
  - `POST /merge/plugins` -- register a new plugin
  - `PUT /merge/plugins/active` -- set the active plugin
- CLI commands (table format):
  - `pd merge submit --branch <branch> --repo <path>` -- submit to queue
  - `pd merge queue` -- list queue (supports `--status`, `--repo`, `--json`)
  - `pd merge execute [id]` -- execute a specific merge or next in queue
  - `pd merge predict [--repo <path>]` -- show predicted conflicts
  - `pd merge cancel <id>` -- cancel a pending merge
  - `pd merge stats` -- queue statistics
  - `pd merge plugins` -- list registered plugins
  - `pd merge plugin register --name <name> --module <path>` -- register
  - `pd merge plugin activate <name>` -- hot-swap active plugin
- MergeExecutor interface: pluggable git operations (merge, revert, inspect). Default implementation uses `execFileSync` with per-repo lock. Tests mock this entirely.
- Integration with existing systems:
  - Arbiter: post-merge invariant checking (test gate, symbol claim consistency)
  - Activity log: new activity types `merge:submitted`, `merge:executing`, `merge:completed`, `merge:failed`, `merge:reverted`
  - Pheromone: conflict surface written as pheromone signal (decays over time)
  - Locks: per-repo lock during merge execution (`merge:<repoPath>`)

### New Section: "Symbol Index (Tree-Sitter)"

Position: After "Merge Queue."

Content outline:
- What: WASM-based AST parsing via `web-tree-sitter`. Extracts functions, classes, methods, interfaces, types, enums with dependency tracking. Enables sub-file claims and structural conflict prediction.
- Languages supported: TypeScript, JavaScript, Python (parsers loaded lazily via WASM)
- Tables created:
  - `symbols` -- extracted symbols with file path, name, type, line range, parent, signature hash, body hash, exported flag
  - `symbol_dependencies` -- directed dependency edges (symbol A uses symbol B)
  - `file_parse_cache` -- file hash -> parsed timestamp (skip unchanged files)
- API endpoints:
  - `POST /symbols/parse` -- parse a file or directory (body: path, recursive?, languages?)
  - `GET /symbols` -- search symbols (query: file, name, type, exported)
  - `GET /symbols/:id` -- get a single symbol with dependencies
  - `GET /dependencies` -- query dependency graph (query: symbol, direction: uses|usedBy, depth)
  - `POST /conflicts/predict` -- predict conflicts between two sets of claims (body: claimsA[], claimsB[])
- CLI commands:
  - `pd symbols parse <path>` -- parse file(s) into the index
  - `pd symbols search [--file <path>] [--name <pattern>] [--type <type>]` -- search the index
  - `pd symbols deps <symbolPath> [--direction uses|usedBy] [--depth N]` -- dependency query
  - `pd conflicts predict --branch-a <branch> --branch-b <branch>` -- conflict prediction between branches
- Conflict prediction tiers (critical to document):
  - **Direct (blocking):** Both claim sets modify the same symbol. Merge will almost certainly conflict.
  - **Dependency (warning):** Claim set A modifies a symbol; claim set B reads/calls it. Merge may succeed but runtime behavior changes.
  - **Signature (blocking):** Claim set A changes a symbol's signature (return type, parameters); claim set B calls it. Compile-time breakage.
  - **Transitive (info):** A modifies X, X is used by Y, B modifies Y. Confidence decays with distance (0.9^depth).
- Update triggers: on file claim (`session_files` INSERT), on explicit `pd symbols parse`, periodic sweep (configurable, default 60s for active repos)
- Performance: ~1ms per file for typical TypeScript modules. SHA-256 file hash used to skip unchanged files.
- Integration with session file claims: `pd session files claim <session> --symbol "createRoutes" --file server.ts` extends existing file claims with optional symbol granularity

### Updates to Existing Sections

**API Endpoints Summary table:** Add all merge queue and symbols endpoints listed above. Group under new headers:
- `**Merge Queue**` (11 endpoints)
- `**Symbols & Conflicts**` (5 endpoints)

**File Locations section:** Add:
- `lib/orchestrator-plugins.ts` -- Orchestrator plugin registry and interface definitions
- `lib/merge-queue.ts` -- Merge queue with orchestrator-delegated ordering
- `lib/symbol-index.ts` -- Tree-sitter AST symbol extraction and caching
- `routes/merge-queue.ts` -- Merge queue and plugin API routes
- `routes/symbols.ts` -- Symbol index and conflict prediction routes

**Architecture section (module list):** Add `orchestrator-plugins.ts`, `merge-queue.ts`, `symbol-index.ts` with one-line descriptions matching the style of existing entries.

**Adding New Features checklist:** Add item: "If your feature touches merge ordering or agent coordination, implement the relevant `OrchestratorPlugin` hook or verify the default FIFO handles it correctly."

**Command Parity Matrix:** Add rows for merge queue and symbol index commands across all surfaces (HTTP, CLI, SDK, dashboard, completions, README, SDK reference).

**In-Progress Features section:** Add a tracking table for the merge queue and symbol index integration, following the format of the existing `pd spawn + pd watch` and `Context-Aware Salvage` tracking tables.

---

## Document 2: README Updates

**What:** User-facing documentation in `README.md` for the three new capabilities.

### New Section: "Orchestrator Plugins"

Position: After the existing "Agent Coordination" or "Sessions & Notes" section, wherever the feature-oriented sections live.

Content outline:
- **One-paragraph summary:** Port Daddy coordinates agents, but the intelligence for decomposing tasks and ordering merges varies by domain. Orchestrator plugins bring domain-specific intelligence while PD provides the infrastructure. PD ships a default FIFO orchestrator; custom orchestrators implement the `OrchestratorPlugin` interface.
- **Quick example** (10 lines, self-contained):
  ```
  // my-orchestrator.js -- sort merges by file count (fewer files = merge first)
  export default {
    name: 'file-count-priority',
    version: '1.0.0',
    async onMergeSubmitted(sub) { return { approved: true }; },
    async computeMergeOrder(queue) {
      const sorted = [...queue].sort((a, b) => a.claims.length - b.claims.length);
      return { order: sorted.map(e => e.id), reasoning: 'fewer files first' };
    },
    async onMergeFailure(f) { return { action: 'revert', reason: 'auto-revert on failure' }; },
  };
  ```
- **Registration example:**
  ```bash
  pd merge plugin register --name file-count-priority --module ./my-orchestrator.js
  pd merge plugin activate file-count-priority
  pd merge plugins  # verify
  ```
- **API reference** (brief table): register, activate, list, get active
- **Link to tutorial:** "See `docs/tutorials/writing-your-first-orchestrator-plugin.html`"

### New Section: "Symbol-Level Claims"

Position: After "Orchestrator Plugins."

Content outline:
- **Problem statement:** File-level claims are too coarse. When two agents both need to modify `server.ts`, a file claim blocks one entirely. Without claims, they collide at merge time.
- **Solution:** Tree-sitter-powered AST analysis lets agents claim individual symbols (functions, classes, methods) within a file.
- **Example scenario:**
  ```bash
  # Parse the file into the symbol index
  pd symbols parse server.ts

  # See what symbols are available
  pd symbols search --file server.ts

  # Agent A claims createRoutes
  pd session files claim <session-a> --symbol "createRoutes" --file server.ts

  # Agent B claims createMiddleware (same file, no conflict)
  pd session files claim <session-b> --symbol "createMiddleware" --file server.ts
  ```
- **Conflict prediction example:**
  ```bash
  pd merge predict --repo .
  # Output shows: Agent A and Agent B have no direct conflicts
  # But: createRoutes DEPENDS ON createMiddleware (dependency warning)
  ```
- **Conflict tiers table:**
  | Tier | Severity | Meaning | Example |
  |------|----------|---------|---------|
  | Direct | BLOCKING | Same symbol modified by both | Both agents edit `validateToken` |
  | Dependency | WARNING | A modifies, B reads | A changes `validateToken` return type, B calls it |
  | Signature | BLOCKING | Signature change breaks callers | A adds parameter to `validateToken`, B calls it |
  | Transitive | INFO | Indirect dependency chain | A modifies X, X used by Y, B modifies Y |
- **Languages supported:** TypeScript, JavaScript, Python
- **Link to how-to:** "See `docs/how-to/symbol-level-claims.html`"

### New Section: "Merge Queue"

Position: After "Symbol-Level Claims."

Content outline:
- **Problem statement:** When multiple agents finish work on separate branches, merging is manual, serial, and blind to conflicts until `git merge` fails. First-mover advantage creates perverse incentives (rush to merge first).
- **Solution:** A coordinated merge queue with conflict prediction, orchestrator-delegated ordering, and post-merge inspection.
- **Example workflow:**
  ```bash
  # Agent submits its branch to the merge queue
  pd merge submit --branch feature-auth --repo /path/to/project

  # Check predicted conflicts
  pd merge predict --repo /path/to/project

  # View queue ordering (determined by active orchestrator)
  pd merge queue --repo /path/to/project

  # Execute next merge (respects orchestrator ordering)
  pd merge execute next --repo /path/to/project

  # Check stats
  pd merge stats --repo /path/to/project
  ```
- **Integration points** (brief):
  - Orchestrator plugins determine merge ordering and handle failures
  - Symbol index provides conflict predictions that feed into ordering decisions
  - Arbiter runs post-merge invariant checks (test gate, symbol claim consistency)
  - Activity log records all merge events for audit trail
- **API reference** (brief table): submit, queue, execute, predict, cancel, stats

### Updates to Existing Sections

**Feature list / hero section:**
- Add "Orchestrator plugins" to capability list
- Add "Symbol-level claims (tree-sitter)" to capability list
- Add "Merge queue with conflict prediction" to capability list

**CLI reference table:** Add all `pd merge` and `pd symbols` subcommands:
- `pd merge submit` -- Submit branch to merge queue
- `pd merge queue` -- List merge queue
- `pd merge execute` -- Execute next/specific merge
- `pd merge predict` -- Predict conflicts
- `pd merge cancel` -- Cancel pending merge
- `pd merge stats` -- Queue statistics
- `pd merge plugins` -- List orchestrator plugins
- `pd merge plugin register` -- Register plugin
- `pd merge plugin activate` -- Hot-swap active plugin
- `pd symbols parse` -- Parse files into symbol index
- `pd symbols search` -- Search symbol index
- `pd symbols deps` -- Query dependency graph
- `pd conflicts predict` -- Predict conflicts between branches

**Architecture diagram:** Add `symbol-index` and `merge-queue` modules to the module list. Show the data flow: `symbol-index -> merge-queue -> orchestrator-plugins -> arbiter`.

---

## Document 3: CHANGELOG Entry

**What:** Entry for the `[Unreleased]` section of `CHANGELOG.md`.

```markdown
## [Unreleased]

### Added

- **Orchestrator Plugin Interface** -- Pluggable architecture for merge coordination.
  Ships with default FIFO orchestrator. Custom orchestrators implement the
  `OrchestratorPlugin` interface with 3 required methods (`onMergeSubmitted`,
  `computeMergeOrder`, `onMergeFailure`) and 3 optional hooks (`onTick`,
  `onAgentRegistered`, `onAgentDied`). Hot-swap support via
  `PUT /merge/plugins/active` for changing the active orchestrator without
  daemon restart. The default FIFO plugin cannot be unregistered (safety net).
  New module: `lib/orchestrator-plugins.ts`.

- **Merge Queue** -- SQLite-backed merge queue with conflict surface computation,
  orchestrator-delegated ordering, and pluggable `MergeExecutor` interface for
  git operations. 11 API endpoints covering submit, reorder, execute, inspect,
  predict, cancel, and stats. Status lifecycle:
  `submit -> approved -> merging -> inspecting -> merged` with failure recovery
  via orchestrator (`revert | retry | park | reassign`). Per-repo locking during
  merge execution. Integration with Arbiter (post-merge invariants), Activity Log
  (new `merge:*` event types), and Pheromone (conflict surface as decaying signal).
  New modules: `lib/merge-queue.ts`, `routes/merge-queue.ts`.

- **Symbol Index (Tree-Sitter)** -- WASM-based AST parsing for TypeScript,
  JavaScript, and Python. Extracts functions, classes, methods, interfaces,
  types, and enums with directed dependency tracking into SQLite. SHA-256
  file hash caching (skip unchanged files, ~1ms per file). Sub-file symbol
  claims extend the existing `session_files` system. Conflict prediction with
  4 severity tiers: direct (blocking), dependency (warning), signature
  (blocking), transitive (info with 0.9^depth confidence decay). 5 API
  endpoints. New modules: `lib/symbol-index.ts`, `routes/symbols.ts`.

- **4 New Skills** -- `olog-construction` (category theory modeling),
  `operad-task-decomposition` (compositional task decomposition),
  `mechanism-design-for-agent-labor` (expanded with pricing mechanisms),
  `semantic-conflict-prediction` (symbol-level conflict analysis).

- **4 Architecture Documents** -- `VISION-AND-PERSPECTIVES.md` (strategic
  framework), `DAEMON-MESH-ARCHITECTURE.md` (multi-daemon topology),
  `OLOG-LIBRARY-PROGRAM.md` (category theory for agent coordination),
  `MERGE-INFRASTRUCTURE-PLAN.md` (8-11 week engineering spec).
```

---

## Document 4: ADR-0023 -- Building Department / Orchestrator Plugin Architecture

**What:** Architecture Decision Record explaining the separation of concerns between PD core and orchestrator plugins.

**File:** `docs/adr/0023-building-department-orchestrator-plugins.md`

### Outline

```markdown
# ADR-0023: Building Department / Orchestrator Plugin Architecture

## Status

Accepted (2026-03-30)

## Context

### The problem
Port Daddy needs to support multi-agent merge coordination, but the intelligence
for decomposing tasks and ordering merges varies by domain. A React codebase
orchestrator needs different strategies than a Rust systems orchestrator. A
monorepo orchestrator needs different strategies than a single-package orchestrator.

### Why a single built-in strategy fails
- File-level claims are too coarse for real multi-agent work
- FIFO ordering ignores dependency structure (foundation changes should merge first)
- Different codebases have different structural invariants (component boundaries in
  React, borrow checker in Rust, package dependency graphs in monorepos)
- The daemon cannot contain domain knowledge for every possible codebase

### Prior art considered
- GitHub's merge queue (too simple -- FIFO only, no conflict prediction)
- Bors-ng (Rust CI merge bot -- right idea but coupled to GitHub PRs)
- Kubernetes admission controllers (the plugin model we adopted)
- Evans' DDD: Generic Subdomain (PD) vs Core Domain (orchestrator)

## Decision

Separate the "building department" (PD core) from the "architect" (orchestrator
plugins). Define a clear interface boundary:

### What PD provides (Generic Subdomain)
- Merge queue with SQLite persistence and status lifecycle
- Conflict prediction via tree-sitter symbol index
- Post-merge inspection via Arbiter invariants
- Per-repo locking during merge execution
- Activity logging and pheromone signals for all merge events
- Plugin registry with hot-swap support

### What orchestrators provide (Core Domain)
- Merge submission approval/rejection logic
- Merge ordering based on domain knowledge
- Failure recovery strategy (revert vs retry vs park vs reassign)
- Adaptive behavior via periodic tick (rebalancing, spawning agents)
- Agent lifecycle awareness (registration, death, salvage)

### The interface contract
3 required methods, 3 optional hooks on the `OrchestratorPlugin` interface.
PD calls the active orchestrator at well-defined lifecycle points. The
orchestrator never touches git directly -- it returns decisions, PD executes
them through the `MergeExecutor`.

### Default FIFO orchestrator
Ships with PD, cannot be unregistered. Provides a no-intelligence baseline:
- Always approves submissions
- FIFO ordering (first submitted = first executed)
- Always reverts on failure
- No adaptive behavior

This ensures PD works out of the box without any plugin configuration.

### Hot-swap semantics
- Only one orchestrator is active at a time
- Switching orchestrators does NOT affect queued merges in progress
- The new orchestrator takes over for the NEXT decision point
- Deactivation does NOT unregister (plugin stays available for re-activation)

## Consequences

### Positive
- PD's core remains domain-agnostic and testable in isolation
- Orchestrators can be developed and iterated independently of PD releases
- The competitive advantage of an orchestrator is its domain knowledge, not
  its infrastructure (PD provides that)
- Testing: each orchestrator is testable against PD's interface without a
  running daemon (mock the types, assert the decisions)
- Users can hot-swap orchestrators without restarting the daemon

### Negative
- PD's API surface grows (merge queue + plugin registry = ~15 new endpoints)
- The OrchestratorPlugin interface is a stability commitment -- breaking
  changes require a deprecation cycle
- Plugin loading via dynamic import introduces a new failure mode (bad plugin
  crashes the daemon? Needs sandboxing consideration for v4.1+)
- FIFO default means users who don't configure a plugin get no intelligence --
  but this is intentional (better safe defaults than surprising heuristics)

### Risks
- Plugin sandboxing: a malicious or buggy plugin can currently block the merge
  queue. Mitigations: timeout on every plugin call (5s default), catch all
  exceptions, fall back to FIFO on plugin error.
- Interface evolution: the 6-method interface was designed for current needs.
  If we need more hooks later, we add optional methods (backward compatible).
- Performance: orchestrator calls are in the merge hot path. Async interface
  allows orchestrators to call external services, but PD should enforce
  timeouts to prevent queue stalls.
```

---

## Document 5: Tutorial -- "Writing Your First Orchestrator Plugin"

**What:** Hands-on learning-oriented tutorial (Diataxis: Tutorial). Walks through building, registering, and testing a custom orchestrator plugin.

**File:** `website/docs/tutorials/writing-your-first-orchestrator-plugin.html` (or `.md`, depending on site build)

### Outline

```
Title: Writing Your First Orchestrator Plugin
Diataxis type: Tutorial (learning-oriented, hands-on)
Estimated time: 30 minutes
Prerequisites: Port Daddy v3.9+ running, Node.js 20+, a test repo with multiple agents

---

1. What You Will Build
   - A "priority orchestrator" that sorts merges by number of changed files
   - Merges with fewer file claims execute first (less risk, faster feedback)
   - On failure, always revert (simple, safe)
   - By the end: registered, activated, tested with real merge submissions

2. Understanding the Plugin Interface
   - What PD expects from an orchestrator (it calls YOU, you return decisions)
   - Diagram: PD lifecycle -> orchestrator hooks
   - The 3 required methods:
     - onMergeSubmitted: called when an agent submits a branch. Return approve/reject.
     - computeMergeOrder: called when PD needs to decide what to execute next. Return ordered IDs.
     - onMergeFailure: called when a merge fails inspection. Return recovery action.
   - The 3 optional hooks:
     - onTick: periodic system snapshot. For adaptive behavior.
     - onAgentRegistered: new agent appeared. For tracking capacity.
     - onAgentDied: agent stopped heartbeating. For salvage coordination.
   - When does PD call each method? Lifecycle diagram with annotations.

3. Building the Plugin
   - Create file: `my-orchestrator.mjs`
   - Implement onMergeSubmitted:
     - Log the submission for debugging
     - Return { approved: true } (accept everything for now)
     - Discussion: when would you reject? (wrong base branch, no tests, untrusted agent)
   - Implement computeMergeOrder:
     - Receive queue (array of MergeQueueEntry)
     - Sort by `claims.length` ascending (fewer files = lower risk = merge first)
     - Return { order: sorted.map(e => e.id), reasoning: 'fewer files first' }
     - Discussion: other ordering strategies (dependency depth, conflict surface, agent priority)
   - Implement onMergeFailure:
     - Return { action: 'revert', reason: 'auto-revert on any failure' }
     - Discussion: when would you retry vs park vs reassign?
   - Full code listing (under 30 lines)

4. Registering and Activating
   - Register: pd merge plugin register --name file-count-priority --module ./my-orchestrator.mjs
   - Verify registration: pd merge plugins (should show FIFO + yours)
   - Activate: pd merge plugin activate file-count-priority
   - Verify activation: pd merge plugins (should show yours as active)
   - What happens to FIFO? Still registered, available as fallback.
   - Switch back: pd merge plugin activate __fifo__

5. Testing Your Orchestrator
   - Set up test scenario: 3 agents, 3 branches, different file counts
   - Agent A: modifies 5 files -> pd merge submit --branch feat-a --repo .
   - Agent B: modifies 2 files -> pd merge submit --branch feat-b --repo .
   - Agent C: modifies 8 files -> pd merge submit --branch feat-c --repo .
   - Check queue: pd merge queue --repo . --json
   - Expected order: B (2 files) -> A (5 files) -> C (8 files)
   - Check conflict predictions: pd merge predict --repo .
   - Execute: pd merge execute next --repo .
   - Observe: B merges first (fewest files)
   - Check stats: pd merge stats --repo .

6. Going Further
   - Adding onTick for adaptive behavior:
     - Monitor queue depth. If > 10 items, increase merge parallelism.
     - Monitor failure rate. If > 30%, park all pending and notify.
   - Using conflict predictions in computeMergeOrder:
     - Read conflictSurface from queue entries
     - Move high-conflict merges to the end (let clean merges go first)
     - Or: move high-conflict merges to the FRONT (fail fast, learn early)
   - Connecting to external systems:
     - Call GitHub API to check CI status before approving
     - Post to Slack when a merge fails
     - Read Jira ticket priority to inform merge ordering
   - Building a test harness:
     - Import the plugin's methods directly
     - Mock MergeQueueEntry objects with different claim counts
     - Assert ordering matches expectations
     - No daemon needed for unit testing the plugin
```

---

## Document 6: How-To -- "Using Symbol-Level Claims for Multi-Agent Work"

**What:** Task-oriented guide for a specific problem (Diataxis: How-to). Solves the problem of two agents needing to modify the same file.

**File:** `website/docs/how-to/symbol-level-claims.html` (or `.md`, depending on site build)

### Outline

```
Title: Using Symbol-Level Claims for Multi-Agent Work
Diataxis type: How-to (task-oriented, solve a specific problem)
Estimated time: 15 minutes
Prerequisites: Port Daddy v3.9+ running, a project with TypeScript/JavaScript/Python files

---

1. The Problem: Two Agents, One File
   - Scenario: you have two agents working on the same project.
     Agent A is building a new route handler in server.ts.
     Agent B is refactoring middleware in the same server.ts.
   - With file-level claims: pd session files claim <session-a> server.ts
     -> Agent B cannot claim server.ts. Blocked. Sequential work only.
   - Without claims: both agents modify server.ts freely.
     -> At merge time: git conflict on overlapping lines. Manual resolution.
   - Neither option is acceptable for real multi-agent work.

2. The Solution: Claim at the Symbol Level
   Step-by-step:

   a. Parse the file into the symbol index:
      pd symbols parse server.ts
      (First parse loads the tree-sitter WASM parser; subsequent parses are ~1ms)

   b. Discover available symbols:
      pd symbols search --file server.ts
      Output: table of functions, classes, methods with line ranges
      Example output:
        createRoutes    function    lines 45-120    exported
        createMiddleware function   lines 122-180   exported
        startServer     function    lines 182-210   exported
        ...

   c. Agent A claims its symbol:
      pd session files claim <session-a> --symbol "createRoutes" --file server.ts
      (Claims lines 45-120 of server.ts, associated with the createRoutes symbol)

   d. Agent B claims its symbol:
      pd session files claim <session-b> --symbol "createMiddleware" --file server.ts
      (Claims lines 122-180 of server.ts, associated with the createMiddleware symbol)

   e. No conflict -- both agents work on the same file, different symbols.

   f. Check claims:
      pd files/who-owns --path server.ts
      Output shows both claims with their symbol scopes.

3. Detecting Conflicts Before They Happen
   - Run conflict prediction:
     pd merge predict --repo .
   - Output shows predicted conflicts between pending merges, with severity tiers:

   a. Direct conflict (BLOCKING):
      Both agents modify the same symbol.
      Example: both edit `validateToken` -> guaranteed git conflict.
      Action: one agent must wait or they must coordinate via pub/sub.

   b. Dependency conflict (WARNING):
      Agent A modifies `validateToken`; Agent B calls `validateToken`.
      Example: A changes the return type. B's code compiles but may break at runtime.
      Action: A should broadcast the change via pub/sub. B should re-test after A merges.

   c. Signature conflict (BLOCKING):
      Agent A changes the signature of `validateToken` (adds parameter, changes return type).
      Agent B calls `validateToken` with the old signature.
      Example: A adds a required `options` parameter. B's call site won't compile.
      Action: A must merge first. B must update call sites after.

   d. Transitive conflict (INFO):
      Agent A modifies X. X is used by Y. Agent B modifies Y.
      Confidence decays: 0.9^depth. At depth 3, confidence is 0.73.
      Action: informational only. Worth knowing, not worth blocking.

4. Handling Conflicts When They Arise
   Three strategies, ordered by preference:

   a. Reorder work (best):
      Foundation changes merge first. If A modifies a utility that B depends on,
      A merges first. The merge queue's orchestrator can do this automatically
      if it has access to the dependency graph (pd symbols deps).

   b. Negotiate via pub/sub (good):
      pd msg agent-coordination --json '{"type":"expanding","agent":"A","symbol":"createMiddleware","file":"server.ts"}'
      Other agents subscribe to the channel and adjust their claims.

   c. Serialize (last resort):
      One agent pauses work on the conflicting symbol. Resume after the
      other agent merges. Use pd locks to enforce:
      pd lock acquire "server.ts:createRoutes" --owner agent-a --ttl 600000

5. Tips and Best Practices
   - Parse early: run pd symbols parse at session start, not at merge time.
     The index is cached by file hash -- parsing is idempotent and fast.
   - Check staleness: symbols are cached by SHA-256 of the file content.
     If the file changes on disk, the next parse picks up the new symbols.
     The periodic sweep (every 60s for active repos) handles this automatically.
   - Claim narrow: claim the specific function you are modifying, not the
     entire class. Finer-grained claims = fewer conflicts.
   - Use with merge queue: conflict predictions from the symbol index feed
     into the merge queue's ordering. The orchestrator can use them to
     sort merges optimally (clean merges first, or high-conflict first for
     fail-fast feedback).
   - Monitor with pheromones: conflict surfaces are written as pheromone
     signals that decay over time. High-heat files show up in
     pd pheromone files as recent conflict zones.
   - Language support: currently TypeScript (.ts/.tsx), JavaScript (.js/.jsx/.mjs/.cjs),
     and Python (.py). Additional languages can be added by loading the
     appropriate tree-sitter WASM grammar.
```

---

## Cross-Document Dependencies

When expanding these outlines into full documents, maintain consistency across all six:

| Concept | Must be consistent across |
|---------|--------------------------|
| `OrchestratorPlugin` method names and signatures | Doc 1 (CLAUDE.md), Doc 2 (README), Doc 4 (ADR), Doc 5 (Tutorial) |
| Merge queue endpoint paths (`/merge/submit`, etc.) | Doc 1 (CLAUDE.md), Doc 2 (README), Doc 3 (CHANGELOG) |
| Conflict severity tiers (direct/dependency/signature/transitive) | Doc 1 (CLAUDE.md), Doc 2 (README), Doc 3 (CHANGELOG), Doc 6 (How-to) |
| CLI command names (`pd merge submit`, `pd symbols parse`, etc.) | Doc 1 (CLAUDE.md), Doc 2 (README), Doc 5 (Tutorial), Doc 6 (How-to) |
| Default FIFO plugin name (`__fifo__`) | Doc 1 (CLAUDE.md), Doc 4 (ADR), Doc 5 (Tutorial) |
| MergeExecutor interface role | Doc 1 (CLAUDE.md), Doc 3 (CHANGELOG), Doc 4 (ADR) |
| Languages supported (TS, JS, Python) | Doc 1 (CLAUDE.md), Doc 2 (README), Doc 3 (CHANGELOG), Doc 6 (How-to) |

Before publishing any document, verify that all shared concepts use identical names, paths, and descriptions. The source of truth for interface definitions is `lib/orchestrator-plugins.ts`. The source of truth for API endpoints is the route files (`routes/merge-queue.ts`, `routes/symbols.ts`). The source of truth for CLI commands is `bin/port-daddy-cli.ts`.
