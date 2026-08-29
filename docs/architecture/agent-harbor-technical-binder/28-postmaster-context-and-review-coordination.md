# 28 — Postmaster, Context Pressure, And Review Coordination

Status: authoritative target-state contract; hook nudges in the first wave are
shippable now, while the Postmaster ship is not yet running locally.

## Product promise

An agent should not discover important coordination by accident. Port Daddy
must deliver the smallest useful fact at the right lifecycle boundary, preserve
the durable source behind it, and let the agent explicitly acknowledge or act.
The Postmaster is the future durable role that owns this delivery health. It is
not another chatty bot and it does not own the underlying truth.

The operator experience is one quiet coordination rail:

1. SessionStart restores the last plan first and points out salvageable work.
2. Turn start surfaces at most a few actionable inbox, parley, PR, and conflict
   facts, with links back to durable state.
3. Risky actions and rising context pressure require a current plan checkpoint.
4. Stop and SessionEnd flush a receipt and enqueue any expensive synthesis.
5. PreCompact writes a cited continuation packet before a vendor discards
   context.
6. A resumed or replacement body reads the plan and packet, not an undifferentiated
   transcript dump.

## Authority and topology

The Postmaster is a curated projection over existing sources: inbox, Tube,
Parley, claims, roadmap, symbol index, salvage queue, GitHub PR events, Fleetbot
reviews, plans, transcripts, and compaction packets. Those systems remain the
authorities. Postmaster owns delivery cursors, deduplication, digest policy,
escalation, and evidence that a fact was surfaced.

Until durable local ships run, this contract is implemented by deterministic
hooks and daemon services. No process may claim a Postmaster actor is alive merely
because the projection or UI exists.

| Flow | Topology | Durable result |
| --- | --- | --- |
| inbox and PR digest | blackboard projection | per-actor cursor plus surfaced receipt |
| near-overlap invitation | semantic matcher to bounded parley | invitation or explicit decline |
| author to Fleetbot challenge | typed request/reply workflow | review settlement receipt |
| context clustering | dependency graph to manager-driven workgroup | governed WorkIntents and linked plans |

## Lifecycle contract

| Hook | Bounded synchronous duty | Deferred durable duty |
| --- | --- | --- |
| SessionStart | restore last plan first; show salvage count and urgent digest | refresh briefing and cited continuation packet |
| UserPromptSubmit | show at most two actionable facts; message bodies stay out | advance delivery cursor only after explicit acknowledgement |
| PreToolUse | before risky work, require current plan and authority receipt | record denial, safe alternative, and risk evidence |
| Notification | coalesce repository PR/review/merge events | write per-repo digest and urgency class |
| Stop | require SITREP and wave-complete plan checkpoint | enqueue transcript, receipt, and review reconciliation |
| SubagentStop | validate typed result, tests, claims, and handoff | attach result to parent plan and adversarial review |
| PreCompact | write plan-first cited packet; never split tool call/results | rank/drop context parts and propose successor workgroups |
| SessionEnd | best-effort final checkpoint; never block on synthesis | release claims, archive transcript, publish receipt |

Every hook has a hard deadline and a closed output budget. Advisory reads fail
open; authority gates fail closed only on deterministic local evidence. Expensive
search, summarization, GitHub queries, and reviewer dispatch happen behind durable
jobs, never inside the hook deadline.

## Repository digest and parley radius

Repository events are typed as `opened_for_review`, `updated`, `review_requested`,
`merged`, and `closed`. Routine events are batched since each actor's last
acknowledged cursor and delivered at SessionStart or turn boundaries. A security
finding, conflicting claim, or direct review request may interrupt sooner.

“Parleyable radius” is not a filename substring. It is a scored, explainable
intersection of structured claims, touched symbols, roadmap/DAG ancestry,
contracts, and the shared hybrid text matcher. An invitation names the overlap,
its evidence, age, and expected action: inspect, comment, parley, or dismiss.
No invitation becomes authority to edit.

## Suggestion packet

The turn briefing may recommend more than files and skills. One ranked packet
can include:

- roadmap items and adjacent DAG nodes;
- authoritative documents and ADR sections;
- AST symbols, classes, and call-graph neighbors;
- active claims, locks, and agents with relevant history;
- salvageable runs and continuation packets;
- PRs awaiting review or recently merged;
- skills and MCPs appropriate to the next plan node.

Each suggestion carries kind, canonical id, why-now evidence, provenance,
freshness, authority, and estimated context cost. Search uses the repository's
shared semantic-plus-lexical fusion; lexical-only and keyword classifiers are
not shippable.

