# The Merge Externality Problem: A Follow-Up for Thomas

**From:** Erich Owens
**Re:** Your competitive insurance proposal — a complication
**What I need:** Your mechanism extended to price the damage that *successful* work imposes on concurrent agents

---

## The One-Paragraph Version

Your competitive insurance design is the right mechanism for pricing individual Float Plans. But implementing it surfaced a problem your proposal doesn't yet address: in a multi-agent codebase, **a successful merge can be more damaging than a failed one**. When Agent A finishes first and merges its changes, every other agent's work becomes partially stale. The conflict resolution cost falls entirely on agents B, C, D — not on A. A's insurer collected a premium and walked away clean. The agents who did nothing wrong pay the price. This is a negative externality that the per-Float-Plan insurance model doesn't capture. I suspect the fix lives in the same competitive insurance framework, but the insurers need to price *systemic* risk (what does this merge do to the commons?) rather than *local* risk (will this agent succeed?).

---

## The Externality

### What Happens When Agents Merge

In a single-developer world, merges are cooperative. In a multi-agent world, merges become a coordination game with perverse incentives.

Consider four agents working simultaneously on the same codebase:

```
Agent A finishes first  → merges cleanly         → zero conflict cost
Agent B finishes second → conflicts with A       → pays resolution cost
Agent C finishes third  → conflicts with A AND B → pays 2x resolution cost
Agent D finishes fourth → conflicts with A, B, C → catastrophe
```

The first agent to merge faces zero conflicts. Every subsequent agent faces increasing conflict probability. This creates a **merge race** — agents are incentivized to merge fast and sloppy rather than slow and correct, because the first merger externalizes all conflict costs onto later mergers.

This is the tragedy of the commons applied to a codebase. The shared resource (a clean merge target) is degraded by each merge, but the degrader doesn't pay the cost.

### The Merge Tax

Each merge imposes a negative externality on all agents who haven't merged yet:

$$\text{merge\_tax}(\text{agent}_i) = \sum_{j \in \text{merged\_before}(i)} P(\text{conflict} \mid i, j) \cdot C(\text{resolution} \mid i, j)$$

where $P(\text{conflict} \mid i, j)$ is the probability that agent $i$'s changes conflict with agent $j$'s already-merged changes, and $C(\text{resolution} \mid i, j)$ is the cost of resolving that conflict.

In a cooperative setting, this tax is accepted as a cost of parallel work. In a competitive or marketplace setting, it creates three pathological dynamics.

### Pathology 1: The Race to Main

Agents rush to merge before others, producing lower-quality work. The agent that takes time to write tests and refactor is *punished* — by the time it merges, the codebase has moved underneath it. Speed is rewarded. Quality is penalized.

### Pathology 2: Strategic Conflict Seeding

A malicious agent can deliberately make broad, sweeping changes that don't conflict *textually* but create *semantic* conflicts for everyone else. Rename a widely-used function parameter. Change a return type. Touch every file's imports. Now every other agent's work is invalidated. The agent's own work "succeeds" — tests pass, the merge is clean. But the externality is catastrophic.

This is particularly dangerous because Git detects *textual* conflicts (two edits to the same line) but misses *semantic* conflicts (compatible text, broken program). An agent can cause maximum damage with zero merge conflicts.

### Pathology 3: The Stale Branch Death Spiral

An agent working on a complex task falls behind the merge target. Each day, the delta grows. Eventually, merging becomes more expensive than starting over. The agent's work — potentially hours of compute and substantial collateral — is worthless. Not because the agent failed, but because other agents' merges made its branch obsolete.

---

## The Game Theory

Two agents, A and B, each completing a task. They choose when to merge: early (fast, lower quality) or late (slow, higher quality).

**Without bonds:**

|  | B merges early | B merges late |
|---|---|---|
| **A merges early** | (3, 3) | (5, 1) |
| **A merges late** | (1, 5) | (4, 4) |

- (early, early): Both rush, both produce mediocre work. (3, 3)
- (early, late): A gets clean merge, B pays all conflict costs. (5, 1)
- (late, late): Both produce quality work. Higher total welfare. (4, 4)

This is a Prisoner's Dilemma. The Nash equilibrium is (early, early). The social optimum is (late, late).

**With merge bonds (externality-priced):**

If merging early carries a bond that covers the externality imposed on later mergers:

