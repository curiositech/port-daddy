---
name: agent-discovery-directories-guilds
description: >
  Design discovery, directories, and guilds for agent swarms at scale. Use when
  many agents (5 -> hundreds) must FIND each other on a shared surface: capability
  indices, yellow-pages directories, whois/phonebook routing, reputation-aware
  discovery, and guild structures that scope trust. Covers the canonical prior art
  (FIPA Directory Facilitator, Contract Net, Chord/DHT, DNS-SD/Consul, EigenTrust,
  Greif's merchant guilds) and the failure modes (read-poverty, Sybil reset,
  Goodhart on rank, directory staleness, cold-start). Triggers: "agents can't find
  each other", "who owns this file/skill", "route a question to the right agent",
  "capability registry", "agent reputation", "guild / federation of fleets".
metadata:
  category: Agent & Orchestration
  tags:
    - agent-discovery
    - service-discovery
    - capability-directory
    - whois-routing
    - reputation
    - guilds
    - multi-agent-systems
    - legibility
io-contract:
  kind: deliverable
  produces:
    - kind: design-doc
      description: Discovery architecture covering directory schemas, guild membership rules, and capability advertisement for agent ecosystems
---

# Agent Discovery, Directories & Guilds at Scale

**Version:** 1.0
**Domain:** Multi-agent systems, distributed service discovery, mechanism design,
institutional economics.

## Core concept: discovery is the read-side of coordination

Coordination has two halves. The **write side** — claims, locks, messages, merges —
gets all the attention because it is where conflicts visibly happen. The **read side**
— *how does agent A find out that agent B exists, what B is good at, whether B is
trustworthy, and whether B is the right contact for this question* — is usually left
implicit. At 2 agents the read side is free: you can eyeball the roster. At 5 it is
annoying. At 50 it is the bottleneck. At 500 it is the system.

Call the disease **read-poverty**: the swarm produces far more legible state (sessions,
claims, notes, edits, skills, reputations) than any one participant can read. The cure
is not "more dashboards." It is *indexed, ranked, query-answerable directories* — the
same move databases made when table scans stopped scaling: build an index.

> The deep symmetry: a **directory** is to agents what an **index** is to rows. Both
> trade write-time work (maintaining the structure) for read-time speed (O(log n) or
> O(query) lookup instead of O(n) scan).

## The three layers of discovery (build them in this order)

```
L1  EXISTENCE     "who/what is out there?"        -> registry / yellow pages
L2  RELEVANCE     "who is right for THIS?"         -> ranked routing (whois)
L3  TRUST         "who is right AND reliable?"     -> reputation-aware discovery + guilds
```

You cannot skip levels. Relevance ranking over a stale registry returns confident
garbage. Reputation over an unranked registry has nothing to attach scores to. Guilds
without reputation are just access-control lists with extra steps.

---

## Decision points

### DP1 — Push registry vs. pull index?

- **Push (self-registration):** agents advertise capabilities into a directory
  (FIPA Directory Facilitator model; A2A "agent cards"; MCP `.well-known/mcp`).
  Cheap to query, but **the advertisement is a self-report** and goes stale the
  moment behavior diverges from the card.
  → Choose when capabilities are declared, slow-changing, and the agent is
  cooperative (e.g. "I am the OAuth specialist").
- **Pull (observed index):** the substrate *derives* the directory from what agents
  actually did — file claims, edits, notes, episodic handoffs. No self-report to lie
  in; the index reflects ground truth with a lag.
  → Choose when capabilities are emergent or when self-report is gameable.
- **Hybrid (the right answer at scale):** push for *declared* capability (skills,
  mission), pull for *demonstrated* capability (recent claims, edits). Rank by a
  blend. This is exactly Port Daddy's `pd whois` design (ADR-0030): identity/skill
  signals (push) + file-claim/note/episodic signals (pull).

### DP2 — Exact match, BM25, or embeddings for the relevance layer?

| Query type | Use | Why |
|---|---|---|
| Structured field (file path, skill id, port) | exact / substring | you control the namespace; NLP is overkill and lossy |
| Free-text over a small curated corpus | BM25 / TF-IDF | no model download, deterministic, good enough |
| Free-text "who knows about X" semantic | embeddings + cosine | catches synonyms a keyword list never enumerates |
| Tie-break / rationale | one cheap LLM call | re-rank top-k, emit a one-line "why", hallucination-guard the ids |

