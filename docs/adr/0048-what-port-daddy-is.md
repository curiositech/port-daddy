# 0048. What Port Daddy Is — the North Star

## Status

Accepted

## Context

Port Daddy has been, at various times, described as a runtime, an agent OS, an
MCP, a CLI, an operator GUI, a cryptographic protocol, and an economy. "Yes to
all" is the answer of a project that hasn't decided — and a tool that is
everything is a tool nobody can describe to a friend, sequence a roadmap around,
or sell. Before the GUI (or anything else) is decided, the identity must be
fixed. This ADR is the **North Star**: every other ADR, the roadmap, and the GUI
hang off it.

Two anchors from the canon:
- **Hobbes' *Leviathan***: rational actors in a state of nature ("war of all
  against all") *consent* to a sovereign because the alternative is worse. A
  swarm of coding agents without a coordinator is exactly that state of nature —
  double-claimed files, illegible PRs, lies, footguns. Port Daddy is the
  consented authority.
- **Scott's *Seeing Like a State***: states impose **legibility** (grids,
  cadastral maps, standardized names) to govern — and high-modernist
  *over*-legibility that crushes **mētis** (local, practical knowledge) is
  catastrophic. So **legibility is the product, and over-flattening is the
  failure mode.** Every digest must be a *lens that zooms to the real thing*,
  never a replacement for it.

## Decision

### The one-sentence definition
**Port Daddy is the harbor-master for agent swarms: the local-first authority
that makes many coding agents *legible, accountable, and safe* to one human
operator — and, once operators sail out to trade, the cryptographic market that
lets fleets who don't trust each other still work together.**

### The stack (this resolves "yes to all" into layers, each a different *whom*)

| Layer | What it is | For whom | State |
|---|---|---|---|
| **L0 — Daemon (kernel)** | always-on, local-first, SQLite/WAL source of truth: ports, claims, sessions, tube, pheromones, commitments, Arbiter, memory | the **machine** | **built** (this is the actual code) |
| **L1 — Coordination protocol (the "agent OS" / control plane)** | typed conversation + commitments + delegation + Arbiter(regiment)/monitor(enforce) + float plans — the rules of the road (ADR-0047) | the **agents** | designed |
| **L2 — Legibility & authority (the Leviathan; the GUI)** | summarization-with-zoom, roadmap-as-truth, adversarial review, completionist obligation, HiTL escalation, the **read-surfaces** (Attention Queue, suggestibility, resurrection-with-memory), the ratatui operator console (ADR-0046, 0046→pure-ratatui ADR pending) | the **human operator** | **the wedge** |
| **L3 — Economy & federation** | anchor protocol, float-plan escrow, reputation/Elo, harbor federation, work-for-hire + skill/agent marketplace (the whitepapers) | the **market between operators** | whitepaper'd |

Noun-by-noun: **OS** = L1 (for agents). **Shell** = no — PD sits *on* your shell.
**UI** = L2 (for the operator). **Control plane** = L1+L2. **Cryptography** = L3
(trust across boundaries you don't own — never needed locally; needed the instant
Alice's frigates touch your repo). **Economy** = L3 (a three-sided market:
operators sell labor+fleet for-hire; fleets/agents are rentable assets;
skills/tools are licensed — one bond ledger, all post-wedge).

### The sequencing (the product discipline)
1. **Single-player (L2 over L1/L0)** is the wedge: a solo developer drowning in
   illegible agent chaos pays for the harbor-master *today* — fewer footguns,
   automatic adversarial review, a roadmap actually maintained, diffs landed
   thoughtfully, HiTL when irreconcilable. No Alice, no economy, no crypto.
2. **Multiplayer (L3 federation)** is the expansion: you + Alice + two fleets,
   each briefed on the other's contrails so her wake doesn't capsize your
   frigates. Added *after* single-player is loved.
3. **The market (L3 economy)** is the platform: trade at port. You don't sell
   crypto — crypto is the substrate; you sell **hosted trust** (verified ledger +
   relay + reputation).

### The through-line (why memory is the foundation of the economy)
> **memory + checkpoint (resurrection with teeth) → continuity → a *person* not a
> *spawn* → registered outcomes → reputation/Elo → a hireable/sellable asset →
> the market.**

This is the **role-vs-person** answer: a **role** (cartographer) is a bundle of
{obligation, capability, authority} — org-chart, not biography. A **person** is a
role instance *plus continuity* (memory, checkpoint, outcome history). No
reputation without continuity; no market without reputation. So the
read-surface/memory work is not a side quest — it is the literal foundation of
L3. (Richer ideas — role-scoped "vocational" memory across all cartographers,
backend-scoped shared baselines, harbor-scoped team memory, evolutionary
agent-breeding — are memory-scoping/generative designs, L3+ research.)