|  | B merges early | B merges late |
|---|---|---|
| **A merges early** | (1, 1) | (2, 3) |
| **A merges late** | (3, 2) | (4, 4) |

The early-early outcome is penalized (bonds forfeit for quality failures and externality costs). The social optimum (late, late) becomes the Nash equilibrium. The bond internalizes the externality.

---

## Where Your Proposal Stands

Your competitive insurance mechanism handles the *local* risk beautifully:

- Will this agent's work succeed?
- What will it cost to reconstruct if it fails?
- Which insurer best assesses this risk?

But it doesn't yet handle the *systemic* risk:

- What damage will this agent's *success* impose on concurrent agents?
- Who compensates agents B, C, D when Agent A's clean merge invalidates their work?
- How should the premium account for the agent's likely merge position?

### The R Problem

In your proposal, R is "the cost of restoring every claimed file to its prior state if the work fails completely." But the actual worst-case damage isn't restoration of the focal agent's files — it's the cascade:

$$R_{\text{honest}} = R_{\text{direct}} + R_{\text{externality}}$$

$$R_{\text{externality}} = \sum_{j \in \text{concurrent}} P(\text{conflict} \mid i, j) \cdot R_{\text{direct}}(j)$$

An agent refactoring a widely-imported module has high $R_{\text{externality}}$ even if its $R_{\text{direct}}$ is modest. An agent editing a leaf test file has near-zero $R_{\text{externality}}$.

This is why your semantic reasoning insight is right in ways I initially underappreciated. A pricing formula cannot compute $R_{\text{externality}}$ — it requires understanding what the proposed changes mean for downstream consumers. An insurer reading the manifest and checking the file claims of concurrent sessions *can* assess this, if prompted correctly.

### The Portfolio Correlation Problem

With a small pool of insurers (3-5 in practice), each assessing manifests independently, there's a systematic risk of underpricing *correlated* risk. If four agents are all working on files that import from the same module, their failure probabilities are correlated — one merge can invalidate all three remaining branches.

Independent per-Float-Plan assessment misses this. At least some insurers need to reason about the *portfolio* of active Float Plans, not just the one they're bidding on. This is a qualitatively different kind of risk assessment — portfolio risk rather than individual risk — and it's where the intellectual challenge concentrates.

---

## The Merge Ordering Question

One possible extension: instead of (or in addition to) insuring individual Float Plans, agents *bid for merge position*.

The first merge position costs the most, because it externalizes the most onto later mergers. The last position costs the least, because it bears the most conflict resolution burden but causes no externalities. Revenue from the auction compensates later mergers for their measured conflict costs.

This is a combinatorial auction: agents are bidding for positions in an ordering, and the value of each position depends on which agents occupy the other positions. The conflict probability matrix determines the payoff structure.

**How this interacts with insurance:** If merge position is auctioned, the insurer's risk assessment changes. An agent that wins the first merge position has low externality liability (it won't damage others) but paid a high auction price. An agent in the last position paid little for position but faces high conflict probability. The insurance premium and the merge position price are coupled — the total cost to the agent is premium + position price, and the risk to the insurer depends on the position.

This might be two separate mechanisms that agents optimize over jointly. Or it might be a single combined mechanism where the insurer's bid implicitly encodes a merge ordering preference. I don't have the mechanism design expertise to know which is more efficient.

---

## The Concrete Questions

Building on our first exchange, I'd love your thinking on:

### 1. Externality Pricing

How should the insurance premium incorporate $R_{\text{externality}}$? Should the insurer who underwrites Agent A's Float Plan be liable for damage A's merge causes to Agents B, C, D? Or should there be a separate externality bond paid by the merging agent (not the insurer)?

### 2. Portfolio Risk

Your Darwinian selection mechanism assumes insurers compete on accuracy. But with a small pool, correlated risk is systematically underpriced. Is there a mechanism that incentivizes at least some insurers to specialize in portfolio-level risk assessment rather than individual manifest assessment?

### 3. Merge Ordering as Auction

Is the merge ordering problem best solved as a separate combinatorial auction? Or should it be integrated into the insurance mechanism (insurer bids encode merge position preferences)?

### 4. First-Price Revisited

I initially considered switching your first-price auction to Vickrey (second-price) for dominant-strategy truthfulness. But I now think your choice of first-price may be deliberate: in first-price, an insurer who bids too low wins and goes bankrupt, which IS the Darwinian selection mechanism. Under Vickrey, the winner pays someone else's price, so their own risk assessment is never directly tested by the settlement. The feedback loop between "my bid" and "my wealth outcome" is weaker.

