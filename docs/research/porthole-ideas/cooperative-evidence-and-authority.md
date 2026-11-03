# Porthole cooperative evidence and authority archaeology

**Scope:** Synthesis of the cooperative Porthole concept and evidence/authority boundaries across current source and selected historical objects. Research only: this is not a contract, roadmap, implementation claim, runtime authorization, or release receipt.

**Checkpoint:** `/Users/erichowens/coding/tmp/porthole-ideas-archeology`, branch `codex/porthole-ideas-archeology`, HEAD `94f6f6dca8a4120ef8748fc84e9777b06151f9f5`. This worktree is intentionally sparse. Current citations mean that exact HEAD; historical objects are marked explicitly and are not current-main evidence.

## Synthesis

The Aug. 30, 2026 universal-stage expansion reframes Porthole as a live cooperative stage around a chosen app: a person and embodied agents explore together, point, comment, ask for bounded control, and create evidence from what happened. Recording is a witness of cooperation, not the product boundary. This is a later ambition, not Porthole's earliest product idea: the Aug. 29 product document says it began as a better terminal recorder and still treats terminal evidence as its initial wedge (`demos/porthole/PRODUCT.md:5-12`; `docs/adr/0135-porthole-universal-pov-evidence.md` at `b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b:5,19-29,52-67`).

Terms used below: a **Body** is the concrete process or device acting for a participant; a **control lease** is limited permission to act on one target; a **perspective** is one independently attributable observation stream; a **completeness receipt** is a signed account of expected/recorded coverage and gaps; a **projection** is a derived view over source evidence. These meanings follow the source's participant/body, lease, perspective, receipt, and derivation contracts (`docs/adr/0135-porthole-universal-pov-evidence.md` at `b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b:152-177,194-206,229-255,401-415`).

The concept depends on keeping identity, presence, observation, authority, effect, evidence, and projection separate. Joining does not grant capture, control, recording, indexing, delegation, or disclosure. A cursor is presence, not a capability. An action request is not an effect. Replay is not completeness. A schema or fixture is not an exercised runtime. These are the system's central product and trust boundaries.

The evidence ambition is correspondingly broad: independently attributable perspectives; source, stage, and display clocks; pre-action capture schedules; append-only event chains; signed completeness receipts that expose missing or unreadable data; privacy receipts bound to sanitized bytes; disclosure receipts; lineage-aware search; and reviewed regression candidates. The aim is to let a later reviewer reconstruct what was observed, when, under what policy, what was omitted or transformed, and what remains unproven.

Current documents explicitly constrain claims. The native loop is “source-only” and says native crypto/control integration is not wired (`docs/design/porthole-cooperative-native-loop.md:3-15`). The security slice starts no capture, daemon route, service, or operator recording (`docs/operations/porthole-contract-security.md:3-8`). Grand Harbor scenarios are proposed and require named evidence (`docs/grand-harbor/03-product-experiences.md:3-7,101-108`). Native source says synthetic pass, self-issued receipts, and compile success do not certify privacy, deployment, store readiness, or end-to-end completion (`docs/design/porthole-cooperative-native-loop.md:121-130`).

## The cooperative stage and user stories

Historical ADR-0135 rejects treating terminal replay, Parley, a browser extension, or passive recording as the ontology. Each is one useful producer/context; none alone describes arbitrary GUI cooperation (`b4c4a19…:31-65`). The universal stage is bounded to a selected target and can combine pixels with semantics, human meaning, agent actions, and later review.

The user stories implied by the design are:

1. **“Help me inspect this exact app with an agent.”** Choose one window, tab, simulator, document, or pane; see the named target and active/degraded perspectives; do not silently widen capture. ADR-0135 lines 87–112; current stage schema `schemas/agent-harbor/v0/porthole-stage.schema.json:12-35,117-159,179-215`.
2. **“Let us reason together without fighting over the mouse.”** Cursors and hover are lossy presence; selections/comments become reliable after append acknowledgement. Uninstrumented OS input has one controller while others can point, comment, and request control. ADR-0135 lines 257–290.
3. **“Let the agent act only on what it received.”** Each observation bundle names authorized frame/event versions, semantic anchors, human notes and trust labels, policy/gap state, lease budget, and freshness token. The body acknowledges its input version, acts against that precondition, and gets a refusal, dispatch, observed/unknown effect, or revocation. ADR-0135 lines 449–467.
4. **“Turn this moment into a bug report or test without declaring it correct.”** Freeze a bounded interval with expected behavior in the reporter’s words, actions/effects/build/revision/gaps/privacy, then derive a candidate for review and clean rerun. ADR-0135 lines 292–316; regression receipt schema description at current `schemas/agent-harbor/v0/porthole-regression-receipt.schema.json:4-5`.
5. **“Find the incident later from a vague recollection and share only what I approved.”** Search returns cited intervals and makes missing streams visible; sharing previews the exact derivative and records a recipient-scoped grant and disclosure receipt. ADR-0135 lines 318–330.

This is not one undifferentiated “screen share” permission. Current design separates remember-buffer, deliberate recording, and cooperative modes; starts selected-window, local-only, visible, no audio, no autostart; and separates recording, indexing, recall, and disclosure (`docs/design/porthole-cooperative-native-loop.md:71-84`). Historical ADR-0135 lines 301–316 describes an explicit bounded support buffer, whose purpose is “report what just happened” without silent background surveillance.

## Participation, identity, and presence

The historical model distinguishes a durable participant (person or AgentNode), the concrete Body acting now (process, browser, editor, device), and ephemeral presence (cursor, hover, viewport, typing). Presence may vanish without erasing identity, authority, comments, actions, or effects (ADR-0135 lines 152–164). The operator is a participant and witness, not an invisible recorder.

Current role examples are directional: the source owner chooses source and audience; a collaborator may receive granted tracks but approves publishing their own source separately; each agent is a distinct recipient; an observer gets no control/delegation/archive permission; a later viewer has no live-room key and needs a separate historical grant (`docs/design/porthole-cooperative-native-loop.md:33-47`).

Durable collaboration includes selections, comments, decisions, requests, grants, revocations, and effect receipts. Cursor/hover/viewport are transient presence. That distinction allows people and agents to collaborate without making each transient UI packet durable truth (ADR-0135 lines 161–164, 257–275).

## Control leases and authority

A control lease is a narrow, short-lived capability bound to a specific target and concrete Body, not an implication of room membership, cursor ownership, focus, or activity. ADR-0135 specifies target/focus generation, authority snapshot and step-up, bounded action count and TTL, physical-user preemption, atomic focus revalidation, distinct clipboard capabilities, and revocation on blur, target change, removal, capture loss, policy change, timeout, or secure-field focus (lines 194–206, 276–290). Current schema exposes target generation and focus commitment, holder/requester/grantor, capabilities, step-up state, action budget, clipboard-read denial by default, physical-user preemption and revalidation: `schemas/agent-harbor/v0/porthole-control-lease.schema.json:17-34,36-68,70-115,116-140`.

The protocol sequence is request action class/duration; authority grants, modifies, rejects, or ignores; adapter acknowledges the exact lease; resulting effect cites the lease, target, precondition, observed outcome, and evidence range. Revocation discards queued input. Current native-loop guidance likewise separates commands from projections and requires signed invocation receipts for effects/gaps (`docs/design/porthole-cooperative-native-loop.md:43-47`).

The human protection is not merely a confirmation dialog: the proposal is attributable and visible, approval is bounded, dispatch revalidates focus/policy at the effect boundary, and the outcome can be “unknown.” Porthole records/project this boundary but does not become its authority issuer. The atlas separates Porthole (“what did it look like and how did it unfold?”) from Logbook (“what was asserted, by whom, under what authority?”) and says Porthole does not become agent identity or control authority (`docs/proposals/grand-harbor-product-atlas.md:252-275`).

