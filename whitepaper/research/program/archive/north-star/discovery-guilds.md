# Finding Each Other: Discovery, Directories, and Guilds for Agentic Babylonia

**Layer.** L2 (legibility + authority) bleeding into L3 (economy + federation) of the
Port Daddy North Star (**ADR-0048** — *the harbor-master thesis: Port Daddy makes a
swarm of coding agents legible, accountable, and safe to one operator, and a
cryptographic market when operators trade*).

**Audience.** A software engineer with a working CS background. No multi-agent-systems,
distributed-systems, or institutional-economics coursework assumed — every term of art
is defined on first use.

**Reading conventions (house style, after `docs/research/agent-accountability-proposal.md`).**
On first use, **every external technical term is bolded, cited, and given a one-line
gloss**, and **every Port Daddy abstraction is bolded with its source-file or ADR path
(relative to repo root) and a one-sentence explanation.** This is an *explanation*
document in the Diátaxis sense (understanding-oriented), denser than a blog post.

**Honesty marker.** This paper distinguishes **[BUILT]** (code on disk today),
**[PROPOSED]** (an accepted/draft ADR with a concrete design but no merged code), and
**[VISION]** (operator-stated direction, not yet specified). The discovery story is
mostly proposed: the substrate it composes over is built.

---

## Abstract

A single operator can hold two coding agents in their head. They cannot hold two
hundred. The bottleneck is not compute and not the write side of coordination
(claims, locks, merges) — it is the **read side**: how an agent, or the operator,
*finds* the right other agent, the relevant prior work, the trustworthy collaborator,
out of a population that produces far more legible state than anyone can read. We name
this disease **read-poverty** and argue it is the characteristic failure of swarms at
scale. We propose a three-layer cure — **existence** (a directory of who/what is out
there), **relevance** (ranked routing: "who is right for *this*?"), and **trust**
(reputation-aware discovery and guilds) — and show that each layer composes over
primitives Port Daddy already has on disk (a built skill index, sessions, file claims,
episodic memory) or has specified (the **whois** talent phonebook, non-forgeable
identity, obligation history). We ground the relevance layer in the proposed `pd whois`
router, the trust layer in EigenTrust and Greif's analysis of medieval merchant guilds,
and we connect discovery to the **suggestibility read-loop** (the substrate runs the
query on the agent's behalf) and to **reputation** (a directory entry is a continuity
claim, which is what makes reputation — and eventually a tradeable reputation asset —
possible). We are honest throughout about what is built versus designed versus
aspirational.

---

## 1. The thesis, stated concretely

Spin up two agents on a repo. You can read both their notes, eyeball both their file
claims, and route a question to the right one by recognition. Coordination is free
because the population is small enough to hold in working memory.

Now spin up fifty. An agent that wants to ask "who owns the OAuth refactor?" has no
move except to dump the session roster and scroll. It guesses. It cold-DMs the wrong
agent. It re-derives, from scratch, a design decision another agent settled an hour ago
and wrote into a note nobody will ever read again. The operator, trying to supervise,
sees a firehose and a flat list and no way to ask the obvious questions: *who is
working on the same thing as whom? who is the expert on this surface? who keeps
breaking the build?*

The swarm has not run out of information. It has drowned in it. Every agent emits
sessions, claims, notes, diffs, skill tags, and — eventually — reputations, far faster
than any single participant can read them. Call this **read-poverty**: a regime in which
legible state accumulates faster than it can be consulted, so participants fall back to
O(n) eyeball search or, worse, to acting blind.

> **The central claim.** Read-poverty, not write-contention, is the binding constraint
> on swarm scale. The write side has known fixes — claims, locks, merge queues, the
> Arbiter — and Port Daddy has shipped them. The read side has been left implicit, and
> it is where the next order of magnitude is won or lost.

