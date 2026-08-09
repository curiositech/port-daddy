# Rust Kernel Scope — What Gets Built, What Gets Ported, What Gets Killed

**Status:** Proposal. **Author:** dispatched per operator directive ("bring the Rust kernel
in... prescribe what functionality should be built there from the binder, and what of our
current JS code should be ported to it. Don't be shy."). **Grounding:** a citation-backed
audit of `docs/architecture/agent-harbor-technical-binder/` against the actual state of
`core/kernel/*`, `core/harbor-card-rs`, and the TS estate (`lib/`, `routes/`, `cli/`) —
every claim below traces to a file:line, not a vibe.

This is a prescription, not a survey. It ranks work by evidence, not by fairness to every
crate that currently exists.

---

## The headline verdict

The Rust kernel is not under-scoped. It's under-*used*. Two of eight kernel crates have a
real `extern "C"` boundary; of those two, only one has a live caller. The other six are
either genuinely internal-only (fine) or dead scaffolding that nothing imports (not fine —
this is exactly the "potemkin" pattern we don't ship elsewhere in this repo, and Rust code
doesn't get a pass just because it compiles).

Meanwhile the binder's own highest-stakes performance language — hard p95 budgets on the
hot/cool bus — has **zero substrate commitment**. Nobody has said what implements the
250ms/100ms/10ms/25ms/500ms numbers. That's the actual gap worth building for, not another
speculative crate.

Priority order, in one line each:

1. **Wire the macaroon verify path** — 30 minutes of caller-swap, zero new Rust, closes the
   last unwired half of a crate that's already fully built and fully FFI-wrapped.
2. **Kill or commit** `pd-core`/`pd-eventlog`/`pd-mesh`/`pd-runtime` — four crates, zero
   FFI surface, zero callers, unclear purpose. Pick a real owner and a real consumer for
   each, or delete them.
3. **Port `transcript-search.ts`'s BM25/RRF loop to Rust** — the one clean, CPU-bound,
   currently-pure-TS, self-documented-as-load-bearing greenfield target in the whole
   estate.
4. **Build the hot/cool bus in Rust**, in-process inside the daemon, to actually hit the
   binder's own p95 numbers instead of leaving them as unenforced aspiration.
5. **Port tree-sitter file-preview parsing to Rust** — binder proposes it, tree-sitter's
   canonical binding is Rust, and doing it any other way means fighting the ecosystem.
6. **Explicitly do NOT port** the coordination guard's decision logic, sessions/claims,
   spawner, or the squid harness — named here so nobody "fixes" them into Rust and finds
   out the bottleneck was never the language.

Detail on each below, then a phased sequence.

---

## 1. Finish what's already paid for: wire `pd_macaroon_verify_json`

**Evidence:** `core/kernel/pd-anchor/src/ffi.rs:76` exports `pd_macaroon_verify_json`.
`lib/macaroon-ffi.ts` is a complete, correct koffi loader for it — candidate-path
resolution, graceful fallback, the works. It has **zero importers** anywhere in `lib/` or
`routes/`. The live verify path is pure-TS `verifyPushGrant()` in `lib/macaroon/gate.ts:36`.

This is the same shape of gap PR #3828 just closed for the CPM scheduler
(`pd_schedule_dag_json` was built, wrapped, and uncalled — now it's live, once #3828
lands, in `routes/roadmap.ts` via `lib/planner-schedule-ffi.ts` (PR #3828, not yet shipped)).
Do the exact same thing to the macaroon path: write `lib/macaroon-verify-ffi.ts` (proposed
— not yet shipped), mirroring `lib/planner-schedule-ffi.ts` (PR #3828, not yet shipped)'s
kernel-preferred/TS-fallback pattern, swap `gate.ts`'s import, keep the TS implementation
as the fallback (never delete it — it's the CI-safe path when the dylib isn't built).

**Why this is priority 1, not priority 5:** every other item on this list is new work.
This is zero new Rust, a few hours of TS, and it turns a fully-built security-critical
crate from "compiled but inert" into "actually protecting something." There is no
argument for leaving free, already-audited work on the table while chasing greenfield
targets.

**Scope:** one file (`lib/macaroon-verify-ffi.ts`, proposed — not yet shipped), one
caller-swap in `gate.ts`, one test file mirroring the dual-path structure of
`tests/unit/planner-schedule-ffi.test.js` (PR #3828, not yet shipped) — fallback always
runs in CI, kernel-path test skipped unless the dylib exists locally.

---

## 2. Kill or commit: the four dead-scaffolding crates

**Evidence:** `pd-core`, `pd-eventlog`, `pd-mesh`, `pd-runtime` — none exports `#[no_mangle]`
anything, none has a cdylib target being loaded from TS (zero grep hits for
`pd_eventlog`/`pd_mesh`/`pd_runtime` symbol names or crate references across `lib/`,
`routes/`, `cli/`). `pd-tui`'s own source literally self-labels: `"local-only kernel
scaffold"` (`pd-tui/src/lib.rs:26`).

This is not automatically a problem — a crate can be a correctly-scoped internal
dependency of other crates with no FFI surface of its own (`pd-core` looks like this: the
other five crates depend on it internally). But `pd-eventlog`, `pd-mesh`, and `pd-runtime`
have names that imply they're supposed to be load-bearing infrastructure — an event log, a
mesh/transport layer, a runtime — and none of the three is depended on by anything, Rust
or TS. That's not "internal library," that's four names for one thing: nothing calling it.

**The prescription is not "delete them."** It's: for each of the three, name the real TS
counterpart it's supposed to replace or the real capability it's supposed to unlock, and
either build the FFI bridge this quarter or delete the crate. Concretely:

- **`pd-eventlog`** is the obvious candidate to become the backing store for the binder's
  hot/cool bus durable-append leg (`19-operator-surface-triad.md:145-172` — "durable
  append < 500ms"). If that's the plan, say so and start wiring it into item 4 below. If
  it isn't, delete it — an unowned append-only-log crate sitting next to a real
  performance requirement it could serve, doing nothing, is the exact "potemkin" pattern
  this repo's own house style forbids everywhere else.
- **`pd-mesh`** is the obvious candidate for the binder's Windows named-pipe fallback
  (`24-crossplatform.md:129,245` — "blocked on Bun named-pipe support or a Rust shim") and/or
  the local-IPC leg of the hot bus. Same rule: commit it to one of those two real jobs or
  delete it.
- **`pd-runtime`** is the vaguest of the three and the one most likely to just be
  premature scaffolding for the binder's "Local Runtime Kernel" TS role
  (`26-...agent-dag.md:102-110`) — which the binder explicitly commits to staying TS. If
  that's right, `pd-runtime` has no reason to exist and should be deleted outright, not
  kept "in case."

**Why this matters more than it looks like it should:** every quarter these sit unused,
they cost real things — they show up in `cargo build` times, in `cargo doc` output, in
`find core/kernel -name '*.rs'` inventories (like the one that fed this very prescription),
and in the mental model of anyone new reading the kernel who reasonably assumes a crate
called `pd-eventlog` is doing something. Dead code in a security kernel is worse than dead
code elsewhere — it's exactly the kind of thing that makes an audit take longer and trust
the codebase less.

---

## 3. Greenfield port target: `transcript-search.ts`'s BM25/RRF

**Evidence:** `lib/agent-harbor/transcript-search.ts` (718 lines). `tokenize()` re-runs on
every candidate inside `bm25Rank()` on every call (`:427,449-478`) — no caching across
queries. `denseRank()` does per-row cosine dot products in a JS loop (`:483-503`). The
corpus query has **no LIMIT** — the full scoped corpus loads into memory on every search
(`:640-641`). `indexPending()` runs synchronously on backlog rows by default (`:604-606`).
The file's own docstring calls hybrid search load-bearing: "Never ship lexical-only
search."

This is the cleanest port candidate in the entire TS estate for a specific reason none of
the other candidates share: **it has no existing Rust twin.** The macaroon and scheduler
ports (item 1) are caller-swaps into code that already exists. This one is new Rust, and
it's worth writing because the workload is exactly what Rust is for — unbounded,
CPU-bound, in-memory scoring with no I/O in the hot loop — and because it sits directly
behind the roadmap tool's promised typeaheads/search-everywhere feature (skills, tasks,
transcripts, agents) that's explicitly on the near-term roadmap.

**Scope:** a new crate (`pd-search`, or a module inside `pd-core` if that crate survives
item 2's reckoning) exposing `pd_bm25_score_json` / `pd_hybrid_rank_json` over the same
JSON-in/JSON-out FFI convention as `pd-anchor`. Port `tokenize()`, `bm25Rank()`, and
`denseRank()`'s dot-product loop verbatim first — don't redesign the ranking algorithm and
change implementation language in the same PR. `lib/semantic-resolver.ts`'s ONNX embedding
computation stays exactly where it is (already native via `@xenova/transformers`, item 3's
scope is the scoring/ranking math around it, not the embedding step itself).

---

## 4. Build the hot/cool bus — the binder's biggest unaddressed number

**Evidence:** `docs/architecture/agent-harbor-technical-binder/19-operator-surface-triad.md:145-172`
and `work-packets/swarm-invocation-and-node-shaping.md:214-238` state hard budgets: live
board p95 < 250ms, steering p95 < 100ms, local IPC hop < 10ms, loopback WebSocket hop <
25ms, durable append < 500ms. `24-crossplatform.md:174-181` treats a missed budget as a
correctness failure, not a nice-to-have: *"A Windows port that cannot meet the steering
budget is not done; it is a finding."* No file in the binder or the codebase states what
implements this bus.

This is the single largest gap between binder ambition and binder substrate commitment,
and it's exactly the kind of thing that gets silently absorbed into "the daemon does it in
Node" by default, at which point the 10ms local-IPC-hop budget is dead on arrival — Node's
event loop and GC pauses alone make sub-10ms guarantees unreliable under load, and Bun
doesn't change that fundamentally (same V8-family scheduling model).

**Prescription:** "hot bus" and "cool bus" are two different engineering problems wearing
one name, and they should be designed — and staffed — as two different pieces of work, not
one crate.

### 4a. Hot bus (local IPC < 10ms, loopback WS < 25ms, steering p95 < 100ms) — not a queue

These numbers rule out anything with queue semantics: no broker round-trip, no persistence
on the hot path, no retry/backoff — a retry alone can burn the entire 10ms budget. This is
real-time in-process pub/sub, the same category as a UI event bus or a game engine's
message loop, not a job system. Build it as a real Rust component (likely `pd-mesh`'s
actual job, see item 2) that the TS daemon calls into over the same FFI convention as
everything else — not a separate process, not a rewrite of the daemon, and explicitly not
built on top of a queue library or BullMQ-shaped abstraction, since every one of those
trades latency for durability guarantees this leg doesn't need. Loopback WebSocket and
local-IPC hops are the two numbers worth instrumenting first, since they're the ones most
directly falsified by "it's all just Node" — Node's event loop and GC pauses alone make
sub-10ms guarantees unreliable under load, and Bun doesn't change that fundamentally (same
V8-family scheduling model). Build a benchmark harness that asserts the p95 budgets in CI
before writing a line of the bus itself, so "meets the budget" is a testable claim and not
a vibe (this matches this repo's own TDD instinct — a measurable target for when a thing is
done).

### 4b. Cool bus (durable append < 500ms) — this IS a job-queue design problem

500ms is a generous budget by real-time standards but a normal one for "write it and make
sure it survives a crash" — this leg is honestly a durable-write/background-job problem,
and should be designed using that field's actual playbook rather than reinvented from
scratch. Concretely, applying the queue-design decision criterion ("how complex is the
recovery story?"):

- **At-least-once, not exactly-once, is the only honest delivery semantic** for durable
  append — don't design `pd-eventlog` (again, see item 2 — this is the concrete answer to
  "what is `pd-eventlog` for") around an exactly-once guarantee it can't actually keep
  under a crash between write-and-ack. Make every event handler/projection idempotent
  instead (this is exactly the fix already prescribed for `KernelProjection::apply`'s
  double-count-on-replay bug found during the rustdoc backfill — that bug is a preview of
  what happens when this principle isn't followed).
- **Idempotency key, not just a queue-local id**: derive each event's dedup key from the
  business event itself (the roadmap slug + action, the session id + note sequence — the
  same shape as `send-receipt:${orderId}` in the standard pattern), not from an
  eventlog-internal counter alone. This is what makes "did this already get durably
  appended" answerable after a crash mid-write, not just "did this get queued."
- **Reliable-fetch / visibility-timeout thinking applies to the write side too**: if
  `pd-eventlog`'s append path is going to be called from multiple daemon threads/requests
  concurrently, it needs the same "what happens if the writer dies mid-append" story a
  queue's visibility timeout solves — measure real p99 append latency once the crate is
  real, not before, and size any lock/lease duration around that measurement rather than
  guessing.
- **This is a queue, not a workflow** — per the field's own decision criterion, a
  single-hop durable append with no multi-step external fan-out doesn't earn
  Temporal-style durable-execution machinery. Keep `pd-eventlog` a focused append-log +
  idempotent-projection crate; resist the temptation to grow it into a general workflow
  engine just because the vocabulary is adjacent.

The two legs share nothing at the design level — 4a needs to be fast and can be lossy under
extreme load (a dropped steering update at p99.9 is recoverable by the next tick), 4b needs
to survive a crash and can afford queue-grade latency. Building them as one undifferentiated
"bus" crate is how you end up with something too slow for steering and too fragile for
durable append. Split ownership at the design stage, not after the first incident.

**Why this is priority 4 and not priority 1:** it's real, multi-week work, not a
caller-swap. But it's also the one item on this list where *not* doing it leaves the
binder's own stated numbers permanently unenforceable, which is a worse state than not
having written the binder language at all.

---

## 5. Port tree-sitter file-preview parsing

**Evidence:** `09-data-model-and-api.md:568-582` proposes tree-sitter-based file preview
parsing with no substrate stated. tree-sitter's canonical, best-maintained binding is
Rust (`tree-sitter` crate + per-language grammar crates); the Node binding
(`node-tree-sitter`) is a thinner, less-current wrapper around the same C core, and
`pd-console`'s file-tree/editor pane work already lives in Rust — a Rust tree-sitter
integration slots directly next to that surface rather than requiring a second parsing
stack.

**Scope:** small and self-contained relative to items 3–4 — a `pd-syntax` crate (or a
module in `harbor-card-rs`'s neighborhood, since that's the existing FFI-exemplar crate)
wrapping `tree-sitter` + a handful of grammar crates (TS/JS, Rust, Python, Markdown to
start), exposed as `pd_parse_outline_json` for file-preview/symbol-outline use in both
`routes/*.ts` (web previews) and `pd-console` (native panes) — one parser, two consumers,
which is the actual argument for doing this in Rust instead of twice in two languages.

---

## 6. What NOT to port — named explicitly so it doesn't happen by accident

**Coordination guard subprocess cost.** `routes/operator.ts:596-599` documents guard
subprocess calls observed stalling up to ~47s, capped at 1500ms. The instinct on seeing a
slow subprocess is "port the logic to Rust for speed" — that's the wrong diagnosis here.
The cost is dominated by process-spawn + network round-trip to the daemon
(`cli/commands/guard.ts:208-220,602`), not by the size of the allow/block decision logic
itself, which is small-N string/path matching. Porting `evaluateGuardFacts()` to Rust
would make an already-cheap computation marginally cheaper while leaving the actual
47-second cost (subprocess boot + fetch) completely untouched. The real fix is
architectural — an in-process call or a persistent guard process — not a language change.
Flagging this explicitly because it's the most likely candidate to get mis-prescribed by
someone pattern-matching "slow + Rust exists" without checking where the time actually
goes.

**Sessions/claims/notes** (`lib/sessions.ts`, `lib/claim-forest.ts`). Bounded by SQLite
query cost, not CPU; the only per-claim computation is small fixed-size hashing/path
normalization. Already correctly TS.

**`lib/spawner.ts` and friends.** Process orchestration — `child_process.spawn`, file
stats, one-shot JSON parses. No hot loop. Already correctly TS.

**Squid harness** (`lib/squid/adapter.ts`, `identity.ts`, `matrix.ts`). Install-time file
writes and vendor-CLI process spawning; `matrix.ts`'s actual hot path is grepped by bash
hook scripts, not read from TS *or* Rust — it isn't even a language question. Already
correctly scoped.

**`lib/semantic-resolver.ts`'s embedding computation.** Already delegates to native ONNX
runtime (`libonnxruntime.*.dylib`) via `@xenova/transformers`. The only pure-TS residual is
`cosineSimilarity()`, O(n) per candidate and cheap. Not worth a language port on its own —
if item 3's `pd-search` crate ends up owning the ranking pipeline anyway, cosine similarity
can move there as a side effect, but it isn't independently justified.

---

## Sequencing

| Phase | Item | Size | Blocking? |
|---|---|---|---|
| 1 | Wire macaroon verify (§1) | Hours | No — ships standalone |
| 2 | Kill-or-commit audit on pd-core/eventlog/mesh/runtime (§2) | 1–2 days of decision-making, variable execution | Decides whether §4 has a home to build into |
| 3 | `pd-search` BM25/RRF port (§3) | 1–2 weeks | No — ships standalone, unblocks roadmap-tool search |
| 4 | Hot/cool bus (§4) | Multi-week | Depends on §2's verdict on `pd-mesh`/`pd-eventlog` |
| 5 | tree-sitter parsing (§5) | 3–5 days | No — ships standalone |

§1 and §2 should happen first and in parallel — §1 because it's nearly free, §2 because
every later item's crate-ownership question depends on its outcome. §3 and §5 don't block
on anything and can run concurrently with §2/§4. §4 is the long pole and should not start
until §2 has actually answered what `pd-mesh` and `pd-eventlog` are for — building the bus
before that decision risks creating a *sixth* dead-scaffolding crate instead of resolving
the four that already exist.