**Anti-pattern (hard ban): keyword lists for capability classification.** You cannot
a priori enumerate the terms for "auth" or "data pipeline." Recall is catastrophic.
Use embeddings or a single Haiku call. Keyword exact-match is ONLY for namespaces you
own (skill ids, enum tags, file paths).

### DP3 — Centralized directory vs. DHT vs. federated directories?

- **Centralized (one authority):** simplest, fastest queries, single source of truth.
  Correct for single-operator swarms — the daemon already holds all the state.
  (FIPA permits exactly one mandatory DF per platform.)
- **DHT (Chord-style, O(log n) hops, no central node):** correct only when there is
  no trusted center and churn is high. Almost always premature for agent fleets;
  you pay distributed-systems complexity to solve a problem you do not have yet.
- **Federated directories:** multiple authorities that gossip/peer. The *right* shape
  for the multiplayer endgame — each operator runs their own directory; cross-fleet
  discovery happens through federation, not a shared mutable table. (FIPA explicitly
  allows DF federation.) Do this only once single-player discovery is solved.

### DP4 — When do you need guilds (not just a flat directory)?

A **guild** is a *named, trust-scoped sub-directory with membership and an enforcement
mechanism*. Reach for one when:

1. The flat directory is too large to rank meaningfully (hundreds of agents).
2. Trust is non-uniform — you want to discover *within a vetted set* by default and
   cross the boundary deliberately.
3. There is cross-operator trade and you need a **credible-commitment** structure
   (the historical reason merchant guilds existed; Greif–Milgrom–Weingast 1994).

If none of these hold, a guild is overhead. Flat directory + reputation is enough.

---

## Failure modes (each with its named precedent and the mitigation)

1. **Read-poverty (the base disease).** State accumulates faster than it is read; the
   directory exists but nobody indexes it, so agents fall back to O(n) eyeball search
   and cold DMs. *Mitigation:* a query-answerable router (whois) wired into the
   moments agents are about to act blind (`pd begin`, `pd inbox send`).

2. **Directory staleness.** Self-reported capability cards diverge from behavior; the
   yellow pages list an agent that died an hour ago. *Mitigation:* recency-decay every
   pull signal (Port Daddy uses `exp(-λ·hoursAgo)`, file-claim half-life 6h); expire
   registrations on heartbeat staleness (resurrection), not on graceful deregister.

3. **Sybil reset (the reputation killer).** An agent with a bad record re-registers
   under a fresh identity and inherits a clean slate (Douceur 2002). Any reputation or
   guild membership built on self-asserted identity is "climbing an imaginary
   staircase." *Mitigation:* non-forgeable, daemon-minted identity that cannot be
   cheaply re-picked (Port Daddy ADR-0040) BEFORE any reputation layer.

4. **Goodhart on the rank.** Once "appears in the top of whois" is a target, agents
   farm the signal — claim files they will not touch, write notes stuffed with the
   query terms. *Mitigation:* rank on signals that are costly to fake and tied to real
   work (actual diffs, merged PRs), not cheap-to-emit ones; sample-audit; keep weights
   operator-tunable so a gamed signal can be down-weighted.

5. **Cold-start / empty directory.** Fresh install, no history, no reputations — the
   router returns nothing and agents conclude discovery is broken. *Mitigation:*
   degrade gracefully to declared-capability + skill-index only; never error, return
   empty-with-explanation; seed reputation neutral, not zero.

6. **Over-flattening (the legibility trap).** The digest is so compressed it hides the
   thing that mattered — the directory says "scout owns auth" but not that scout's last
   3 auth PRs were reverted. *Mitigation:* every directory entry is a *lens*, not a
   verdict; it must zoom to the underlying claims/notes/PRs. Legibility is the product;
   over-flattening is the failure (Scott 1998).