### The legibility principle (Scott's warning, made a rule)
Summarize for the digest, but **every summary is a lens onto the real artifact,
never a replacement.** Legibility-with-zoom. The pure-ratatui GUI enforces this
by construction (you cannot over-render in a terminal). This is the same
discipline as "honest green / vision-labels" (ADR-0045) and "summaries as
indexes, not replacements" (ADR-0047).

### Promoted gaps (from "never discussed" to first-class)
- **Tokens / compaction** — the COGS *and* the legibility mechanism (the digest
  IS compaction, for humans and agents). L1/L2, sooner than assumed.
- **Discovery / indices / directories / guilds** — can't find 5 agents, let alone
  hundreds; the read-poor disease. `pd whois` is the seed. L2.
- **Reputation / Elo-for-backends / agentic reviews** — the trust metric, for L3
  trade and L2 backend choice; gated on continuity.
- **Jails / custom shell** — the Arbiter's enforcement arm (tool-allowlist +
  scoped-FS per agent). L1 safety.

## Considered Options
- **A. "Yes to all" grab-bag.** Rejected: undescribable, unsequenceable, unsellable.
- **B. Pick one noun (just the runtime / just the GUI / just the economy).**
  Rejected: each alone undersells the thesis; the value is the *stack*.
- **C. (chosen) The layered stack with explicit wedge sequencing** — every noun
  is true, but as a layer for a specific whom, shipping in dependency order.

## Implementation Matrix (the build DAG)

| Phase | Roadmap slug | Status | Depends on | Description |
|-------|--------------|--------|------------|-------------|
| 0 | adr-0048-phase-0-ratify-stack | now | — | This ADR; re-anchor the implementation roadmap + ADRs 0046/0047 to the L0→L3 stack; mark L0 built. **Done when:** the roadmap waves map 1:1 to L0→L3 |
| 1 | adr-0048-phase-1-L1-coordination-protocol | now | adr-0048-phase-0-ratify-stack | L1: ship ADR-0047 (typed conversation/commitments/delegation) + the Arbiter jail (custom-shell corral). **Done when:** agents coordinate via typed performatives + a tool-allowlist jail holds |
| 2 | adr-0048-phase-2-L2-readsurfaces | now | adr-0048-phase-1-L1-coordination-protocol | L2 SPINE: the read-surfaces — suggestibility briefings (agent read), Attention Queue (operator read), resurrection-with-memory (successor read), discovery/`pd whois` index. **Done when:** tuples/pheromones/memories are READ in ≥3 surfaces |
| 3 | adr-0048-phase-3-L2-legibility-digest | now | adr-0048-phase-2-L2-readsurfaces | L2: the digest/legibility-with-zoom + tokens/compaction as the digest engine; the pure-ratatui operator console (ADR-0046). **Done when:** a swarm is legible as a zoomable digest, not a PR pile |
| 4 | adr-0048-phase-4-L2-wedge-ship | now | adr-0048-phase-3-L2-legibility-digest | THE WEDGE: single-player safety+assistance+accountability as the shippable product (footgun-guards, adversarial review, maintained roadmap, thoughtful landing, HiTL). **Done when:** a solo dev would pay for it |
| 5 | adr-0048-phase-5-L3-identity-continuity | now | adr-0048-phase-2-L2-readsurfaces | L3 bridge: durable identity = role + continuity (memory/checkpoint/outcome history) → "persons" with registered outcomes. **Done when:** an agent has a continuous, checkpointed identity with an outcome ledger |
| 6 | adr-0048-phase-6-L3-reputation | now | adr-0048-phase-5-L3-identity-continuity | L3: reputation/Elo for agents + backends, learned-outcome routing, agentic reviews. **Done when:** backend/agent selection uses a learned reputation score |
| 7 | adr-0048-phase-7-L3-federation-market | now | adr-0048-phase-6-L3-reputation | L3 platform: harbor federation (Alice's fleet) → the work-for-hire + skill/agent marketplace on the bond ledger (anchor protocol). **Done when:** two operators' fleets safely co-work + trade with reputation + escrow |
| 8 | adr-0048-phase-8-whitepapers | now | adr-0048-phase-0-ratify-stack | Deep-research whitepapers backing the North Star (legibility/Leviathan, the economy/anchor, identity→reputation, tokens/compaction, discovery/guilds), building deep skills en route. **Done when:** each layer has a cited paper |

## Consequences

### Positive
- A describable, sequenceable, sellable identity: *"the harbor-master that makes
  your agent swarm legible, accountable, and safe; a market only when you trade."*
- The wedge (single-player L2) is shippable now and doesn't depend on the
  economy/crypto/federation.
- The read-surface/memory work is revealed as the through-line to the entire L3
  economy, not a side quest.

### Negative
- L3 (economy, federation, evolution) is explicitly deferred — exciting work
  parked behind the wedge. Correct, but requires discipline not to chase it early.

### Neutral
- This ADR is the parent: 0046 (the GUI = L2), 0047 (the protocol = L1), 0041
  (commitments), 0040 (identity), 0045 (Arbiter/attest = legibility) all hang off
  it as layers of one stack.