The cure is the move every database made when table scans stopped scaling: **build an
index**. A **directory** is to agents what an **index** is to rows — it pays write-time
cost (maintaining the structure) to buy read-time speed (answer a query in O(query)
instead of scanning O(n) participants). This paper is about what those directories look
like for agents, how they rank, how they earn trust, and how they compose into the
larger North Star.

This is also a **legibility** argument in James C. Scott's sense (**Scott 1998**,
*Seeing Like a State* — *states make populations governable by imposing simplified,
readable schemas; the same simplification that enables governance can destroy the local
knowledge it flattens*). A directory is a state-like act of legibility over the swarm.
Done well it is the product. Done badly — over-flattened into a verdict that hides the
thing that mattered — it is the failure. Every directory entry must therefore be a
*lens that zooms to the real thing*, never a substitute for it. (ADR-0048 makes this the
governing principle: *every digest is a lens*.)

---

## 2. Three layers of discovery, in dependency order

```
L1  EXISTENCE   "who/what is out there?"     ->  registry / yellow pages
L2  RELEVANCE   "who is right for THIS?"      ->  ranked routing (whois)
L3  TRUST       "who is right AND reliable?"  ->  reputation-aware discovery + guilds
```

The layers are strictly ordered. Relevance ranking over a stale or empty registry
returns confident garbage. Reputation over an unranked registry has nothing to attach a
score to. Guilds without reputation are access-control lists with extra ceremony. You
build up.

### 2.1 L1 — Existence: the yellow pages

The canonical prior art is forty years old. **FIPA** (*Foundation for Intelligent
Physical Agents, the 1990s–2000s standards body for agent interoperability*) made a
**Directory Facilitator (DF)** (**FIPA Agent Management Specification, FIPA00023** —
*the mandatory "yellow pages" agent: others register the services they offer and query
to find agents that offer a needed service*) a required component of every conformant
platform. Two design choices from FIPA matter for us. First, the DF is **push-based**:
agents *self-advertise* capabilities. Second, **DFs may federate** — a platform can run
several, and they can peer, which is the seed of cross-operator discovery (§6).

The DF idea has been re-invented, almost beat for beat, for LLM agents. **A2A agent
cards** (*Agent-to-Agent protocol metadata documents listing an agent's skills,
endpoints, and capabilities*) are DF registrations. The proposed **MCP discovery
endpoint** (*a `.well-known/mcp` URI advertising a Model Context Protocol server's tools
and policies*) is a DF for tools. And the **Agent Name Service** (**Ren et al. 2025**,
*"Agent Name Service (ANS): A Universal Directory for Secure AI Agent Discovery and
Interoperability"*, arXiv:2505.10609 — *a DNS-inspired naming + capability-resolution
layer for agents, with PKI-backed identity*) is FIPA's DF with a 2025 threat model
bolted on. The lesson: **L1 is a solved shape**; what is new is doing it well under the
specific pathologies of LLM agents (self-report drift, Sybil reset, churn).

Port Daddy's L1 is already on disk, though it was not built as a "directory." The
`agents`, `sessions`, and `session_files` tables (schema in `lib/db.ts` — *the core
SQLite schema the daemon self-initializes*) hold the population, their stated purpose,
and their file claims. The **skill index** (`lib/shipwright/skill-index.ts` — *a
SQLite-backed vector index that embeds every `SKILL.md` description with a MiniLM
encoder and answers top-k cosine queries* **[BUILT]**) is a yellow pages over
*capabilities*. The existence layer is not the gap. The gap is the layers above it.

### 2.2 L2 — Relevance: from "who exists" to "who is right for *this*"

A flat registry answers "does an OAuth specialist exist?" It does not answer "of the
fifty live agents, who should I ask about *this specific* OAuth bug, given who touched
these files an hour ago and who wrote the design note?" That is a **ranking** problem,
and it is the heart of the proposed **talent phonebook**.