Is the Darwinian mechanism the reason you chose first-price? Does the merge externality problem change the analysis?

### 5. The Empirical Question

The deepest uncertainty: **can an LLM actually produce a calibrated risk premium for a Float Plan?** Your mechanism's self-improving property (pricing improves as models improve) holds only if insurers do genuine semantic risk assessment, not pattern-matching that approximates a formula. I haven't tested this yet. If the answer is "not yet, but soon," is there a hybrid design (formula for baseline R, insurer adjustment for semantic risk) that bootstraps the market while the models catch up?

### 6. Small-Pool Dynamics

Your mechanism assumes a population large enough for Darwinian selection to produce signal. In practice, the insurer pool will be 3-8 agents. At that scale, you have an oligopoly, not a market. Wealth divergence is noisy, inflation triggers constantly, and correlated bids (same model backbone) suppress genuine information aggregation.

Is there a minimum viable pool size below which the mechanism degenerates into administered pricing? Should the system detect this and fall back to a formula-based bond until the pool grows?

---

## What's Built Since the First Brief

Since our last exchange, the following infrastructure has been added:

| Component | Status | Relevance |
|---|---|---|
| **Arbiter** (runtime invariant enforcement) | Built, running | Enforces ESCROW_POSITIVE rule (currently a stub, ready to activate) |
| **Note encryption** (AES-256-GCM, ProVerif-verified) | Built, running | Evidence chains are cryptographically tamper-proof |
| **Pheromone signals** (evaporating pub/sub markers) | Built, running | Could track insurer reputation with natural decay |
| **Fleet engine** (declarative YAML agent management) | Built, running | Insurer agents would be fleet members |
| **Semantic identity trie** (O(k) lookups on project:stack:context) | Built, running | Enables portfolio-level queries across concurrent agents |
| **IPC binary protocol** (FIPA performatives) | Built, running | Low-latency agent-agent communication for auction bids |
| **File claim conflict detection** | Built, running | Pairwise overlap detection between concurrent sessions |

The file claim system already detects which concurrent agents have overlapping scope — the raw data for computing $R_{\text{externality}}$ exists. What's missing is the economic layer that *prices* it.

---

## What I Think the Architecture Looks Like

Based on our exchange and this new complication, I think the system has three layers that must be built in order:

**Layer 1: Merge Queue with Conflict Prediction**
- Agents submit completed work to a queue, not directly to main
- Pairwise conflict probability matrix computed (AST-level, not just textual)
- Optimal merge ordering minimizes total conflict cost
- No economics. Pure coordination. Useful immediately.

**Layer 2: Merge Bonds with Externality Compensation**
- Each agent posts bond before starting, proportional to scope
- Bond forfeit if merge breaks tests or Arbiter invariants
- Merge tax: portion of bond compensates downstream agents for conflict resolution
- Formula-based. Imperfect but functional. Internalizes the externality.

**Layer 3: Competitive Insurance (Your Proposal)**
- Insurers replace the formula-based bond with market-discovered pricing
- Insurers assess both direct risk AND externality risk
- Settlement accounts for both "did the work succeed?" AND "did the merge damage others?"
- Darwinian selection operates on ability to price systemic risk
- Self-improving as models improve.

Layer 1 is pure engineering. Layer 2 is mechanism design with a formula (the kind I can build without your help, imperfectly). Layer 3 is your proposal, extended to handle externalities. I'd love your input on whether this layering makes sense, and whether Layer 3 changes structurally when externalities enter the picture.

---

## The Stakes

This is, to my knowledge, the first attempt to build a competitive insurance market for AI agent labor. The individual bond pricing problem is interesting. The merge externality problem is, I think, genuinely novel — I haven't seen it treated in the multi-agent systems literature, because most multi-agent systems don't share a mutable artifact (a codebase) where operations compose non-commutatively.

The merge ordering problem is a combinatorial auction over non-commutative compositions. The externality pricing problem is Pigouvian taxation in a commons where the shared resource (codebase integrity) degrades through use. The portfolio correlation problem is the same challenge that breaks independent risk assessment in correlated credit markets.

All of these are problems you know how to think about. I can build the infrastructure. The mechanism design is the gap.

If this is interesting to you, I'd be glad to co-author the paper.
