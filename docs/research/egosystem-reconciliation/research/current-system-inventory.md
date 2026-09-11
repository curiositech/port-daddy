# Current Port Daddy Inventory

Status: current-source inventory, not a product claim  
Fetched baseline: `origin/main@38e52122a7b54346d509bf5b7ae07278f1c48ced`  
Parent: `chartroom-grand-harbor-authority-cutover`

## Inventory rule

This document distinguishes five kinds of truth:

1. **accepted doctrine**: an accepted ADR or explicit operator rule;
2. **source-present mechanism**: code and tests exist in the fetched source;
3. **runtime-proven mechanism**: the installed daemon was directly exercised;
4. **projection**: a replaceable view derived from another record; and
5. **proposal**: an ADR, mock, or document whose behavior is not established.

Source presence is not runtime proof. Retrieval is not authority. A signed or immutable event proves provenance and integrity, not that its claim is true. A roadmap note records attributed history; it does not let its author decide the roadmap item.

## Mapping to the Project Epistemology tuple

The research hypothesis uses:

\[
\mathcal P_t = (E_t, B_t, G_t, I_t, C_t, A_t, V_t, U_t)
\]

| Object | Existing substrate | Current status | What is missing |
| --- | --- | --- | --- |
| `E` evidence | session notes, transcript events, Porthole artifacts, test/commit/PR references, Harbor events | several append-only or provenance-bearing mechanisms exist; retention and disclosure differ by source | one normalized evidence reference with integrity, observation time, authority class, disclosure envelope, retention, and falsification state |
| `B` actor belief | profile instructions, handoff decisions, messages, notes | prose exists; no first-class actor-indexed belief state | explicit subject, proposition, confidence/uncertainty, observed-at, believed-at, basis, scope, supersession, and visibility |
| `G` goals | roadmap items, session plans, task purposes | roadmap and plan mechanisms exist, at different authority levels | typed relationship between organizational goal, bounded work goal, affected outcome, and current authoritative status |
| `I` intentions | file/symbol claims, session purpose, proposed actions | claims and purpose are source-present | explicit intended action, preconditions, expected consequences, expiry, and withdrawal without treating intent as permission |
| `C` commitments | `lib/commitments.ts`, claim-linked obligations | source-present; closure can require an oracle | connection from commitment to goal, decision, value, evidence, and consequences; richer independent closure receipts |
| `A` arguments | Tube `supports`, `contradicts`, `extends`, `narrows`, `synthesizes`; discourse lineage; Parley | source-present typed message edges and structural triggers | proposition/premise/warrant objects, undercut versus rebuttal, evidence validity, scope, adjudication, and non-naive resolution |
| `V` values | operator directives, policy prose, ADR drivers, permission rules | distributed in prose; no typed value object | affected stakeholder, protected value, priority/lexical constraint, value owner, conflict rule, consent and escalation threshold |
| `U` unresolved | Parley conflict signals, open commitments, review findings, roadmap blockers | several domain-specific open states exist | unified but scoped unresolved-question object with competing arguments, materiality, owner, deadline, escalation and closure criteria |

## Existing authority that must remain authoritative

### Harbor authority

ADR-0122 is accepted doctrine: exactly one authoritative writer owns the canonical harbor sequence at a time. Remote bodies, phones, CI publishers, and peers may propose events; they do not co-write canonical state. The relay mirrors and transports signed events but cannot grant a writer lease, author an epoch, or decide ACLs. Project Epistemology must therefore be an event family ordered by the current Harbor authority, not a peer database or a second sequencer.

### Roadmap authority

`docs/roadmap/AUTHORITY.md` says the live daemon's `roadmap_items` store is authoritative and repository snapshots are projections. The current `chartroom-grand-harbor-authority-cutover` epic is intended to replace the local/snapshot authority with one remote append-only planning authority. This research is a specification child of that cutover. It must not settle the cutover by building a competing local truth store.

### Durable identity

ADR-0121 is accepted doctrine: the daemon-minted opaque `AgentNode.agentNodeId` is the durable person; a runtime body, bounded session, and static organizational actor are distinct layers. Beliefs and contributions must bind to AgentNode or an attributable human principal. Display names and reviewer personas are routing/interaction metadata, never credentials.

### Resource scope and disclosure

`lib/resource-scope.ts` defines repository, worktree, ref, commit, harbor, catalog, and quarantine worlds inside account/team/project/harbor scope. It defaults protected material to explicit grants and prefilters vector candidates before ranking. The epistemology layer must use the same opaque scope and grant decision. Similar names, paths, users, devices, or embeddings confer no cross-project authority.

### Commitments

ADR-0041 and `lib/commitments.ts` distinguish a promise from a result: `done` requires an oracle reference such as a released claim, commit SHA, test id, or arbiter check. This is directly reusable. It does not prove quality, and a free-text success note is not closure evidence.

## Existing evidence and projection mechanisms

