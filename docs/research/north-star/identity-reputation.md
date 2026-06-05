# From Spawn to Person: Identity Continuity as the Foundation of Agentic Reputation

> A North Star whitepaper for **Port Daddy** (the local-first harbor-master for
> agent swarms; see `docs/adr/0048-what-port-daddy-is.md`). This paper backs the
> **L3 bridge** — the link in the stack where a *spawn* becomes a *person*, a
> person accrues *reputation*, and reputation becomes a *tradeable asset*. It is
> the cited companion to Phases 5 and 6 of the ADR-0048 Implementation Matrix
> (`adr-0048-phase-5-L3-identity-continuity`, `adr-0048-phase-6-L3-reputation`).

> **House style.** First use of an external technical term gets **bold +
> citation + one-line gloss**; first mention of a Port Daddy abstraction gets
> **bold + repo-root-relative path + one sentence**. (The rule lives in
> `AGENTS.md` § Writing technical docs.)

> **Honesty contract.** This paper marks every claim as **[BUILT]**,
> **[DESIGNED]** (an accepted/proposed ADR, no shipping code), or **[VISION]**
> (research, not yet specified). The North Star's own legibility principle —
> *every digest is a lens that zooms to the real thing, never a replacement*
> (`docs/adr/0048-what-port-daddy-is.md`) — forbids selling a design as a feature.

---

## Abstract

Port Daddy's North Star ends in a market: *"the cryptographic market that lets
fleets who don't trust each other work together"*
(`docs/adr/0048-what-port-daddy-is.md`). A market needs prices; prices on labor
need reputation; reputation needs an identity that cannot be shed; and an identity
that cannot be shed needs **continuity** — memory, checkpoint, and an outcome
history that outlives any one process or context window. This paper traces that
dependency chain in reverse, from the economy back to its load-bearing root, and
argues the central thesis of the L3 bridge: **a reputation system is exactly as
real as the identity it keys on, and an identity is durable only if it carries
continuity.** We ground the chain in Port Daddy's primitives (episodic memory,
actor-souls, resurrection, bonds, the Arbiter), connect each link to its prior
art (Locke and Parfit on personal identity; Friedman & Resnick and Douceur on
cheap-pseudonym attacks; Elo, Bradley–Terry and TrueSkill on skill rating; the
contextual-bandit LLM-routing literature; Zheng et al. on LLM-as-judge bias), and
catalog the failure modes that quietly turn each link into theater. The honest
finding: Port Daddy today has the *organs* of continuity but not yet the *spine*
of reputation, and the build order is therefore forced — identity, then outcomes,
then a score, then routing, then a market.

**Four-bullet summary**

- **No reputation without continuity; no market without reputation.** A *role* is
  `{obligation, capability, authority}`; a *person* is a role instance **plus**
  continuity. Reputation can only attach to persons, and a market can only price
  reputation.
- **Identity is the load-bearing root.** While Port Daddy identities are
  self-asserted strings (`lib/actor-roster.ts`), every reputation built on them is
  defeated for free by **Sybil-reset** and **whitewashing** — a respawn launders
  the record. The fix (`docs/adr/0040-non-forgeable-actor-identity.md`) is the one
  genuinely architectural piece.
- **Continuity has three distinct organs** — memory (`lib/episodic-memory.ts`,
  **[BUILT]**), checkpoint (resurrection passes *notes*, not state, so this is
  weak **[BUILT-WEAK]**), and an outcome ledger (`docs/adr/0041-…`, **[DESIGNED]**)
  — and reputation keys on the third, the one not yet built.
- **The estimator is the easy part, and the last part.** Elo/Bradley–Terry,
  TrueSkill, and contextual-bandit routing are well-understood; the work is the
  three links beneath them. Ship the score as *telemetry*, gate on *predicates*,
  and de-bias any judge in the loop, or the score becomes a Goodhart target.

---

## 1. The thesis, stated as a dependency chain

The North Star compresses the entire L3 program into one line
(`docs/adr/0048-what-port-daddy-is.md`):

> **memory + checkpoint (resurrection with teeth) → continuity → a *person* not a
> *spawn* → registered outcomes → reputation/Elo → a hireable/sellable asset →
> the market.**