## Semantic evidence projection and replay truth

Porthole is a projection across evidence sources, not a flattening layer. Historical ADR-0135 lists exact-window pixels, accessibility, DOM, app operations, terminal bytes, console errors, and tool receipts as distinct perspectives. Each has its own sequence, key, completeness receipt, clock map, and hash commitment (`b4c4a19…:166-177`). A composite can aid navigation but cannot hide a missing source or elevate a weak modality.

Time keeps source monotonic, source wall time and uncertainty, stage time, and edited display time distinct; jump cuts change display position, never source time (`b4c4a19…:469-482`). Current stage-event schema carries source/stage/display timing and separate ephemeral and sealed content (`schemas/agent-harbor/v0/porthole-stage-event.schema.json:8-36,37-80,82-123`).

“Effects, not claimed intent” is a core invariant: the adapter witnesses target and outcome or marks the outcome unknown. Permission loss, dropped frames, quarantine, restarts, clock uncertainty, and offline time are explicit gaps rather than hidden by smooth playback (ADR-0135 lines 83–120). Grand Harbor's evidence table reinforces the limits: source does not prove runtime; commit does not prove deployment; PR/check is exact-head automation, not runtime truth; visual capture does not prove hidden semantics/accessibility; transcript does not prove unsupported claims (`docs/proposals/grand-harbor-product-atlas.md:252-267`).

For each displayed claim, the projection should expose its source, participant/Body, source interval and clock map, privacy transformation, completeness/gap state, derivation lineage, and what evidence would be required for a stronger claim.

## Provenance, completeness, disclosure, and deletion

Completeness is committed before action. The adapter declares its sequence/cadence/watchdog and completeness rule before the first embodied action; the terminal receipt applies that rule rather than defining expected data from whatever happened to be retained (ADR-0135 lines 229–255). Current `porthole-completeness-receipt.schema.json:12-37,39-48,77-99` binds schedule and terminal event and separately counts verified/unreadable segments, declared gaps, and missing captures. Current security docs say timing checks are independent of hashes/signatures; chronology validity differs from chain integrity (`docs/operations/porthole-contract-security.md:19-25`).

Cryptographic commitment, privacy, and authority are distinct. A hash/signature binds bytes to a key; it does not prove the target was safe, capture complete, sharing authorized, or content true. Structural ciphertext-envelope validation does not authenticate ciphertext; AEAD opening is separate. Verification authority must be independent of the issuer (`docs/operations/porthole-contract-security.md:26-49`). Raw evidence, authorized-device retrieval projections, and scrubbed warehouse aggregates stay separate (`:107-109`).

Sharing is itself an evidence-producing act, not a toggle. The receipt should identify recipient, exact interval/derivative, redaction pipeline, grant/key scope, duration, and residual risk. Revocation can limit future retrieval and destroy controlled keys; it cannot make a viewed/exported secret unknowable (ADR-0135 lines 326–330, 563–565). Indexes/summaries are rebuildable projections with lineage, not alternate source ledgers (lines 401–415, 678–701).

## Regression receipts and rejection frontier

Test derivation is reviewed work. A click trace suggests a test; it does not prove an expected assertion. Current regression receipt description calls for source commitments, generator, privacy scan, clean-profile/build/worktree/sandbox/egress attestations, artifact hashes, repeated attempts, human review, and accepted/rejected lineage (`schemas/agent-harbor/v0/porthole-regression-receipt.schema.json:4-5`).

