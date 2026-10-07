# Design beat: make the authority understandable

**Decision:** HOLD the operator experience at static-prototype truth. Design the complete interaction model now; do not imply that its controls operate a live reference monitor.

## Reciprocal-review correction

The complete information architecture remains a target, not the V1 build.
V1 has one desktop Control Room path with **Proposal**, **Run/Intervene**, and
**Review/Evidence**. FleetBar is status and deep-link projection only.
Continuity, Settlement, Archive, a separate Observatory, and mobile authority
remain contract-only or deferred. Every consequential request converges on one
signed Switchboard path. `OperatorSemanticContract` begins in S0; visual
composition may mature later.

## Strongest design case

The architecture can become unusually legible if every screen answers four questions without jargon: **what is happening, who or what may act, what is merely proposed, and what evidence would change the state?** The system should feel calm under normal work and become more explicit—not more animated—when uncertainty rises.

## Information architecture

### FleetBar: glance, attention, emergency

- current posture and freshness;
- “Needs You” decisions;
- active governed runs and their one-line state;
- immediate Stop/freeze/quarantine entry;
- no deep editing and no invented aggregate green.

### Control Room: operate one body of work

- **Muster** — repositories, rooms, proposals, and allowed launch profiles;
- **Workroom** — conversation, current step, claimed scope, diff/test motion, capacity, and intervention;
- **Reviews** — immutable proposal comparison, assent, adjudication, and PR/evidence review;
- **Continuity** — predecessor/successor comparison, omissions, obligations, generations, and body translation;
- **Settlement** — typed evidence, disagreement, no-settlement or future settlement profile;
- **Archive** — replayable receipts, immutable unavailable-evidence records, and exported artifacts.

### Observatory and Switchboard

The Observatory is read-only by default. The Switchboard is a visibly separate authority surface for consequential commands. A projection changing selection, filters, repository, room, or session must never change lifecycle, wake state, worktree, or capability.

## Core journeys

1. **First launch:** select repository → inspect bounded profile → review exact proposal → assent → observe independent admit/deny.
2. **Follow work:** read current step → inspect changed files and tests → open primary evidence within two actions.
3. **Intervene:** request Stop → watch delivery, fence, process, lease, effects, and teardown as separate witnesses.
4. **Handle failure:** see `FAILED`, `UNKNOWN`, `STALE`, and `AMBIGUOUS` as distinct states with one safe next action.
5. **Resurrect:** compare predecessor and proposed body → review retained/omitted/narrowed/unknown context → admit only after independent gates.
6. **Settle:** inspect criterion-specific witnesses → preserve conflict as `UNSETTLED` rather than synthesizing green.

## Wireframe: desktop Control Room

```text
┌ Project / Room / Run ───────────────────────────────────────────────────────┐
│ ● observed  one governed run   last host witness 4s   [Request Stop]       │
├──────────────┬─────────────────────────────────────┬────────────────────────┤
│ RUNS         │ WORKROOM                            │ EVIDENCE               │
│ ● active     │ current step / claimed scope        │ review envelope        │
│ ◐ needs you  │ conversation and exact actions      │ diff + tests           │
│ ? unknown    │ diff motion / tests / blocker       │ effect saga            │
│ ○ proposed   │ capacity vector / expiry            │ witnesses + dissent     │
├──────────────┴─────────────────────────────────────┴────────────────────────┤
│ Authority: exact scope · generation · policy · one-use expiry              │
└────────────────────────────────────────────────────────────────────────────┘
```

At narrow widths, Runs becomes a drawer, Workroom remains primary, and Evidence becomes a full-height sheet. No essential content has a fixed height.

## Wireframe: mobile companion

```text
┌ Needs You (1) ───────────┐
│ ◐ Review changed target │
│ repo / head / body / cap│
│ [Inspect exact changes] │
├ Active run ─────────────┤
│ ● step 4/7 · tests      │
│ last host witness 8s    │
│ [Follow] [Request Stop] │
├ Evidence ───────────────┤
│ diff · tests · effects  │
└─────────────────────────┘
```

