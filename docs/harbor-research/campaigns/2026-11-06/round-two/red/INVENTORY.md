# RED dispatch writer inventory and admission bypass findings

Research date: 6 November 2026. Investigator: tool-native RED inventory agent. Evidence class: **source-established paths; probes not executed by this investigator**. This report records the baseline at HEAD `8ec96b55a7e048e6f18a472a54e94fcd1c150e41`; subsequent implementation is not included in its conclusions.

## Boundary evidence

- Verified root: `/Users/erichowens/coding/tmp/research-admission-binding-20261106`.
- Verified branch: `codex/research-admission-binding-20261106`.
- Verified Git directory: `/Users/erichowens/coding/port-daddy/.git/worktrees/research-admission-binding-20261106`.
- Root, branch, linked-worktree metadata and baseline HEAD were checked before inspection and again before this report write.
- No source code or tests edited; no Port Daddy CLI, MCP, daemon, hook, app or local agent launched. This report is the investigator's only authorized write. Other agents' campaign files and `lib/dispatch/admission.ts` were observed and left untouched.
- The teams share a host and filesystem. Separation here is procedural; no OS-level team privacy or isolation is claimed.
- Applied the red-team skill's concrete target → probe → observation → impact approach. The named probes below are recommendations, not completed executions.

The target research document is `docs/harbor-research/research/dispatch-admission-conformance.md`.

## Complete discovered writer inventory

The investigation searched tracked production source across languages, then traced generic SQL/table selectors and whole-database replacement paths. Runtime dispatch DML consists of **two INSERT sites and fourteen UPDATE sites in `lib/dispatch/queue.ts`**, **one UPDATE site in `lib/harbormaster.ts`**, and **the generic DELETE in berth seeding**. Schema/migration and whole-database writers also matter. These counts are source statement sites, not API-method counts or statements observed during execution.

All source references below are relative to the verified worktree root. Line numbers refer to the baseline HEAD.