**`pd whois <query>`** (**ADR-0030**, `docs/adr/0030-talent-phonebook-coordination-router.md`
— *a coordination router that ranks live agents, sessions, actors, and skills by
relevance to a free-text query and returns scored matches with a one-line rationale and
a pre-filled DM command* **[PROPOSED]**) is Port Daddy's L2. Its design is the load-bearing
artifact for this paper, so it is worth stating its mechanism precisely (§3). The
crucial architectural decision: it is a **hybrid** of push and pull signals.

- **Push signals** (declared capability): the agent's `identity` and `purpose` strings,
  its skill tags resolved through the skill index. These come from self-report.
- **Pull signals** (demonstrated capability): file claims with recency decay, session
  notes via BM25, episodic-memory matches. These are *derived from what the agent
  actually did* — there is no self-report to lie in.

The blend is the point. Pure push is gameable and goes stale (an agent advertises
"auth expert" and never touches auth). Pure pull has no answer for an agent who *will*
be the right contact but has not acted yet. ADR-0030 weights five signals and lets the
operator tune each (§3).

### 2.3 L3 — Trust: reputation-aware discovery and guilds

L2 tells you who is *relevant*. It does not tell you who is *reliable*. "Owns the claim
on `auth.ts`" and "owns the claim on `auth.ts` and has shipped three green PRs there"
should not rank equally — but they do, until reputation enters the ranking. L3 turns
the directory from *who can* into *who should*.

This is where the discovery story collides with the accountability story, and where the
ordering bites hardest: **you cannot build reputation on a forgeable identity.** An
agent that earns a bad record under `project:stack:context` and re-registers as
`project:stack:context2` has shed it for free. The accountability research found this is
not hypothetical: **29 of 29** proposed mechanisms flagged a **Goodhart risk**
(**Goodhart 1975; Strathern 1997** — *"when a measure becomes a target, it ceases to be
a good measure"*) and **11 of 29** failed specifically to **Sybil reset** (**Douceur
2002**, *The Sybil Attack* — *defeating a reputation system by minting fresh
identities*), as recorded in `docs/research/agent-accountability-proposal.md`. So L3
depends on **non-forgeable actor identity** (**ADR-0040**,
`docs/adr/0040-non-forgeable-actor-identity.md` — *a daemon-minted, opaque, signing-key-
bound actor id that an agent cannot cheaply re-pick* **[PROPOSED]**) and on a record of
kept-and-broken commitments (**ADR-0041**,
`docs/adr/0041-durable-commitments-and-obligation-monitoring.md` — *obligation
monitoring + sanction, the violable counterpart to the Arbiter's regimentation of
prohibitions* **[PROPOSED]**). Discovery and accountability are the same primitive seen
from two sides: a directory entry that says "this is the agent that did that work" is
exactly the *continuity claim* a reputation attaches to.

When the directory grows past the point where a flat reputation-weighted ranking is
meaningful — hundreds of agents, non-uniform trust, cross-operator trade — the right
abstraction is the **guild** (§5).

---

## 3. The mechanism, grounded in Port Daddy primitives

The relevance layer is the most fully specified, so we detail it. ADR-0030 defines
`findExpert(query)` as a weighted sum of five sub-scores, each normalized to [0,1]
before weighting, with the final value clamped to [0,1]:

```
score(c, q) = clamp(
    w_file  * fileClaimScore(c, q)  +   # pull: did c touch files named in q, recently?
    w_note  * noteScore(c, q)       +   # pull: BM25 over c's recent session notes
    w_ident * identityScore(c, q)   +   # push: TF-IDF over c's identity+purpose
    w_skill * skillScore(c, q)      +   # push: skill-index cosine, joined to c's skills
    w_epis  * episodicScore(c, q)   -   # pull: episodic-memory match to past handoffs
    w_load  * loadPenalty(c)            # demote busy/draining agents
  , 0, 1)
```

Default weights (file 0.35, note 0.20, ident 0.20, skill 0.15, epis 0.10, load 0.15)
are each a `PD_WHOIS_W_*` environment variable — *operator-tunable, so a gamed signal
can be down-weighted without a code change*. Three details carry most of the design's
intelligence:

**Recency decay on every pull signal.** A file claim's contribution is
`exp(-λ · hoursAgo)` with a 6-hour half-life; episodic matches use a 24-hour half-life;
notes are restricted to the last 48 hours. *A stale row can never outrank a live one.*
This is the same discipline production service discovery enforces with health-checked,
expiring registrations (**Consul / DNS-SD** — *register-with-TTL so a dead service falls
out of the directory rather than lingering*); Port Daddy gets it from heartbeat
staleness via **resurrection** (`lib/resurrection.ts` — *a heartbeat-staleness detector
that flags dead agents* **[BUILT]**) rather than graceful deregistration, which agents
rarely do.

**No keyword NLP, anywhere it would matter.** The only sub-score using substring
matching is `fileClaimScore`, and it runs over *structured file paths* — a namespace
the operator controls. Every free-text signal uses BM25 (notes), TF-IDF character
bigrams (identity), or embeddings (skills). This is a deliberate refusal of keyword
lists for capability classification, whose recall is catastrophic because you cannot a
priori enumerate the terms for a category like "auth." The relevance layer reuses the
same MiniLM encoder the skill index already pays for (`lib/semantic-resolver.ts`), so
no new model download.

**A cheap LLM only re-ranks and explains — and is hallucination-guarded.** After
structural scoring, the top `min(2·limit, 6)` candidates go to a low-cost classifier
(resolved through `lib/llm-backend-resolver.ts` — *the single file that reads
`PD_*_BACKEND` env and returns a transport* **[BUILT]**) that emits, per candidate, a
≤15-word rationale and a ±0.1 re-ranking delta. **Every id in the LLM response is
validated against the candidate set the router sent** — unknown ids are dropped — so the
model cannot invent an agent. On malformed JSON or an 8-second timeout, the router falls
back to the structural ranking with `rationale: null`. The LLM is an *affordance*, not a
dependency: with no backend configured, `pd whois` still ranks, just without prose.

**Refuse-to-route.** If every candidate falls below a confidence floor (default 0.35),
the router returns `matches: []` with an `omitted` count — *not* a confident wrong
answer. CLI exit code 1, MCP an empty-matches response agents handle gracefully. This
is the single most important property for trust in a router: **"I don't know" must beat
a guess**, because the cost of sending an agent to the wrong door (duplicated work, a
cold DM, a corrupted handoff) is high and silent.

**Where it composes in.** ADR-0030 wires a non-blocking, stderr-only *pre-send
affordance* into **`pd begin`** (`cli/commands/sugar.ts` — *the session-start command*
**[BUILT]**) and `pd inbox send`: before an agent commits to a contact, the router
surfaces "scout edited these files 1h ago → pd inbox send scout …". It is advisory,
TTY-only, 3-second-timeout, and silenced by `PD_NO_SUGGEST=1`. *Discovery never gates
the action; it informs it.*

A note on honesty: `lib/router.ts` and `routes/router.ts` **do not exist on disk yet**.
ADR-0030 is Proposed. What exists is every signal source it composes (the agents table,
file claims, the skill index, episodic memory) and the backend resolver. The mechanism
is designed and grounded; it is not shipped.

---

## 4. Discovery is the read-side of two other loops

Discovery is not a standalone feature. It is the read-primitive that the suggestibility
loop and the reputation system both call.

### 4.1 Suggestibility: the substrate runs the query for you

The **suggestibility layer** (**ADR-0039**, `docs/adr/0039-suggestibility-layer.md` —
*topical-match coaching: the substrate proactively notices that several agents are on
the same surface, or that prior art exists, and surfaces it unprompted* **[DRAFT]**)
is discovery turned inside out. Instead of an agent typing `pd whois`, a background
classifier fingerprints each active agent every 60–90 seconds (session purpose, claimed
files, recent notes, last git diff hunks), embeds the topic, and runs a *cross-agent
similarity search* — which is a discovery query the agent never had to issue. When three
agents cluster on the same surface, the layer proposes an ad-hoc group chat; when an
agent's topic matches old episodic memory or an ADR, it surfaces the prior art.