The phone requests control; the host must acknowledge it. Pairing does not grant files, credentials, launch authority, or a background wake right.

## Component grammar

- `TruthBadge`: `SOURCE_PRESENT`, `PROPOSED`, `UNKNOWN`, `BLOCKED_BY_HALT`.
- `AuthorityBar`: principal, scope, generation, policy digest, expiry, and one-use state.
- `FreshnessStamp`: witness, observed time, age budget, and stale behavior.
- `IdentityStack`: durable actor, current body, provider session, and predecessor.
- `ReviewEnvelope`: exact shown proposal and critical-field diff.
- `CapacityVector`: time, attempts, concurrency, known cash, included-but-scarce allowance, network, and attention.
- `BirthTimeline`: eligibility → reservation → lease → durable dispatch intent → start.
- `EffectSaga`: prepared → dispatched → confirmed/failed/ambiguous/reconciled.
- `CommandLifecycle`: requested → delivered → acknowledged → fenced → teardown witnessed.
- `RebodyComparison`: retained, omitted, narrowed, translated, and unknown context.
- `ResultVector`: separate subordinate `PASS`, `FAIL`, `INCOMPLETE`, and `UNKNOWN` axes.
- `DissentDrawer`: open, answered, rejected with evidence, preserved, or escalated.

## Visual language

Warm paper and ink carry most of the surface. Jewel colors mark narrow rails, dots, focus, and consequential boundaries:

- paper `#F4F0E7`, ink `#17191D`, muted `#666A68`;
- cobalt navigation `#3557C8`;
- emerald observed `#147665`;
- amber pending `#A46516`;
- amethyst proposed `#6A50A7`;
- garnet danger `#A33B48`.

Fractional borders establish depth without card soup: 0.5px hairline, 0.75px section, 1.5px authority, 2px emergency. Forced-colors mode uses system colors and 1px lines.

Status grammar never relies on color:

- `● OBSERVED`
- `◐ PENDING`
- `○ PROPOSED`
- `× DENIED / FAILED`
- `? UNKNOWN`
- `⧗ STALE`
- `⊘ BLOCKED`

Use Big Shoulders Display only for headings, Recursive for body at 16px minimum, and Recursive Mono for IDs, digests, witnesses, and times at 13px minimum. At 200% zoom, columns reflow rather than shrinking or clipping.

Motion is a receipt, not atmosphere. No pulse, breathing glow, parallax, or continuous spinner. An optional 120ms opacity edge may mark newly appended evidence. Reduced motion removes even that.

## Two-action evidence rule

1. Activate any summary to open a drawer with exact claim, truth state, operational state, authority, witness, observation age, limitation, digest, and next safe action.
2. Activate “Open primary evidence” to reach the exact source range, diff hunk, command/test output, event, trace, provider receipt, or immutable unavailable-evidence record.

Missing evidence is a destination, not an endless loading state.

## Trust wording

- “This records your assent to the exact proposal shown here. It does not execute the action; adjudication may still deny it.”
- “Signature verified for these bytes. This proves source and integrity, not factual truth or complete mediation.”
- “Stop requested. Delivery is not shutdown; waiting for fence, process, lease, effect, and teardown witnesses.”
- “This effect may have applied. It will not be retried or released until an independent witness reconciles it.”
- “Proposed body · not started · no authority.”
- “Included but scarce. Current availability is unknown; real-provider admission is blocked.”

## Usability and teach-back gate

Static sessions must test first launch, assent-versus-execution, critical substitution, two-action evidence zoom, stale/unknown/ambiguous distinctions, delayed Stop, lost acknowledgement, resurrection, settlement conflict, 200% keyboard/screen-reader operation, and mobile authority.

One silent launch, stale-authority mutation, duplicate effect, inaccessible emergency control, or mistaken terminal state fails the design regardless of aggregate completion rate.
