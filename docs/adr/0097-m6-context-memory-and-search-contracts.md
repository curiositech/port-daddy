# 0097. M6 Context, Memory, and Search Contracts — the F0-delta for Milestone 6

## Status

Proposed — 2026-07-06 (M6 F0-delta, opening the M6 wave; binder ch07 Milestone 6,
ch04 Context Memory And Skills, ch18 iteration loop: "if the slice changes runtime
truth, update contract/schema/tests before UI.")

Depends on: ADR-0095 (Agent Run Saga + F0 contract freeze), ADR-0096 (signed
GuidanceEnvelope, M5 F0-delta)

Blocks: binder milestone M6 (context pressure → compaction → resume; transcript
search; episodic memory; read-only blackboard)

Skill lenses applied (grafted per the ch18 F0 discipline):
`cqrs-event-sourcing-architect` (search results and the blackboard are
projections — queries display, never decide; the log is sacred, cards are
disposable), `agent-interchange-formats` (schema-first envelopes with version
discriminators; tolerant-reader open `kind` strings), `episodic-memory-algorithms`
(bi-temporal validity — validFrom/validUntil for world time plus ingestedAt for
system time, the Zep/Graphiti model; forgetting policies as never-forget /
half-life decay / session-scoped; token-budgeted retrieval as a hard failure-mode
guard), `rag-retrieval-pattern-design` (hybrid lexical+dense retrieval with RRF
fusion as the default posture, cross-encoder rerank as an optional hint, explicit
result budgets and truncation honesty), `architecture-binder-of-record` (drift
locks against superseded chapter sketches; explicit scope-guard against M8 creep),
and `api-versioning-strategy` (additive evolution inside v0; unknown fields
tolerated; breaking changes get a new directory version).

## Context

ADR-0095 froze the eleven F0 contracts and ADR-0096 added the twelfth
(GuidanceEnvelope). Milestone M6 — "Context, memory, and transcript search"
(binder ch07) — is next on the milestone DAG (M4 → M6, M5 → M6), and its gate is
concrete:

> - force context threshold and, in an adapter-equipped daemon with a provider-session → plan binding, daemon-owned measurement, a current plan checkpoint, and tool-pair coverage, see a cited compaction packet;
> - explicitly resume or take over from the packet, last plan, and bounded cited handles after hash-chain verification;
> - search "how did we deploy X" and get cited results;
> - memory retrieval never exceeds configured budget.

Chapter 04 supplies the prose truth this ADR converts into contracts: the
memory-tier model (core / recall / archival / graph / blackboard), the
compaction-packet contents list and its validator ("the validator fails uncited
factual claims and warns when active obligations are missing"), the retrieval
rule ("a memory without a source is a suggestion, not a fact"), graph facts that
"need validity intervals and sources", the distilled-source contract for deleted
payloads, and the two "build early" tools: transcript search and the blackboard.

Per ch18's iteration loop, the M6 implementation chains must not fan out before
the shapes they will share are frozen. This ADR is that freeze — the same
F0-delta pattern ADR-0096 used for M5.

## Decision

### 1. Five additive v0 contracts

`schemas/agent-harbor/v0/` gains five schemas, each with the
`pd.agent-harbor.<name>.v0` const discriminator, `additionalProperties: true`
(tolerant reader), and the frozen F0 keyword subset enforced by
`tests/unit/agent-harbor-contracts.test.js`:

| Schema | Object | Authority |
| --- | --- | --- |
| `compaction-packet.schema.json` | CompactionPacket | The cited continuation packet (ch04 "How Longshoremen compact Voyagers"); payload of the first-class `compaction_packet` transcript event; the successor's primary context source. |
| `memory-episode.schema.json` | MemoryEpisode | Distilled memory unit with bi-temporal validity (validFrom/validUntil + ingestedAt) and mandatory citations; carries graph facts and the ch04 distilled-source (tombstone) contract. |
| `transcript-search-query.schema.json` | TranscriptSearchQuery | Budgeted, scoped, mode-explicit search request over events, notes, files, diffs, PRs, outcomes, memory episodes, and receipts. |
| `transcript-search-result.schema.json` | TranscriptSearchResult | Cited hits + optional cited synthesized answer + budget echo (configured vs used vs truncated) + projection freshness envelope. |
| `blackboard-item.schema.json` | BlackboardItem | READ-ONLY projection card of live harbor state, source-linked and TTL'd. No write/parley semantics — see §5. |

Fixture instances live in `schemas/agent-harbor/v0/fixtures/` and are validated
by the contract test suite, which now freezes seventeen schemas.

### 2. The citation discipline (normative)

Ch18's M6 gate wants cited search results, and ch04's validator exists to fail
uncited factual claims. So citations are structural, not stylistic:

- A **citation** is one object of `{kind: "transcript-event", transcriptEventId,
  span?}` or `{kind: "file", fileRef}` or `{kind: "claim", claimRef}`, with an
  optional `sessionId` for cross-session references. The shape is identical in
  all five schemas.
- `CompactionPacket.factualClaims[].citations` has `minItems: 1` — an uncited
  factual claim is *schema-invalid*, not merely validator-failed. The embedded
  `validator` block (`passed`, `uncitedClaimCount`, `missingObligationWarnings`)
  records the ch04 validator's verdict; consumers must refuse `passed: false`.
- `TranscriptSearchResult.hits[].citations` and `answer.citations` both have
  `minItems: 1` — a search result is never a bare answer.
- `MemoryEpisode.citations` has `minItems: 1` — a memory without a source is a
  suggestion, not a fact (ch04).
- `BlackboardItem.citations` has `minItems: 1` — cards are "source-linked, not a
  loose chat" (ch04).

Cross-field coupling (`kind: "transcript-event"` requires a non-null
`transcriptEventId`, etc.) cannot be expressed in the frozen fail-closed keyword
subset (no `oneOf`/`if`), so it is enforced at runtime by the packet/result
validators — the same normative-module pattern as ADR-0095's witnessing
invariant and ADR-0096's macaroon `authorityRef` rule.

### 3. Validity intervals (normative)

Per ch04 ("facts need validity intervals and sources") and the bi-temporal model
from `episodic-memory-algorithms` (Zep/Graphiti: `(validFrom, ingestedAt)`
tuples plus fact superseding):

- `MemoryEpisode.validFrom` (required) and `validUntil` (**required but
  nullable**) bound when the fact held in the world. Requiring the key while
  allowing `null` makes open-ended validity an explicit assertion, never an
  omission a reader must guess about.
- `ingestedAt` (required) is the second temporal axis: when the system learned
  the fact. It enables "what did we believe on date D" audit queries and keeps
  extraction latency visible.
- `supersedes`/`supersededBy` carry the contradiction-closure chain; closing a
  superseded episode's `validUntil` is the runtime effect.
- A retrieval layer must not serve episodes whose `validUntil` has passed as
  current facts (the stale-memory-pollution failure mode).
- Per-fact `validFrom`/`validUntil` on `facts[]` items allow a single episode to
  carry graph facts with tighter intervals than the episode envelope.

### 4. Budgets and retrieval posture (normative)

The M6 gate "memory retrieval never exceeds configured budget" is made auditable
per exchange rather than asserted globally:

- `TranscriptSearchQuery.budget` is **required** (`maxResults` ≥ 1, optional
  `maxContextTokens` and `maxLatencyMs`). `maxContextTokens` is the number that
  protects the caller's context window (ch04: "retrieved memories should stay
  under a fixed context budget").
- `TranscriptSearchResult.budget` is **required** and echoes
  `configured` vs `used` vs `truncated`. Truncation is data, not silence.
- Default retrieval mode is `hybrid` (lexical + dense, RRF fusion) per
  `rag-retrieval-pattern-design`; `lexical` is an explicit opt-in narrowing,
  never a silent fallback. Engine details (`embeddingModel`, `fusion`,
  `reranked`) are echoed in the result for reproducibility and semantic-drift
  audits.
- Search is a **query** in the CQRS sense: it displays and never decides. The
  result carries the C-routes freshness envelope (`projection.stale` /
  `lastLedgerSeq` / `headSeq`); stale results are labeled, never hidden, and
  never authorize a command.

### 5. The blackboard is READ-ONLY in v0 (scope guard, normative)

Binder ch05 is explicit:

> Milestone 6 should ship a read-only/search blackboard over transcript and
> memory facts; active conflict/parley write semantics belong in Milestone 8.

`blackboard-item.schema.json` therefore freezes only the **read model**: kind
(open string, tolerant reader), `title`/`detail` (named `detail`, not `body` —
`body` is a superseded ch03 name for the runtime Body per fork 1), typed
`subjects`, severity,
confidence, `status`, TTL (`expiresAt`), supersession, provenance
(`assertedBy` — who the projection derived the card from, not a write API), and
mandatory citations. It deliberately carries **no** write/parley/ack/mutation/
permission-grant fields — no `writeToken`, no `parleyState`, no `ackRequired`,
no proposal or vote fields. The schema description repeats this guard so a
future chain cannot "helpfully" add write semantics without tripping the
drift-lock test; M8 introduces those under its own ADR.

### 6. Drift locks

- **ch04 sketch names are superseded.** Ch04's pre-turn context envelope sketch
  uses `agentId`; ADR-0095 fork resolution 1 froze `agentNodeId` (with
  `sessionId`/`runId` as the join keys). All five M6 schemas use the frozen
  names; the test suite asserts the superseded ch03/ch04 names (`agentId`,
  `body`, `blobRefs`, `redaction`, `retention`) do not reappear on any of them.
- **Validity-interval naming is frozen** to `validFrom`/`validUntil`/`ingestedAt`
  (the episodic-memory-algorithms convention already used by ch04's Zep-style
  prose). Variants (`validTo`, `validityStart`, `expiry` for validity) are
  locked out by test.
- **CompactionPacket vs ContextEnvelope:** the ContextEnvelope (F0) is context-
  pressure *accounting*; the CompactionPacket is the *continuation artifact*
  that pressure triggers. The packet's `trigger.contextEnvelopeRef` joins the
  two; pressure fields (`windowTokens`, `usedTokensEstimate`) must not leak into
  the packet.
- **Resume is verifiable:** `CompactionPacket.sourceTranscript`
  (`headEventId`/`headHash`/`throughSequence`) pins the packet to the exact
  transcript prefix it summarizes, so "resume successor from packet and
  transcript" (M6 gate) verifies against the per-session hash chain from the F0
  TranscriptEvent contract.

### 7. Versioning posture

Additive-only inside v0 (unknown fields tolerated by every reader); any breaking
change to these five shapes requires a `schemas/agent-harbor/v1/` directory and
a Deprecation/Sunset plan per `api-versioning-strategy`. This ADR is additive to
the ADR-0095 package exactly as ADR-0096 was.

## Implementation Matrix

<!-- ADR-0043: one row per phase; slugs are the stable join keys into
     roadmap_items. Phase 0 ships with this ADR's PR; phases 1–4 are the M6
     implementation chains that build against the frozen contracts. -->

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0097-m6-context-memory-search-contracts | now | ADR-0095, ADR-0096 | This freeze: five v0 schemas, fixtures, contract tests (ships with this ADR's PR). |
| 1 | adr-0097-phase-1-compaction-chain | partial | Phase 0 | Terminal-spawner has ContextEnvelope/packet machinery; Claude-only interactive ingress registers a `UserPromptSubmit` turn-time pressure refresh plus the verified `PreCompact` checkpoint. It fails closed without a daemon-owned provider-session → active-plan binding, returning `provider-session-unbound` and no packet. After binding, an adapter-equipped daemon needs a daemon-owned measurement watermark, a current durable plan checkpoint, and complete tool-pair coverage before it can record a validated packet; the hook accepts neither usage nor raw transcript text. The turn path gives the .60 prepare, .75 cited-packet, .85 restriction, and .92 governed-successor directive only through Claude's bounded `additionalContext`; PreCompact does not pretend its discarded system message is a warning. The observation key includes the plan revision and watermark, so a later source observation with unchanged rounded usage gets a new packet while an exact retry replays. The default daemon wires no operational binding or witnesses, so it issues no interactive packet. An explicit packet-derived resume re-verifies `sourceTranscript` against the session hash chain and starts from the last plan plus bounded handles. Universal provider hooks, automatic successor execution, retrieval, and W8/W12 remain separate work. |
| 2 | adr-0097-phase-2-transcript-search | later | Phase 0 | Hybrid search service over events/notes/files/PRs/outcomes honoring query budgets and returning cited results (M6 gate lines 3–4). |
| 3 | adr-0097-phase-3-episode-extraction | later | Phase 0 | Longshoreman episode/graph-fact extraction with bi-temporal validity, supersession closure, and distilled-source tombstones. |
| 4 | adr-0097-phase-4-blackboard-projection | later | Phases 1–3 | Read-only blackboard projection over ledger + memory facts, rendered as cards/badges/search/timeline (write/parley semantics stay M8). |

## Consequences

- **Positive:** the M6 chains (context-pressure tracker, Longshoreman compactor,
  successor resume, transcript search service, episode extractor, blackboard
  projection) can fan out against shared shapes instead of inventing five
  incompatible citation formats; every M6 gate criterion has a field it is
  checked against; hallucinated compaction and bare-answer search are
  schema-invalid, not just discouraged.
- **Cost:** runtime validators must enforce the citation cross-field rules and
  the packet validator semantics the keyword subset cannot express; the search
  engine must meter token estimates to honor `maxContextTokens` honestly.
- **Honest limitation:** Phase 1 is partial, not universal. Claude's registered
  `UserPromptSubmit` pressure refresh and `PreCompact` checkpoint are first
  fail-closed on a daemon-owned provider-session → active-plan
  binding (`provider-session-unbound` and no packet), then on a trusted
  measurement (`measurement-unavailable`), then on complete tool-pair coverage
  (`packet-withheld`). The default daemon wires no operational binding or
  witnesses, so the interactive path issues no packet. An adapter-equipped
  path also needs a current durable plan checkpoint. The turn-time directive is
  Claude-only because it relies on its admitted `additionalContext`; `PreCompact`
  does not claim to deliver a discarded warning. No provider hook is simulated.
  A `governed-successor` directive requires an explicit
  packet-derived continuation and never resurrects or launches a process.
  Search, episode extraction, blackboard projection, universal heartbeats, and
  W8/W12 durable output references remain open.
- **Deferred:** blackboard write/parley semantics (M8, per ch05); Longshoreman
  scheduling policy (ch04's 80/15/5 reactive split is operational guidance, not
  schema); embedding-model choice and index topology (implementation concerns
  under `rag-retrieval-pattern-design` / the shared-embedder directive).

## Rollout

1. This ADR (Proposed → Accepted after review), with the five schemas, fixtures,
   and contract tests in the same PR — contract/schema/tests before UI (ch18).
2. The M6 implementation chains build against the frozen shapes: compactor +
   context-pressure wiring (ContextEnvelope → CompactionPacket), transcript
   search service, episode extraction, read-only blackboard projection.
3. M6 gate proof: an adapter-equipped, evidence-gated forced-threshold
   compaction artifact with a daemon-owned provider-session → plan binding and a
   current `pd plan` checkpoint; an explicit packet-derived resume from the last
   plan plus bounded handles with hash-chain verification; a cited "how did we
   deploy X" search run; and a budget-compliance check on every retrieval in the
   proof transcript.