The relationship is clean: **discovery is the engine; suggestibility is the trigger.**
ADR-0039 explicitly lists the skill index, episodic memory, the cartographer surface
finder (named `lib/spider.ts` in **ADR-0031**, `docs/adr/0031-spider-surface-finder.md`
**[PROPOSED]** — not yet on disk), and file claims as the sources it runs inference over — the same L1 substrate this paper's directories index. The
read-poor disease is precisely "nobody runs the query"; suggestibility runs it for you.

### 4.2 Reputation: from "who can" to "who should"

Section 2.3 established that reputation requires non-forgeable identity. The canonical
algorithm shows *how* a directory becomes reputation-aware once identity is solid.
**EigenTrust** (**Kamvar, Schlosser & Garcia-Molina 2003**, *"The EigenTrust Algorithm
for Reputation Management in P2P Networks"* — *compute a global trust value per peer as
the principal eigenvector of the normalized local-trust matrix; rank and route by it*)
gives a global, collusion-resistant trust score by **power iteration** over peer
feedback, anchored in a set of **pre-trusted peers** so a colluding ring cannot bootstrap
itself. The threat model EigenTrust assumes — *malicious peers minting fresh identities
to escape bad reputation* — is exactly the Sybil reset ADR-0040 closes. The composition
is therefore: ADR-0040 makes identity sticky → ADR-0041 records kept/broken obligations
→ an EigenTrust-style aggregation turns that history into a per-actor trust value → the
`pd whois` ranking adds trust as a sixth signal. None of this aggregation is built; it
is the natural L3 extension of a built L1 and a proposed L2.

There is a discovery-by-market alternative worth naming. The **Contract Net Protocol**
(**Smith 1980**, *"The Contract Net Protocol: High-Level Communication and Control in a
Distributed Problem Solver"*, IEEE Trans. Computers — *discovery by announcement: a
manager broadcasts a task, contractors bid, the manager awards*) discovers the right
worker not by lookup but by auction. This is the bridge to L3-as-market (ADR-0048's
"cryptographic market that lets fleets who don't trust each other work together"): when
fleets trade, "who should do this work?" becomes a bid, and reputation becomes the
collateral that makes a bid credible.

---

## 5. Guilds: trust-scoped sub-directories with enforcement

A **guild**, for our purposes, is *a named, trust-scoped sub-directory with membership
and an enforcement mechanism* — not merely an access-control list. You reach for one
when a flat reputation-weighted directory stops being meaningful: hundreds of agents,
non-uniform trust, and — the historically decisive case — cross-operator trade.

