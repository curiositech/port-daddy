# The North Star Whitepapers

> **Parent:** ADR-0048, *What Port Daddy Is — the North Star*
> (`docs/adr/0048-what-port-daddy-is.md`). This volume is Phase 8 of that ADR's
> Implementation Matrix (`adr-0048-phase-8-whitepapers`): *"Deep-research
> whitepapers backing the North Star … Done when: each layer has a cited paper."*
> Five papers, one stack, one through-line.
>
> **Honesty contract (inherited from ADR-0045).** Every paper marks **[BUILT]**
> for code on disk today, **[DESIGNED]**/**[PROPOSED]** for an accepted-or-draft
> ADR with no merged code, and **[VISION]** for an argued-but-unspecified
> direction. Selling a design as a feature is the exact failure this volume
> argues against. (Terminology note: the papers vary between [DESIGNED] and
> [PROPOSED] for the same tier, and identity-reputation adds [BUILT-WEAK] for
> resurrection — see *Cross-paper tensions*, item 1.)

---

## What the volume argues (the five-bullet thesis)

- **A coding-agent swarm is a Hobbesian state of nature, and the cure is a
  *legible* local sovereign.** Left alone, agents double-claim files, open
  unreadable PRs, narrate work they did not do, and trip footguns — Hobbes' war
  of all against all, and an *emergent* one (LLM agent societies have been
  observed re-enacting the arc to a consented sovereign). The operator
  rationally consents to Port Daddy as a local-first Leviathan, but consent
  renews only while the authority stays inspectable: the sovereign must be the
  *most* legible actor in the system, not the least.

- **Legibility is the product; over-flattening is the failure; the one rule is
  digest-with-zoom.** Every summary must be a *lens onto a verifiable artifact*
  (the diff, the test log, the DB row), never a replacement and never the agent's
  own possibly-unfaithful narration. This single discipline — Scott's warning made
  a buildable rule — is the quality bar of the entire L2 wedge, and it is the same
  act as honest attestation (ADR-0045) and "summaries as indexes" (ADR-0047).

- **The digest *is* compaction, so tokens are the swarm's COGS and its legibility
  engine at once.** The same act that controls the bill (what context to carry
  forward) controls what is true and visible (what survives into the summary the
  operator and the next agent read). Port Daddy already compacts in five built
  primitives without having named the economics. This makes context economics the
  load-bearing seam between L2 (legibility) and L3 (a market you can only meter in
  COGS you actually accounted).

- **No reputation without continuity; no market without reputation; and all of it
  is void on a forgeable identity.** A *role* is `{obligation, capability,
  authority}`; a *person* is a role instance **plus** continuity (memory,
  checkpoint, outcome history). Reputation attaches only to persons, a market only
  prices reputation, and a re-pickable identity launders any record for free
  (Sybil-reset). Non-forgeable, daemon-minted identity (ADR-0040) is therefore the
  single architectural bottleneck the whole L3 program waits on. The estimator
  (Elo / Bradley-Terry / TrueSkill / bandit routing) is off-the-shelf and *last*.

- **The mature economy is a three-sided market sold as hosted trust — but it is
  strictly additive on the wedge.** Operators sell fleet-labor, agents/fleets are
  rentable assets, skills are licensed; all three settle on the *same* built bond
  ledger (`lib/bonds.ts`, conservation property-tested over 10k traces). The
  defensible product is the verified-ledger-plus-relay-plus-reputation (hosted
  trust), not the commoditized payment rail. Because every side reuses the L0
  primitive, none of L3 needs to ship before the single-player wedge is loved —
  which is exactly why ADR-0048's sequencing discipline ("don't chase L3 early")
  is *safe*.

---

## The five papers, mapped to the stack

ADR-0048 resolves "what Port Daddy is" into four layers, each for a different
*whom*. Each paper is the cited backing for one (or one seam):

| Paper (file) | North Star layer | One-line claim it defends |
|---|---|---|
| **legibility-leviathan** — *The Legible Swarm: a Leviathan for agentic software development* (`legibility-leviathan.md`) | **L2** — legibility & authority (the Leviathan; the GUI; for the operator) | The swarm is a state of nature; the operator consents to a *legible* local Leviathan; it rules by digest-with-zoom. |
| **tokens-compaction** — *Context Economics: Tokens and Compaction as the Swarm's COGS and its Legibility Engine* (`tokens-compaction.md`) | **L1/L2 seam** — the digest engine under legibility | The digest *is* compaction; tokens are COGS *and* the legibility mechanism at once. |
| **discovery-guilds** — *Finding Each Other: Discovery, Directories, and Guilds for Agentic Babylonia* (`discovery-guilds.md`) | **L2 → L3** — the read-side of coordination | Read-poverty, not write-contention, is the scale bottleneck; cure it in three ordered layers (existence → relevance → trust). |
| **identity-reputation** — *From Spawn to Person: Identity Continuity as the Foundation of Agentic Reputation* (`identity-reputation.md`) | **L3 bridge** — Phases 5–6 (identity-continuity → reputation) | A reputation system is exactly as real as the identity it keys on; identity is durable only if it carries continuity. |
| **agent-economy-anchor** — *The Harbor Economy: Float Plans, Bonds, and a Three-Sided Market for Agent Labor* (`agent-economy-anchor.md`) | **L3** — economy & federation (the market between operators) | The harbor economy is a three-sided market on one conserving ledger, sold as hosted trust. |

> **Companion volume — the doctrine scorecards (`doctrine/`).** Where these five
> papers *argue* the North Star, the five docs in `doctrine/` *score the codebase
> against it*: each opens with a quality-gate scorecard and grounds every claim in a
> repo path you can open (`doctrine/README.md`). Its thesis is the L2-built /
> L3-designed split — *the line sits exactly where the folk theorem stops working*:
> single-operator coordination is a Nash equilibrium (observable history +
> worktree-anchored identity + high δ), and the market layer exists because
> federation breaks persistent identity (δ→0), requiring economic enforcement to
> replace the game-theoretic guarantee. See `doctrine/game-theory.md` for the proof.

Mapped onto the ADR-0048 Implementation Matrix phases:

```
 Phase 2-3  L2 read-surfaces + legibility-digest ── legibility-leviathan
                                                  └─ tokens-compaction (the digest engine)
 Phase 2/5  L2→L3 discovery seam ──────────────── discovery-guilds
 Phase 5-6  L3 identity-continuity → reputation ── identity-reputation
 Phase 6-7  L3 reputation → federation-market ──── agent-economy-anchor
```

---

## Reading order

Two valid traversals; pick by what you want.

**A. The build order (left-to-right on the through-line — recommended for
roadmap work).** Read in dependency order, the way the stack must actually be
built:

1. **legibility-leviathan** — *why anyone pays*: the justification of the
   authority and the L2 quality bar (digest-with-zoom). The wedge's theory.
2. **tokens-compaction** — *the engine under that digest*: how legibility is
   physically produced, and why it is also the cost line. Read second because it
   operationalizes paper 1's central rule.
3. **discovery-guilds** — *the read-side that legibility forgets*: once you can
   read one agent, you still cannot find the right one among two hundred. The
   bridge from a legible swarm to a navigable one.
4. **identity-reputation** — *the spine the whole economy hangs on*: why
   continuity precedes reputation and a forgeable id voids both. The forced
   bottleneck (ADR-0040).
5. **agent-economy-anchor** — *the market that all of the above makes possible*:
   the three-sided economy, settled on the one built ledger.

**B. The proof order (right-to-left — recommended for skeptics).** Start at the
market (paper 5) and walk backward: a market needs reputation (paper 4), which
needs continuity and identity (paper 4), priced in COGS you can only account by
compacting honestly (paper 2), over a swarm you can only govern if it is legible
(paper 1) and navigable (paper 3). Each paper is a proof obligation discharged by
the one to its left.

If you read only one: **legibility-leviathan**. It carries the thesis (consent,
legibility, digest-with-zoom) every other paper assumes.

---

## The through-line (why these five are one volume, not five essays)

ADR-0048 compresses the entire program into one sentence:

> **memory + checkpoint (resurrection with teeth) → continuity → a *person* not a
> *spawn* → registered outcomes → reputation/Elo → a hireable/sellable asset →
> the market.**

Every paper is a station on that line, and three motifs recur across all five,
which is what makes the volume cohere:

1. **Digest-with-zoom / legibility-with-zoom.** Stated in legibility-leviathan
   (the one law), it reappears as the anti-over-flattening cure in
   tokens-compaction (§4.4), the "a directory entry is a lens, never a verdict"
   rule in discovery-guilds (§7 failure mode 6), the "ship the score as
   telemetry, not a verdict" rule in identity-reputation (§6), and the
   conservation/oracle discipline in agent-economy-anchor (settlement binds to an
   oracle, not a free-text note). It is the volume's single quality bar.

2. **Sybil-reset / forgeable identity as the universal solvent.** *Three* papers
   independently converge on the same hard ordering constraint: reputation
   (identity-reputation), discovery/guilds (discovery-guilds), and the second and
   third market sides (agent-economy-anchor) are *all* void until ADR-0040
   (non-forgeable, daemon-minted identity) lands. They cite the same evidence —
   the repo's own 46→29→1 audit (11/29 mechanisms fail to Sybil-reset,
   `docs/research/agent-accountability-proposal.md`) and Douceur 2002 /
   Friedman & Resnick 2001. ADR-0040 is the volume's shared keystone.

3. **The oracle the agent cannot author.** Closure binds to ground truth, not
   self-report — a merged SHA, a passing test, a satisfied Arbiter check. This is
   the substrate-level form of digest-with-zoom (don't trust the narration, check
   the artifact) and it appears as commitment closure (identity-reputation §3.3),
   settlement (agent-economy-anchor §3.3), verifiable-zoom (legibility-leviathan
   §4.2), and compact-from-artifacts (tokens-compaction §4.3).

The wedge sequencing is the product discipline that ties the motifs to a roadmap:
single-player L2 ships first (papers 1–3 are its theory), L3 federation and
market come *after* the wedge is loved (papers 4–5 are its expansion), and the
read-surface/memory work is revealed not as a side quest but as L3's load-bearing
wall.

---

## How each paper backs its layer (the contribution, not the summary)

- **legibility-leviathan** supplies the *theory of legitimacy and quality* for the
  L2 wedge: §2–3 justify the authority (state of nature → consent → legible
  sovereign), §4–5 set the bar (digest-with-zoom + verifiable targets +
  stakes-proportional friction, grounded in Scott *and* the human-factors
  out-of-the-loop literature). Its original move is the *legible-sovereign
  amendment* to Hobbes: the authority must be the most inspectable actor, or
  consent lapses.

- **tokens-compaction** supplies the *mechanism* under L2's digest and the
  *denominator* of every L3 price. Its original move is the fusion — "the digest
  IS compaction" — proving the cost view and the legibility view are one problem,
  and naming the five built primitives (briefing, attention, episodic-memory,
  pheromone-decay, resurrection) as a distributed compaction engine.

- **discovery-guilds** supplies the *read-side primitive* the other layers call.
  Its original move is naming **read-poverty** as the binding scale constraint and
  ordering the cure into existence → relevance → trust, with the relevance layer's
  *refuse-to-route* discipline ("I don't know" beats a guess) as the trust-critical
  property. It is where L2 legibility becomes L3 navigability.

- **identity-reputation** supplies the *spine* of the L3 bridge. Its original move
  is the Locke→Parfit argument that the **outcome ledger** (not the memory stream)
  is the transitive thing reputation must key on, and the diagnosis that PD has the
  *organs* of continuity (memory [BUILT], weak checkpoint [BUILT-WEAK], designed
  ledger [DESIGNED]) but not the *spine* — so the build order is forced.

- **agent-economy-anchor** supplies the *shape* of the L3 market. Its original move
  is the three-sided count (labor / rentable-asset / licensed-skill, by incentive
  constraint not UI tab) settling on one conserving ledger, with Grossman-Hart
  residual-control-rights as the economic justification for the Arbiter jail and
  Akerlof-lemons as the justification for metered+clawback skill licensing. It is
  honest that, absent shipped reputation, this is "a two-sided market with a
  roadmap" today.

---

## Cross-paper tensions and open problems (flagged for the next editor)

The five papers are coherent and non-contradictory on substance. The items below
are seams, terminology drift, and genuinely open problems — *not* contradictions
with the North Star unless marked.

1. **Honesty-label terminology drift (cosmetic, worth normalizing).**
   legibility-leviathan, tokens-compaction, and identity-reputation use
   **[DESIGNED]** for an accepted-ADR-not-yet-built; discovery-guilds uses
   **[PROPOSED]** for the same tier (and **[DRAFT]** for ADR-0039);
   identity-reputation introduces **[BUILT-WEAK]** for resurrection while
   legibility-leviathan writes the same fact as "[BUILT, weak]". All describe the
   same reality (resurrection passes notes, not state) — but a reader scanning
   labels across papers will see three vocabularies. *Recommendation:* a single
   labels key (BUILT / BUILT-WEAK / DESIGNED / VISION) in each paper's header, with
   PROPOSED treated as a synonym for DESIGNED. Not blocking; not a substance
   conflict.

2. **Is reputation "the gate" or "the last/easy part"? (Two true framings, worth
   reconciling explicitly.)** identity-reputation calls the estimator "cheap and
   last" (Elo/BT/TrueSkill are off-the-shelf; the substrate beneath is the work).
   agent-economy-anchor calls reputation the *existence condition* for the second
   and third market sides ("phase 5/6 are not optional polish; they are the
   existence conditions"). These are compatible — *the estimator is easy, but the
   thing it estimates over (witnessed outcomes on a non-forgeable id) is the hard
   prerequisite* — but a careless reader could hear "reputation is easy" (paper 4)
   against "reputation is the moat" (paper 5). The reconciliation: the *score* is
   cheap; the *substrate that makes the score real* is the gate. Both papers
   already say this; it is just not cross-linked.

3. **ADR-0040 is load-bearing in three papers but specified in none of this
   volume.** identity-reputation, discovery-guilds, and agent-economy-anchor all
   make ADR-0040 (non-forgeable identity) the forced first commit, but ADR-0040 is
   [DESIGNED]/[PROPOSED], not [BUILT]. This is *consistent* with the North Star
   (Phase 5 bridge), but it means the volume's single most-cited keystone is
   unbuilt. Not a contradiction — the papers are honest about it — but the next
   editor should note that *the whole L3 half of the volume is gated on one
   unbuilt ADR*, and that is the highest-leverage build in the program. Flagged as
   a roadmap risk, not a paper defect.

4. **"Three-sided market" vs. "two-sided market with a roadmap" (self-flagged,
   honest).** agent-economy-anchor's headline claim (three sides) and its own
   honesty note (today it is two-sided because reputation is unbuilt) sit in the
   same paper. This is the paper being honest, not contradicting itself — but it
   does mean the volume's economy claim is aspirational in exactly the way
   identity-reputation predicts. The two papers should cross-reference here: the
   "third side" of the market (agent-economy-anchor) *is* the "tradeable asset"
   terminus of the continuity chain (identity-reputation). They are describing the
   same future from two directions.

5. **Genuinely open problems the volume does not solve (union of the §-open
   sections).**
   - **Forced-zoom sampling rate** (legibility-leviathan §9): how often must the
     operator be made to zoom, as a function of agent reputation × action stakes?
     This couples L2 legibility to L3 reputation and is unsolved.
   - **The compaction-quality scalar** (tokens-compaction §7; legibility-leviathan
     §9): what must a summary *retain* to stay a faithful, zoomable index? No
     agreed metric; candidate is successor-task-success-from-digest-alone.
   - **Price of anarchy when reputation is itself for sale** (agent-economy-anchor
     §8): the third side makes reputation a strategic instrument; bounding PoA under
     realistic reputation noise is open.
   - **Cross-harbor reputation portability without a global PKI**
     (identity-reputation §8; discovery-guilds §8): the seam where the
     *cryptographic* market becomes load-bearing; FLP impossibility bites on
     federated directory membership.
   - **The unit of reputation** (discovery-guilds §8): per-actor vs.
     per-(actor, surface) — accuracy vs. cold-start sparsity, unresolved.

6. **No contradiction with the North Star found.** All five papers correctly place
   themselves in the L0→L3 stack, honor the wedge sequencing (single-player first,
   market last), invoke the legibility principle without overclaiming, and label
   built-vs-vision consistently with ADR-0045. The volume strengthens ADR-0048's
   central claim — that the read-surface/memory work is the through-line to the
   whole economy — from four independent directions.

---

## Skills built en route

Each paper was written alongside a reusable design-discipline skill (decision
points, failure-mode tables, worked examples, quality gates), registered in the
skill index:

| Skill | Authored with | What it codifies |
|---|---|---|
| `legibility-for-agentic-systems` | legibility-leviathan | The one law (digest-with-zoom), 4 decision points, 5 failure modes, 3 worked examples, 8 quality gates. |
| `context-economics-for-agent-swarms` | tokens-compaction | Per-agent budgeting, compaction-strategy selection, digest granularity, the context-degradation cascade, 9 quality gates. |
| `agent-discovery-directories-guilds` | discovery-guilds | Push-vs-pull directory choice, exact/BM25/embedding ranking, centralized/federated/DHT topology, when to reach for guilds, 7 failure modes, 9 quality gates. |
| `agent-identity-continuity-reputation` | identity-reputation | The memory→continuity→person→outcomes→reputation→asset chain, 5 ordered decision points, 8-row failure-mode table, 7 quality gates. |
| `three-sided-agent-labor-market` | agent-economy-anchor | Side-counting by incentive constraint, Rochet-Tirole price structure, Grossman-Hart residual control for rental, Akerlof metered+clawback licensing, hosted-trust pricing. (Extends the pre-existing `mechanism-design-for-agent-labor`.) |

These compose with the sibling `political-philosophy-of-computation` skill and the
agent-canon skills (BDI, Contract Net, FIPA, deontic logic) the L1 protocol draws
on.

---

*Series editor's note: this README indexes and connects the five Phase-8
whitepapers; it does not rewrite them. Each paper is self-contained and carries
its own references, honesty key, and companion skill. The papers land via their
own branches (`paper/<id>`); this index is on `paper/north-star-index`.*