| Writer / source | Changed columns or rows | Guard and transaction boundary |
| --- | --- | --- |
| `lib/dispatch/queue.ts:330`, `SCHEMA_SQL` | Creates dispatch table and indexes; establishes every initial column/default | `CREATE … IF NOT EXISTS`; construction-time statements, no enclosing constructor transaction |
| `lib/dispatch/queue.ts:505`, `migrateNightshiftIntents` | INSERT: `id,slug,goal,tags_json,state,requested_by,base_branch,backend,budget_usd,timeout_ms,worktree_path,branch,session_id,result_artifact,cost_usd,duration_ms,error_message,merge_policy,created_at,claimed_at,started_at,produced_at,reviewed_at,settled_at` | Reads legacy rows **before** transaction; transaction inserts with `OR IGNORE`. Legacy states can initialize `proposed`, `claimed`, `in_progress`, `settled`, `failed`, `salvage` |
| `lib/dispatch/queue.ts:640`, `migrateDispatchFailoverColumns` | Adds `predecessor_dispatch_id,failover_attempt,failover_from_backend,handoff_episode_id,spawned_agent_id,failover_chain_json` | PRAGMA presence check then individual ALTERs; no outer transaction |
| `lib/dispatch/queue.ts:660`, constructor additive migrations | Adds `run_requested_at,launch_id,agent_id,transcript_id,model,project_dir`; run-request index | PRAGMA presence check then individual ALTERs |
| `lib/dispatch/queue.ts:917`, `materializeProjection`; `propose` delegates | INSERT: `id,slug,goal,tags_json,state,requested_by,target_actor_id,reviewer_actor_id,base_branch,project_dir,backend,budget_usd,timeout_ms,merge_policy,created_at,claimed_at,predecessor_dispatch_id,failover_attempt,failover_from_backend,handoff_episode_id,failover_chain_json` | Validates input; initial state is `proposed` or caller-selected `claimed`; select-existing → insert → read-back are separate statements. Existing ID returns old row without comparing immutable request fields |
| `lib/dispatch/queue.ts:747`, `claimStmt`; used by `claimProposed`, `claim`, `nextProposed` | `state,worker_actor_id,worktree_path,branch,session_id,run_requested_at,claimed_at` | SQL requires `state='proposed'`. `claimProposed` checks `changes`; `claim` returns any already-claimed row as success without lease-owner comparison. Only `nextProposed` wraps select/update/read-back in a transaction |
| `lib/dispatch/queue.ts:759`, `releaseUnboundAutoClaimStmt`; `prepareForRun` | `state='proposed',run_requested_at,claimed_at=NULL` | Requires claimed state and NULL worker/worktree/branch/session/start fields; no launch/agent/transcript check; no outer transaction |
| `lib/dispatch/queue.ts:773`, `prioritizeProposedRunStmt`; `prepareForRun` | `run_requested_at` | Requires proposed; `COALESCE` retains existing timestamp; no transaction or changed-row assertion |
| `lib/dispatch/queue.ts:779`, `restorePreparedRunStmt`; `restorePreparedRun` | `state,run_requested_at,claimed_at` | Requires proposed, matching `run_requested_at`, empty worker/worktree/branch/session/start fields. Caller-supplied snapshots select rollback values. Timestamp is not an incarnation token |
| `lib/dispatch/queue.ts:794`, `startStmt`; `start` | `state='in_progress',started_at` | Requires claimed; JS returns any already-in-progress row as success. Read/update/read-back separate; UPDATE result ignored |
| `lib/dispatch/queue.ts:801`, `bindExecutionStmt`; `bindExecution` | `launch_id,agent_id,transcript_id,model` | Allowed in claimed/in-progress/produced/review-pending/accepted/settled/failed/salvage. Non-NULL caller values overwrite prior values. No owner/generation predicate; UPDATE result ignored |
| `lib/dispatch/queue.ts:811`, `produceStmt`; `produce` | `state,result_artifact,cost_usd,produced_at,duration_ms` | Requires in-progress; any already-produced row returns as idempotent success. Separate statements; UPDATE result ignored |
| `lib/dispatch/queue.ts:824`, `requestReviewStmt` | `state='review_pending'` | Requires produced; separate pre-read/update/read-back; changes ignored |
| `lib/dispatch/queue.ts:830`, `acceptStmt` | `state='accepted',reviewed_at,error_message` | Requires review-pending; separate statements; changes ignored |
| `lib/dispatch/queue.ts:838`, `rejectStmt` | `state='rejected',reviewed_at,reject_reason` | Requires review-pending; nonempty reason; separate statements; changes ignored |
| `lib/dispatch/queue.ts:846`, `settleStmt`; `settle`, `cancel` | `state,result_artifact,cost_usd,error_message,settled_at` | SQL only excludes settled/salvage. `settle` accepts any other source, including **failed**, and targets settled/failed/salvage. `cancel` has an earlier JS terminal check. Neither binds expected source revision |
| `lib/dispatch/queue.ts:891`, `requeueStrandedStmt`; `recoverStranded` | `state='proposed',worker_actor_id=NULL,launch_id=NULL,agent_id=NULL,transcript_id=NULL,model=NULL,session_id=NULL,started_at=NULL,error_message` | Selects eligible rows **outside** transaction; updates inside transaction using only ID and claimed/in-progress state. Does not repeat age, recovery-count, owner, or revision predicate. Leaves `worktree_path,branch,claimed_at,spawned_agent_id` intact |
| `lib/dispatch/queue.ts:905`, `salvageStrandedStmt`; `recoverStranded` | `state='salvage',error_message,settled_at` | Same preselected rows and state-only transaction guard |
| `lib/dispatch/queue.ts:1381`, `recordSpawnedAgent` | `spawned_agent_id` | Only `WHERE id=?`; no state, owner, generation, or revision check |
| `lib/harbormaster.ts:270`, `backDispatchToProduced` | `state='produced',error_message,produced_at` | PR10359 correctly uses `WHERE id=? AND state='accepted'`, checks one changed row. Still only state CAS, not approval-generation CAS |
| `lib/seed-berth-db.ts:139`, `seedBerthDbFromProd` | Copies entire DB, then deletes all `dispatches` via `DELETE FROM ${table}` | `EXECUTABLE_QUEUE_TABLES=['dispatches']`; target-presence/integrity checks; deletion is per-table, outside encompassing transaction; caller can disable scrubbing |

The fourteen queue UPDATE sites, explicitly enumerated, are: claim, release-unbound-auto-claim, prioritize-proposed-run, restore-prepared-run, start, bind-execution, produce, request-review, accept, reject, settle, requeue-stranded, salvage-stranded, and record-spawned-agent. The two INSERT sites are legacy migration and projection materialization.

Additional executable/database lifecycle surfaces:

| Source | Effect |
| --- | --- |
| `migrations/083_dispatches.sql:23–150` | `BEGIN IMMEDIATE`; creates dispatch/legacy schema and separately INSERTs legacy rows into dispatches. Independent migration writer, not just documentation |
| `migrations/088_dispatch_failover.sql` | Six ALTER statements. Header identifies queue constructor as actual runtime applier; still executable schema text that must be classified |
| `lib/db.ts:165`, `migrateLegacyRegistry` | `VACUUM INTO` copies all dispatch rows into a newly selected canonical database |
| `lib/backup.ts:268`, `restoreBackup` | Validates snapshot hashes, renames existing DB, writes complete snapshot bytes, integrity-checks. Can restore old dispatch states, revisions and any co-stored admission receipts |
| `scripts/db-consolidate.ts:635`, `applyConsolidationPlan` | Snapshots a selected source with VACUUM, archives destination, renames staged DB into canonical location. Checks precomputed open-daemon blockers, but replaces whole dispatch history |

No current dispatch-targeting FK cascade or trigger was found. Generic retention policies are currently registered for other tables. Harbor projection rebuilding targets `harbor_proj_*`, not dispatches. `scripts/registry-reunify.ts` writes roadmap tables only.

`public/fleet-ui/assets/*` is generated client output. Swift/Rust/web dispatch surfaces are HTTP clients or readers, not independent SQLite writers. `scripts/capture-roadmap-activity-evidence.ts` and `core/pd-console/docs/artifacts/gpui/proof-visual-task-lane/seed-visual-task-daemon.ts` are evidence/fixture producers using the queue; classify them explicitly instead of counting them as runtime SQL writers.

## Indirect mutation and effect callers

- `lib/agent-harbor/work-intent-service.ts:354`, `materializeDispatchProjectionFromIntent`, calls queue insertion; `start` and `captureDispatch` use it. `captureDispatch` persists intent and then materializes separately, without a transaction spanning both.
- `routes/dispatches.ts` supplies proposal, acceptance, rejection, cancellation and worker nudges.
- `cli/commands/dispatch.ts` constructs a writable database with default `initDatabase()` role; proposal/cancel/prepare/rollback are direct queue writes. `runDispatchViaDaemon` prepares locally, awaits HTTP, then can rollback.
- `cli/commands/review.ts` accepts/rejects and settles rejected rows.
- `cli/commands/morning.ts` and `cli/commands/sugar.ts` construct the queue, so even read-oriented use can run construction migrations.
- `lib/dispatch/worker.ts` recovers, claims, launches, settles on exceptions, and reaps worktrees.
- `lib/dispatch/runner.ts` claims, invokes an arbitrary supplied adapter, binds runtime IDs, mints failover successors, and settles.
- `lib/dispatch/conductor-adapter.ts` starts rows, calls Conductor, and asynchronously overwrites execution bindings.
- `lib/dispatch/spawn-adapter.ts` creates worktrees, disables guard configuration, spawns bodies, pushes branches, opens PRs, produces, requests review, and settles.
- `lib/harbormaster.ts` fetches/rebases/merges; conflict helper named `openConflictSubDispatch` currently only posts a note.
- `lib/dispatch/auto-merge.ts` checks GitHub state, merges, and deletes worktrees/branches using dispatch snapshots.

## Concrete stale authority and bypass findings

The following are source-established paths. Their proposed inert probes were not executed by this investigator.

### RED-01: Successful Harbormaster merges remain stale across awaits

`processCandidate` tests `c.dispatchState`/`c.status`, which are fields of an earlier selected object. After awaited fetch (`lib/harbormaster.ts:337`) and rebase (`:346`), it unconditionally calls `gh pr merge` (`:392`). Cancel during either await: dispatch becomes salvage, merge still executes. PR10359 repairs the conflict writer only.

**Probe:** cancel via the real queue inside an inert runner's fetch/rebase callback. **Required repaired observation:** zero merge calls. **Impact:** external merge can use revoked dispatch approval.

### RED-02: Auto-merge has no facility to check current dispatch authority

`checkAndCompleteDispatch(dispatch,opts)` (`lib/dispatch/auto-merge.ts:482`) receives no queue/DB. It checks merge policy and artifact, but not even snapshot state, then awaits PR info (`:507`) and merges (`:531`). A cancelled/rejected dispatch selected earlier still merges; directly calling the exported function with a salvage snapshot can also pass.