A historical extension applies the same falsifiability discipline to claims about validators: construct one lie against one exact validator; bind source/validator/test-bundle digests, baseline and mutated outcomes, replay path, artifacts, issuer, and signature. “Killed” means the unchanged baseline passed and that particular mutant was rejected; it does not prove every lie in its class rejects. A separate coverage inventory marks claims demonstrated, survived, not-demonstrated, inconclusive, or out-of-scope and requires reasons/receipt links. These contracts exist at historical object `809f8886c1`: `schemas/agent-harbor/v0/porthole-mutation-receipt.schema.json:3-5,13-23,24-42,55-83`; `porthole-rejection-coverage.schema.json:3-5,15-60,65-82`; and `porthole-mutation-invariants.mjs`.

That “rejection frontier” is valuable because it says exactly which constructed deception was rejected, which survived, and which claims have not been challenged. It prevents a green aggregate or signature from becoming an unbounded security claim. Important status: these mutation/rejection schemas are historical-only at inspected HEAD `94f6f6d`; they are not current-main or runtime capability. Current HEAD retains the regression receipt, not those two contracts.

## Integration topology

- **Porthole:** consented observations, evidence contracts, replay projection. Not identity, control authority, a duplicate transcript ledger, or an independent search owner. Current plan: Porthole observes; shared search retrieves; Epistemology evaluates; Drydock governs execution (`docs/design/porthole-cooperative-native-loop.md:20-31`).
- **Sugar/Parley:** one agent coordination producer, not Porthole ontology. Historical ADR-0135 lines 513–539 says natural interaction belongs to Sugar; raw performatives remain drill-down and are not stage event kinds just because Parley ran there.
- **Drydock:** governs isolated execution/outcome proof. Porthole may surface evidence beside work, but guest assertion is not host-containment proof (`docs/design/porthole-cooperative-native-loop.md:112-113`).
- **Epistemology/search:** evaluates claims and retrieves cited intervals. Do not add another index or promote repeated summaries (`docs/design/porthole-cooperative-native-loop.md:20-31,96-105`).
- **Grand Harbor:** Porthole is one surface in a truthful workstation: Chartroom explains why, Claim Forest where, Actors who, action review what is authorized, Porthole what happened (`docs/grand-harbor/03-product-experiences.md:59-65`). Cooperative sovereign Harbors require directional grants and label weaker conventional-adapter guarantees (`:75-81`). The atlas calls inconsistent views of the same canonical typed state a product defect (`docs/proposals/grand-harbor-product-atlas.md:269-287`).

## Ambition versus inspected proof

| Evidence layer | Establishes | Does not establish |
|---|---|---|
| Product direction | Cooperative-stage journeys and intended authority/privacy/evidence boundaries. | Shipped universal stage or adapter parity. |
| Current contracts | Schemas/fixtures and source-level validation/storage slice (`docs/operations/porthole-contract-security.md:10-52`). | Capture integration, enrolled authority, daemon/service admission, or installed app (`:79-105`). |
| Historical contracts | ADR-0135 universal-stage direction; mutation/rejection contracts at `809f8886c1`. | Presence in current HEAD or runtime capability. |
| Fixtures/tests | Contract expectations and the behavior exercised by an exact test run. | Real-target privacy, independent signing authority, deployment, or complete user journey. |
| Visual artifacts | Rendered appearance at a moment. | Hidden semantics/accessibility, provenance, completeness, control enforcement. |
| Live proof | Requires named build/target, permissions, independent witnesses, receipts, gap handling, and adversarial cases. | Not supplied by this research note. |

A migration caveat is explicit in ADR-0135 lines 484–511: historical public terminal casts are sanitized derivatives, not raw archives or completeness proof; jump cuts are display mapping; regex highlighting is not privacy, redaction, retrieval, or completeness authority.

Current security checklist says schemas alone never grant control, adapter admission needs immutable capture lease and pre-persistence exclusion/redaction, service exposure needs storage/recovery/resource proof, and native release has separate synthetic proof/package/notarization gates (`docs/operations/porthole-contract-security.md:79-105`). The cooperative native plan leaves real RTC media/data E2EE, audience isolation, rotation, removed-member reconnect, and loss recovery as release proof to complete (`docs/design/porthole-cooperative-native-loop.md:106-111`).

