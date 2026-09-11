# Cooperative Harbor implementation ledger

Approved by the operator on 2026-09-08. Implementation is authorized; service
activation, paid runs, deployment and lifting the Port Daddy halt are not.
This is a source-controlled implementation checklist, not another roadmap or a
claim that the existing program has been changed in a running service.

## Outcome and ownership

Abe, Becky and Charli bring selected work, knowledge, constraints and assistants
to one project. They discover consequential conflicts and useful overlaps,
negotiate agreements, accept their own responsibilities, and deliver work across
devices and interruptions. Private perspectives remain distinct. A clean code
merge does not establish that their plans are compatible.

Parent: `port-daddy-unified-product-hypertree`
(`2df9b851-effa-4c41-9f85-2274d3007661`). Retain the existing
`chartroom-grand-harbor-authority-cutover`, `harbor-editor`,
`harbor-editor-p3-agents-as-peers-claims`, `harbor-editor-layer-a-tree-sitter`,
`harbor-editor-e2-operator-affordances`, `harbor-editor-local-text-input` and
`porthole-cooperative-live-stage` item identities. No live registry mutation is
permitted during the halt. This implements the cooperative work, evidence/memory
and remote/team portions of Grand Harbor, not its marketplace or settlement.

| Owner | Owns | Does not confer |
| --- | --- | --- |
| Personal perspective | Private knowledge, intentions, tools, history | Access to undisclosed context |
| Chartroom / Oracle | Canonical planning records and accepted plan revisions | Editing authority or a second Harbor event store |
| Harbor writer | Editing/execution records and their authoritative ordering | An independently mutable copy of Chartroom plans |
| Project Epistemology | Attributed, evidence-backed intersection allegations | Belief rewriting, assignment or execution authority |
| Remote Harbor | Membership, keys, synchronization, acknowledgements, recovery | Authority obtained merely by restoring data |
| Porthole / Logbook | Causal replay and evidence-linked continuity | Proof inferred from a note or status badge |
| Execution / future Convoy | Separately authorized, bounded effects and receipts | Permission inferred from a plan or prediction |

Cross-domain references bind immutable identities and exact revisions. The
existing account, principal, device, AgentNode, Harbor and ResourceScope remain
canonical; do not add Epistemology users.

## Delivery checklist

Each stage needs source, test and delivery evidence before its box is checked.
Designed, source-built, tested, deployed and observed are separate states.

- [ ] CH1: Reconcile custody, ownership, skills and existing roadmap references.
- [ ] CH2: Finish local editor foundations: DocumentRef, replica incarnations,
  stable cursors, everyday editing, syntax, diagnostics and render performance.
- [ ] CH3: Govern collaboration and interrupted-edit recovery using real Rust
  operation receipts, canonical replay, stable claims, filesystem witnesses and
  atomic claim-transfer/provenance finalization. Keep public recovery 503-gated.
- [ ] CH4: Shared project state, invitations, participation, scoped disclosure,
  executable dependency plans, negotiated commitments, decisions, keys,
  revocation and device recovery.
- [ ] CH5: Separate managed Cloudflare Harbor runtime, encrypted journals,
  durable-before-ack heads, reconstruction, explicit transfer and transport parity.
- [ ] CH6: Contributions, scoped intersection analysis, resolution,
  decision-linked work and incremental invalidation.
- [ ] CH7: Native/web/iOS/companion delivery, Porthole continuity, accessibility,
  human task testing, reviewed PRs and exact-version release evidence.

### CH1: accepted contract amendments

Managed Cloudflare hosting is recommended for **new shared projects**, with
explicit consent. Account-free local-only and self-hosted use remain supported.
The managed runtime may decrypt explicitly shared project content for approved
project work; it receives no implicit access to personal notes, conversations or
assistant memories. The service and infrastructure operator are inside that
mode's trust boundary. Device-private mode retains its stronger custody boundary.
See the amendments in ADR-0123 and ADR-0126. Relay and protected object storage
remain ciphertext-only; the managed runtime has separate identities, bindings
and project-scoped keys. Account roots and personal keys stay outside it.