Read left to right it is a roadmap. Read right to left it is a proof obligation:
each arrow is a claim that the right-hand thing is *impossible without* the
left-hand thing. The market is impossible without prices; prices on labor are
impossible without reputation; reputation is impossible without an identity that
survives sanction; that identity is impossible without continuity. The paper's job
is to defend each arrow and locate exactly where Port Daddy's reality stops.

The ADR also gives us the vocabulary that makes the chain precise. A **role** is a
bundle of `{obligation, capability, authority}` — "cartographer", "lookout",
"navigator" — an org-chart entry any spawn can fill. A **person** is a role
instance *plus continuity* (memory, checkpoint, outcome history). The slogan **"a
person, not a spawn"** is therefore not poetry: it is the precise statement that
reputation attaches to the continuity, not to the role and not to the process.

> **Why "Port Daddy" / "harbor-master".** Port Daddy is a local-first daemon
> (`server.ts`, the always-on `com.portdaddy.daemon` on `localhost:9876`,
> SQLite/WAL) that coordinates a *fleet* of coding agents for one operator. The
> L3 "market" is the future state where operators federate and trade fleet labor.

---

## 2. Personal identity is a continuity problem (the philosophy is load-bearing)

The claim "a person is a role *plus continuity*" is not a metaphor borrowed
loosely; it is the dominant theory of personal identity in philosophy, and it
makes a specific, useful prediction about which kind of continuity matters.

**Locke's memory criterion** (Locke, *An Essay Concerning Human Understanding*,
1689, Bk II ch. xxvii — *personal identity consists in the continuity of
consciousness/memory, not of substance*) is the founding move: what makes the
person at t2 the same as the person at t1 is not the same body or the same
"soul-stuff" but a connection of *memory* between them. This is precisely the
move Port Daddy makes when it separates the **actor-soul** (durable identity,
mailbox, history) from the **body-lease** (the live incarnation with a heartbeat)
in **actor-souls** (`docs/adr/0022-durable-actor-souls-and-body-leases.md` — *the
durable identity/state of an agent that outlives any one process or session*).
The body is Lockean substance; the soul is Lockean consciousness.

