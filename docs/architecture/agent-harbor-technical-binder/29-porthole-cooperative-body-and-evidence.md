# 29 Porthole Cooperative Body And Evidence

Status: canonical binder integration contract; target architecture with active,
partial implementation.

Diátaxis mode: reference.

Consistency gate: this is the Tier-2 resolution candidate for the current
binder/ADR ordering contradiction. Until this change and ADR-0135 are
reconciled and merged, implementations must not choose whichever source is more
convenient or describe the live cooperative contract as settled on `main`.

Decision authority:

- [ADR-0135 in active PR #9970](https://github.com/curiositech/port-daddy/pull/9970),
  `Porthole as universal cooperative app stage and evidence fabric`, is the
  Porthole product decision. This chapter absorbs that decision into the Agent
  Harbor binder; it does not create a second Porthole ontology.
- [ADR-0022](../../adr/0022-durable-actor-souls-and-body-leases.md) owns durable
  identity versus replaceable Body leases.
- [ADR-0122](../../adr/0122-harbor-authority.md) owns harbor authority.
- [ADR-0124](../../adr/0124-transcript-redaction.md) owns transcript and
  evidence redaction states.
- [ADR-0136](../../adr/0136-cross-runtime-execution-envelope.md) owns the
  cross-runtime `ExecutionEnvelope` and the separation among
  model provider, execution locus, loop owner, governor, coordination authority,
  and transcript authority.

The corresponding schemas, runtime, installed applications, and live proof are
not on `main` merely because this chapter states the target. The current
implementation evidence and unresolved decisions are recorded below.

## Product decision

**Porthole**, whose decision source is ADR-0135 in active PR #9970, is the
body-neutral **live cooperative session protocol and historical evidence
substrate** for humans and agents. It is not a recorder to which collaboration
is added later.

A Porthole starts before the first embodied action, hosts live perspectives,
presence, comments, selections, capability negotiation, and attributable
control, then seals the same session into independently verifiable historical
evidence. Local terminal replay, exact-window capture, browser testing, Harbor
Editor collaboration, app SDKs, remote stages, and future device adapters are
conforming `BodyAdapter` implementations of this contract.

The architecture is summarized by four distinct responsibilities:

> **Grand Harbor is institutional truth. Porthole is experiential evidence.**
> **The append-only event ledger is causal history. Search is the connective
> tissue.**

These nouns must not collapse into one database or one user interface:

| Responsibility | Owns | Must not claim |
| --- | --- | --- |
| Grand Harbor / Chartroom | Authorized objectives, ownership, policies, commitments, decisions, status transitions, and the evidence requirements for accepting them | That an authorized claim is physical proof, or that a projection is authoritative when its writer is not |
| Porthole | What a named participant through a concrete Body could observe or affect, including modality, clocks, target, consent, completeness, gaps, and disclosure lineage | Hidden model state, absent modalities, institutional acceptance, or causal truth outside the witnessed source |
| Append-only event ledger | Ordered actions, effects, receipts, revisions, denials, gaps, and causal links from intent through outcome | That every reported event was independently witnessed, or that event order alone establishes meaning |
| Authorized search and lineage | Cited traversal among institution, events, Porthole moments, artifacts, commits, PRs, and decisions | New authority, silent epistemic promotion, raw-secret indexing, or a citation to evidence the caller cannot inspect |

Grand Harbor is a product role, not a claim that the remote authority is already
deployed. On current `main`, the local daemon remains authoritative for the
local harbor under ADR-0122. PR #9989 is a draft Chartroom remote-authority
kernel and explicitly excludes production deployment and Grand Harbor import.

## Descent to evidence and ascent to consequence

Every abstraction that presents historical or institutional fact must permit an
authorized descent toward its support:

```text
objective -> accepted claim -> decision -> PR/artifact -> action/effect receipt
          -> Porthole perspective -> exact moment -> witnessed source
```

The reverse traversal must also be possible:

```text
witnessed moment -> action/effect -> artifact/diff -> commit -> PR
                 -> accepted claim -> objective
```

Links carry identity, source and display clocks, evidence class, completeness,
redaction state, and access policy. A user who cannot access a source sees the
existence and classification of the link when policy permits, not leaked
content. A broken or unauthorized link cannot be replaced by a summary that
quietly sounds equally certain.

## Closed epistemic vocabulary

Every historical assertion, search result, receipt field, evidence badge, and
institutional transition cites one of these evidence classes:

| Class | Meaning | Minimum lineage |
| --- | --- | --- |
| `witnessed` | A source-bound adapter or authority directly observed the stated event or bytes/pixels/operations within its declared modality | witness identity, Body, `BodyAdapter`, target, source interval, clocks, integrity commitment, completeness or gap receipt |
| `reported` | A participant, provider, tool, or remote system asserted the fact without an independent source-bound witness | reporter identity, signed or transport provenance when available, report time, declared scope |
| `derived` | A deterministic or reproducible transform of cited inputs, such as a scrubbed replay, OCR span, diff, aggregate, or display composite | producer and transform version, all input references and classes, output commitment, invalidation lineage |
| `inferred` | A probabilistic or interpretive conclusion, such as intent, semantic similarity, likely cause, or risk | model/rule version, confidence, cited inputs, policy limits, review state |
| `unavailable` | The required source or modality was not captured, was blocked, withheld, deleted, could not be verified, or is outside the adapter's contract | reason, expected modality or witness, time range, whether remediation or later evidence is possible |

Rules:

1. Repetition never promotes `reported` or `inferred` evidence to `witnessed`.
2. A composite exposes every contributing class and gap. Its headline class is
   no stronger than the weakest source required for the displayed claim.
3. `derived` means reproducible lineage, not “probably reconstructed.” Missing
   lineage is `unavailable`.
4. A claim requiring a modality that was not present is `unavailable`, not
   false, zero, clean, or complete.
5. A provider-exposed reasoning event may be `reported` or `witnessed` as an
   emitted event; it never proves access to hidden reasoning or hidden context.
6. Grand Harbor may accept a lower-class fact under explicit policy, but the
   acceptance changes institutional state, not the evidence class.
7. Search, summarization, analytics, and model output may add `derived` or
   `inferred` assertions. They cannot rewrite the source assertion's class.

`POVCompletenessReceipt` is therefore central. “What did this perspective fail
to see?” is queryable alongside “what did it see?”

Semantic events should map compatible model, agent, tool, retrieval, and memory
operations to the [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
where those conventions fit. Interoperable telemetry is `reported` event data
unless a source-bound Porthole perspective independently witnesses it; adopting
common event names does not collapse observability into experiential evidence.

## The live cooperative body contract

The first executable contract freezes these concepts before adapters diverge:

`PortholeStage`:
  A bounded live room with harbor/project/target identity, consent policy,
  participants, Body instances, independently keyed perspectives, clock
  anchors, realtime transport, evidence append, and the ADR-0135 lifecycle:
  `proposed -> consenting -> preparing -> capture-ready -> live -> draining ->
  sealed | aborted`.

`Participant`:
  A durable human principal or `AgentNode`. The operator is a visible,
  attributable participant, not an invisible recorder.

`Body`:
  The concrete process, browser, desktop, editor bridge, simulator, device, or
  remote runtime presently acting for a participant.

`BodyAdapter`:
  The versioned boundary between a Body and Porthole. It binds the Body and
  `ExecutionEnvelope`; declares targets, sensory channels, semantic anchors,
  control verbs, privacy regions, clocks, readiness and completeness rules;
  translates only supported observations and effects; and emits receipts.
  Unsupported parity is `unavailable`. An Anode may host or launch a Body, but
  the provider adapter is not automatically its Porthole `BodyAdapter`.

`Perspective`:
  One independently attestable and independently keyed observation stream:
  exact-window pixels, DOM, accessibility tree, app operations, terminal bytes,
  console/network records, or tool/effect receipts. A polished replay never
  substitutes for a missing perspective.

`ObservationBundle`:
  The versioned, capability-filtered view delivered to an agent Body. It names
  exact source/event versions, clocks and freshness, semantic anchors, human
  comments/selections as untrusted data, secure or uncapturable regions,
  active lease state, and completeness/gaps. The Body acknowledges the exact
  bundle it accepted before proposing an effect.

`Presence` and `Anchor`:
  Presence is lossy cursor, hover, viewport, typing, and focus state. An anchor
  is a versioned reference to screen geometry, AX/DOM element, terminal byte
  interval, editor object/frontier, or app semantic object. Presence is never
  authority; anchors may resolve, drift, become ambiguous, or expire.

`ControlLease`:
  The domain concept serialized as ADR-0135's `PortholeControlLease`: a short,
  attributable, target-bound, revocable capability for consequential input. It
  binds holder, issuer, Body, target/focus generation, allowed action classes,
  step-up level, action budget, time window, and physical-user preemption.
  Room membership, attention, pointer ownership, UI focus, and recent activity
  never mint authority. Blur, target change, capture loss, policy change,
  participant removal, expiry, or secure-field focus revokes the lease and
  discards queued input.

`CapabilityGrant`:
  A signed, attenuable grant binding principal, Body, exact resource/action,
  policy digest, audience, nonce, issue/expiry, revocation and credential
  provenance. It is separate from a `ControlLease`: the grant describes what
  may be attempted; the lease describes who may currently drive a particular
  live target.

`ActionIntent`, `EffectReceipt`, and `InvocationReceipt`:
  The proposed action, the source-bound observed result or honest unknown
  result, and the whole capability-run settlement. A command acknowledgement
  is not an effect. Effects cite the lease, precondition, target, dispatch,
  observed outcome, Porthole interval, and gaps.

## Realtime and archival lanes

Realtime collaboration and durable evidence share identities, event ids and
clock mappings, not delivery guarantees:

| Lane | Delivery | Authority |
| --- | --- | --- |
| Media | Congestion-controlled realtime | None; sealed archival segments are independent evidence |
| Cursor, hover, viewport, typing | Lossy latest-value-wins | None |
| Selection, comment, test annotation | Reliable ordered with acknowledgement | Durable only after append receipt |
| Control request/decision | Bounded RPC with timeout | Decision is appended before a capability/lease becomes active |
| Action, effect, gap, disclosure | Reliable local append | Producing authority's durable ledger |
| Index, summary, lineage projection | Asynchronous and rebuildable | None; all results cite source classes |

The local same-machine protocol must not depend on a hosted media service. A
remote stage may use an ephemeral encrypted realtime substrate only with fresh
participant consent and independent Port Daddy authorization. Room transport
does not own identity, keys, authorization, durable evidence, or disclosure.

Capture-readiness is an action precondition. Each required perspective must be
ready or visibly waived with a reduced-completeness receipt before the first
embodied action. Capture loss blocks or downgrades further action according to
policy; it never becomes a silent hole.

## Products using the same substrate

### Cooperative coding and multiplayer testing

Humans and specialized agents can join the same workspace or isolated browser,
desktop, simulator, device, or editor Body. They can follow or independently
inspect, point, select, comment, request control, hand control back, convert an
anchored observation into a bug or candidate test, and later reopen the exact
moment. Browser/app testing adds deterministic semantic adapters and test
oracles; it does not create a parallel collaboration system.

### Live Fleet Portholes

Each active `AgentNode` may advertise one active or most-recent `PortholeStage`
reference. FleetBar and Grand Harbor show capture health, source identity,
evidence class, completeness/gap state, current controller, and whether the
operator may view, point, comment, or request control. Opening the row joins the
stage or opens sealed history under explicit policy.

If no source-bound Porthole exists, the surface renders `unavailable`. A live
transcript, heartbeat, synthetic demo, or terminal cast cannot masquerade as a
native app/body perspective. FleetBar remains a lightweight launch and status
surface; the full live stage opens in the appropriate Porthole-capable client.

### Sugar and Parley

Sugar is an agent-facing interaction style and Parley is one structured
reconciliation protocol that bodies may run. Their sealed messages,
acknowledgements, settlement receipts, and semantic events can enter Porthole
as attributed inputs after their own runtime proof gates pass. They do not own
participant identity, the stage lifecycle, perspectives, control authority,
evidence classes, completeness, or disclosure. Raw performatives remain
inspectable protocol evidence, not the default user experience.

## Governed capability invocation and mutual non-exfiltration

The exchange unit is not necessarily source code. A provider may offer a
signed, content-addressed skill, agent, model, toolchain, or composite capsule
for invocation under a negotiated policy. The customer may supply authorized
data without receiving provider implementation; the provider need not receive
the customer's repository.

Every invocation separates:

1. **input grant**: exactly which customer resources the execution may read;
2. **execution grant**: exact tools, model, skills, network, time, cost,
   retention, and action capabilities;
3. **observation grant**: which participants, including the provider, may
   watch or inspect which perspectives;
4. **output/disclosure grant**: which result fields, evidence derivatives, and
   receipts may leave the execution boundary, to whom, for how long.

Default customer-bound execution denies network and unlisted egress. It can
keep customer data local, but it cannot prove that a provider's proprietary
skill or model is hidden from a customer who controls the host. Provider-bound
execution can protect implementation custody, but customer-data secrecy then
depends on minimization, enforceable I/O policy, and the named trusted computing
base. Containers alone do not make mutually distrustful parties blind.

The **trusted computing base (TCB)** is the hardware, firmware, and software
responsible for enforcing the security policy, following the
[NIST definition](https://csrc.nist.gov/glossary/term/trusted_computing_base).
**Remote attestation** is the evidence/appraisal exchange by which a relying
party assesses whether a remote execution environment is in an intended state,
following the role separation in [RFC 9334](https://www.rfc-editor.org/rfc/rfc9334.html).

The strongest two-sided claim requires confidential execution with fresh
remote attestation, non-extractable ephemeral keys, measured code/policy,
default-deny egress, bounded queries/rates, typed output contracts, disclosure
inspection, revocation, and auditable key release. Even then, output channels
remain model-extraction and data-encoding surfaces. Porthole supplies evidence
of observed access, attempted actions, effects, gaps, and disclosure; it does
not itself enforce information-flow secrecy.

### Signed invocation receipt

Both parties receive compatible, privacy-preserving `InvocationReceipt`s that
commit to:

- provider and consumer identities and signing epochs;
- capability/capsule name, version and content digest without revealing its
  protected implementation;
- project/harbor and policy digests without embedding secret inputs;
- input, execution, observation, output and disclosure grant digests;
- `ExecutionEnvelope`, Body and `BodyAdapter` identities and attestation state;
- resource **classes** accessed, denied attempts, action/effect receipt refs,
  network/egress decisions and terminal status;
- output-contract digest and result commitment, not undisclosed result data;
- Porthole stage, perspective, evidence-class, completeness and gap refs;
- cost/time usage, retention/disclosure decisions, and revocation state.

Receipts prove the signed statements and referenced evidence. They do not prove
unobserved absence, information-theoretic secrecy, or correctness of a model's
answer. PR #6786 is a useful blind-session substrate: sealed skill material,
execute-only caveats, output contracts and per-run receipts. Its own current
boundary is policy on a named executor TCB, with residual extraction risk and
no production poll/queue trigger. PR #9822 supplies a separate one-use action
capability foundation. Neither is silently rebranded as the completed rented
capability product.

## Implementation and evidence map

This table is a source/status map, not an integration or merge order:

| Surface | Current source state | Owner / decision authority | Acceptance gate |
| --- | --- | --- | --- |
| Universal Porthole direction and Phase 0 foundation | Active PR #9970; ADR-0135 and broad contracts are not on `main`; PR is dirty and has known security/coverage gates | Porthole program / ADR-0135 | Exact-head contracts, encrypted store, privacy, crash/contention, signing, completeness and retention-pin gates |
| Focused source-only evidence contracts | Active PR #10013; split from #9970; no routes, live ingestion, native capture or deployment | Porthole contract owner | Exact-head tests, coverage, review, roadmap and protected merge gates |
| Native exact-window stage | Active PR #9992; source/CI package with synthetic visual evidence, not an installed production capture | Native Porthole owner | Signed/notarized installed build plus operator-hardware consent, background, cursor, interaction and bounded-shutdown proof |
| Sugar/Parley | Active PR #9914 and follow-up runtime work | Sugar/Parley owner | Stable runtime deployment, fresh ordinary multi-party proof, then Porthole adapter bridge |
| Chartroom institutional authority | Draft PR #9989; no production deployment or Grand Harbor import | Grand Harbor/Chartroom authority owner | Signed production write/readback, partition and receipt gates, then explicit import/cutover plan |
| Search connective tissue | Active PR #9995 is provider-neutral design only; runtime selection, receipts, authorization and egress are successor work | Retrieval owner | Sanitized-before-index corpus, cited hybrid retrieval, authorization, invalidation/redaction cascade and production proof |
| Broad design-agent history draft | Draft PR #9997 is blocked, spans unrelated config/evidence surfaces and reports no tests; it is not Porthole or retrieval authority | PR #9997 owner | Reconcile or supersede its still-valid history/search claims through chapter 29 and the focused retrieval lane before promotion |
| Blind/rented capability substrate | Active PR #6786 is policy-bound blind-session first slice; PR #9822 is one-use action capability work | Security/capability owners | Named TCB, attestation, default-deny egress, extraction tests, compatible invocation receipts and explicit residual-risk disclosure |

PR #9996 is the active adversarial-test companion to native Stage PR #9992,
not a separate product direction. Its verdict can strengthen or block the native
adapter gate; it cannot promote synthetic evidence into installed capture proof.

Historical terminal proof from merged PR #9902 remains the terminal-perspective
reference. It is not an active PR and is not native Stage proof.

## Proof gates

The following are binder acceptance tests. Each must preserve source, compiled
artifact, runtime, visual proof, exact head and institutional acceptance as
separate witnesses.

`PH-01 Local live-to-history`:
  A person and an agent join an exact-target local stage before action, point
  and comment, grant one bounded `ControlLease`, witness its effect, stop, seal,
  restart, and reopen the same independently verifiable perspective and gaps.

`PH-02 Multiplayer browser/app test`:
  Builder, tester and person join an isolated browser or app Body. An anchored
  bug becomes a candidate deterministic test, a clean rerun and an effect
  receipt without granting page content authority over the agent.

`PH-03 Live Fleet`:
  FleetBar/Grand Harbor opens an active worker's Porthole, shows current
  controller and capture health, then opens the sealed history. A worker with
  only transcript evidence is labeled `unavailable` for native/browser POV.

`PH-04 Customer-bound rented capability`:
  A signed capsule runs against fixture customer data with network denied,
  emits only its typed output, records malicious egress refusal, and produces
  compatible receipts without secret input or capsule material.

`PH-05 Provider-IP and mutual-secrecy honesty`:
  The provider-IP badge stays `unavailable` on a customer-controlled ordinary
  host. It may become attested only after a reviewed confidential-execution
  profile proves measurement, key release, egress, output and revocation gates.

`PH-06 Epistemic downgrade`:
  Missing source, forged report, incomplete modality, stale index, unavailable
  citation and derived composite fixtures never render as stronger evidence.
  Grand Harbor may record an explicit policy acceptance without changing the
  evidence class.

`PH-07 Protocol independence`:
  A Sugar/Parley session produces attributed semantic inputs and a settlement
  receipt while the stage remains valid without Sugar and Sugar remains useful
  without Porthole. Neither protocol can mint the other's authority.

## Ambition classification for this reconciliation

| Ambition family | Classification | Destination and reason |
| --- | --- | --- |
| Porthole live cooperative body | `absorbed` | This chapter and ADR-0135; it is a foundational contract with PH-01, not later recorder embellishment |
| Cooperative coding and multiplayer testing | `absorbed` | This chapter, chapter 05, PH-01 and PH-02 |
| Live Fleet Portholes | `absorbed` | This chapter and PH-03; FleetBar is a launcher/status view rather than a second stage runtime |
| Private data plus rented skill/agent/model | `absorbed` | Governed invocation contract and PH-04/PH-05; marketplace listing, pricing and settlement UX remain deferred |
| Hardware-backed mutual confidentiality | `deferred` | Requires an operator-selected confidential-computing/attestation substrate and leakage policy |
| Full remote/mobile/device breadth | `deferred` | Requires exact-target local proof, live-session conformance and remote E2EE/device gates from ADR-0135 |
| Porthole defined by Parley replay | `superseded` | Sugar/Parley remains one protocol over bodies; ADR-0135 and this chapter own the universal stage/evidence contract |

## Unresolved operator and architecture decisions

These remain explicit; this chapter does not choose them silently:

1. Which confidential-computing and remote-attestation substrate, if any, is
   acceptable for the strongest provider-IP/customer-data claim?
2. What output-channel leakage budget, query/rate limit and human-review policy
   is acceptable for each rented capability class?
3. Who may observe a customer-bound run: customer only, provider by explicit
   grant, or an independently attested reviewer?
4. What are the commercial rules for licensing, royalties, revocation,
   vulnerability response, disputes, escrow and receipt-based settlement?
5. Which authority admits capsule publisher keys and execution measurements,
   and how do offline invocation and emergency revocation interact?
6. At what exact gate does Chartroom become authoritative for a remote harbor,
   and how is existing local institutional history imported without two writers?

Until these are decided and proven, product language must state the narrower
boundary and render stronger claims as `unavailable`.