Container disk is not durable storage: Cloudflare documents disk loss on restart.
Use immutable encrypted R2 journal segments/artifacts, and transactionally checked
signed heads, idempotency and delivery records in a SQLite-backed Durable Object.
Upload blobs before referencing them. Shared acceptance requires a complete
durable journal segment and checked head. A locally prepared transaction cannot
authorize publication or effects. Reconstruct checkpoints plus the complete
subsequent journal and verify the current lease before accepting writes.
The authorized kernel signs; the relay cannot manufacture a writer lease.
These are application protocol requirements, not guarantees supplied by storage
alone. Sources: [Container lifecycle](https://developers.cloudflare.com/containers/concepts/architecture/),
[DO transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/).

Connection loss permits local drafts, not shared acceptance. Runtime restart
reconstructs the same authorized Harbor. Planned transfer requires a signed
epoch change and successor acceptance. Lost-host recovery fences the predecessor
and requires recovery authority. Missing keys or journal segments mean unavailable,
not silent truncation or authority invention. Offer encrypted backup and an
explicit self-host-to-managed transfer; no backup means no recovery promise for
destroyed device-only work. Restored data never grants administrative control.

### CH2–CH4: concrete data boundaries

Every consequential record carries immutable identity/revision, tenant/project/
Harbor/repository/disclosure scope, authoring principal and embodiment, exact
source references, recorded/applicable time, supersession and required grant
revision. Extend the existing schema/event families and rebuildable projections.

| Record | Required meaning |
| --- | --- |
| ProjectParticipation | Existing identities, responsibilities, capability offers, availability, decision rights, agent delegations |
| EvidenceRef | Exact source revision/digest/location, provenance, grant and retention |
| Assertion | Attributed proposition, evidence, warrant, uncertainty, scope and time |
| Goal / ValueConcern | Owned outcome or constraint and priority authority |
| WorkIntent / WorkPlan | Actions, assumptions, dependencies, alternatives, acceptance criteria; complete the existing unshaped scaffold |
| Commitment | Accepting principal, beneficiary, negotiated terms/due condition and verified fulfillment; extend the current store |
| ConsequenceEdge | Premise, consequence, conditions, evidence and verification status |
| IntersectionCase | Opportunity/conflict, affected exact revisions, bounded paths, uncertainty and next question |
| Decision | Exact proposal, authorized decider, rationale, required acceptances, attributed dissent and effective scope |
| WorkReceipt | Existing action/effect authority, artifacts, checks and actual outcome |

Offer is not assignment; proposed assignment is not accepted commitment. Do not
impose the daemon's agent deadline defaults on humans. Reading is not accepting.
Published contributions do not expose their author's entire history. Extracted
assertions remain unconfirmed interpretations. Decisions govern agreed behavior,
not beliefs. Dissent retains its author and revisit condition. Corrections append
superseding records. Revocation/erasure invalidates caches, queued analysis,
retrieval, exports and dependent cases; already disclosed plaintext cannot be
made undisclosed.

DocumentRef binds Harbor, repository, worktree/ref and stable document identity;
local paths are mappings, never cross-machine identity. A verified principal has
distinct device/session replica incarnations. A successor gets its own replica
while retaining predecessor-authored operations. Stable CRDT positions anchor
cursors/annotations, not line numbers ([Loro cursors](https://loro.dev/docs/tutorial/cursor)).

Reuse EditorPane, the pane tree, surface actions and background pipeline. Validate
IME/Unicode, selection/clipboard, undo/redo, wrapping, virtualization, native
incremental syntax, navigation/diagnostics, file operations, diff/review,
tests and Git/PR handoff. Support independent worktrees and explicitly shared
document sessions; companions disappearing cannot erase project state.

### CH6–CH7: interactions and prediction

Project navigation is Overview, Plan, Work, Decisions and Evidence. The center
holds the working artifact or selected case; the inspector explains intent,
dependencies, agreements, evidence/dissent and scope. People/agents live in a
collapsible roster. Overview answers goal, my responsibility, consequential
changes, needed decisions and verified outcomes.

Contribution sheets preview exact content, audience, proposed interpretations
and managed-processing consent. Intersection cards lead with the consequence,
show the bounded evidence path and uncertainty, and ask the smallest question.
Offer clarify, challenge, propose resolution, defer with revisit condition and
dismiss with reason. Decision views compare alternatives and outstanding assent.
Editors show authors, cursors, claims, intent, decisions and test evidence.
Direct claim violations are enforced; speculative semantic cases stay advisory
unless a separately authorized policy establishes a gate. Recovery distinguishes
durable work, device-only drafts and the proposed successor's inheritance.

Material changes to published plans, commitments, decisions or relevant shared
evidence may trigger bounded prediction under approved policy and budget. Never
analyze private activity or every keystroke. Filter authority/disclosure **before**
hybrid lexical/dense retrieval with compatible spaceIds. Build typed bounded
paths; check time, applicability, exceptions and missing premises. Output an
opportunity, conflict allegation or insufficient evidence. Recheck grants/source
revisions before delivery, invalidate affected cases on change, and record
coverage limits/provenance. Similarity is not contradiction.

Hosting, prediction and execution permissions/budgets are distinct. Background
prediction inherits account/global suspension. Unknown control state denies new
automated paid work; human editing, evidence access and emergency controls remain.

Web and native iOS support review, contributions, decisions, evidence, membership,
hosting/recovery and controls, not miniature desktop IDEs. All surfaces use the
same freshness and acknowledgement states, semantic tokens, readable type,
keyboard access, light/dark, zoom and reduced motion. Graphs are optional.

## Acceptance and release gates

The field-notebook end-to-end scenario must prove:

- [ ] Three people on separate machines publish selected context only.
- [ ] Central-validation-before-save is shown to prevent offline capture despite
  a clean code merge; the local operation log is also identified as a retry opportunity.
- [ ] Local save and shared acceptance are distinguished, with original beliefs,
  dissent and exact decision/acceptance revisions preserved.
- [ ] People accept their own work; agents cannot volunteer another person's time.
- [ ] Adjacent co-editing, offline/reconnect tests and traceable delivery work.
- [ ] Interrupted work retains correct authorship; restart loses no acknowledged transaction.
- [ ] Revoked members get no fresh content through warmed caches, queues, search,
  exports or recovery. Identical tenant names/paths never merge authority.
- [ ] Duplicate/reordered events, concurrent devices, stale decisions, expired
  leases, split brain, missing checkpoints/keys, spent budgets and unavailable
  pause settings fail safely. Private-premise changes cannot alter unauthorized output.
- [ ] Real native light/dark screenshots, task recording, keyboard/zoom/a11y and
  human task testing exist. The halt currently prevents native runtime observation.
- [ ] Held-out evaluation against shared-retrieval and similarity-only baselines
  reports useful findings, missed collisions, false alarms, review time and cost.
  Inconclusive results remain experimental.

## Evidence so far

Detailed [foundation evidence](../research/egosystem-reconciliation/final/cooperative-foundations-evidence.md)
records the tested subset and blockers. CH1 source amendments/checklist/skill
corrections are written; canonical registry reconciliation and landed proof are
held. CH2 has tested document routing, fresh replica incarnations, exact-history
mirrors and stable local selections, not a complete editor or shared session.
CH3–CH7 remain open. No stage is closed merely because its design was recorded.

- Base reconciled with `origin/main` at `ea797e6244ca5153bcf0faed926a53ac306d5b26`.
- Existing research commits preserved on a separate implementation branch.
- No services, paid inference, agents or deployments started. Full product
  completion, runtime observation and predictive benefit remain unproven.
