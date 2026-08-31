I now have thorough, code-grounded knowledge of the L0 kernel. I'm ready to write the dossier.

# LAYER DOSSIER — L0: The Daemon (the Kernel)

> *Avatar of the rung that serves the machine.*
> **One-line:** L0 is the always-on, local-first, single-writer SQLite/WAL authority that gives every higher layer a single, durable, crash-safe source of truth for who-holds-what, who-is-alive, who-promised-what, and what-actually-happened — and the runtime monitor (Arbiter) that makes a small set of forbidden coordination states physically unreachable.
> **Honest header (ADR-0045 key):** `BUILT` · `BUILT-WEAK` · `DESIGNED` · `VISION`. The code is the source of truth for this layer; every claim below is labeled against the shipped tree at `lib/*.ts`.

---

## 0. Framing: what "the kernel" actually means here

The North Star (ADR-0048) calls L0 "the daemon … the machine's layer." That is correct but undersells the *load-bearing* claim. L0 is not "the database." L0 is the **reference monitor + system of record** for a swarm: the one process that mediates contended resources, the one file that survives every agent's death, and the one place where "true" is decided rather than asserted. Everything L1 (protocol), L2 (legibility), and L3 (economy) say is only as trustworthy as L0's promise that *a write that returned success is durable, and a state the Arbiter forbids cannot exist.* Those two promises are the kernel's entire job. The rest is convenience.

The right mental model is **a single-writer transactional reference monitor**, in the Lampson/Anderson sense (a small, always-invoked, tamper-evident mediator of every security-relevant operation), realized as a local daemon over SQLite-in-WAL. It is deliberately *not* a distributed consensus system at L0 — there is one writer, one machine, one file. (Distribution is an L3 concern: harbors, gossip, revocation. Pushing Raft/CRDTs down into L0 would be the wrong layer and is explicitly out of scope here.)

---

## 1. The complete idea-space — the full set of primitives, mechanisms, obligations, and claims L0 must own

Organized into seven *organs*, each a contract the kernel must hold for the stack above to be coherent. The seeds named a flat list ("ports, claims, sessions, tube, pheromones, commitments, Arbiter, memory"); this is the spanning set, with the connective tissue the seeds left implicit.

### 1.1 The substrate organ — durable single-writer state
The bedrock that everything else is just a table in.
- **Storage engine duality** (`lib/sqlite-runtime.ts`): one `DatabaseInstance` API satisfied by *two* runtimes — `better-sqlite3` (Node/jest/dev) and `bun:sqlite` (the compiled single-binary daemon). This is a real, shipped, non-obvious kernel property: **the runtime under which truth is computed is not the runtime under which it is tested**, and a pragma/option shim (`executeBunPragma`, `translateBunOptions`) bridges the gap. Any L0 claim must be true under *both* runtimes or it is a lie (the bun-vs-jest 500 class of bugs).
- **WAL discipline** (`lib/db.ts`): `journal_mode=WAL`, `synchronous=NORMAL`, `wal_autocheckpoint=200`, `busy_timeout=5000`, `foreign_keys=ON`, clean-shutdown `wal_checkpoint(TRUNCATE)`. The kernel's durability claim *is* this pragma set; the claim "a write that returned success survives a crash" reduces to WAL crash-safety.
- **Schema idempotence**: every module self-initializes with `CREATE TABLE IF NOT EXISTS` + lazy `ALTER TABLE` migrations. There is no migration sequencer; the schema is the union of what each `createFoo(db)` factory declares. This is a design *choice* with a real cost (see §3, schema-drift).
- **Path/ownership invariants**: DB resolves to a single canonical path; `chmod 0o600` (the DB carries the Ed25519 Harbor-Card signing key in plaintext — a same-machine secret); the fail-closed `assertNotProdInTest` guard (Rails `ProtectedEnvironment` analogue) that refuses to open the live registry from a test context.
- **The single-writer invariant itself** — *named explicitly*: concurrency across many CLI invocations + the daemon is serialized by SQLite's file lock + `busy_timeout`, not by application logic. The seeds never state this; it is the reason L0 needs no consensus protocol.