The economic-history grounding is sharp. Medieval long-distance trade faced a
**credible-commitment problem** rooted in **time inconsistency** (*a ruler who lures
foreign merchants to his city has every short-run incentive, once they arrive, to seize
their goods — and the merchants, anticipating this, never come*). The institution that
solved it was the **merchant guild** (**Greif, Milgrom & Weingast 1994**, *"Coordination,
Commitment, and Enforcement: The Case of the Merchant Guild"*, Journal of Political
Economy 102(4) — *a guild credibly threatens collective trade embargo, making the
ruler's promise of safe-conduct self-enforcing*). Earlier, the **Maghribi traders'
coalition** (**Greif 1993**, *"Contract Enforcement and Economic Institutions in Early
Trade: The Maghribi Traders' Coalition"* — *a reputation network in which cheating one
member meant losing all members as trading partners*) achieved enforcement through pure
multilateral reputation, with no formal authority.

The transfer to agent swarms is direct. A guild is the structure that lets *fleets who
do not trust each other* trade: membership is the trust boundary, collective sanction
(de-listing, embargo) is the enforcement, and reputation is the collateral. This is
precisely ADR-0048's L3 — *"the cryptographic market that lets fleets who don't trust
each other work together."* Two design implications follow from the history:

1. **A guild needs an exit cost.** Greif's guilds worked because membership was costly
   to acquire and costly to lose. A guild whose membership is free to mint and free to
   abandon is a Sybil farm — back to ADR-0040.
2. **A guild's enforcement must be collective, not central.** The Maghribi coalition had
   no king. The enforcement primitive is *every member refuses to deal with a cheater*,
   which maps onto a federated de-listing protocol, not a single authority's ban.

We mark guilds firmly **[VISION]**: no ADR specifies them. What exists is the substrate
they would require (identity, reputation, federation-capable directories), and a clear
institutional template for what "good" looks like.

---

## 6. Centralized now, federated later: the directory topology

A recurring design temptation is to reach for decentralized lookup too early.
**Chord** (**Stoica et al. 2001**, *"Chord: A Scalable Peer-to-Peer Lookup Service for
Internet Applications"*, ACM SIGCOMM — *a distributed hash table that resolves any key
to its owner in O(log n) hops with O(log n) per-node routing state, no central
authority*) is the textbook answer to "find a value in a peer-to-peer network with no
trusted center." It is also the **wrong** answer for a single-operator swarm, where
there *is* a trusted center: the daemon. You pay distributed-systems complexity
(finger-table maintenance, churn handling, eventual consistency) to solve a problem you
do not have.

The North Star's wedge sequencing settles the topology question:

- **Single-player (now): one centralized directory.** The daemon (`server.ts` on
  `localhost:9876`, SQLite-backed **[BUILT]**) already holds all the state. FIPA itself
  mandates exactly one DF per platform. A centralized directory gives the fastest
  queries and a single source of truth, and it is correct for the operator-as-wedge
  phase (ADR-0048 L2).
- **Multiplayer (later): federated directories.** When operators trade, each runs their
  own directory and they peer — FIPA's DF federation, ANS's DNS-inspired resolution,
  the Maghribi coalition's gossip. Cross-fleet discovery happens through federation, not
  a shared mutable table. This is ADR-0048 L3.
- **DHT (maybe never): only if there is genuinely no trusted center and churn is high.**
  Almost certainly premature for agent fleets in the foreseeable horizon.

The sequencing is the discipline: *do not build the federated/decentralized directory
until the centralized one is solved and the trade relationships that demand federation
actually exist.*

---

## 7. Failure modes (each with its precedent and mitigation)

1. **Read-poverty (the base disease).** State accumulates faster than it is read; the
   directory exists but is never indexed, so agents fall back to O(n) eyeball search and
   cold DMs. *Mitigation:* a query-answerable router (whois) wired into the moments
   agents act blind (`pd begin`, `pd inbox send`), plus suggestibility running the query
   unprompted (§4.1).

2. **Directory staleness.** Self-reported cards diverge from behavior; the yellow pages
   list an agent that died an hour ago. *Mitigation:* recency-decay every pull signal
   (ADR-0030's `exp(-λ·hoursAgo)`); expire on heartbeat staleness (resurrection), like
   Consul/DNS-SD TTLs, not on graceful deregister.

3. **Sybil reset (the reputation killer).** A bad-record agent re-registers fresh and
   inherits a clean slate (Douceur 2002). *Mitigation:* non-forgeable, daemon-minted
   identity (ADR-0040) **before** any reputation or guild layer. This is the hard
   ordering constraint of the whole paper.

4. **Goodhart on the rank.** Once "top of whois" is a target, agents farm it — claim
   files they will not touch, stuff notes with query terms (Goodhart 1975; Strathern
   1997). *Mitigation:* weight signals that are costly to fake and tied to real work
   (merged PRs, actual diffs) above cheap-to-emit ones; sample-audit; keep weights
   operator-tunable so a gamed signal is down-weighted without a deploy.

5. **Cold-start / empty directory.** Fresh install, no history, no reputations — the
   router returns nothing and the agent concludes discovery is broken. *Mitigation:*
   degrade to declared-capability + skill-index only; **never error, return
   empty-with-explanation**; seed reputation neutral, not zero.

6. **Over-flattening (the legibility trap).** The digest is so compressed it hides what
   mattered — "scout owns auth" omits that scout's last three auth PRs were reverted
   (Scott 1998). *Mitigation:* every directory entry is a *lens* that zooms to the
   underlying claims/notes/PRs, never a verdict that replaces them (ADR-0048's governing
   principle).

7. **Collusion in reputation.** A ring up-votes itself (EigenTrust's threat model).
   *Mitigation:* trust transitively from a pre-trusted set, not raw peer feedback; cap
   any single rater's influence (Kamvar et al. 2003).

---

## 8. Open problems

- **What is the unit of reputation?** Per-actor is the obvious choice, but expertise is
  surface-specific — an agent excellent at TypeScript refactors may be poor at SQL
  migrations. Per-(actor, surface) reputation is more accurate but sparser and slower to
  warm up. Unresolved.
- **How do guild boundaries interact with file claims?** If a guild scopes discovery,
  does it also scope the claim namespace? A cross-guild claim conflict needs a
  resolution rule that does not yet exist.
- **Federation consistency vs. the FLP impossibility.** Federated directories that must
  agree on membership face the **FLP impossibility** (**Fischer, Lynch & Paterson
  1985** — *no deterministic consensus is guaranteed to terminate in an asynchronous
  network with even one faulty process*). The Maghribi coalition tolerated inconsistency
  (gossip, eventual agreement); a cryptographic market may not. Which consistency model
  does cross-fleet trade actually need?
- **Calibrating the whois weights empirically.** ADR-0030 ships defaults and a plan to
  calibrate "after two weeks of real usage." There is no ground-truth dataset of
  "correct routes" to calibrate against. Building one is itself a discovery problem.
- **The market-vs-lookup boundary.** When does discovery want a Contract-Net auction
  (Smith 1980) versus a whois lookup? Auctions surface latent capacity and price it;
  lookups are cheaper and faster. The crossover point is unknown.

---

## 9. How this backs the North Star

ADR-0048's through-line is *memory + checkpoint → continuity → a person not a spawn →
reputation → a tradeable asset → the economy.* Discovery is the read-primitive that
makes every link after "continuity" legible:

- **Continuity → a person, not a spawn.** A directory entry is a *continuity claim* —
  "this stable identity is the one that did that work." Non-forgeable identity (ADR-0040)
  makes the claim true; the directory makes it *findable*. An agent you can find,
  reliably, across sessions, is a person, not a spawn.
- **Reputation → a tradeable asset.** You cannot trade what you cannot find or verify.
  Reputation-aware discovery (L3) is the appraisal layer that turns a reputation into
  something a counterparty can look up, weigh, and price.
- **The economy.** A market needs a directory (who is offering), a relevance ranking
  (who fits this job), and trust (who will deliver) — exactly L1/L2/L3. Guilds are the
  institution that lets distrusting fleets transact (Greif). Contract Net is the
  auction primitive once they do (Smith).

And the wedge sequencing maps cleanly onto the directory topology (§6): **single-player
L2** is a centralized directory + whois routing (the operator's GUI made legible);
**multiplayer L3 federation** is federated directories + guilds; **the market** is
reputation-as-collateral over Contract-Net auctions. Discovery is not a feature bolted
onto the North Star — it is the read-side substrate the whole staircase stands on.

---

## References

1. **FIPA** (2002). *FIPA Agent Management Specification* (SC00023). Foundation for
   Intelligent Physical Agents. — The Directory Facilitator yellow-pages standard.
   <http://www.fipa.org/specs/fipa00023/>
2. **Ren, V. et al.** (2025). *Agent Name Service (ANS): A Universal Directory for
   Secure AI Agent Discovery and Interoperability.* arXiv:2505.10609.
   <https://arxiv.org/abs/2505.10609>
3. **Smith, R. G.** (1980). *The Contract Net Protocol: High-Level Communication and
   Control in a Distributed Problem Solver.* IEEE Transactions on Computers, C-29(12),
   1104–1113. <https://www.reidgsmith.com/The_Contract_Net_Protocol_Dec-1980.pdf>
4. **Stoica, I., Morris, R., Karger, D., Kaashoek, M. F. & Balakrishnan, H.** (2001).
   *Chord: A Scalable Peer-to-Peer Lookup Service for Internet Applications.* ACM
   SIGCOMM. <https://pdos.csail.mit.edu/papers/chord:sigcomm01/chord_sigcomm.pdf>
5. **Kamvar, S. D., Schlosser, M. T. & Garcia-Molina, H.** (2003). *The EigenTrust
   Algorithm for Reputation Management in P2P Networks.* WWW '03.
   <https://nlp.stanford.edu/pubs/eigentrust.pdf>
6. **Douceur, J. R.** (2002). *The Sybil Attack.* IPTPS '02.
7. **Greif, A., Milgrom, P. & Weingast, B. R.** (1994). *Coordination, Commitment, and
   Enforcement: The Case of the Merchant Guild.* Journal of Political Economy, 102(4),
   745–776. <https://www.journals.uchicago.edu/doi/abs/10.1086/261953>
8. **Greif, A.** (1993). *Contract Enforcement and Economic Institutions in Early Trade:
   The Maghribi Traders' Coalition.* American Economic Review, 83(3), 525–548.
9. **Scott, J. C.** (1998). *Seeing Like a State: How Certain Schemes to Improve the
   Human Condition Have Failed.* Yale University Press.
10. **Goodhart, C.** (1975); **Strathern, M.** (1997). *"Improving ratings": audit in
    the British university system.* European Review, 5(3), 305–321. — Goodhart's law.
11. **Fischer, M. J., Lynch, N. A. & Paterson, M. S.** (1985). *Impossibility of
    Distributed Consensus with One Faulty Process.* Journal of the ACM, 32(2), 374–382.
12. **HashiCorp.** *Consul service discovery and DNS interface.* — Health-checked,
    TTL-expiring service registry. <https://developer.hashicorp.com/consul/docs/discover>

### Port Daddy grounding (repo-relative)

- `docs/adr/0030-talent-phonebook-coordination-router.md` — `pd whois` router **[PROPOSED]**
- `docs/adr/0039-suggestibility-layer.md` — proactive topical-match coaching **[DRAFT]**
- `docs/adr/0040-non-forgeable-actor-identity.md` — daemon-minted identity **[PROPOSED]**
- `docs/adr/0041-durable-commitments-and-obligation-monitoring.md` — obligation history **[PROPOSED]**
- `docs/adr/0031-spider-surface-finder.md` — cartographer surface index **[PROPOSED]**
- `lib/shipwright/skill-index.ts` — vector skill catalog (the built L1 capability index) **[BUILT]**
- `lib/semantic-resolver.ts` — shared MiniLM encoder reused by the router **[BUILT]**
- `lib/llm-backend-resolver.ts` — single env-resolved LLM transport for the re-rank **[BUILT]**
- `lib/resurrection.ts` — heartbeat-staleness expiry (the TTL discipline) **[BUILT]**
- `lib/db.ts` — `agents`/`sessions`/`session_files` tables (the population) **[BUILT]**
- `docs/research/agent-accountability-proposal.md` — the 29-mechanism Goodhart/Sybil audit

---

*Companion skill:* `~/.claude/skills/agent-discovery-directories-guilds/SKILL.md` —
decision points, failure modes, worked examples, and quality gates for designing
discovery/directory/guild systems for agent swarms.