## Open product/research questions

1. What is the smallest useful first live stage for one human and one agent with exact-window pixels, comments, a lease, and durable effect observation, while clearly labeling missing semantics?
2. What independent mechanism binds the chosen OS target to the actual stream after resize, movement, occlusion, relaunch, or process identity change?
3. How can the UI show proposal, lease holder, pending effect, and uncertainty without exposing protocol internals? Which decisions deserve interruption?
4. What does recovery look like when one-frame secrets, unknown child windows, mask races, scanner suspicion, or adapter restarts cause quarantine/gaps, without pressuring users to disable protection?
5. How are sources combined without semantic labels overriding pixels, source bytes, incomplete schedules, or “unknown” outcomes?
6. How do separate Harbors make sovereignty, cross-device grants, revocation, observer roles, and weaker adapter guarantees legible?
7. Who owns expected behavior and test acceptance? How are flaky/environment-bound candidates separated from demonstrated reproductions, and what held-out evidence shows reduced recurrence?
8. Which canonical authority issues/verifies leases, privacy, completeness, disclosure, and test-review receipts? Which claims need an external witness?
9. What can be claimed at each adapter tier: visual-only, semantic, replayable, complete, private, live-shared, externally witnessed?

## Source index

- Earliest product framing inspected: [Porthole product](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/demos/porthole/PRODUCT.md#L5-L24), which says the wedge began as a terminal recorder and describes an evidence/continuity layer.
- Later universal cooperative-stage expansion: [ADR-0135 at historical object b4c4a19](https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/docs/adr/0135-porthole-universal-pov-evidence.md#L19-L29), with scope and product needs at [lines 31–81](https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/docs/adr/0135-porthole-universal-pov-evidence.md#L31-L81). Same-object [foundation changelog](https://github.com/curiositech/port-daddy/blob/b4c4a19d77e07fdb1a65e00e88bf15ab7700ca0b/changelog.d/9970-porthole-universal-stage-foundation.md#L1-L3) describes schemas/unexposed storage, not live capture.
- [Current native cooperative-loop plan](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/design/porthole-cooperative-native-loop.md#L1-L31), [authority and transport](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/design/porthole-cooperative-native-loop.md#L33-L69), [delivery checklist](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/design/porthole-cooperative-native-loop.md#L71-L130).
- [Current security contract](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/porthole-contract-security.md#L1-L52), [remaining exposure gates](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/operations/porthole-contract-security.md#L79-L109).
- [Grand Harbor product experiences](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/grand-harbor/03-product-experiences.md#L59-L81) and [Porthole/Logbook product boundary](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/docs/proposals/grand-harbor-product-atlas.md#L252-L287).
- Current stage/readiness contract: [PortholeStage](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/schemas/agent-harbor/v0/porthole-stage.schema.json#L12-L35); current [control lease](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/schemas/agent-harbor/v0/porthole-control-lease.schema.json#L17-L34); [completeness receipt](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/schemas/agent-harbor/v0/porthole-completeness-receipt.schema.json#L12-L48); [regression receipt](https://github.com/curiositech/port-daddy/blob/94f6f6dca8a4120ef8748fc84e9777b06151f9f5/schemas/agent-harbor/v0/porthole-regression-receipt.schema.json#L1-L45). Fixtures are not runtime proof.
- Historical-only [mutation receipt](https://github.com/curiositech/port-daddy/blob/809f8886c1/schemas/agent-harbor/v0/porthole-mutation-receipt.schema.json#L3-L23) and [rejection coverage](https://github.com/curiositech/port-daddy/blob/809f8886c1/schemas/agent-harbor/v0/porthole-rejection-coverage.schema.json#L3-L24) at `809f8886c1`; neither is present at current HEAD or runtime capability.