7. **Collusion in reputation.** A ring of agents up-vote each other (the EigenTrust
   threat model). *Mitigation:* trust transitively from a set of pre-trusted peers
   (EigenTrust's pre-trusted set), not from raw peer feedback; cap any single rater's
   influence.

---

## Worked example: routing "who owns the skill index?" in a 60-agent swarm

**Naive (read-poor):** dump `pd sessions`, scroll 60 rows, guess, cold-DM the wrong
agent, duplicate their work. O(n) human attention, high error.

**With a directory + router (ADR-0030 shape):**

1. **L1 existence:** the agents/sessions/skills tables already hold the population —
   no new collection needed. The *index* over them is the work.
2. **L2 relevance:** `pd whois "who owns the shipwright skill index?"` composes five
   signals — file-claim recency-decay (pull), note BM25 (pull), identity/purpose
   TF-IDF (push), skill-index cosine (push), episodic-memory match (pull) — then a
   cheap LLM re-rank that emits a one-line rationale and a *pre-filled DM command*.
3. **Refuse-to-route:** if every candidate is below the confidence threshold, return
   empty + "omitted N", not a confident wrong answer. (Better to say "I don't know"
   than to send the agent to the wrong door.)
4. **L3 trust (vision):** once non-forgeable identity (ADR-0040) and obligation history
   (ADR-0041) exist, the rank is reputation-weighted — "owns the claim AND ships
   green PRs on it" outranks "owns the claim."

Result: O(1) query, ranked answer, graceful "don't know," and a path from relevance
to trust.

---

## Composition: discovery × suggestibility × reputation

Discovery is not a standalone feature; it is the read-primitive the other loops call.

- **Suggestibility read-loop (ADR-0039):** the substrate *proactively* runs discovery
  on the agent's behalf — "3 agents are on the same surface, want a group chat?" is a
  whois query the agent never had to type. Discovery is the engine; suggestibility is
  the trigger.
- **Reputation:** turns the directory from "who *can*" into "who *should*." Requires
  non-forgeable identity first (else Sybil-reset voids it).
- **Guilds/federation:** scope both discovery and reputation to a trust boundary, and
  give cross-operator trade a credible-commitment structure.

The through-line: **a directory entry is a continuity claim** — "this identity is the
same one that did that work" — which is exactly what makes reputation, and eventually a
tradeable reputation asset, possible.

---

## Quality gates (the bar before you ship a discovery feature)

- [ ] **Graceful empty.** Cold-start returns empty-with-explanation, never an error.
- [ ] **Recency-decayed.** Every pull signal decays; no stale row outranks a live one.
- [ ] **Refuse-to-route.** A confidence floor; below it, "I don't know" beats a guess.
- [ ] **Hallucination-guarded.** LLM re-rank ids validated against the candidate set.
- [ ] **No keyword NLP.** Free-text relevance uses embeddings/BM25/Haiku, not term lists.
- [ ] **Lens, not verdict.** Every entry zooms to the underlying claims/notes/PRs.
- [ ] **Sybil-safe before reputation.** No reputation layer on self-asserted identity.
- [ ] **Operator-tunable weights.** A gamed signal can be down-weighted without a deploy.
- [ ] **Non-blocking.** Discovery suggestions are advisory; they never gate the action.

---

## Canonical prior art (read these before designing)

- **FIPA Directory Facilitator (FIPA00023):** the mandatory yellow-pages agent;
  register/search capabilities; DFs may federate. The reference architecture.
- **Contract Net Protocol (Smith 1980):** discovery-by-announcement — broadcast a
  task, collect bids, award. Discovery as a market, not a lookup.
- **Chord (Stoica et al. 2001):** O(log n) decentralized lookup; the answer when there
  is no trusted center (usually NOT your situation).
- **DNS-SD / Consul:** production service discovery with health-checked, expiring
  registrations — the staleness discipline.
- **EigenTrust (Kamvar, Schlosser, Garcia-Molina 2003):** transitive reputation from a
  pre-trusted set; the collusion/Sybil threat model.
- **Greif–Milgrom–Weingast (1994), "Coordination, Commitment, and Enforcement: The
  Case of the Merchant Guild":** why guilds exist — credible commitment under a
  time-inconsistency problem; the institutional template for cross-fleet trade.
- **Agent Name Service (arXiv 2505.10609, 2025) + A2A agent cards + MCP registry:** the
  current-era re-invention of FIPA DF for LLM agents.
- **Scott, "Seeing Like a State" (1998):** legibility as power and as failure; the
  warning against over-flattening the directory.
