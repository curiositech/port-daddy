# Bold concepts: the recursive control plane (research capture)

> Status: **research / exploratory.** Not canon. A landing pad for the bolder
> cross-cutting ideas generated alongside the four-paper rewrite
> (`docs/research/north-star/00-THE-FOUR-PAPERS.md`, pending in #378), and the **graft target**
> for `erichowens/soma` and `curiositech/windags` once those repos are added to
> the session scope. The "Open research items" list at the bottom is meant to be
> promoted into `docs/research/north-star/00-THE-LEDGER-open-problems.md` (research) and/or the Cartographer
> roadmap (`docs/ROADMAP.md`).

## The unifying frame: legibility is recursive

The papers treat legibility as one-directional — the **operator** must see the
swarm. But every party that must coordinate needs a legible, *suggestible* view
of everyone else doing the same kind of work. The operator suffers read-poverty
about the swarm; **each agent suffers read-poverty about its peers**; and **each
harbor suffers read-poverty about its federation**. The control plane is
**fractal**: port-daddy is the operator's control plane over agents; agents need
one over *each other*; federated harbors need one over all the daemons/operators.

This frame gives the otherwise-homeless threads a job: read-poverty,
digest-with-zoom, and tokens-as-COGS are **recursive** — they recur at every
tier, as the substance of each tier's control plane.

---

## Concept 1 — The recursive control plane (and where it breaks symmetry)

Three tiers, **self-similar in protocol**:

| Tier | Who coordinates | Enforcer | Canon home |
|---|---|---|---|
| agent ↔ agent | peers in one box | the **daemon** (sovereign arbitrates) | Paper 1 substrate + Paper 2 |
| operator → agents | port-daddy today | the **daemon / operator** | Paper 2 |
| operator ↔ operator | federated harbors | **nobody** — needs **bonds** | Paper 4 |

The key insight: the recursion is self-similar in *protocol* but **breaks
symmetry at the top tier — exactly at the folk-theorem boundary.** Inside one
box a coordination round works because the daemon is a sovereign who can convene
it, break ties, and make agreed roles stick (claims + commitments it serializes).
Across operators there is no shared sovereign, so the same round must be enforced
by **bonds**, not fiat. Same conversation; different teeth. This is not a wart —
it is *why Paper 4 exists* (truthful signaling is a Nash equilibrium only inside
one operator's box; δ\* ≈ 0.253, machine-checked).

## Concept 2 — Peer suggestibility + the parley protocol

Extends ADR-0039 (suggestibility) from operator→agent coaching to **agent↔agent**.
Today an agent knows what *files* others touch (claims). The bolder version:
an agent is alerted that **another agent is doing a similar *thing*** — and the
swarm can escalate from informal parallel work into a structured negotiation.

**The mode switch (the parley):**
> informal parallel work → *(convergence detected)* → suspend → **parley**
> (a typed, multi-party Contract-Net round: shared plan, goals, role allocation)
> → break → resume, now coordinated.

This is the agent-world analog of the operator's force-zoom / HITL escalation.

**What exists vs. what is net-new.** The *parts* exist in the L1 substrate
(Paper 1): the tube (inbox), the pheromone blackboard (ambient reality), claims
(who touches what), typed performatives (`cfp`/`agree`/`refuse`/`decide`/
`finalize` — Contract-Net *is* a parley), and commitments (a parley's durable
output). Net-new is **two** things, and the hard one is not the parley:
1. **The convergence detector** — "another agent is doing a similar thing." This
   is the hard open problem already named in the layer dossiers: duplication/loop
   detection that distinguishes legitimate parallelism from collision **without
   keyword matching** (semantic task-shape similarity).
2. **The cost-aware trigger** — convene too eagerly and coordination overhead
   kills the parallelism you wanted (the realism-check's MAS-overhead warning);
   too rarely and you get duplicated/conflicting work. The trigger is a
   **Signal-Detection** problem (asymmetric miss/false-alarm cost), the same
   structure as the operator's force-zoom threshold.

**Per-turn context as the agent's control plane.** "Controlling what an agent
sees every turn" (suggestibility briefing + inbox + pheromone reality + others'
claims + recent commits) *is* the agent's cockpit. It is a read-economics
problem: what to inject, at what token cost (COGS), at what fidelity
(digest-with-zoom, so the agent can drill from "someone is near your file" to
the actual diff).

## Concept 3 — The shared-memory depth ladder

The recursion can go *deeper in substrate*, not just wider in scope:

> shared **bulletin** (text) → shared **blackboard** (pheromone) → shared
> **memory** (witnessed records) → shared **learned representation** (neural)

Each rung is more powerful and **less legible**. The sharp tension:
**shared neural memory breaks the one law of Paper 2 — digest-with-zoom.** You
can zoom from a shared *record* to its artifact; you cannot zoom into a shared
*weight/embedding* to see why it says what it says. It is an un-inspectable
channel — and across harbors (no shared sovereign) it is a poisoning/backdoor
surface that bonds cannot price, because you cannot *witness* what is in it.

**The safe, buildable version** of "shared memory that cuts across harbors /
daemons / agent-types / durable roles" is a **shared, attested store of witnessed
outcomes keyed on non-forgeable identity** — i.e. the outcome ledger (Paper 3)
and the witness log (Paper 4) generalized into a cross-cutting memory.

**Open problem (a good one):** how do you make a *learned* structure
**attestable without making it inspectable** — so the deepest rung keeps the
legibility and bonding guarantees the shallow rungs have?

## Concept 4 — Evolutionary dynamics (Papers 3 + 4 run forward in time)

generations / cross-over / quality-evaluation / reproduction / stable ecosystem
dynamics map cleanly onto primitives that already exist:

| Evolution | Port-daddy primitive |
|---|---|
| fitness | the witnessed **outcome ledger** (reputation) |
| fitness function | the **grading oracle** |
| selection pressure | **bonds / slashing** |
| lineage | **non-forgeable identity** |
| reproduction | **spawn** |
| variation / cross-over | *missing* — recombining roles / skills / prompts / configs |

Selection + fitness + lineage already exist; what is missing are the
**variation + inheritance operators** and the **ecosystem-stability analysis**.
The danger is the one the §8.4.4 Monte-Carlo sims already flag, at fast-forward:
**selection on a gameable fitness function is Goodhart at speed** — monoculture
collapse, cartel capture, wash-trading. Evolution makes **grading-oracle
integrity existential**, not merely important.

**Where it belongs:** not a fifth paper. It is what Papers 3 + 4 look like as a
*dynamical system*, and its proper output is a **sandbox / simulation** whose
results become evidence (more §8.4.4-style Monte-Carlo) under Paper 4. Seed
already exists: the `research/evolutionary-agent-coordination-sandbox` branch
(PR #228).

---

## Where these land in the canon

- **Concept 1** sharpens **Paper 2's thesis** from "the operator sees the swarm"
  to "everyone who must coordinate gets a legible, suggestible view of everyone
  else," and explains the Paper 1 / Paper 4 split as a *symmetry break*, not just
  a difficulty jump.
- **Concept 2** deepens **Paper 1's** L1 substrate (the parley protocol) and is
  the agent-side of **Paper 2's** legibility.
- **Concept 3** generalizes **Paper 3's** outcome ledger + **Paper 4's** witness
  log into a cross-cutting shared memory; the neural rung is an open frontier.
- **Concept 4** is the forward-time dynamics of **Papers 3 + 4** — research track,
  not canon.

## Open research items (promote to the Ledger / roadmap)

- **RCP-1 — Convergence detector.** Semantic task-shape similarity for "another
  agent is doing a similar thing," without keyword matching. *(Hard; gates the
  parley.)*
- **RCP-2 — Parley trigger.** Cost-aware (Signal-Detection) threshold for when to
  break formation and convene; avoid MAS-overhead Goodhart.
- **RCP-3 — Parley protocol.** Typed multi-party Contract-Net round over the
  existing performatives that outputs role allocation + commitments.
- **RCP-4 — Attestable-but-not-inspectable learned memory.** Make the neural rung
  of the shared-memory ladder carry attestation/bonding guarantees.
- **RCP-5 — Cross-harbor shared outcome store.** The safe shared-memory rung:
  attested witnessed-outcome memory keyed on non-forgeable identity, spanning
  harbors / daemons / agent-types / durable roles.
- **RCP-6 — Variation / inheritance operators.** Cross-over + mutation of roles /
  skills / prompts / configs for the evolutionary track.
- **RCP-7 — Ecosystem-stability analysis.** Does selection converge to healthy
  diversity or collapse (monoculture / cartel)? Extends the §8.4.4 sims.

## Graft points (pending session access to the source repos)

- **`erichowens/soma`** → *(to fill)* — expected: shared-memory / neural-memory
  concepts (Concept 3) and possibly the evolutionary substrate (Concept 4).
- **`curiositech/windags`** → *(to fill)* — expected: the workgroup / parley /
  skills ideas (Concept 2) and the multi-agent coordination harness.

> Once both repos are in session scope, dispatch specialty agents to parse each,
> extract the load-bearing concepts, and graft them into the matching section
> above (and mint the corresponding RCP- items).