### 1.2 The resource organ — ports & claims (the original sin, the namesake)
- **Port allocation** (`lib/services.ts`): claim a port for a service, idempotent re-claim (returns existing), TTL/expiry, `restart_policy`, OS-level `isPortAvailable()` bind-test, `systemPorts` exclusion, port-takeover (`lib/port-takeover.ts`). This is the literal "Port Daddy."
- **File/region/symbol claims** (`session_files`: `file_path`, `start_line`, `end_line`, `symbol`, `symbol_path`): the *edit-surface* claim that prevents two agents writing the same file. The seeds say "claims"; the kernel actually distinguishes **whole-file vs. line-range vs. symbol-path** granularity — the substrate for the "reserve functions+regions not whole files" vision (MEMORY: Single Approver Agent).
- **Generic mutexes** (`lib/locks.ts`): named locks with owner, PID, TTL (default 5min, max 1hr, `ttl<=0 → default`), wildcard release, owner-scoped release, expiry sweep, `with-lock`. The general-purpose mutual-exclusion primitive under the named claims.
- **The claim contract** (must be stated as a theorem): *acquire is atomic and exclusive* (SQLITE_CONSTRAINT on PK race → loser sees the holder), *re-claim is idempotent*, *release is idempotent*, *expiry is lazy-swept on every read*. These are the four properties L1 builds typed ownership on.

### 1.3 The identity organ — who is asking
- **Semantic identity** (`lib/identity.ts`): `project:stack:context`, ≤3 segments, pattern matching, SQL-glob translation, normalization with defaults. The *addressing* scheme for everything (claims, sessions, resurrection, messages).
- **Agents/actors** (`lib/agents.ts`, `lib/actor-roster.ts`): registration, heartbeat (`POST /agents/:id/heartbeat`), capability sets, liveness.
- **The honest gap, named once**: actor identity at L0 today is **self-asserted** — `owner_actor_id` is whatever the session claims. ADR-0040 (non-forgeable Ed25519 identity) is the keystone that turns self-assertion into proof. L0 *ships the signing substrate* (keychain, `coordination-crypto.ts`, Harbor-Card keys) but does not yet *gate* writes on verified identity. This is the single highest-leverage unbuilt thing at L0 (see §6).

### 1.4 The communication organ — the bus
- **Tube** (`lib/tube.ts`): pub/sub over `messages` table + `/msg/:channel`, versioned envelope (`buildEnvelope`, `inReplyTo`, `decodeMessage`), file/in-memory history stores, sender synthesis, message TTL/expiry. The seeds list "tube" flatly; the kernel ships the **envelope versioning + history-cursor** that L1's typed performatives ride on.
- **Tuple space** (`lib/tuples.ts`): Linda-style coordination tuples, harbor-scoped, TTL-swept. Durable shared blackboard cells.
- **Pheromones** (`lib/pheromone.ts`): stigmergic floats in entity metadata, per-kind exponential decay (`decayRate^intervals`), background evaporation tick **and** read-time decay (`decayOnRead` — accurate without waiting for the tick), threshold-pruning below 0.01. This is the kernel mechanism that ADR-0047 cites as the *structural* defense against blackboard-rot.
- **Inboxes & messaging** (`lib/agent-inbox.ts`, `lib/messaging.ts`): directed actor-to-actor delivery; the request/response and steering substrate.
- **IPC transport** (`lib/ipc-*.ts`): a *second* transport — binary framing over a Unix domain socket (`/tmp/port-daddy.ipc`) alongside the HTTP socket, with peer-credential auth, backpressure/draining. The kernel has a high-frequency path the seeds never mention.