**Probe:** cancel during inert PR-info retrieval. **Required repaired observation:** zero merge/cleanup effects. **Impact:** merge and destructive cleanup can use stale authority through an alternate effect path.

### RED-03: Recovery produces executable ABA

Old runner A holds claimed row → recovery writes proposed → B claims and starts → A invokes `start(id)`. The API treats B's in-progress row as A's successful idempotent start. A can launch too and later overwrite B's runtime IDs or settle its row. This needs a run incarnation/lease token, not merely a state check.

**Probe:** retain A's claimed snapshot, execute actual recovery/reclaim/start for B, then invoke A's start/effect seam with an inert adapter. **Required repaired observation:** stale A refuses and B's row/bindings remain unchanged. **Impact:** duplicate execution and attribution corruption.

### RED-04: Recovery selection is stale before its transaction

`recoverStranded` selects rows outside the transaction. Another connection may finish, requeue, and reclaim a row before the transaction begins. Its update repeats only state membership; it can erase a newly current worker, use stale recovery-marker history, and report rows as recovered even when the update changed zero rows.

**Probe:** two-connection controlled interleaving after stranded selection, before recovery transaction. **Required repaired observation:** a new revision/lease is preserved and no false recovery result is reported. **Impact:** a live/newly admitted worker loses ownership and may be executed again.

### RED-05: Failover can create successors after cancellation/deletion

`attemptFailover` uses `queue.get(id) ?? claimed` (`lib/dispatch/runner.ts:527`); `decideFailover` ignores dispatch state. It awaits handoff generation (`:560`) then mints from the old snapshot (`:574`). Worker mint checks local runtime permission, not predecessor authority. Cancel during handoff—or delete the row before selection—and a successor can still be created.

**Probe:** cancel during inert handoff generation; separately remove the predecessor before failover selection. **Required repaired observation:** no successor is minted. **Impact:** rejected or missing predecessor authority can create fresh executable work.

### RED-06: Dispatch cancellation does not revoke Conductor work

Route cancel only calls `queue.cancel` (`routes/dispatches.ts:321`). Adapter starts the row then calls Conductor, which may await worktree creation. No dispatch-specific witness reaches the launch/body boundary. Conductor's existing halt machinery is a different state domain. Queue binding callbacks swallow exceptions, further preventing binding failure from acting as authorization refusal.

**Probe:** cancel dispatch during an inert delayed Conductor worktree/admission hook. **Required repaired observation:** no backend invocation; cancellation remains authoritative. **Impact:** cancellation can appear successful while a pending body still starts.

### RED-07: Inline adapter remains a bypassable alternate effect path

`createSpawnAdapter` creates a worktree before `queue.start`, and pushes/opens PRs after awaiting body execution without current dispatch checks. It is exported and is the worker's fallback default. Current CLI `--really-run` routes through daemon, so its header's standalone-CLI claim is stale; nonetheless the callable fallback remains real.

**Probe:** invoke adapter with inert worktree/spawn/PR dependencies; cancel before worktree/start and during spawn. **Required repaired observation:** effects after revocation refuse. **Impact:** a common boundary added only to the Conductor adapter leaves a callable effect path uncovered.

### RED-08: State-only conflict CAS is vulnerable to approval ABA

Accepted → conflict return to produced → review-pending → newly accepted allows an old accepted snapshot to satisfy Harbormaster's accepted-only CAS. Bind the exact reviewed artifact/head and approval generation, not only `state='accepted'`.

**Probe:** retain an old candidate, perform an actual approval cycle before its conflict callback writes. **Required repaired observation:** old candidate cannot overwrite the newly accepted generation. **Impact:** stale merge attempt consumes newer approval.

### RED-09: Settlement is broader than the table model

`settle` permits proposed/claimed/in-progress/produced/review-pending/rejected/failed → settled, plus failed → salvage. These edges are absent from the central table. Failed is terminal according to other APIs but deliberately mutable according to `settle`.

**Probe:** invoke each permitted source/target settlement pair on real isolated queue rows and compare actual state against the declared model. **Required observation:** every actual edge is classified, or the writer refuses it. **Impact:** a table-only reachability result omits executable transitions.

### RED-10: Berth scrub can resurrect legacy executable rows

Seeder deletes `dispatches` but preserves `nightshift_intents`. Queue construction immediately migrates missing legacy rows back into `dispatches`, including proposed/claimed/in-progress work.