But Locke's raw version has a famous bug, and the bug matters for us. Direct
memory **connectedness** is not **transitive**: an old general may remember being
a brave officer who remembered being a boy, yet not remember being the boy
(Reid's objection). **Parfit's repair** (Parfit, *Reasons and Persons*, 1984 —
*identity is psychological **continuity**, an overlapping chain of memory/
intention connections, which is transitive even when direct connectedness is
not*) is the version that survives. The lesson for agent design is sharp:

> An agent that keeps a memory stream but loses its **outcome ledger** between
> incarnations is *connected*, not *continuous*. Continuity is the transitive
> chain — and reputation, which must accumulate across arbitrarily many
> incarnations, can only attach to the transitive thing.

This is why, later, we will insist the **outcome ledger** (not the memory stream)
is the organ reputation keys on. Memory makes an agent *feel* like the same
character; the ledger makes it *be* the same accountable principal.

---

## 3. The three organs of continuity (and what Port Daddy has built)

"Continuity" is routinely used to mean three different things. Conflating them is
the most common way a reputation design fails its own honesty test.

### 3.1 Memory — the episodic record  **[BUILT]**

**Episodic memory** (`lib/episodic-memory.ts` — *durable memory episodes promoted
out of transient execution history*; factory `createEpisodicMemory(db, …)`) is
Port Daddy's record of *what happened*: typed episodes (`handoff`, etc.) with a
title, a summary, a source reference, and a harbor/agent scope. This is the
shipped organ. Its design echoes the canonical agent-memory architecture —
**Generative Agents** (Park, J.S. et al., *Generative Agents: Interactive Simulacra
of Human Behavior*, UIST 2023 — *a memory stream of natural-language observations,
periodic **reflection** into higher-level inferences, and retrieval scored by
recency × importance × relevance*). Port Daddy's promotion-of-episodes step is the
same idea: not every event is worth remembering, so episodes are *promoted* from
raw history, the analogue of Park's importance gate.

The broader literature has since formalized this into taxonomies of short-term /
long-term-episodic / profile memory (see the 2025–2026 surveys on LLM-agent memory
mechanisms, e.g. *A Survey on the Evolution of LLM Agent Memory Mechanisms*,
Preprints.org 2026; *Memory for Autonomous LLM Agents*, arXiv:2603.07670). Port
Daddy's episodic table is the long-term-episodic layer; the **three-tier memory
vocabulary** (`docs/adr/0035-three-tier-memory-vocabulary.md`) is its naming.

### 3.2 Checkpoint — restorable state  **[BUILT, but WEAK — say so]**

A checkpoint is *restorable execution/belief state*: enough that a successor
resumes where the predecessor stopped. Port Daddy's **resurrection**
(`lib/resurrection.ts` — *a heartbeat-staleness detector that flags dead agents
for salvage and republishes their unfinished work*) is the liveness organ. But it
must be described honestly, and the repo already does: resurrection **passes
notes, not state.** It is checkpoint-of-*record*, not checkpoint-of-*execution*.
The North Star calls the goal "resurrection **with teeth**" precisely because the
current version has gums. This paper does not paper over that: strong continuity
(the kind that lets a person *resume* rather than merely *inherit a summary*) is
**[VISION]**, and selling weak resurrection as checkpointing would violate the
ADR-0048 legibility principle and the **honest-attestation** discipline
(`docs/adr/0045-loud-fail-invariants-and-honest-attestation.md` — *only say "all
good" when you have actually verified it; absence of error ≠ attestation*).

### 3.3 Outcome ledger — the witnessed record of delivery  **[DESIGNED]**

The third organ is the one reputation actually keys on, and the one not yet built:
an **append-only, daemon-witnessed outcome ledger.** Its design lives in
**durable commitments** (`docs/adr/0041-durable-commitments-and-obligation-monitoring.md`
— *a violable promise bound 1:1 to an actor, auto-enrolled when a claim is taken,
closed only against an oracle, and watched by an obligation monitor that is the
dual of resurrection*). The commitment row records what was promised; closing it
requires a `closed_by_oracle_ref` (a released **claim**, a merged commit SHA, a
passing test id, a satisfied **Arbiter** sub-check). An **oracle** here is *a
trusted source of ground truth the agent cannot author*. The ledger is the
transitive, Parfitian chain of §2 made concrete: a sequence of witnessed
deliveries that survives every respawn.

> **The diagnosis in one sentence.** Port Daddy has memory **[BUILT]**, weak
> checkpoint **[BUILT-WEAK]**, and a *designed* outcome ledger **[DESIGNED]** — so
> it has the *organs* of continuity but not yet the *spine* of reputation, because
> the spine is the third organ.

---

## 4. Identity: the root the whole chain hangs from

Before any organ of continuity matters, the identity it attaches to must be one
the agent cannot freely re-pick. This is the most important — and the most
under-appreciated — claim in the paper, and Port Daddy's own research already
proves it the hard way.

The accountability synthesis (`docs/research/agent-accountability-proposal.md`)
mined 46 candidate mechanisms, stress-tested 29 adversarially, and found that
**29 of 29 flagged a Goodhart risk** and **11 of 29 failed specifically to
Sybil-reset.** The root cause is one line of present-tense code: Port Daddy
identities are **self-asserted strings** of the form `project:stack:context`,
resolved by the **actor-roster** (`lib/actor-roster.ts` — *maps agent-supplied
identity fields to a canonical actor id, freely aliasing one to another*). An
agent that earns a throttle, a slash, or a bad reputation simply re-registers as
`project:stack:context2` and inherits a clean slate. Every reputation system built
on that identity is, in the adversarial reviewer's phrase, *"climbing an imaginary
staircase."*

The literature names both attacks precisely:

- **The Sybil attack** (Douceur, J., *The Sybil Attack*, IPTPS 2002 — *defeating a
  reputation or quorum system by minting many pseudonymous identities*). With free
  identities, an attacker (or a lazy agent) gets unlimited fresh starts.
- **Whitewashing** (Friedman, E. & Resnick, P., *The Social Cost of Cheap
  Pseudonyms*, J. Econ. & Mgmt. Strategy, 2001 — *when pseudonyms are cheap, agents
  let reputation rot and re-enter as newcomers; society pays a "cheap-pseudonym"
  cost because it must distrust all newcomers*). This is the deeper result: the
  *existence* of cheap re-entry imposes a tax on every honest newcomer.

A reputation system is **incentive-compatible** (Nisan, N. et al., *Algorithmic
Game Theory*, 2007 — *a mechanism is incentive-compatible when honest behavior is
each agent's best strategy*) only if a bad record cannot be shed more cheaply than
it can be earned. That is impossible with a re-pickable id. The fix is
**non-forgeable actor identity** (`docs/adr/0040-non-forgeable-actor-identity.md`
**[DESIGNED]** — *a daemon-minted opaque `actor_id` (ULID) bound to a credential
the agent cannot cheaply re-pick — a per-actor signing key or the actor-soul
body-lease — with the self-asserted string demoted to a display alias*).

Friedman & Resnick's analysis also dictates the *newcomer policy*, and ADR-0040
adopts it almost verbatim: a strict floor blocks legitimate first runs; a lenient
floor makes whitewashing free. The resolution is not a scalar but a *shape* — a
newcomer gets **full ability to work but a reduced economic ceiling** (lower
default **bonds** ceiling — `lib/bonds.ts` — *collateral an agent escrows on spawn,
refunded on clean exit or slashed on failure* — and lower spawn ceiling) until it
has accrued daemon-witnessed clean exits. This prices identity churn without
locking out genuine newcomers — exactly the social-cost trade-off Friedman &
Resnick model.

> **This is the forced bottleneck.** Of the entire program, ADR-0040 is "the *one*
> genuinely architectural piece … everything else is additive"
> (`docs/adr/0040-…`). The estimator, the routing, the market — all of it waits on
> a non-forgeable id. Build it first.

---

## 5. The reputation estimator (the well-understood part)

Once identity is non-forgeable and outcomes are witnessed, scoring is the part the
literature has already solved. The design choice is *which signal you have*.

### 5.1 Pairwise / tournament signal → Elo, Bradley–Terry, TrueSkill

When the signal is comparative — backend X's diff was preferred to backend Y's on
the same task; agent A closed the contested claim, agent B did not — the right
tool is a latent-strength model.

- **The Elo system** (Elo, A., *The Rating of Chessplayers, Past and Present*,
  1978 — *each player has a scalar rating; expected score is a logistic function of
  the rating difference; ratings update by the surprise of each result*) is the
  familiar online updater.
- **The Bradley–Terry model** (Bradley & Terry, 1952 — *the maximum-likelihood
  latent-strength model of which Elo is the online special case*) is what
  large-scale LLM evaluation has converged on. **Chatbot Arena**
  (Chiang et al., *Chatbot Arena: An Open Platform for Evaluating LLMs by Human
  Preference*, arXiv:2403.04132, 2024) moved *from* online Elo *to* a Bradley–Terry
  fit precisely because, with the full game history available and mostly-static
  players, BT gives more stable ratings than Elo's recency-weighted online update.
  This is directly relevant: a Port Daddy harbor *has* the full outcome history in
  SQLite, so it is in the BT regime, not the streaming-Elo regime.
- **TrueSkill** (Herbrich, R., Minka, T., Graepel, T., *TrueSkill: A Bayesian Skill
  Rating System*, NeurIPS 2007 — *each player's skill is a Gaussian belief
  (mean μ, uncertainty σ); inference is approximate message-passing on a factor
  graph; handles draws, teams, and any number of competitors*) is the right tool
  the moment you need **calibrated uncertainty** — which you always do for a fresh
  backend or a newcomer agent. TrueSkill's σ encodes "we have not tested this one
  enough to trust the mean," which is exactly the cold-start signal a router needs
  to *explore* rather than *exploit*. This is the principled answer to the
  newcomer-starvation failure mode (§6).

### 5.2 Scalar outcome signal → learned-outcome (bandit) routing

When the signal is a scalar per `(context, backend)` — did the test pass, what did
it cost, how long did it take — the problem is **contextual-bandit** model
selection (*choose an arm/backend per context from partial feedback, trading
exploration against exploitation*). The recent LLM-routing literature is a direct
template for Port Daddy's **learned-outcome routing**:

- Routing as a contextual bandit conditioned on a *cost/quality preference vector*
  (*Adaptive LLM Routing under Budget Constraints*, arXiv:2508.21141, 2025; *Learning
  to Route LLMs from Bandit Feedback*, arXiv:2510.07429, 2025) — one policy, many
  trade-offs, which maps onto an operator dialing "cheap vs. careful" per task.
- **NeuralUCB**-style upper-confidence routing (*Reward-Based Online LLM Routing via
  NeuralUCB*, arXiv:2603.30035) makes the exploration bonus explicit — the bandit
  analogue of TrueSkill's σ.
- **RouterBench** (the 36,497-sample / 11-LLM routing benchmark) reports ~93% of
  GPT-4 quality at ~25% of cost from good routing — the order-of-magnitude prize
  that justifies the whole estimator layer for the operator's COGS.

For Port Daddy this is the bridge from L2 (the operator picking a backend) to L3
(the market pricing one): the same learned score that *routes* a task internally
becomes the *reputation* a federated buyer reads.

### 5.3 Agentic reviews → de-biased LLM-as-judge

Many outcome signals will come from an **agentic review** — an LLM judging another
agent's diff. This is powerful and *biased*, and the bias is well-characterized:
**LLM-as-judge** (Zheng, L. et al., *Judging LLM-as-a-Judge with MT-Bench and
Chatbot Arena*, NeurIPS D&B 2023 — *strong judges reach >80% agreement with humans
but exhibit **position bias** (favoring the first option), **verbosity bias**
(favoring longer answers), and **self-enhancement bias** (favoring their own
family)*). The mitigations are non-negotiable for any outcome that feeds
reputation: swap presentation order and average; prefer pairwise to absolute
scoring; never let a backend judge its own family unblinded. This is the
estimator-layer mirror of the substrate-layer rule "closure must bind to an
oracle the agent cannot author."

---

## 6. Failure modes — where each link silently becomes theater

Every arrow in the chain has a way to look done while being hollow. A design that
does not name its defense for each is theater.

| Link | Failure | Name + source | Defense (PD primitive) |
|---|---|---|---|
| identity | respawn buys a clean slate | **Sybil-reset** (Douceur 2002) | daemon-minted id bound to a credential (`docs/adr/0040`) |
| identity | rot then re-enter as newcomer | **whitewashing** (Friedman & Resnick 2001) | newcomer floor: full work, reduced economic ceiling (`docs/adr/0040` + `lib/bonds.ts`) |
| continuity | "resurrection" only forwards a note | weak checkpoint sold as strong | label honestly (`lib/resurrection.ts`; ADR-0045 honest attestation) |
| outcome | agent self-closes its own success | **Goodhart** (Strathern 1997 — *when a measure becomes a target it ceases to be a good measure*) | close only against an oracle; sampled adversarial re-open (`docs/adr/0041`) |
| reputation | optimize the proxy, not the work | Goodhart again | gate on predicates, score as telemetry; pair with adversarial QA |
| reputation | new backend looks bad / untested | exploration starvation / cold start | TrueSkill σ or bandit UCB bonus (§5) |
| judge | self-preference / position / verbosity | LLM-judge bias (Zheng 2023) | blind, order-swap, pairwise, family-exclude |
| sanction | hollow compliance cheaper than honesty | incentive mis-design (Nisan 2007) | graduated, **staked** sanctions; faked-and-caught must cost MORE than honest non-completion (Ostrom 1990, *Governing the Commons* — *graduated sanctions, warning first, exile last*) |

The single most important entry is the **sampled adversarial auditor**: re-open a
random + risk-weighted fraction of *cleared* outcomes and re-run the claimed
validation, judging the closing note against the diff (`docs/adr/0041`). It is the
only mechanism that attacks the *proxy gap* — the space between "technically met
the check" and "actually did the work." More presence-checks do not help; only a
chance of being re-graded does.

> **The honest ceiling (repeated because it is the most-violated rule).** None of
> this proves the work was *good* — only that a promise was *closed against an
> oracle on a clock the agent did not set* (`docs/research/agent-accountability-proposal.md`).
> Reputation built this way measures *reliable delivery*, not *quality*; quality
> needs adversarial QA on top. Never sell the ledger as proof of quality.

---

## 7. How this backs the North Star

The North Star's discipline is *sequencing* — ship the single-player wedge, then
federation, then the market (`docs/adr/0048-what-port-daddy-is.md`). This paper
shows the sequencing is not a marketing choice but a *dependency truth*, and it
maps cleanly onto the ADR-0048 Implementation Matrix:

```
ADR-0040 non-forgeable id   ──┐  (the architectural bottleneck — build first)
                              ▼
ADR-0041 commitments +        ┤  Phase 5: identity = role + continuity
  obligation monitor          │  "a person with a checkpointed identity + outcome ledger"
  (the outcome ledger)        │
                              ▼
reputation estimator          ┤  Phase 6: Elo/BT/TrueSkill + bandit routing + agentic reviews
  + learned-outcome routing   │  "backend/agent selection uses a learned reputation score"
                              ▼
harbor federation + market    ┘  Phase 7: two operators' fleets co-work + trade
  on the bond ledger             with reputation + escrow
```

Three consequences for the roadmap fall out:

1. **The read-surface / memory work is not a side quest.** ADR-0048 says it
   outright, and §2–§4 prove it: memory and the outcome ledger are the *literal
   foundation* of L3. Funding continuity is funding the economy.
2. **Identity (ADR-0040) is the gate.** Until the id is non-forgeable, building the
   estimator is building on sand — the 11-of-29 Sybil-reset result is the proof.
   The single most leverage-dense next commit in the whole L3 program is ADR-0040.
3. **The estimator is cheap and last.** Elo/BT/TrueSkill and bandit routing are
   off-the-shelf; the hard, original work is the substrate beneath them. A team
   tempted to start with "an Elo leaderboard for backends" would be building the
   roof before the foundation.

---

## 8. Open problems and future work  **[VISION]**

The North Star explicitly parks the richer designs as "memory-scoping / generative
designs, L3+ research" (`docs/adr/0048-what-port-daddy-is.md`). They are real and
hard:

- **Strong resurrection (checkpoint-with-teeth).** Moving from
  continuity-of-record to continuity-of-*state* so a successor *resumes* rather
  than inherits a summary. This is the hardest continuity problem and the one that
  most upgrades the "person" claim from metaphor to fact.
- **Role-scoped vocational memory.** A memory pooled across *all* instances of a
  role, so every "cartographer" inherits cartographer lessons. This is the
  Parfitian chain widened from one person to a *lineage* — and it reintroduces the
  whitewashing risk at the role level (a fresh instance inherits good rep it did
  not earn). Gate accordingly.
- **Backend-scoped baselines.** A backend's reputation as a shared *prior* across
  every agent it powers, with per-task deltas — the natural TrueSkill hierarchy
  (backend μ as the prior mean for each agent it spawns).
- **Harbor-scoped team memory.** Continuity at the fleet level, not just the agent.
- **Evolutionary breeding.** High-reputation persons seed new ones; reputation
  becomes heritable. Powerful and *dangerous* — mode collapse, Goodhart at the
  lineage level, and a Sybil attack that now reproduces. Needs the strongest gates
  of anything here.
- **Cross-harbor reputation portability without a global PKI.** ADR-0040's threat
  model is a lazy agent in a fleet the operator *owns*; the market (L3 federation)
  introduces a *mutually-distrusting* counterparty, where reputation must travel
  across a trust boundary. This is where the *cryptographic* market of the
  one-sentence definition becomes load-bearing — and is the seam between this paper
  and the economy/anchor whitepaper.

---

## 9. References

*(External works — verify against primary sources before citing downstream.)*

1. Locke, J. (1689). *An Essay Concerning Human Understanding*, Bk II, ch. xxvii. (Memory criterion of personal identity.) — Stanford Encyclopedia of Philosophy, *Locke on Personal Identity*.
2. Parfit, D. (1984). *Reasons and Persons.* Oxford University Press. (Psychological **continuity** vs. connectedness; transitivity.)
3. Friedman, E. & Resnick, P. (2001). The Social Cost of Cheap Pseudonyms. *Journal of Economics & Management Strategy* 10(2), 173–199. (Whitewashing; newcomer cost.)
4. Douceur, J. (2002). The Sybil Attack. *Proc. IPTPS.* (Minting identities to defeat a reputation/quorum system.)
5. Strathern, M. (1997). 'Improving ratings': audit in the British University system. *European Review* 5(3). (Canonical statement of Goodhart's law.)
6. Nisan, N., Roughgarden, T., Tardos, É., Vazirani, V. (eds., 2007). *Algorithmic Game Theory.* Cambridge University Press. (Incentive compatibility.)
7. Ostrom, E. (1990). *Governing the Commons.* Cambridge University Press. (Graduated sanctions.)
8. Elo, A. (1978). *The Rating of Chessplayers, Past and Present.* Arco. / Bradley, R. & Terry, M. (1952). Rank analysis of incomplete block designs. *Biometrika* 39.
9. Herbrich, R., Minka, T., Graepel, T. (2007). TrueSkill: A Bayesian Skill Rating System. *Advances in Neural Information Processing Systems* 19, 569–576.
10. Zheng, L. et al. (2023). Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena. *NeurIPS Datasets & Benchmarks.* arXiv:2306.05685.
11. Chiang, W.-L. et al. (2024). Chatbot Arena: An Open Platform for Evaluating LLMs by Human Preference. arXiv:2403.04132.
12. Park, J.S., O'Brien, J., Cai, C.J., Morris, M.R., Liang, P., Bernstein, M.S. (2023). Generative Agents: Interactive Simulacra of Human Behavior. *UIST '23.* arXiv:2304.03442.
13. *Adaptive LLM Routing under Budget Constraints.* (2025) arXiv:2508.21141. / *Learning to Route LLMs from Bandit Feedback.* (2025) arXiv:2510.07429. / *Reward-Based Online LLM Routing via NeuralUCB.* arXiv:2603.30035.
14. Surveys on LLM-agent memory (2025–2026): *Memory for Autonomous LLM Agents* (arXiv:2603.07670); *A Survey on the Evolution of LLM Agent Memory Mechanisms* (Preprints.org 202601.0618).

*(Port Daddy grounding — repo-root-relative.)*

- `docs/adr/0048-what-port-daddy-is.md` — the North Star (the stack; the through-line; the legibility principle).
- `docs/adr/0040-non-forgeable-actor-identity.md` — non-forgeable id (the architectural bottleneck). **[DESIGNED]**
- `docs/adr/0041-durable-commitments-and-obligation-monitoring.md` — the outcome ledger (commitments + obligation monitor). **[DESIGNED]**
- `docs/adr/0022-durable-actor-souls-and-body-leases.md` — actor-soul vs. body-lease (the substance/consciousness split). **[ACCEPTED]**
- `docs/adr/0045-loud-fail-invariants-and-honest-attestation.md` — honest green (the honesty contract). **[ACCEPTED]**
- `docs/adr/0035-three-tier-memory-vocabulary.md` — the memory naming.
- `docs/research/agent-accountability-proposal.md` — the 46→29→1 result; the five laws; the honest ceiling.
- `lib/episodic-memory.ts` — episodic memory (`createEpisodicMemory`). **[BUILT]**
- `lib/resurrection.ts` — heartbeat-staleness salvage (passes notes, not state). **[BUILT-WEAK]**
- `lib/bonds.ts` — bond escrow / slash (the staked sanction). **[BUILT]**
- `lib/actor-roster.ts` — self-asserted identity resolution (the present-tense root cause). **[BUILT]**

---

*Companion skill authored with this paper:*
`~/.claude/skills/agent-identity-continuity-reputation/SKILL.md` — the reusable
design discipline for the memory → continuity → person → outcomes → reputation →
asset chain, with decision points, failure-mode table, and quality gates.
