# Skill audit — `agent-conversation-protocols`

**Independent read-only audit · anchor `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`**

## Verdict

**Supplant in place.** Semantic score: **2.3/10 (F)**. Preserve the skill ID,
cycle detection, explicit gathers, resource ceilings, and “security cannot be
voted away.” Replace the category error that treats worker topology and generic
orchestration patterns as conversation protocols while omitting authority,
replay, ordering, fencing, provenance, and terminal settlement.

| Dimension | Score / 10 | Finding |
|---|---:|---|
| Activation | 4 | Keyword-heavy mini-manual overlaps frameworks, runtime topology, debate, and handoff. |
| Domain expertise | 3 | Useful examples; absent message authority, replay, evidence, and state machine. |
| Progressive disclosure | 4 | Compact but monolithic; no focused references. |
| Self-containment | 1 | No schema, audit script, fixtures, or executable validation. |
| Maintainability | 1 | No changelog, version, provenance, or test contract. |
| Visuals | 1 | Complex protocols represented as ASCII rather than decision diagrams. |

## Critical findings

1. **Conversation can mint authority.** Request/response is treated as simple
   capability delegation, direct worker messages may change action, and a
   topology broadcast is obeyed without issuer authority, audience, epoch, or
   revocation fence. A message may request authority; prose cannot grant it.
2. **Replay, duplication, ordering, and fencing are absent.** No message,
   conversation, causation, sequence, epoch, idempotency, duplicate, late-
   message, or generation-fence contract exists.
3. **The evidence channel is poisonable.** Sender confidence is treated as
   evidence and used for blackboard expiry. Confidence is testimony, never an
   authority or truth upgrade.
4. **Termination is inverted and incomplete.** Fixed thresholds are
   uncalibrated; one example stops when tokens remain or before the deadline.
   “Stop” does not fence effects, cancel outstanding work, or reject late output.
5. **Three graphs are conflated.** Conversation state, runtime/process topology,
   and authority topology are distinct and may not mutate each other by
   implication.
6. **Framework claims lack primary citations** while framework selection is
   simultaneously declared out of scope.
7. **Privileges are excessive.** The design skill requests unrestricted shell,
   write, web search, and web fetch despite having no executable contract.

## False-green evidence

- Normal structural validation exits zero while strict mode rejects duplicate
  top-level metadata.
- Self-containment and indexing pass vacuously because the bundle has no support
  artifacts.
- Repository governance audit reports no missing governance while also calling
  the skill unclassified with no changelog or references.
- No hostile fixture exists to prove any protocol property.

## Claims to delete or narrow

- Delete broad “deep analysis” of named frameworks until primary mappings exist.
- Remove framework names from activation; route selection elsewhere.
- Narrow voting to preference aggregation among an authorized electorate; it is
  not evidence or truth.
- Delete universal confidence thresholds and confidence-based evidence expiry.
- Replace “full context to all workers” with least-disclosure, provenance-bound
  references.
- Bind direct messages and topology changes to external capabilities, epochs,
  fences, acknowledgements, and rollback.
- Correct termination arithmetic and make late effects impossible after fence.
- Treat redundant fan-out as correlated unless independence is evidenced; bind
  it to cost and cancellation limits.

## Replacement boundary

> Designs typed, sparse, authority-aware conversation state machines between
> already admitted participants. Use for request/propose/refuse/accept,
> cancellation, evidence exchange, terminal acknowledgement, replay, ordering,
> and conversation-level fan-out/gather. NOT for serialization formats,
> transports, framework selection, runtime topology or scheduling, spawn
> authority, memory systems, or single-agent reasoning.

Default tools: `Read,Grep,Glob` plus narrowly scoped Node validation.

Core shibboleths:

- message receipt is not authorization;
- signature proves source, not truth;
- sequence orders one issuer/epoch, not the world;
- idempotency deduplicates effects, not merely text;
- termination fences future effects;
- confidence is testimony, not evidence.

## Required bundle

- separate conversation, runtime, and authority topology diagrams;
- request/authority/response/evidence/terminal sequence;
- lifecycle state machine including duplicate, stale epoch, timeout, cancel,
  dispute, and terminal acknowledgement;
- closed conversation-protocol schema and deterministic audit script;
- valid example and hostile fixtures for replay, stale epoch, forged authority,
  poisoned evidence, unbounded rounds, unfenced fan-out, and topology conflation;
- stable finding IDs and at least six positive/six negative activation cases;
- primary-source ledger and `v2.0.0` breaking changelog;
- no legacy confidence or conversational-topology-authority mode.
