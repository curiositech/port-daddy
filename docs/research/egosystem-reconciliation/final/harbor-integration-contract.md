# Project Epistemology in the existing cooperative Harbor

Status: integration specification, not a running feature. D1a has offline code;
D5 remains blocked on the proof gates below. The operator's halt remains binding.
This document extends [architecture](architecture.md), not Harbor's authority.

## Product promise and placement

Cooperating humans and agents should be able to answer: what applies here,
who believes otherwise, what evidence changed, whose commitment is at risk,
and what happens if we adopt this proposal? The shared system preserves those
distinctions through interruption and participant changes. It is not a reviewer
queue, a common all-knowing summary, or a new editor.

| Concern | Existing source / authority | Project Epistemology contribution | Proof before integration |
| --- | --- | --- | --- |
| Text convergence and provenance | `core/pd-console/src/buffer.rs`, `editor_pane.rs`, `editor_sync.rs` | Link a case to the exact source revision and affected spans | A fresh edit invalidates the preview without losing collaborators' text |
| Claims and permitted writes | `editor_claims.rs`, `editor_wedge.rs`, `editor_commit_gate.rs`; existing Harbor grants | Surface semantic consequences above byte convergence; detector output stays an allegation | A clean CRDT merge can still expose a commitment conflict; preview never bypasses the write gate |
| Institutional ordering | ADR-0122 and current Harbor writer | Existing event family and deterministic scoped projections | Gap, stale epoch, duplicate command and concurrent-precondition tests on the real envelope |
| Durable people and embodiments | ADR-0121; `lib/actor-roster.ts` is role registry, not another identity root | Attribute assertions, participation and historical execution separately | A successor cannot silently inherit another principal's beliefs, grants, or assent |
| Obligations | ADR-0041; `lib/commitments.ts` | Link existing commitment IDs to goals, evidence, cases and outcomes | Acceptance/refusal/cancellation/fulfillment tests use the existing lifecycle, with exact closure receipts |
| Evidence and retrieval | Porthole; resource scopes; provider-neutral retrieval fabric | Authorized evidence references, lineage invalidation and typed candidate nomination | Revocation/erasure affects caches, queued jobs, derived output and exports; no raw evidence copied into general memory |
| Recovery | `routes/editor-recovery.ts`, `lib/editor-recovery.ts` | Recover the case context alongside, not instead of, typed operation receipts | Canonical Loro replay, scope/symbol/file witnesses, claim transfer and post-recovery provenance demonstrated together |

Source presence is not runtime proof. In particular, public editor recovery
mutations remain 503-gated pending their documented authorities. Older skill
examples that say to create the Editor surface are historical; the existing
`SurfaceKind::Editor` and `EditorPane` are the starting point. Never use old
note-encoded op-log helpers as the canonical recovery producer.

The shell, Loro core, governance and transport remain separate layers. Reuse
the existing collaboration server and transport abstraction; do not add a
Project Epistemology sync backend or make the editor branch on network topology.
For future pixel work, compose gpui-rust-console, beautiful-gui-design,
rust-gpui-motion, and the existing text/rendering siblings. This slice adds no
native pixels and does not claim a native visual or motion gate passed.

## Participant protocol, not implicit consensus

Every proposal is bound to tenant/project/harbor, source head, policy revision,
writer epoch and expected sequence. Peer participation does not mean identical
permissions. A request can be refused, delayed or renegotiated.

| Observation | What it establishes | What it does not establish |
| --- | --- | --- |
| Published | The service admitted an attributable contribution | Any recipient received or read it |
| Delivered | The recipient endpoint acknowledged delivery | The person understood it |
| Read / acknowledged | An attributable recipient marked this revision seen | Acceptance of the proposal or commitment |
| Accepted / refused | The authorized participant explicitly disposed of this revision | Another participant's assent |
| Fulfilled | The commitment's named oracle and closure receipt are satisfied | That every effect succeeded or every dispute is closed |
| Departed / timed out | The embodiment is unavailable | Consent, cancellation, transfer, or successful completion |

The Synthesis Steward integrates arguments and preserves dissent. The existing
authorized decider changes institutional state. Neither rewrites an actor's
assertion. Select required participants by affected rights, obligations and
outcomes, not by who is online. Unknown delivery remains unknown; silence is not
common knowledge. Reconsider commitments on relevant source/goal changes,
failure or cancellation, not an unbounded periodic reasoning loop.

Successor recovery must show predecessor, exact source head, pending
commitments, prior accepted decisions, undelivered/unacknowledged contributions,
and unresolved evidence. Same-principal embodiment replacement and a new
principal accepting a transfer are different operations. Retain responsibility
until the existing transfer/renegotiation protocol explicitly changes it.

## Separate views and disclosure

