# Context Economics: Tokens and Compaction as the Swarm's COGS and its Legibility Engine

**Layer.** L1 (coordination protocol) / L2 (legibility & authority) of the North Star
stack ([ADR-0048](../../adr/0048-what-port-daddy-is.md)). This is the whitepaper for the
*tokens / compaction* gap that ADR-0048 promotes "from never-discussed to first-class"
and schedules as Phase 3 (`adr-0048-phase-3-L2-legibility-digest`) and Phase 8
(`adr-0048-phase-8-whitepapers`).

**Audience.** A software engineer with a working CS/math background. No prior multi-agent-
systems coursework assumed; every term of art is defined on first use.

**Reading conventions (house style; see the accountability proposal's
[§8](../agent-accountability-proposal.md) for the original statement).** On first use,
**every external technical term is bolded, cited, and given a one-line gloss**, and **every
Port Daddy abstraction is bolded with its source-file path (relative to repo root) and a
one-sentence explanation.** This is an *explanation* document in the **Diátaxis** sense
(Procida 2017 [\[1\]](#refs) — *a four-quadrant taxonomy of docs: tutorial, how-to,
reference, explanation; this is the understanding-oriented quadrant*), denser than a blog
post and lighter than a proof.

**Honesty label.** Built-vs-vision is marked inline: **[BUILT]** for code that exists in
this repo today, **[DESIGNED]** for an ADR'd-but-unshipped mechanism, **[VISION]** for an
argued-but-unspecified direction. The thesis is a *reframe of primitives that already
exist*, not a promise of new ones.

---

## Abstract

A swarm of coding agents has exactly one consumable that is both metered and meaningful:
**tokens** — the units of text an LLM reads and writes, billed per million. This paper
argues that tokens occupy a position no other resource in the stack does: they are
*simultaneously* the swarm's **cost-of-goods-sold (COGS)** — *the direct, variable cost of
producing one unit of output, the line the L3 economy must meter and bill* — **and** its
**legibility engine** — *the mechanism by which a swarm becomes seeable to the one human
operator and to the agents themselves.* The bridge between the two is **compaction**:
taking a context window near its limit, summarizing it, and reinitiating with the summary
(Anthropic 2025 [\[2\]](#refs)). Compaction is a cost decision (fewer tokens carried
forward) and a truth decision (what survives into the summary) *at the same time*. The
digest the operator reads, the briefing the next agent reads, and the bill the market
charges are three projections of one compaction. We ground this in Port Daddy's existing
primitives — the briefing projection (`lib/briefing.ts`), the attention composer
(`lib/attention.ts`), episodic-memory promotion (`lib/episodic-memory.ts`), pheromone
decay (`lib/pheromone.ts`), and resurrection handoff (`lib/resurrection.ts`) — and show
that PD already *does* compaction in five places without having named the economics. We
then catalog the **context-degradation cascade** (lost-in-the-middle, context rot,
recursive-summarization collapse, over-flattening) as the failure surface that connects
the cost and legibility views, and close with where this backs the North Star.

Four-bullet version:

- **Tokens are the swarm's COGS and its legibility engine at once** — the same compaction
  choice that controls the bill controls what is true and visible. No other resource is
  dual like this.
- **The digest IS compaction** — for humans (the operator's Attention Queue) and for agents
  (the briefing, the resurrection handoff). PD already compacts in five primitives; this
  paper names the economics under them.
- **Compaction failures are a cascade, not a bug** — lost-in-the-middle, context rot, and
  recursive-summarization collapse compound; the cure is *legibility-with-zoom* (every
  digest a lens onto the artifact, never a replacement), which is Scott's warning made a
  rule (ADR-0048).
- **Context economics is the load-bearing seam between L2 and L3** — you cannot meter a
  market in COGS you never accounted, and you cannot make a swarm legible with summaries
  that lie. Both reduce to budgeting and compacting tokens honestly.

---

## 1. The thesis, stated concretely

You run six coding agents on one feature. Each chews through a context window; each emits a
transcript no human will ever read in full. Two questions land on you at once:

1. **What did this cost, and which agent spent it?** (the operator's wallet; the market's
   invoice.)
2. **What happened, and what needs my decision?** (the operator's eyes; the next agent's
   onboarding.)

The naïve view treats these as unrelated — one a billing problem, one a UX problem. The
claim of this paper is that *they are the same problem viewed from two sides*, and the
hinge is the token.

A token is the atomic unit an LLM consumes and produces (a sub-word fragment;
**byte-pair-encoding**, Sennrich et al. 2016 [\[3\]](#refs) — *the dominant tokenizer
family that merges frequent character pairs into a fixed vocabulary*). Every token in a
context window costs money to process and occupies a slice of a *finite* budget. When the
window fills, you must drop something. *What you drop is a cost decision* (you stop paying
to carry it) *and a legibility decision* (whoever reads the residue no longer sees it).
The act that resolves both is **compaction** — and compaction's output is exactly the thing
a human or successor agent reads to understand the swarm: **the digest is the compaction**.

> **The syllogism.** (A) A swarm's only metered-and-meaningful resource is tokens. (B) The
> only way anyone — human or agent — perceives the swarm is through a compaction of its raw
> token trajectory. (C) Therefore the engineering of token budgets and compaction *is* both
> the cost-accounting layer (COGS the market bills) and the legibility layer (the digest
> the operator reads). Optimize one without the other and you ship a fleet that is either
> bankrupt or illegible.

This is why ADR-0048 files *tokens/compaction* under L1/L2 and calls it "the COGS *and*
the legibility mechanism … sooner than assumed." This paper is the argument for that line.

---

## 2. Tokens as COGS

### 2.1 What COGS means here

In accounting, **cost-of-goods-sold (COGS)** is the direct variable cost of producing the
units you sell. For a fleet, the unit is "a landed piece of work" (a merged PR, a fixed
test, a synced doc) and the dominant variable cost is **inference tokens** — input tokens
(context fed in) plus output tokens (text generated), each priced per million by the model
provider. Unlike a salary (fixed) or a GPU lease (capacity), tokens are *consumed per task,
in proportion to how much context an agent carries and how much it writes.* That is the
textbook shape of COGS.

The L3 economy in ADR-0048 — *"operators sell labor+fleet for-hire; fleets/agents are
rentable assets; skills/tools are licensed — one bond ledger"* — cannot price any of those
without a COGS line. A rented fleet that bills $X must know its token cost or it sells at a
loss; an agent-for-hire's reputation (Phase 6) is only meaningful relative to outcome **per
token spent**. So context economics is not a side metric — it is the denominator of every
L3 price.

### 2.2 Effective context ≠ advertised context — the COGS trap

The first cost trap is buying window you cannot use. Providers advertise 128K, 1M, even 10M
token windows, but the **effective context length** — *the length at which a model still
performs within ~85% of its short-context accuracy* — is far smaller. Across independent
benchmarks, models show severe accuracy degradation well before their advertised limit;
one real-world study reports that *most models degrade severely by ~1,000 tokens of context
and fall short of their maximum window by as much as >99%* (Hong & Sun 2025
[\[4\]](#refs)). Anthropic names the same phenomenon **context rot** (2025 [\[2\]](#refs) —
*"as the number of tokens in the context window increases, the model's ability to accurately
recall information from that context decreases"*), rooted in the transformer's $n^2$
attention over $n$ tokens (Vaswani et al. 2017 [\[5\]](#refs) — *the architecture whose
self-attention computes all pairwise token relationships, so attention is spread thinner as
the window grows*).

The COGS consequence is blunt: **packing an agent to 200K tokens does not buy 200K of
capability; it buys degradation at full price.** You pay for every token and the marginal
ones make the agent *worse*. Budgeting to *effective* context is therefore simultaneously a
cost optimization (fewer tokens billed) and a quality optimization (less rot). The two
goals point the same way — the defining feature of context economics.

### 2.3 What PD meters today, and what it does not

**[BUILT]** PD's **cost-accrual tracking** (the `cost-accrual-tracker` skill domain;
`pd`-side budget caps on spawned agents via the spawner, `lib/spawner.ts` — *the module that
launches backend agents and can cap their run*) accounts *dollars and runs*. **[VISION]** It
does not yet keep a **per-agent-task token ledger keyed to outcomes** — the row that says
"agent `feat:tests` spent 84K input + 12K output to land PR #123." That ledger is the COGS
primitive L3 needs and the honest place to enforce budget caps with a loud failure
([ADR-0045](../../adr/0045-loud-fail-invariants-and-honest-attestation.md) — *loud-fail
invariants: a violated budget must surface, not silently truncate*). Naming it here is the
point of Phase 3 feeding Phase 5–7.

---

## 3. Compaction as the legibility engine

### 3.1 Compaction, defined

**Compaction** (Anthropic 2025 [\[2\]](#refs) — *"the practice of taking a conversation
nearing the context window limit, summarizing its contents, and reinitiating a new context
window with the summary"*) is the canonical move for keeping a long-horizon agent under its
token budget. Anthropic's own guidance is to *"maximize recall first"* (capture everything
relevant) *"then optimize precision"* (trim) — a recall-then-precision discipline this paper
will reuse as a quality gate.

Two sibling techniques complete the family:

- **Structured note-taking** (Anthropic 2025 [\[2\]](#refs) — *"the agent regularly writes
  notes persisted to memory outside of the context window … pulled back in at later times"*)
  — external memory instead of in-window summary.
- **Sub-agent context isolation** (Anthropic 2025 [\[2\]](#refs) — *specialized sub-agents
  with clean windows, each returning "a condensed, distilled summary of its work (often
  1,000–2,000 tokens)"*) — isolation *is* compaction: the parent never sees the bloat.

### 3.2 The claim: the digest is the compaction

Here is the reframe. In an agent system, *the only artifact anyone reads to understand the
swarm is a compaction of its raw trajectory.* The operator does not read six transcripts;
they read a digest. The seventh agent does not replay the first six; it reads a briefing.
The successor of a crashed agent does not recover its scrollback; it reads a handoff. **Each
of these is a summary of dropped tokens — i.e., a compaction — produced for a specific
reader.** So compaction is not merely a cost-control trick that happens inside one agent;
it is *the legibility mechanism of the entire swarm.* The digest **IS** compaction, for
humans and for agents alike (ADR-0048).

This is the **legibility principle** ADR-0048 lifts from **James C. Scott's *Seeing Like a
State*** (1998 [\[6\]](#refs) — *states impose legibility — grids, censuses, standardized
names — to govern, and high-modernist over-legibility that erases local "mētis" is
catastrophic*): **legibility is the product; over-flattening is the failure mode.** A digest
must be *a lens that zooms to the real thing, never a replacement for it.* In compaction
terms: every summarized claim must retain a pointer back to its source artifact, or it is
not a lens — it is a lie that reads clean.

### 3.3 Where PD already compacts (five primitives, one economics)

PD has been doing swarm-compaction for releases without naming the economics. Five primitives,
mapped to reader and compaction type:

| PD primitive (source) | Reader | Compaction type | What it drops / keeps |
|---|---|---|---|
| **Briefing** (`lib/briefing.ts`) — *daemon writes `.portdaddy/` files projecting daemon state scoped to a project; agents read on startup to learn "what happened before they arrived."* | arriving agent | structured note-taking (external) | drops full history; keeps scoped state as files |
| **Attention** (`lib/attention.ts`) — *composer for "what does this agent need to see right now?"; aggregates inbox + subscribed channels into one stable-shape result a SessionStart hook can pin.* | agent (and, at L2, the operator's Attention Queue) | precision compaction | drops the firehose; keeps addressed-to-you items |
| **Episodic memory** (`lib/episodic-memory.ts`) — *promotes a transient "story beat" into a durable `Episode` with a `summary`, out of execution history.* | future self / successor | recall→precision summary | drops raw turns; keeps titled summary + source pointer |
| **Pheromone decay** (`lib/pheromone.ts`) — *semantic traces in metadata that evaporate over time (`decayRate` 0.95 per `intervalMs`=60s, with read-time decay via `Math.pow`).* | the swarm (stigmergic) | lossy time-decay compaction | drops stale signal continuously; keeps fresh |
| **Resurrection** (`lib/resurrection.ts`) — *on stale/failed agents, auto-publishes a changelog of unfinished work to the radio for a successor to pick up.* | successor agent | handoff summary | drops dead agent's context; keeps unfinished-work digest |

The throughline: **every one of these is a token-compaction producing a reader-specific
digest.** PD's coordination layer is, viewed correctly, a *distributed compaction engine*.
What this paper adds is the economics — that those same compactions are the COGS-bearing
and legibility-bearing surface, and should be budgeted and audited as such.

> **A note on a name collision.** `lib/harbor-tokens.ts` exists — but those are *capability
> tokens* (Ed25519-signed JWTs for L3 federation/auth), **not** LLM context tokens. This
> paper is exclusively about the latter. The collision is worth flagging precisely because
> the L3 economy will meter *both*: bandwidth-of-trust (harbor tokens) and cost-of-thought
> (context tokens).

### 3.4 Pheromone decay is *forgetting as compaction*

One primitive deserves a closer look because it is the most counterintuitive instance of the
thesis. **Pheromone decay** (`lib/pheromone.ts`) implements **stigmergy** (Grassé 1959
[\[7\]](#refs) — *coordination via persistent traces left in a shared environment, as ants
deposit evaporating pheromone trails*) by multiplying stored signal by `decayRate` each
interval. Decay is *deliberate, continuous compaction of the shared context*: old
coordination signal is dropped not by a summarizer but by an exponential, so the swarm's
shared state stays small and fresh without anyone running a summary pass. This is the
cheapest compaction in the system — $O(1)$ per read via `Math.pow(decayRate, intervals)` —
and it is *legibility by subtraction*: the map stays readable because the stale ink fades.
It is the swarm-scale analogue of an attention budget: the environment, like the window, has
finite room, and decay is how it pays.

---

## 4. The context-degradation cascade (the shared failure surface)

Cost and legibility share one failure surface: when compaction goes wrong, the bill *and*
the truth degrade together. The failures compound — hence "cascade."

**4.1 Lost-in-the-middle starvation.** Models use information at the *beginning and end* of
a context far better than the middle (**Liu et al. 2024**, *Lost in the Middle*
[\[8\]](#refs) — *"performance is often highest when relevant information occurs at the
beginning or end … and significantly degrades when models must access information in the
middle," even for long-context models*). *Failure:* an agent retrieves the right fact but
reasons as if it hadn't, because the fact sat mid-window. *Cost angle:* you paid to carry a
fact the model then ignored. *Legibility angle:* the obligation buried in scrollback is
invisible to the agent that owns it. *Cure:* put load-bearing facts at edges; shorten the
window; surface obligations as pinned digest items, not history.

**4.2 Context rot.** Quality decays as the window grows even with nothing dropped
(Anthropic 2025 [\[2\]](#refs); §2.2). *Failure:* a long session silently gets dumber.
*Cure:* compact *earlier* and budget to effective context — the cost cure and the quality
cure are the same act.

**4.3 Recursive-summarization collapse.** Each summary injects a little LLM noise; summarize
the summary enough times and the noise compounds into confident fabrication. Recent work
warns that *"recursive summarization inherently accumulates semantic noise … which can
induce cascading hallucinations and ultimately long-horizon collapse"* (Slipstream 2026
[\[9\]](#refs)), and the broader compaction literature notes that retained information
*"fluctuates substantially from run to run, making the agent's retained knowledge
unpredictable"* (Parallel Context Compaction 2026 [\[10\]](#refs)). *Failure:* the digest
asserts things that never happened. *Cure (the load-bearing one):* **compact from the
durable artifacts on each round — git, notes, the DB — never from the previous summary.**
PD is unusually well-placed here because its artifacts (claims, notes, tuples, episodes)
are durable and addressable; a PD compaction can re-derive from source instead of recursing
on prose. This is **ACON's** finding operationalized (Kang et al. 2025, *Acon*
[\[11\]](#refs) — *failure-driven optimization of the compression step itself, treating the
compactor as a tunable component rather than a fixed prompt*).

**4.4 Over-flattening (the Scott failure).** The digest reads clean and green but the
operator cannot act because the real situation isn't reachable from it. *Failure:* the
summary became a *replacement*, not a *lens* — exactly Scott's high-modernist catastrophe
(§3.2). *Detection rule:* any digest line with no deep-link to its artifact. *Cure:*
**legibility-with-zoom enforced by construction** — ADR-0048 observes the pure-ratatui
operator console (ADR-0046) enforces this *because you cannot over-render in a terminal*;
the constraint of the medium forbids the flattening. This is the same discipline as
ADR-0045's "honest green" and ADR-0047's "summaries as indexes, not replacements."

The four failures form a ladder: rot makes you compact, naïve compaction loses the middle,
recursion fabricates, and the operator-facing digest over-flattens what's left. Break any
rung — budget to effective context, edge-place facts, compact-from-artifacts, enforce
zoom — and the cascade stops.

---

## 5. The mechanism: budgets and metering across a fleet

### 5.1 Single-operator (the wedge): account, don't auction

In the single-player wedge (ADR-0048's first sequencing step), all agents serve one
operator, so there is **no incentive problem** — only a visibility problem. The right
mechanism is *accounting*, not a market: a per-agent-task token ledger, budget caps, and a
loud failure when a cap is blown ([ADR-0045](../../adr/0045-loud-fail-invariants-and-honest-attestation.md)).
This is the cheapest thing that makes COGS real and it ships inside L2. **[VISION]** — the
ledger row is not built; the spawner's run-caps (`lib/spawner.ts`) are the nearest **[BUILT]**
foothold.

### 5.2 Multi-operator (the market): price the externality, resist sybils

The instant Alice's fleet touches your repo (ADR-0048's federation step), token spend
becomes a *strategic* resource and accounting is insufficient. Two results from
**algorithmic game theory** (Nisan, Roughgarden, Tardos & Vazirani 2007 [\[12\]](#refs) —
*the standard text on designing systems where self-interested agents act strategically*)
apply directly:

- **Charge the externality.** An agent that floods shared context (a verbose pheromone, an
  over-long note) degrades *everyone's* effective context — a negative externality. The
  mechanism-design fix is to price it (a **Pigouvian** charge / VCG-style payment for the
  externality imposed), so the bill internalizes the harm rather than socializing it.
- **Resist sybils.** Cheap identities let a fleet split work across many agents to dodge
  per-agent budget caps (a **sybil attack**, Douceur 2002 [\[13\]](#refs) — *forging many
  identities to subvert a system that assumes one-per-participant*). The fix is to tie token
  spend to a *costly, persistent* identity — which is exactly the *continuity → reputation*
  through-line of ADR-0048 (Phase 5–6). Context economics thus *requires* the identity
  layer it appears to precede: you cannot bill a swarm of disposable spawns.

### 5.3 The recall→precision quality gate

Both regimes share one operational gate, lifted from Anthropic's compaction guidance and
made checkable:

1. **Recall first:** does the compaction capture every load-bearing fact (obligations, open
   claims, architectural decisions, unresolved bugs)? Test by asking the successor to act
   from the digest alone.
2. **Precision second:** trim redundancy *after* recall is satisfied, never before.
3. **Zoom always:** every retained claim deep-links to its artifact. No terminal summaries.
4. **Compact-from-artifacts:** on recursion, summarize source, not the prior summary.
5. **Meter:** one token row per agent-task; cap breaches loud-fail.

---

## 6. How this backs the North Star

ADR-0048's stack is L0 (daemon) → L1 (protocol) → L2 (legibility/authority) → L3
(economy/federation), sequenced single-player-wedge → federation → market, on the
through-line *memory → continuity → person → reputation → asset → economy.* Context
economics is load-bearing at three joints:

1. **It is the engine under L2's "legibility-with-zoom."** Phase 3 is literally "the
   digest/legibility-with-zoom + tokens/compaction as the digest engine." This paper supplies
   the argument: the digest *is* compaction, PD already compacts in five primitives, and the
   anti-over-flattening rule is the zoom requirement. L2's whole spine is a compaction
   discipline.

2. **It is the denominator of every L3 price.** The economy meters COGS; COGS is dominantly
   tokens; tokens-per-outcome is the unit of an agent's reputation (Phase 6) and a rented
   fleet's margin (Phase 7). No honest L3 price exists without the per-task token ledger this
   paper names.

3. **It forces the continuity layer.** §5.2: you cannot bill, cap, or reputation-score a
   swarm of disposable spawns, because sybils dodge every per-agent mechanism. Context
   economics therefore *demands* the *continuity → person → reputation* through-line — it is
   not downstream of identity, it is a reason identity must come first. This tightens
   ADR-0048's claim that memory is "the literal foundation of L3."

The honest status: the *reframe* is the contribution. The five compaction primitives are
**[BUILT]**; the per-task token ledger and the externality-pricing/sybil-resistant market
mechanisms are **[VISION]/[DESIGNED]** and depend on Phases 5–7. This paper's job, per Phase
8, is to make the layer first-class and cited — not to ship the ledger.

---

## 7. Open problems

1. **The compaction-quality metric.** We have failure *detection* (§4) but no agreed scalar
   for "how good is this digest." A candidate: *successor task-success-rate from the digest
   alone* vs. from full context — an extrinsic, outcome-grounded measure. Unspecified.
2. **Optimal budget allocation across a DAG of agents.** Given a task DAG and a total token
   budget, how to split it across orchestrator/worker/reviewer roles to maximize landed work?
   This is a constrained-optimization problem PD's symbol-index + cartographer could inform;
   unmodeled today.
3. **Pricing the shared-context externality without chilling coordination.** Charge too much
   for pheromone/note writes and agents stop coordinating (the commons under-provisions);
   charge too little and it floods. This is an **Ostrom**-style commons-governance problem
   (Ostrom 1990 [\[14\]](#refs) — *self-organized governance of common-pool resources without
   privatization or central control*) layered on a mechanism-design problem; open.
4. **Compaction under adversarial inputs.** A malicious federated agent could craft context
   designed to survive compaction and poison a successor's digest (a recursive-summarization
   attack). Defenses (compact-from-artifacts, provenance on every claim) are sketched in §4.3
   but unproven.
5. **When does decay beat summary?** Pheromone decay (§3.4) is $O(1)$ and lossy-by-design;
   summarization is expensive and lossy-by-noise. A theory of *which compaction for which
   signal* (decay for coordination traces, summary for decisions, eviction+pointer for
   reconstructable artifacts) exists only as the heuristic in the companion skill.

---

## 8. Relation to prior art

- **Context engineering** (Anthropic 2025 [\[2\]](#refs); Cognition 2025 [\[15\]](#refs) —
  *"context engineering is effectively the #1 job of engineers building AI agents"*) names
  compaction/notes/isolation but treats them as single-agent reliability techniques. This
  paper's move is to read them as a *swarm-scale economics* and to fuse the cost and
  legibility views.
- **Long-context degradation** (Liu et al. 2024 [\[8\]](#refs); Hong & Sun 2025
  [\[4\]](#refs)) supplies the empirical "effective ≪ advertised" that makes budgeting a cost
  *and* quality act.
- **Compaction validation/optimization** (Acon [\[11\]](#refs); Slipstream [\[9\]](#refs);
  Parallel Context Compaction [\[10\]](#refs)) supplies the collapse failure mode and the
  "compact-from-artifacts" cure.
- **Mechanism design** (Nisan et al. 2007 [\[12\]](#refs)) and **commons governance** (Ostrom
  1990 [\[14\]](#refs)) supply the multi-operator metering layer.
- **Legibility** (Scott 1998 [\[6\]](#refs)) and the **consented authority** (Hobbes 1651
  [\[16\]](#refs) — *rational actors consent to a sovereign because the state of nature is
  worse*) supply the L2 framing already canonized in ADR-0048.

The gap this fills: no prior source treats *the digest as compaction* and *compaction as
simultaneously COGS and legibility* in a coordination substrate that already does the
compaction. That fusion, grounded in PD's five primitives, is the contribution.

---

## <a id="refs"></a>References

1. Procida, D. *Diátaxis: A systematic framework for technical documentation.* 2017–. https://diataxis.fr/
2. Anthropic. *Effective Context Engineering for AI Agents.* 2025. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (see also *Effective harnesses for long-running agents*, https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
3. Sennrich, R., Haddow, B., Birch, A. *Neural Machine Translation of Rare Words with Subword Units (BPE).* ACL 2016. https://aclanthology.org/P16-1162/
4. Hong, Y. & Sun (et al.). *The Maximum Effective Context Window for Real-World [LLM tasks].* 2025. https://www.oajaiml.com/uploads/archivepdf/643561268.pdf (corroborated by Epoch AI, *Context windows*, https://epoch.ai/data-insights/context-windows)
5. Vaswani, A., et al. *Attention Is All You Need.* NeurIPS 2017. https://arxiv.org/abs/1706.03762
6. Scott, J. C. *Seeing Like a State.* Yale University Press, 1998.
7. Grassé, P.-P. *La reconstruction du nid et les coordinations interindividuelles … La théorie de la stigmergie.* Insectes Sociaux, 1959.
8. Liu, N. F., Lin, K., Hewitt, J., Paranjape, A., Bevilacqua, M., Petroni, F., Liang, P. *Lost in the Middle: How Language Models Use Long Contexts.* TACL 12 (2024), 157–173. https://arxiv.org/abs/2307.03172
9. *Slipstream: Trajectory-Grounded Compaction Validation for Long-Horizon Agents.* 2026. https://arxiv.org/pdf/2605.08580
10. *Parallel Context Compaction for Long-Horizon LLM Agent Serving.* 2026. https://arxiv.org/abs/2605.23296
11. Kang, M., et al. *ACON: Optimizing Context Compression for Long-horizon LLM Agents.* 2025. https://arxiv.org/abs/2510.00615
12. Nisan, N., Roughgarden, T., Tardos, É., Vazirani, V. V. (eds.). *Algorithmic Game Theory.* Cambridge University Press, 2007.
13. Douceur, J. R. *The Sybil Attack.* IPTPS 2002. https://doi.org/10.1007/3-540-45748-8_24
14. Ostrom, E. *Governing the Commons: The Evolution of Institutions for Collective Action.* Cambridge University Press, 1990.
15. Cognition. *Don't Build Multi-Agents* (on context engineering as the #1 job). 2025. https://cognition.ai/blog/dont-build-multi-agents
16. Hobbes, T. *Leviathan.* 1651.

---

### Port Daddy primitives cited (source paths)

- `docs/adr/0048-what-port-daddy-is.md` — the North Star stack & legibility principle.
- `docs/adr/0045-loud-fail-invariants-and-honest-attestation.md` — loud-fail / honest green.
- `docs/adr/0046-operator-tui.md`, `docs/adr/0047-conversation-protocol.md` — L2 console / L1 protocol.
- `lib/briefing.ts`, `lib/attention.ts`, `lib/episodic-memory.ts`, `lib/pheromone.ts`, `lib/resurrection.ts` — the five compaction primitives (§3.3).
- `lib/spawner.ts` — run/budget caps (the nearest built foothold for token metering).
- `lib/harbor-tokens.ts` — capability tokens (the *name collision* flagged in §3.3, not context tokens).

*Companion skill:* `~/.claude/skills/context-economics-for-agent-swarms/SKILL.md` — the
operational decision-points/failure-modes/quality-gates distilled from this paper.