### 1.5 The obligation/enforcement organ — the sovereign's two arms
This is the deontic core, and it is genuinely two distinct mechanisms (Jones & Sergot):
- **Regimentation → the Arbiter** (`lib/arbiter.ts`): a runtime monitor subscribed to the activity log, checking every transition against six rules (`PID_SQUATTING`, `CAP_ESCALATION`, `NOTE_MONOTONICITY`, `ESCROW_POSITIVE`, `LOCK_OWNER_VALID`, `HEARTBEAT_FRESHNESS`) across three actions (LOG always / ALERT in observe mode / HALT→man-overboard in strict mode). Crucially, the Arbiter is **a runtime reference monitor, not a static type system** — it makes forbidden states *detected-and-reverted/halted*, which is weaker than "physically unreachable" for most rules (see §3, §6). One rule (`CAP_ESCALATION`) is enforced by a **Rust FFI core** (`libharbor_card_rs`) with checksum-verified embedding; the rest are TS-runtime; some degrade to `stubbed` when the enforcer is absent. The kernel is *honest about its own enforcement coverage* — `ArbiterStatus` reports enforced/degraded/stubbed counts.
- **Enforcement → commitments** (`lib/commitments.ts`, `lib/obligation-monitor.ts`): durable, *violable* promises (Cohen & Levesque "intention as persistent goal"). The five hardening laws, two shipped: **Law 1** — `due_at` is daemon-derived from a scope policy, *never* agent-supplied (Goodhart-resistance); **Law 2** — `close()` refuses 'done' without a non-empty `closed_by_oracle_ref` (a released claim, a merged SHA, a passing test id, a satisfied Arbiter sub-check). Free-text notes cannot close a commitment. State machine: `open → done|abandoned|superseded`, single-minded vs. open-minded drop strategies.
- **The split, stated as the kernel's deontic theorem**: *prohibition* is regimented (Arbiter), *obligation* is enforced (commitment + monitor), *permission* is a recorded capability. L1's deontic binding (ADR-0047 §4) is a direct lift of this L0 split.