## Plan-first continuity and context pressure

`pd plan` is the resumability anchor across all bodies and vendors. A checkpoint
is required at wave completion, before risky actions, and at the existing context
pressure thresholds: prepare at 0.60, build a cited packet at 0.75, warn before
broad work at 0.85, and require a governed successor *boundary* directive at
0.92. That directive records the evidence a separate, governed continuation may
consume; the hook does not create or replace a process. The
packet thresholds are evidence-gated: without a daemon-owned provider-session →
plan binding, trusted measurement, current plan checkpoint, or complete
tool-pair coverage, the daemon records no packet. This slice records the
directive; it does not claim to spawn, resurrect, or silently replace a process.
PreCompact checkpoints the durable plan before an interactive packet can be
written. The bounded entry-path seam can expose an exact, revalidated packet
and that last plan for an already-proven predecessor during active/closed
re-begin, direct takeover, or post-auth salvage; a truly fresh begin remains
`none` and never searches by similar identity or transcript. The seam is
dependency-injected: until the daemon composition root supplies the verified
ledger loader, production entry paths report `none` rather than pretending that
packet continuation is active. Neither path dumps a predecessor transcript.

The compactor never rewrites history and never separates a tool invocation from
its result. It produces a cited packet whose parts declare priority, token cost,
provenance, and whether they may be dropped. The original transcript remains
append-only.

### Interactive Squid implementation boundary