**Probe:** seed a file-backed fixture containing both tables; confirm dispatches empty immediately after seeding, then construct the queue. **Required repaired observation:** executable legacy rows remain absent. **Impact:** a berth can inherit executable work despite its explicit scrub policy.

### RED-11: Copied databases invalidate row-revision-only freshness

Restore, legacy rescue, consolidation, and seeding can resurrect an older row and its old approval receipt together. A fresh row revision column alone cannot distinguish this storage incarnation. Either bind a new non-replayed execution epoch or invalidate all outstanding approvals on these boundaries.

**Probe:** preserve an admitted snapshot, mutate/revoke, then restore/copy the earlier database into a fresh execution context. **Required repaired observation:** the old admission cannot authorize an effect. **Impact:** storage rollback restores apparently fresh authority.

## Recommended independent fail-closed gate

Maintain a reviewed writer contract independent of the mutation implementation. Each entry should declare source symbol/site, target table, INSERT/UPDATE/DELETE/DDL/whole-DB operation, affected columns, precondition, revision/incarnation effect, abstract transition or justified stutter, and executable probe.

The discovery gate should:

- Inspect every tracked executable source and migration, not a hand-maintained list of known filenames.
- Parse SQL-bearing literals/templates and resolve bounded table-name selectors such as `EXECUTABLE_QUEUE_TABLES`.
- Fail on unclassified dynamic mutation targets, new DML sites, new `exec`/`prepare`/`query`/`RETURNING` paths, schema mutations, and whole-database copy/replacement code.
- Treat generated files and fixtures using an explicit path classification with checked source provenance.
- Include a mutation test adding an unknown direct dispatch writer outside the common module; CI must fail.
- Include raw SQL through a second connection, dynamic-table deletion, `.get()`/`.all()` UPDATE RETURNING, schema replacement, restore, and inline-adapter bypass probes. A wrapper around one queue object is insufficient.

The runtime binding should include at least database/execution incarnation, dispatch ID, row revision, run/lease identity, policy digest/version, model digest/version, operation/effect type, canonical effect parameters, and a one-use admission identifier. Consume it with the exact compare-and-set and durable effect intent in one synchronous SQLite transaction. Unknown/unsafe/incomplete checker output must refuse.

Exercise policy changes, model changes, metadata-only writes, state ABA, delete/reinsert, restore rollback, simultaneous consumers, cancellation during every await, checker errors, and transaction rollback. A state-preserving metadata write is a stutter only if the declared fact/policy abstraction is provably unchanged.

An atomic local admission/outbox commit does **not** make SQLite and an external GitHub/provider effect one transaction. Report the proven boundary honestly; effect execution needs its own final authority check and idempotency/receipt strategy.

## Existing primitives to reuse

- `lib/agent-run-receipts.ts:305,374`: canonical request hashing, UNIQUE idempotency key, atomic UPSERT RETURNING, conflicting replay refusal, persisted read-back.
- `lib/agent-harbor/work-intent-spawn.ts:31`: synchronous transaction composing admission receipt + WorkIntent + WorkPlan; useful pattern without importing its runtime.
- `lib/fleet/conductor.ts:606`: transaction composing policy checks, budget reservation and launch insertion. Reuse its transaction discipline; it currently does not bind a dispatch revision.
- `lib/sessions.ts:1687–1713`: `transaction(...).immediate()`, liveness checked inside transaction, verified persistence and post-commit projection separation.
- `lib/agent-harbor/event-ledger.ts`: append-only triggers, schema verification, canonical hashing and durable event identity.
- `lib/db.ts:584,597`: mutating-SQL classification and guarded execution methods, including RETURNING. Existing guard is a client-role guard, not complete dispatch mediation: database role defaults to daemon, maintenance bypass exists, independent handles/file replacement remain possible.
- `queue.claimProposed`, `nextProposed`, `restorePreparedRun`, and repaired Harbormaster changed-row CAS are useful local components, but none currently supplies policy/model/revision-bound admission.

## Handoff

This inventory is baseline source analysis, not executable conformance or deployed-runtime proof. The next RED worker should execute bounded probes with inert effects, record exact outcomes and distinguish confirmed failures from disproved candidates. No finding here authorizes starting the halted local runtime. The inventory's contract remains independent of WHITE implementation and BLUE acceptance work.