R2 requires separate rankings where operator regret and agent continuation
priorities diverge. The operator view emphasizes consequences, reversibility,
cost, uncertainty and the smallest decision needed. The agent view emphasizes
its next obligations, exact evidence and dependencies. Both derive from the
same authorized history; neither reveals private beliefs by inference.

Tenant/account, project, repository, harbor and audience are distinct scope
dimensions. Propagate them, disclosure class, grant revision and lineage through
query filters, cache keys, queue envelopes, metrics, exports and deletion.
Revocation is checked against current rights even for historical queries.
Invalidated or erased premises invalidate their derivatives before ranking.
Do not disclose protected existence through counts, labels, ranking movement,
sealed-review enabledness or error differences.

Required paired probes: same IDs/path in two tenants; revoked member with a
warm cache; revocation after queue admission but before delivery; private premise
changed while an unauthorized observer's output remains equal; deleted evidence
retrieved through a derivative; and equal allowed releases under varied sealed
review schedules. D1a covers only in-memory subsets of these probes.

R9's bounded sealed-room model informs the review protocol; it is not proof of
deployed isolation. R5 concerns complete mediation of controllable effects,
not control of a model's thoughts. R14 requires both interruption and missed-harm
measurements; if no acceptable operating range exists, improve evidence or
capacity rather than quietly suppressing affected people.

## First three moments and recovery

1. **Enter an existing project, or open the providerless demonstration.** Reuse
   the existing account/Harbor membership flow. An unsigned-in user gets only
   invented examples. No credential request, automatic account, invitation or
   provider call is needed to understand the feature.
2. **Select a proposal or affected editor region.** Empty projects explain what
   evidence to attach and show a synthetic example. Existing projects show
   source/revision, audience and incomplete evidence before opening a case.
3. **Compare consequences.** Show what stays applicable, what changes, affected
   people, competing views and dissent. Offer keep-current-plan and request-
   clarification. Acceptance is absent/disabled when authority, freshness,
   evidence or the operator halt prevents it. No preview button executes work.

Reuse existing sign-in/recovery, team invitation and membership controls;
integration must prove invitation acceptance, wrong-account refusal, member
removal, account recovery, export and deletion paths. This document does not
invent a new account or billing system. Provider setup, when separately allowed,
uses existing guided credential UI; missing credentials retain local read-only
value and never select a paid fallback automatically.

On daemon loss, partition, expired grants or a stale projection, retain local
drafts and show freshness plus the precise unavailable operation. During the
halt, do not offer automatic restart. On recovery, revalidate the original
proposal and do not retry ambiguous effects blindly. Support export must be a
scoped/redacted receipt bundle with a preview, not a raw transcript dump.

## Owners, milestones, gates and rollback

These are role accountabilities, not newly launched agents or live roadmap
assignments. Current local implementation responsibility is the #10108 author
(Codex). The existing Synthesis Steward owns this package's integration; the
Harbor Architect of Record owns cross-binder consistency. The historical
`chartroom-grand-harbor-authority-cutover` association remains unchanged.

| Milestone | Accountable role | Status and gate | Failure / recovery |
| --- | --- | --- | --- |
| D0 packet parity | #10108 author | Offline; independent Ajv boundary tests plus existing declaration tests | Reject malformed input; revert the bounded schema/validator commit together |
| D1a temporal + R17 adapter | #10108 author | Offline; `harness/test_temporal.py`, four case results, original R17 sweep | Reject incomplete/unsupported/bounded-out input; discard synthetic projection and replay; no canonical data to roll back |
| D1b canonical contract parity | Existing Harbor writer / commitment maintainers | Deferred; real envelope, epoch handoff, compare-and-swap, effect and reservation fixtures | Block integration; retain source records and uncertain receipts; revert adapter without changing writer authority |
| D2/D3 H1/H2 utility | Synthesis Steward, with operator-approved study scope | Deferred; preregistered matched baselines, held-out labels, human time, false positives, uncertainty and cost | Inconclusive/negative result stays unpromoted; stop study at approved cap |
| D4 H3/H4 | Synthesis Steward; privacy owner consulted | Deferred; actual isolated initial inquiry, schedule/disclosure probes and provenance ablations | Preserve missing/correlated inputs honestly; stop on contamination or revoked research consent |
| D5 Harbor integration | Existing Harbor/editor maintainers | Specification only; participant, tenant, recovery, UI and failure probes above; explicit activation authority | Leave read-only/disabled; revert integration adapter, preserve history and pending obligations |
| D6 automation | Operator | Not authorized; separate benefit, hard-cap and incident-recovery decision | Halt stays effective across admission and downstream effects |

Before native integration, prove buffer + claims + canonical recovery together;
transport polish does not close that gate. Required UI evidence is real native
light/dark screenshots, keyboard/zoom/accessibility checks and a task-flow clip,
followed by human task testing. Existing HTML screenshots prove only the local
design study. No human-study or production-readiness result is claimed here.