The first live interactive producer is deliberately narrow: Claude Code only.
Its `UserPromptSubmit` registration runs the existing prompt tentacle as
`pd-hook-prompt --interactive-context-pressure`, so the .60/.75/.85/.92
directive is refreshed at ordinary turn start through Claude's bounded
`additionalContext`; Gemini, agy, and Codex retain their ordinary prompt hooks
without a simulated pressure producer. The verified Claude `PreCompact` event
([vendor reference](https://code.claude.com/docs/en/hooks)) remains the truthful
compaction checkpoint. It can block only a manual missing-plan attempt; Claude
discards its `systemMessage` and `continue` fields, so warnings are never claimed
to be provider-visible there. `pd-hook-precompact` accepts at most 64 KiB of the provider lifecycle event and
uses a bounded, authenticated local CLI transport to
`POST /agent-harbor/interactive-context-pressure`; it never forwards a
transcript, accepts hook-supplied usage, or manufactures token usage. The first
gate is a daemon-owned provider-session → active `pd plan` binding, not an
ambient `PD_SESSION_ID` or hook-supplied plan text. Without it, ingress returns
`provider-session-unbound` and writes no receipt, envelope, or packet. Only after
that binding does the daemon seek a trusted measurement: its absence is
`measurement-unavailable`, also with no packet. Only an adapter-equipped daemon
with a known daemon window/estimate may then combine a separately witnessed
provider estimate using the conservative maximum, resolve the current plan from
its durable `todo_list`, and demand complete daemon-owned tool-pair coverage.
Unavailable or malformed coverage is `packet-withheld`; a missing current plan
also withholds the packet. The default daemon wires none of the provider-session
binding, usage, or tool-pair witnesses, so it issues no operational packet. No
Codex, Gemini, or agy `PreCompact` equivalent is registered until a
provider-native witness exists.

Every trusted adapter measurement carries an opaque daemon-owned
`measurementRef`; the observation identity includes that reference and any
accepted native measurement time. An exact retry therefore replays its original
boundary, while a later provider or tool-pair observation with the same rounded
token count cannot reuse stale packet evidence. The bounded durable fallback
uses the latest bounded provider-work event's sequence and hash as its
corresponding watermark; plan, coverage, envelope, and packet receipts never
advance their own next-turn observation.

In an adapter-equipped daemon, when that evidence exists, the resulting contract
is deterministic and recordable:

| Pressure | Daemon result |
| --- | --- |
| 0.60 | prepare compaction and checkpoint the durable plan |
| 0.75 | with a current `plan_checkpoint`, write a cited CompactionPacket whose plan obligations cite that event |
| 0.85 | retain the packet and restrict broad or risky work |
| 0.92 | allow provider-owned compaction and record one governed-successor boundary directive; this hook creates no successor process |

The ingress accepts only string loopback metadata. Empty or non-string `request.ip` values are rejected before payload parsing or ledger mutation; adapters and proxies must provide a verified value rather than relying on coercion.

Before a packet is built, interactive transcript rows must prove complete,
ordered tool-call/result pairs. A malformed, orphaned, duplicate, or unresolved
pair yields `packet-withheld` rather than guessing. Repeating the same provider
observation after crash/restart is idempotent. An explicit governed,
packet-derived cross-backend continuation reads the verified packet, last plan
checkpoint, and bounded citation/coverage handles with no raw transcript tail;
the PreCompact outcome does not project a continuation or create a process by
itself. (Other sanitized handoff capsule contracts may preserve bounded operator
turns under their own rules.) `BufferedOutputRef` remains W8/W12's storage
contract: this path may cite that narrow reference once it is available but does
not introduce a second blob store.

Porthole can record this boundary by showing (1) the Claude-only prompt command
with `--interactive-context-pressure` plus its separate PreCompact config entry,
and the absence of a pressure producer or simulated PreCompact entry for Codex,
Gemini, and agy; the 0.60 prompt receipt must be a plan-first preparation
directive (with the durable plan already `checkpointed`) and no packet, while
0.75+ may cite a packet; (2) an
unbound provider session returning `provider-session-unbound` with no receipt,
envelope, or packet, including proof that ambient `PD_SESSION_ID` cannot select
one; (3) hook input rejection for every non-envelope field, including usage,
raw transcript text, plan text, and `BufferedOutputRef` objects;
(4) a bound session with no witness returning `measurement-unavailable` and no
packet, then an adapter-equipped measurement/coverage fixture resolving
`max(provider, daemon)` or a daemon-only known window; (5) `packet-withheld` for
missing, malformed, or incomplete tool-pair coverage and no packet for a missing
current plan; (6) the four pressure transitions above, including a 0.92
`governed-successor` directive that launches nothing; and (7) a crash/retry and
explicit packet-derived cross-backend handoff that reuses the packet, plan, and
bounded handles while showing an empty raw-transcript tail. When the daemon
composition root supplies the verified lookup, Porthole can additionally show
the same bounded `contextContinuation` projection on active/closed re-begin,
direct takeover, and post-auth salvage; otherwise it must show `none`, not a
simulated continuation.

When context contains weakly coupled clusters, Port Daddy may propose a small
synchronized workgroup. Clusters come from the task/claim/symbol graph plus the
shared semantic matcher. Each child receives a typed node prompt, disjoint claim,
budget, relevant context packet, and return schema. Creation still passes the
normal WorkIntent and admission gate; this is not a raw `spawn` escape hatch.

## Fleetbot author-reviewer settlement

A PR author may send a typed `challenge`, `clarification`, or `evidence` message
to the Fleetbot review group. Every reviewer sees the same immutable PR snapshot:
head SHA, diff, prior findings, thread history, tests, roadmap link, and receipts.
Reviewers answer independently before seeing peer conclusions when independence
matters, then enter a bounded reconciliation round.

A settled finding emits a durable review-settlement receipt containing issue,
positions, evidence, resolution, participants, head SHA, and expiry conditions.
Future reviewer turns end early when that receipt still applies. A changed diff
or contradicted assumption reopens it. Unresolved disagreement remains visible
to the operator and cannot be converted into a fabricated green review.

## Security and attention rules

- Digests contain identifiers and summaries, not raw secrets or private message
  bodies.
- Delivery is idempotent by event id, actor, repository, and cursor.
- Notification never grants authorization; every action rechecks capability.
- Cross-harbor data follows the card/capability boundary and local-only stays local.
- Digest size, frequency, urgency, and expiry are observable and operator-tunable.
- A dead Postmaster projection degrades to direct durable reads; it never becomes
  a second truth.

## Implementation waves and gates

1. **Nudges now:** unread inbox/parley count at turn start and project salvage
   count at SessionStart, both bounded and fail-open.
2. **Lifecycle receipts:** plan checkpoint at Stop/risky PreToolUse, plan-first
   SessionStart, and PreCompact cited packets using the existing pressure module.
3. **Repository digest:** ingest GitHub events, persist per-actor cursors, batch
   review/merge facts, and prove no duplicate delivery after restart.
4. **Suggestion packet:** roadmap/doc/AST/claim/PR ranking with provenance and
   hybrid-search tests.
5. **Fleetbot parley:** typed author-reviewer messages and settlement receipts,
   with changed-head invalidation and adversarial disagreement fixtures.
6. **Postmaster ship:** activate the durable local role only after ship runtime,
   identity, supervision, and operator projection all prove liveness.
7. **Context workgroups:** pressure-triggered clustering and governed successor
   agents, with disjointness, shared-plan, budget, and salvage tests.

The program is complete only when a crash, compaction, merged PR, stale review,
and overlapping change can each be replayed from durable evidence and produce
the same bounded next action without transcript archaeology.