### 1.6 The continuity organ — memory & resurrection (the foundation of the entire economy)
The through-line of ADR-0048 ("memory → continuity → person → reputation → market") *bottoms out here.* If L0's continuity is weak, L3 is built on sand.
- **Sessions & notes** (`lib/sessions.ts` — the largest module, 69k): lifecycle (active/done), phases, append-only `session_notes` (the durable handoff record), file claims, scope notes. NOTE_MONOTONICITY (Arbiter) guards that an active session's note count never regresses — *the kernel forbids amnesia.*
- **Resurrection** (`lib/resurrection.ts`): heartbeat-watchdog → stale/dead detection → resurrection queue (per project/stack/context), man-overboard salvage trigger. **Honest label (BUILT-WEAK, and the user is explicit about this):** resurrection *passes notes*, it does not checkpoint execution state. "Resurrection with teeth" (ADR-0048's through-line) is the *gap* between this and real checkpointing.
- **Episodic memory** (`lib/episodic-memory.ts`): durable story-beats keyed by source/agent/project, dedup index. The substrate for L2 read-surfaces and L3 outcome-history.
- **Activity log** (`lib/activity.ts`): the append-only event stream the Arbiter subscribes to — the kernel's *audit organ*, and the thing that makes "what actually happened" answerable.
- **Merkle chaining** (`lib/merkle-chain.ts`, `lib/merkle-tree.ts`): tamper-evident hash-chaining over the audit log — the substrate that turns "we logged it" into "we can *prove* the log wasn't edited," which is what L3 reputation needs.

### 1.7 The self-attestation organ — honest green (ADR-0045 lives at L0)
- **Invariant registry + `pd attest`** (`lib/attest.ts`, `lib/attest-invariants.ts`): each invariant returns `PASS|FAIL|SKIPPED(reason)|UNKNOWN`; the report is *scoped and conjunctive* ("all good" only when every checked invariant passes, and it always prints what was *not* checkable). Three triggers: boot regimentation (refuse-to-serve on CRITICAL fail), CLI pre-flight (loud refusal naming the fix), continuous watchdog (PASS→FAIL → pheromone + notification). Clean reports signable with actor identity → **non-repudiable green**.
- **Drift/liveness guards** (`lib/binary-drift-detector.ts`, `lib/cli-liveness.ts`, `lib/bosun-heartbeat.ts`, `lib/git-origin-check.ts`): the homebrew-vs-repo install trap, version match, supervisor liveness. The kernel must know *which copy of itself is the real one.*
- **The claim L0 must make about itself**: the kernel is the one component that can honestly report its own integrity, because it is always-on and owns the only writable truth. Self-attestation is therefore an L0 organ, not an L2 dashboard feature.

---

## 2. The kernel's invariants, stated as theorems (the formal spine of the L0 paper)

A completionist treatment names the properties as provable claims, each with its mechanism and honest label:

| # | Invariant (theorem) | Mechanism | Honest label |
|---|---|---|---|
| I1 | **Durability**: a write that returns success survives process crash | WAL + `synchronous=NORMAL` | BUILT |
| I2 | **Mutual exclusion**: at most one holder per (port \| file-region \| lock) at any instant | PK constraint + atomic insert + `busy_timeout` serialization | BUILT |
| I3 | **Idempotence**: re-claim/re-release are safe to retry | COALESCE upsert / delete-if-exists | BUILT |
| I4 | **Liveness reclamation**: every claim/lock/lease has a TTL and is swept | lazy expiry sweep on read + background ticks | BUILT |
| I5 | **Goodhart-resistance**: an agent cannot set its own deadline | Law 1, daemon-derived `due_at` | BUILT |
| I6 | **Oracle-bound closure**: a promise cannot be marked done without external evidence | Law 2, `closed_by_oracle_ref` | BUILT |
| I7 | **No-amnesia**: an active session's durable note history is monotone | Arbiter NOTE_MONOTONICITY | BUILT-WEAK (runtime-detected, not regimented) |
| I8 | **Forbidden-state unreachability** (capability escalation, PID squatting, double-claim) | Arbiter rules | BUILT-WEAK in observe mode; only HALTs in strictMode; one rule is FFI, others degrade-to-stub |
| I9 | **Tamper-evidence**: the audit log cannot be silently rewritten | Merkle chain | BUILT-WEAK (chain exists; verification not yet gating reads everywhere) |
| I10 | **Honest self-report**: "all good" ⇒ every checked CRITICAL invariant passed, with the unchecked set enumerated | `pd attest` scoped report | BUILT |
| I11 | **Runtime parity**: every invariant holds under both `bun:sqlite` and `better-sqlite3` | sqlite-runtime shim + CI must boot the bun daemon | BUILT-WEAK (the shim is real; CI parity is the recurring failure) |
| I12 | **Non-forgeable identity**: a write is attributable to a cryptographically verified actor | ADR-0040 | DESIGNED (substrate present, gating absent) |

This table *is* the formal core of the L0/Anchor paper. The honest-label column is the ADR-0045 discipline turned on the theorems themselves.

---

## 3. Gaps the seeds missed (concrete, completionist)

The seed framing was a flat noun-list. A complete L0 treatment must add:

1. **The single-writer assumption is unstated and load-bearing.** The seeds never say *why* L0 needs no consensus. The answer — one machine, one writer, SQLite file-lock serialization — is the cleanest thing about the layer and the sharpest contrast with L3. It must be stated as a first-class design decision (and its boundary: the instant a *second* daemon touches the same truth, you are at L3 and the assumption breaks).

2. **The dual-runtime substrate is a real kernel property, not an impl detail.** "Truth is computed under bun:sqlite in prod but verified under better-sqlite3 in test" is a genuine soundness hazard with a shipped mitigation (the shim) and a shipped failure history (green-in-jest, 500-in-bun). A paper that omits this is dishonest about how the kernel is actually built.

3. **Claim granularity is richer than "claims."** Whole-file / line-range / symbol-path claims already exist in `session_files`. This is the substrate for the entire "reserve regions not files" research direction and the semantic-conflict-prediction work (`lib/symbol-index.ts`, tree-sitter). The seeds collapsed three primitives into one word.

4. **Two transports, not one.** HTTP-over-Unix-socket *and* binary-IPC-over-Unix-socket (`lib/ipc-*.ts`) with peer-cred auth and backpressure. The high-frequency path matters for the living-harbor viz and for any agent doing tight-loop coordination.

5. **The Arbiter's enforcement is a *spectrum*, not a binary.** Rules are `enforced | degraded | stubbed`; engines are `runtime | ffi | stub`; modes are `observe | strict`. "The Arbiter makes forbidden states unreachable" (ADR-0045 phrasing) is true *only* for strictMode + loaded-FFI + the regimentable rules. Most rules in the default config *detect and alert*, they do not *prevent*. This must be stated precisely or it over-claims.

6. **Closure oracles are a small, enumerable set — and that set is the kernel's honesty boundary.** Law 2 admits exactly: released-claim, merged-SHA, passing-test-id, satisfied-Arbiter-subcheck. Anything outside that set cannot close a promise. Naming the oracle vocabulary is naming the limit of what L0 can mechanically verify (it cannot verify "the refactor is good," only "the test the agent named passed").

7. **Continuity is weaker than the through-line implies, and the gap is precisely "notes vs. checkpoint."** ADR-0048 leans the *entire L3 economy* on "checkpoint (resurrection with teeth)." The shipped resurrection passes notes. The honest paper must mark this seam loudly: the economy's foundation has a known soft spot, and "teeth" = real execution-state checkpointing, which is unbuilt.

8. **Merkle tamper-evidence exists but is not yet a gating invariant.** The chain is built; nothing yet *refuses to serve* on a broken chain. Tamper-evidence that isn't checked on the read path is documentation, not enforcement.

9. **Schema has no sequencer.** Idempotent `CREATE TABLE IF NOT EXISTS` + ad-hoc `ALTER TABLE` is elegant for greenfield and a latent hazard for rename/backfill/multi-column migrations. There is no down-migration, no version table, no ordering guarantee across modules. This is a real open problem (§6).

10. **Backpressure, fairness, and starvation are unaddressed.** Locks have TTL but **no queue and no fairness** — acquisition is racy-first-come; a slow agent can be starved indefinitely while fast agents churn a hot file. There is no priority, no FIFO wait-list, no anti-starvation. The seeds say "claims" as if exclusion were the whole story; *fair* exclusion is missing.

11. **No transactional cross-organ atomicity is guaranteed at the API boundary.** "Claim this port AND open this session AND record this commitment" is three writes; nothing wraps them in one SQLite transaction at the kernel boundary. Partial-failure semantics across organs are undefined.

12. **Clock trust.** Every TTL, deadline, decay, and heartbeat-freshness check trusts `Date.now()` on one machine. Fine at L0 (single machine), but the *assumption* must be named, because it is exactly what breaks at L3 federation (no shared clock).

---

## 4. Open problems (these become starred exercises in the paper)

★ **OP-1 — Fair exclusion without a scheduler.** Can L0 add anti-starvation (a bounded-wait guarantee) to claims/locks while keeping the single-writer, no-background-scheduler simplicity? Is a SQLite-backed FIFO wait-list with TTL'd reservations enough, or does fairness force a real scheduler (and thus push L0 toward L1)?

★ **OP-2 — Regimentation vs. enforcement boundary.** Which of the six Arbiter rules are *truly* regimentable (forbidden-state-unreachable, prevented before commit) vs. only enforceable (detected-after, reverted/halted)? Formalize the boundary. PID_SQUATTING and double-claim look regimentable (reject at insert); CAP_ESCALATION needs the FFI; HEARTBEAT_FRESHNESS is intrinsically observe-only. A clean theorem here is the deontic heart of the layer.

★ **OP-3 — Cross-runtime soundness as a proof obligation.** Can we *prove* (not just test) that the bun:sqlite and better-sqlite3 paths are observationally equivalent for the invariant set? What is the minimal differential-test suite that would make I11 a theorem rather than a hope?

★ **OP-4 — Checkpoint with teeth.** What is the minimal durable artifact that turns "resurrection passes notes" into "resurrection restores work"? Is it a content-addressed snapshot of {working-tree diff + open claims + commitment set + last-N transcript turns}? What is recoverable vs. fundamentally lost when an LLM agent dies mid-thought? (This is the literal foundation of the L3 economy — it is the most important open problem at L0.)

★ **OP-5 — Oracle completeness.** The Law-2 oracle set is finite. Which real "done" conditions does it *fail* to capture, and is there a principled way to extend it without re-admitting free-text (i.e., without re-opening the Goodhart hole)?

★ **OP-6 — Tamper-evidence on the read path.** Where, exactly, should Merkle verification gate? Verifying every read is too slow; verifying never is theater. Is there a sampling/checkpoint-verification regime with a provable detection-probability bound?

★ **OP-7 — Schema evolution without a sequencer.** Can idempotent self-init be extended to safe renames/backfills/down-migrations while preserving the "any module can create its own tables in any order" property? Or is a version table unavoidable?

★ **OP-8 — Pheromone decay calibration.** Decay rate and interval are global constants. What is the right per-kind decay so that stigmergic signals neither rot (stale guidance) nor evaporate before they coordinate? This is an empirical-systems question (and the structural anti-blackboard-rot claim depends on the answer being *right*, not just present).

★ **OP-9 — Same-machine adversary.** The DB is `0600` but plaintext; the FFI enforcer is materialized to a temp file. The threat model explicitly excludes a same-user process adversary. What is the minimal hardening (OS keychain for the signing key, sealed memory) that closes this without a TPM dependency?

---

## 5. Adjacency contract (the consistency guarantee)

### What L0 ASSUMES from below (the machine / OS):
- A POSIX filesystem with working `flock`/`fcntl` advisory locking (SQLite's correctness rests on this; networked filesystems void the warranty).
- A monotonic-enough local wall clock (`Date.now()`); single-machine, no shared-clock assumption needed.
- Unix domain sockets + peer-credential auth available (the IPC and HTTP transports).
- An OS keychain reachable for signing keys; `chmod` honored on the DB path.
- A supervisor (launchd / bosun) to keep the daemon always-on and to resurrect *the daemon itself* — L0 makes other things always-on but cannot make *itself* always-on; that is delegated downward.

### What L0 PROVIDES to L1 (the protocol / agents) — the kernel API contract:
- **Atomic, idempotent, TTL'd claims** (I2–I4) over ports, file-regions, symbols, and named locks — L1's typed ownership (`escalate`/`finalize` clearing a lane) reduces to L0 claim release.
- **A durable, versioned, history-cursored pub/sub bus** (tube) + tuple space + decaying pheromones — L1's typed performative envelope is *carried in* L0's tube envelope; L1's blackboard pattern *is* L0 pheromones; the anti-blackboard-rot property is *provided by* L0 decay.
- **The deontic split as a primitive**: prohibition→Arbiter, obligation→commitment, permission→capability. L1's ADR-0047 §4 is a direct binding to these L0 organs; L1 must not re-implement enforcement.
- **Daemon-owned deadlines and oracle-bound closure** (I5, I6) — L1's commitment lifecycle/quiescence-termination relies on L0 owning `due_at` and refusing un-oracled closure.
- **An append-only, Merkle-chained audit log** — L1's delegation-chain loop-detection and L2's "what happened" digest both read this stream; L0 guarantees append-only + tamper-evidence.
- **Self-attestation** (`pd attest`, I10) — L1/L2 may *assume the kernel is honest about its own health* rather than re-deriving it.
- **Semantic-identity addressing** (`project:stack:context`) — the namespace every L1 message, claim, and delegation chain is keyed on.

### The explicit non-provisions (so higher layers don't over-assume):
- L0 does **not** provide non-forgeable identity yet (I12 = DESIGNED). L1/L3 claims that need it must say so in one clause (per the nomenclature key, ADR-0040 is the "highest-leverage unbuilt keystone").
- L0 does **not** provide fair/queued exclusion (OP-1), cross-organ transactional atomicity (§3.11), real execution-checkpoint (OP-4), or any cross-machine guarantee (that is L3 — different theorems, different failure modes, a shared-clock and Byzantine-membership problem L0 deliberately never touches).
- L0 does **not** decide *what to do* (no orchestration) — it enforces what *can't* be done and records what *did* happen. (The "building department, not architect" model — orchestration is an L1/L2 plugin.)

---

## 6. Prior art to cite (author + year + one-line relevance)

**Storage, durability, single-writer:**
- **Gray & Reuter, 1992** — *Transaction Processing.* ACID, durability, write-ahead logging; the formal ground for I1.
- **Mohan et al., 1992 (ARIES)** — WAL recovery algorithm; what SQLite's WAL mode descends from; the durability/checkpoint mechanism.
- **Hipp / SQLite WAL design docs, 2010** — the specific WAL semantics PD's I1/I4/I11 rest on; single-writer-multiple-reader concurrency.
- **Kleppmann, 2017** — *Designing Data-Intensive Applications.* The single-leader vs. distributed framing that justifies "L0 = one writer, no consensus; distribution is L3."

**Reference monitors, regimentation, capability security:**
- **Anderson, 1972 / Lampson, 1974** — the *reference monitor* concept: always-invoked, tamper-evident, small mediator — the precise abstraction the Arbiter instantiates.
- **Jones & Sergot, 1993** — *On the characterisation of law and computer systems (deontic logic).* The regimentation-vs-enforcement distinction that is L0's deontic core (Arbiter vs. commitment monitor). Already the canon cite in ADR-0045/0047.
- **Saltzer & Schroeder, 1975** — protection design principles (least privilege, complete mediation, fail-safe defaults); CAP_ESCALATION + the `0600`/fail-closed guards are these principles applied.
- **Schneider, 2000** — *Enforceable security policies (security automata).* Which policies a runtime monitor *can* enforce vs. cannot — directly answers OP-2 (regimentation boundary).

**Commitments, obligation, intention:**
- **Cohen & Levesque, 1990** — *Intention is choice with commitment.* The persistent-goal model the commitment state machine literally implements (single-/open-minded drop). Cited in `commitments.ts`.
- **Castelfranchi, 1995** — *Commitments: from individual intentions to groups and organizations.* Social commitment; the bridge from L0 commitments to L1 multi-agent obligation.

**Stigmergy / coordination primitives:**
- **Grassé, 1959** — *stigmergy* (the original term); the principle pheromones implement.
- **Gelernter, 1985** — *Generative communication in Linda (tuple spaces).* The direct ancestor of `lib/tuples.ts`; decoupled coordination via shared associative memory.
- **Dorigo & Di Caro, 1999** — ant-colony optimization / pheromone decay; the calibration question of OP-8.

**Tamper-evidence / audit:**
- **Merkle, 1987** — hash trees; the basis of `merkle-tree.ts`/`merkle-chain.ts` and I9.
- **Haber & Stornetta, 1991** — *How to time-stamp a digital document* (hash-chained logs); the append-only tamper-evident ledger pattern, pre-blockchain, exactly L0's audit organ.

**Liveness / failure / why L0 stays single-machine:**
- **Fischer, Lynch & Paterson, 1985 (FLP)** — impossibility of deterministic consensus with one faulty process; the formal reason consensus is *deliberately not* an L0 problem (one writer ⇒ no consensus) and becomes hard only at L3.
- **Chandra & Toueg, 1996** — failure detectors; the theory behind heartbeat-freshness/resurrection (you cannot distinguish slow from dead — why HEARTBEAT_FRESHNESS is intrinsically observe-only, OP-2).
- **Lamport, 1978** — clocks/ordering; the assumption L0 *gets away with* (one clock) and L3 *cannot*.

**Self-healing / always-on:**
- **Kephart & Chess, 2003** — *The vision of autonomic computing* (self-configuring/healing/protecting). The framing for resurrection + watchdog + `pd attest` as the kernel's autonomic loop.

---

## 7. Honest state — per major claim (ADR-0045 discipline)

| Claim / mechanism | Module(s) | Honest label | Caveat |
|---|---|---|---|
| Always-on local daemon, SQLite/WAL source of truth | `db.ts`, `sqlite-runtime.ts` | **BUILT** | Dual-runtime; CI must boot the bun daemon to keep parity honest |
| Port claims (idempotent, TTL, restart policy, OS bind-test) | `services.ts`, `port-takeover.ts` | **BUILT** | — |
| File / line-range / symbol-path claims | `sessions.ts` (`session_files`), `symbol-index.ts` | **BUILT** | Symbol-granular claims exist; "reserve regions not files" workflow is L1/L2 vision |
| Named locks (TTL, owner, wildcard, expiry sweep) | `locks.ts` | **BUILT** | No fairness/queue/anti-starvation (OP-1) |
| Sessions + append-only notes + phases | `sessions.ts` | **BUILT** | The continuity substrate; large module |
| Tube pub/sub (versioned envelope, history cursor, TTL) | `tube.ts` | **BUILT** | Bodies untyped at L0; typing is L1 (ADR-0047) |
| Tuple space (harbor-scoped, TTL) | `tuples.ts` | **BUILT** | — |
| Pheromones (per-kind decay, read-time + background) | `pheromone.ts` | **BUILT** | Global decay constants; calibration open (OP-8) |
| Binary IPC over Unix socket (peer-cred auth, backpressure) | `ipc-*.ts` | **BUILT** | Second transport; under-documented in the seeds |
| Commitments — Law 1 (daemon-owned deadline) | `commitments.ts` | **BUILT** | — |
| Commitments — Law 2 (oracle-bound closure) | `commitments.ts` | **BUILT** | Oracle vocabulary is finite (OP-5) |
| Obligation monitor (breach detection, dedup) | `obligation-monitor.ts` | **BUILT** | — |
| Commitment Laws 3–5 (sanction ladder, accountability ledger, non-forgeable id) | — | **DESIGNED** | Explicitly out of scope in the module header |
| Arbiter — observe mode (LOG/ALERT), 6 rules | `arbiter.ts` | **BUILT** | Most rules detect, do not prevent |
| Arbiter — strict mode (HALT → man-overboard) | `arbiter.ts` | **BUILT-WEAK** | Off by default; "unreachable" only holds in strict + loaded-FFI |
| Arbiter CAP_ESCALATION via Rust FFI core | `arbiter.ts`, `dist/core` | **BUILT-WEAK** | Degrades to `stubbed` when enforcer absent; honest self-report of coverage |
| Resurrection (heartbeat → stale/dead → queue → man-overboard) | `resurrection.ts` | **BUILT-WEAK** | **Passes notes, not checkpoints** — the user's explicit caveat; "teeth" = OP-4 |
| Episodic memory (durable beats, dedup) | `episodic-memory.ts` | **BUILT** | Read-surfaces that consume it are L2 |
| Activity log (append-only event stream) | `activity.ts` | **BUILT** | The Arbiter's input + the audit organ |
| Merkle tamper-evident chaining | `merkle-chain.ts`, `merkle-tree.ts` | **BUILT-WEAK** | Chain built; not yet a gating read-path invariant (OP-6) |
| `pd attest` — scoped honest-green self-report | `attest.ts`, `attest-invariants.ts` | **BUILT** | The ADR-0045 surface; boot/preflight/watchdog triggers per phase matrix |
| Binary-drift / install-path / version-match guards | `binary-drift-detector.ts`, `cli-liveness.ts`, `git-origin-check.ts` | **BUILT** | The homebrew-vs-repo trap is a known live hazard |
| Fail-closed prod-DB-in-test guard | `db.ts` (`assertNotProdInTest`) | **BUILT** | Rails-ProtectedEnvironment analogue |
| DB `0600` perms; signing key plaintext-at-rest | `db.ts`, `keychain.ts`, `coordination-crypto.ts` | **BUILT-WEAK** | Same-user adversary explicitly out of threat model (OP-9) |
| Non-forgeable actor identity (gating writes) | ADR-0040 | **DESIGNED** | Substrate present (keychain, crypto, Harbor-Card keys); not gating; the highest-leverage L0 keystone (I12) |
| Single-writer / no-consensus design | (architecture) | **BUILT** (as a property) | Holds by construction on one machine; *boundary*: breaks the instant a second daemon shares truth → that is L3, not L0 |
| Cross-organ transactional atomicity at the API boundary | — | **VISION** | Not guaranteed; partial-failure semantics undefined (§3.11) |
| Real execution checkpoint / "resurrection with teeth" | — | **VISION** | The single most important unbuilt L0 thing; the literal foundation of the L3 economy (OP-4) |

---

### Through-line coherence note (for the stitch editor)
L0's job ends exactly where trust must cross a boundary the machine doesn't own. Every "single-machine / one-writer / one-clock / self-asserted-identity" simplification that makes L0 clean is precisely the assumption L3 must pay to relax (consensus, gossip, escrow, non-forgeable identity, shared time). The two genuinely soft spots at L0 — **non-forgeable identity (I12, DESIGNED)** and **checkpoint-with-teeth (OP-4, VISION)** — are *also* the two things ADR-0048's economy leans on hardest. So the most honest sentence the L0 paper can hand upward is: **the kernel is solid where it is local and provisional exactly where the economy will need it to be cryptographic and continuous.** That is not a flaw to hide; it is the layer boundary, stated truthfully.",