| Mechanism | Useful contribution | Boundary |
| --- | --- | --- |
| immutable session notes (ADR-0007) | attributed append-only corrections within session history | session cleanup/retention means they are not a universal permanent evidence ledger |
| transcript archive and handoff capsules | execution history and sanitized continuation context | raw transcripts do not gain authority; cross-boundary continuation uses sanitized, rescanned material |
| Porthole evidence | source-bound execution observation and inspectable artifacts | capture permission, source identity, cursor/scope, retention and redaction remain part of proof; recording is not intent or truth by itself |
| Harbor event ledger | ordered, signed, attributable history | integrity/attribution do not validate the semantic claim |
| roadmap notes | immutable work receipts and supersession prose | note author does not become item owner or canonical decision maker |
| graph edges | typed, derived planning relationships | derived edges remain projections unless their source relation is authority-owned |
| roadmap chomp | deterministic extraction of plans into authoritative items | extraction proposes/plants items; prose adjacency and semantic similarity do not justify a relationship |
| retrieval fabric | authorized hybrid lexical+dense+lineage candidate discovery | every result is a candidate; incompatible vector spaces fail closed; retrieval never decides contradiction or policy |
| GitHub comments, checks and PR summaries | familiar collaboration, review and actuation projections | mutable and provider-owned presentation is not the sole institutional record; append-only finding, argument and commitment events remain authoritative |

## Existing conflict and discourse mechanisms

### Discourse lineage

`lib/tube.ts` carries five discourse relationships: `supports`, `contradicts`, `extends`, `narrows`, and `synthesizes`. `lib/discourse-lineage.ts` builds a message graph and calls a contradiction unresolved when the target has no later `synthesizes` child. This is a useful conversational index, not a truth-maintenance system. Any message may label itself, and a synthesis edge currently says nothing about premise validity, authorization, affected value, or whether the contradiction was actually resolved.

### Parley

ADR-0111 remains proposed, while Parley source and tests are present. `lib/parley-trigger.ts` admits structurally produced conflict signals at bounded checkpoints and chooses `debate-with-judge` or `contract-net`. Automatic admission uses server-owned policy, hard round/delegation limits, and evidence references. This is the correct bounded convening substrate. Project Epistemology should supply typed propositions, arguments, and consequences to Parley; it should not create a second debate runtime.

### unSpider

ADR-0032 is proposed and no `lib/unspider.ts` implementation is present on the fetched baseline. Its sound ideas are evidence-first detection, deterministic high-confidence checks, two output lanes, bounded cost, and Cartographer as roadmap writer. Its stale elements include lexical-only matching and prose/path scanning that conflict with the current provider-neutral retrieval policy. Treat it as predecessor design input, not shipped detector truth.

## What does not exist as one governed mechanism

- actor-indexed beliefs distinct from evidence and institutional state;
- an authority-owned `Decision` transition that records alternatives, arguments, values, decider, rationale, effective interval, supersession, and appeal;
- a typed premise/warrant/conclusion graph with rebuttal, undercutting, and undermining;
- consequence closure from proposed change to affected commitments, permissions, stakeholders, and user outcomes;
- controlled disclosure that preserves independent retrieval before cross-review;
- a single impact preview that explains which outcome is gained, lost, narrowed, or replaced;
- a calibrated detector with allegations, proof paths, false-positive feedback, and human-attention accounting;
- one query surface that answers “what did this project believe at time t, why, under whose authority, and what remains contested?”
- an explicit separation among outcome owner, durable role, synthesis owner, App actuator, deterministic queue and human decision authority;

## Reuse plan

| Need | Reuse | Extend only by |
| --- | --- | --- |
| canonical ordering | Harbor authority/event ledger | new epistemic event types and deterministic projectors |
| durable principals | AgentNode + human/account principals | contribution and belief attribution |
| authorization | resource scope + existing actor credential/capability path | epistemic actions and field-level disclosure classes |
| retrieval | provider-neutral retrieval fabric | typed epistemic corpus profile and lineage-aware filters |
| bounded reconciliation | Parley | propositions, argument objects, value conflicts, and adjudication receipts |
| obligations | commitments | links to goals, decisions, evidence, and affected outcomes |
| roadmap tie | roadmap item + typed links when canonical link support lands | child specification and staged implementation items, never duplicate authority |
| execution proof | Porthole and authoritative API receipts | normalized evidence references; no raw capture copied into broad memory |

## Source references

### September 8 follow-through: previously unmapped sources

- [Harbor Results R17](../../../../skills/harbor-results/references/results-compendium.md)
  already supplies a bounded deontic-conflict fragment and reproducible checker.
  The [D1a adapter](../harness/README.md) now reuses that checker. Its synthetic
  oracle results establish neither real-project usefulness nor the advertised
  optimized detector bound for the reference pair-enumerating implementation.
- [The existing editor plan](../../../strategy/harbor-editor-battle-plan.md)
  and `core/pd-console/src/editor_pane.rs` / `editor_sync.rs` establish source
  placement for the cooperative surface. The editor is not a future blank slate.
  Public `routes/editor-recovery.ts` mutations are still explicitly 503-gated.
- [The integration contract](../final/harbor-integration-contract.md) connects
  R2/R5/R9/R14/R17, participant transitions, existing authority, scoped views,
  recovery and first use. These are requirements and bounded offline tests,
  not evidence that existing production paths enforce the proposed semantics.

- `docs/adr/0007-immutable-session-notes.md`
- `docs/adr/0032-unspider-contradiction-finder.md`
- `docs/adr/0041-durable-commitments-and-obligation-monitoring.md`
- `docs/adr/0111-parley-protocol.md`
- `docs/adr/0121-durable-agent-roster.md`
- `docs/adr/0122-harbor-authority.md`
- `docs/roadmap/AUTHORITY.md`
- `docs/proposals/provider-neutral-retrieval-fabric.md`
- `lib/actor-roster.ts`
- `lib/commitments.ts`
- `lib/discourse-lineage.ts`
- `lib/parley-store.ts`
- `lib/parley-trigger.ts`
- `lib/resource-scope.ts`
- `lib/roadmap-chomp.ts`
- `lib/roadmap-items.ts`
- `lib/tube.ts`
