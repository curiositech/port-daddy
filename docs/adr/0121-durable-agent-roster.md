# 0121. Durable named-agent roster

> **Note (2026-08-16):** Renumbered from 0119 → 0121 to resolve the 0119 collision with the relay release-channels ADR (which keeps 0119: dated 2026-08-04 and load-bearing for the relay deploy gate).

## Status

Accepted

- **Roadmap:** `durable-agent-roster`

## Context

Port Daddy can already observe live process registrations, coordinate ephemeral
sessions, preserve episodic memory, and continue sanitized handoffs across the
backend catalog. Those pieces did not yet form a person. A good Claude or Codex
session disappeared back into transcript history after its process ended, while
`/agent-roster` showed only live bodies and the static actor roster represented
source-defined organizational roles.

The product needs a fourth composition without inventing a fourth identity
source: an operator can create a named expert or promote a strong session, use
that expert across repositories or system-wide, retrieve it by expertise, and
continue it in any compatible runtime. The identity must survive bodies and
sessions, must not be a self-selected principal, and must not replay raw provider
transcripts into another trust boundary.

## Decision

### AgentNode is the person

The existing daemon-minted `AgentNode.agentNodeId` is the canonical durable
principal. A roster name such as `portdaddy-typography-expert` is a unique human
alias inside a system or canonical-repository scope. It is never an authority
credential and never replaces the opaque AgentNode id in memory, continuation,
or future outcome ledgers.

The split is:

| Layer | Lifetime | Source of truth |
| --- | --- | --- |
| Durable named agent | long-lived person/profile | append-only `agent-node` facts |
| Fleet body | process embodiment | transient agent/body/run registries |
| Session | bounded unit of work | `sessions` and transcript events |
| Static actor | source-defined organizational role/mailbox | `lib/actor-roster.ts` |

This extends ADR-0028 rather than replacing it. A durable named agent may embody
or collaborate with a static actor, but the two are not aliases.

### Profiles are append-only AgentNode facts

`pd.agent-harbor.durable-agent-profile.v0` rides as the optional `profile` on an
AgentNode fact. Every edit increments `revision` and appends a new event. Previous
prompts, remits, scope, backend preferences, memory references, and lifecycle
states remain replayable from the sacred Harbor event ledger. The embedding
table is a disposable derivative and can be rebuilt from those facts.

The profile stores:

- scoped human name, display name, remit, and durable instructions;
- skills, tool declarations, and ordered backend/model preferences;
- sanitized handoff episode references and compaction/search policy;
- declared trigger shapes;
- declared filesystem/network/tool policy; and
- wizard or session-promotion provenance.

Permission policy has the literal state `declaration-only`. Trigger declarations
have the literal state `declared`. Neither surface may claim enforcement or
activation until a runtime adapter emits daemon-witnessed evidence.

### Promotion requires durable native-session lineage

Session promotion requires a `handoff-capsule` episodic-memory record whose
capsule source names the native harness session being promoted. Handoff ingress
already validates, secret-scans, and durably records that lineage. A matched
Port Daddy coordination session can enrich the episode with notes and claims,
but it is not an identity prerequisite for historical Claude, Codex, Gemini, or
other harness sessions.

Profile text crosses the same fail-closed local and external Gitleaks boundary as
handoff prompts. The profile stores the sanitized episode id and compact operator
authored instructions, not the raw Claude, Codex, Gemini, API, Ollama, LM Studio,
or Cloudflare transcript. An unrelated handoff episode still fails closed with
`PROMOTION_LINEAGE_MISMATCH`.

Later sessions attach another sanitized handoff episode only when the capsule's
source or target durable identity matches the AgentNode id. Retirement appends a
new state fact; it does not delete the person or its history.

### Expertise retrieval is hybrid and non-reputational

Roster lookup searches display name, alias, remit, instructions, skills, tools,
and backend preferences. It combines BM25 and the one shared local
`Xenova/all-MiniLM-L6-v2` embedder through reciprocal-rank fusion. If semantic
retrieval is unavailable, the API labels the lexical fallback `degraded` and
points to `pd doctor`; it never silently ships lexical-only search.

Results expose lexical and semantic rank provenance, not a scalar reputation or
quality score. Declared expertise is useful routing metadata but is not an
earned outcome. Reputation remains deferred until daemon-witnessed work receipts
and external outcome predicates can resist self-report and identity churn.

### Continuation composes the existing N:N runtime

The roster does not duplicate continuation logic. Each agent detail exposes the
latest eligible handoff episode and the existing
`POST /memory/handoffs/:episodeId/continue` command URL. `pd roster continue` and
the MCP roster tools supply the daemon-minted AgentNode id as `durableAgentId`.

The semantics remain ADR-0118's semantics:

- same-family native resume only after exact session/workspace revalidation;
- every cross-family path starts a successor from the sanitized, rescanned
  handoff successor brief;
- every attempt owns a durable continuation receipt; and
- choosing another backend changes the body, not the person.

### Surface contract

- `GET /durable-agents` lists durable identities, including agents with no body.
- `GET /durable-agents/search` performs hybrid expertise retrieval.
- `GET /durable-agents/:id` joins the current profile, revisions, continuation
  affordance, and receipts.
- create, promote, patch, handoff-attach, and retire routes require a
  daemon-minted, operation-scoped capability and append facts rather than
  rewriting history. Loopback location, socket access, UID, `Host`, and
  forwarded headers are transport facts, never authority.
- `pd roster` exposes the same operations to agents and emergencies.
- MCP exposes discovery, creation, promotion, handoff attachment, and runtime
  continuation so Port Daddy can delegate to a suitable named expert.
- Beacon owns the primary operator roster, creation/promotion, and runtime-choice
  interface.

## Consequences

### Positive

- A person survives process death, session completion, backend changes, daemon
  restarts, and profile edits.
- Session promotion preserves the good parts of a transcript without granting
  historical text new system or tool authority.
- Repo scoping canonicalizes linked worktrees through Git's shared common
  directory, preventing one expert from fragmenting into worktree-local copies.
- Runtime portability, memory continuity, and profile identity remain separate
  predicates that can be independently witnessed.

### Negative

- Profile creation depends on the local secret scanner and semantic indexing
  can be temporarily degraded when the shared model cache is unavailable.
- Declared permissions and triggers are intentionally less exciting than an
  "always-on" badge until enforcement adapters exist.
- Promoting a session is a two-step operation: Beacon first persists a sanitized
  handoff, then promotes it.

## Rejected alternatives

- **A new `durable_agents` identity table.** Rejected because it would compete
  with AgentNode and make continuation, compliance, and future reputation choose
  between principals.
- **Use the live `/agent-roster` id.** Rejected because process registrations are
  self-asserted and disappear with bodies.
- **Treat a raw transcript as memory.** Rejected because it leaks secrets,
  exceeds context budgets, imports stale instructions, and couples identity to
  provider formats.
- **Rank experts by a single score.** Rejected because declared skill and
  self-reported success do not constitute reputation.
- **Mark stored triggers active.** Rejected until email, webhook, timer, task,
  and agent-message adapters can emit durable delivery and execution receipts.

## References

- `docs/adr/0028-actor-fleet-agent-session-three-layers.md`
- `docs/adr/0040-non-forgeable-actor-identity.md`
- `docs/adr/0095-agent-run-saga-and-backend-authority.md`
- `docs/adr/0097-m6-context-memory-and-search-contracts.md`
- `docs/adr/0118-harness-adapter-contract.md`
- `whitepaper/published/spawn-to-person-whitepaper.pdf`
- `whitepaper/published/anchor-protocol-whitepaper.pdf`
