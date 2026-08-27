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
broad work at 0.85, and compact or create a successor at 0.92. SessionStart,
PreCompact, crash recovery, takeover, salvage, and fresh begin read the last plan
before transcript recall.

The compactor never rewrites history and never separates a tool invocation from
its result. It produces a cited packet whose parts declare priority, token cost,
provenance, and whether they may be dropped. The original transcript remains
append-only.

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
