# Orchestrators, Insurance, and the Construction Analogy: A Follow-Up for Thomas

**From:** Erich Owens
**Re:** Your competitive insurance proposal — who gets bonded, and who's the general contractor?
**What I need:** Confirmation that the right unit of insurance is the orchestrator, not the individual agent

---

## The One-Paragraph Version

Your competitive insurance design is elegant, but while planning the implementation I got lost pricing individual agent tasks and their pairwise interactions. A conversation with a collaborator snapped the frame: **construction doesn't insure individual subcontractors' merges — it bonds the general contractor.** The GC is responsible for scheduling trades, resolving conflicts, and delivering the finished building. The surety company assesses the GC, not the plumber. I think the same applies here: Port Daddy is the building department (infrastructure, inspections, records), **orchestrators** are the general contractors (scheduling, conflict management, delivery), and your insurer agents assess orchestrators. This simplifies the mechanism substantially. The merge externality problem I was trying to price per-agent is actually the orchestrator's job to manage — and the insurer's job to assess whether the orchestrator can handle it.

---

## The Construction Analogy

In construction:

| Role | Construction | Port Daddy |
|---|---|---|
| **Building department** | Issues permits, inspects, maintains records, enforces codes | Daemon: ports, sessions, Arbiter, activity log, identity |
| **General contractor** | Schedules trades, resolves conflicts, manages quality, delivers the project | Orchestrator agent: schedules work, orders merges, coordinates agents |
| **Subcontractors** | Electricians, plumbers, carpenters — do the actual work | Working agents: write code, run tests, edit files |
| **Surety company** | Bonds the GC. Assesses GC's track record and project complexity. Pays if GC fails to deliver. | Your insurer agents |
| **Building owner** | Hires GC, defines requirements, accepts final product | Human developer or principal |

The surety company does not bond individual plumbers. It bonds the GC. The GC's competence at coordinating trades *is* what's being assessed. If the electrician's conduit run conflicts with the plumber's rough-in, that's the GC's problem — it's priced into the GC's overhead, not into per-trade insurance.

---

## The Merge Problem (Reframed)

### Why I Was Overcomplicating It

In multi-agent development, when several agents work on the same codebase simultaneously, merging their work creates negative externalities. The first agent to merge faces zero conflicts. Every subsequent agent faces increasing conflict probability. This creates a race to merge fast and sloppy rather than slow and correct.

I initially tried to price this externality into per-agent insurance — each agent's premium would incorporate the damage its merge imposes on concurrent agents. This led to increasingly complex mechanisms: externality-adjusted R, portfolio correlation, merge ordering auctions, pairwise conflict pricing.

Then I realized: **this is the orchestrator's problem.** A good orchestrator:

- Assigns work with minimal file overlap
- Orders merges to minimize total conflict cost
- Tells agents when to rebase
- Detects semantic conflicts before they reach the merge queue
- Takes responsibility for the composed output

A bad orchestrator lets agents race to main, ignores conflicts, and delivers broken compositions. The insurer doesn't need to price merge externalities per-agent. The insurer needs to assess: **is this orchestrator competent?** If yes, low premium. If no, high premium. If the orchestrator fails and the project isn't delivered, the bond covers reconstruction — just like construction.

### What Changes

| My Original Approach | Construction-Informed Approach |
|---|---|
| Insure each agent's Float Plan individually | Insure the orchestrator's project-level Float Plan |
| Price merge externalities per-agent ($R_{\text{externality}}$) | Merge management is the orchestrator's competence |
| Combinatorial auction for merge ordering | Orchestrator decides merge ordering |
| Portfolio correlation as insurer problem | Portfolio composition as orchestrator problem |
| N auctions for N agents | One auction for one orchestrator |

The mechanism is the same — competitive insurer agents bid premiums, Darwinian selection evolves accurate pricing. But the unit of insurance is the orchestrator, not the individual working agent. This is substantially simpler.

---

## What the Orchestrator Looks Like

An orchestrator is an agent that:

1. Files a Float Plan for the whole project ("Refactor the auth system")
2. Gets bonded via your insurance auction
3. Spawns and coordinates sub-agents
4. Manages their merge ordering and conflict resolution
5. Delivers the composed result
6. Settlement: did the project meet acceptance criteria?

The orchestrator can be simple (a human running `pd begin` and manually managing agents) or sophisticated (an AI agent that decomposes tasks, assigns work, monitors progress, and handles merges autonomously).

Multiple orchestrators can compete for the same project. The insurer assesses the orchestrator's track record, not the individual sub-agents' capabilities. A good orchestrator with mediocre sub-agents may outperform a bad orchestrator with excellent sub-agents — because composition is harder than execution.

Port Daddy provides the infrastructure the orchestrator needs:
- File claim conflict detection (who's overlapping with whom)
- Pub/sub messaging (coordination between sub-agents)
- Activity log (evidence trail for settlement)
- Arbiter (invariant enforcement)
- Merge primitives (queue, ordering data)

But Port Daddy doesn't *do* the orchestration. That's the GC's job.

---

## Where Your Mechanism Applies

Your proposal maps cleanly onto this:

1. **R** = the cost of reconstructing the project if the orchestrator fails to deliver. This is easier to estimate at the project level than at the per-agent level — it's "how much would it cost to start over?"

2. **Insurer agents** read the orchestrator's Float Plan (the project manifest, not individual task manifests) and assess: Can this orchestrator handle a project of this scope? How is its track record? How many sub-agents is it coordinating? What's the conflict density of the claimed files?

3. **Solvency gate** applies to the orchestrator's bond, not per-agent bonds.

4. **Settlement** is binary (your original design): the project was delivered to spec, or it wasn't. The insurer doesn't need to evaluate individual sub-agent merges. It evaluates the orchestrator's output.

5. **Darwinian selection** operates on insurers' ability to assess orchestrator competence, not individual agent risk. This is a more tractable assessment — "can this GC deliver?" is a question with more historical signal than "will this agent's merge conflict with that agent's work?"

---

## Privatized Orchestrators

An important architectural question: should orchestration be a role that different agents can compete for? Or should Port Daddy provide a default orchestrator?

I think orchestration should be **open**. Different orchestrators will have different strategies:

- A conservative orchestrator serializes all work (no merge conflicts, slow)
- An aggressive orchestrator parallelizes maximally (fast, risky)
- A domain-aware orchestrator knows that auth changes should merge before API changes
- A learning orchestrator improves its scheduling based on historical conflict data

The market for orchestrators is separate from the market for insurance. Orchestrators compete on execution quality. Insurers compete on risk assessment accuracy. These are different competencies.

Port Daddy's role: provide the infrastructure both markets need (conflict data, merge primitives, activity logs, identity, settlement) without being either the orchestrator or the insurer.

---

## Revised Questions for You

The original six questions I prepared were overengineered because I was trying to price merge externalities into per-agent insurance. With the orchestrator framing, the questions simplify:

### 1. The Unit of Insurance

Do you agree that the right unit is the orchestrator's project-level Float Plan, not the individual agent's task-level Float Plan? If there are cases where per-agent insurance is still needed (agents working without an orchestrator), how should the mechanism degrade gracefully?

### 2. First-Price vs. Second-Price

I initially considered switching to Vickrey (second-price) for dominant-strategy truthfulness. But I now think your choice of first-price may be deliberate: under first-price, an insurer who bids too aggressively wins and goes bankrupt, which *is* the Darwinian selection mechanism. Under Vickrey, the winner pays someone else's price, so the feedback loop between "my bid" and "my wealth outcome" is weaker.

Is the Darwinian mechanism the reason you chose first-price?

### 3. Small-Pool Dynamics

In practice, the insurer pool will be 3-8 agents. At that scale, correlated bids (same model backbone) suppress genuine information aggregation. Is there a minimum viable pool size below which the mechanism degenerates into administered pricing? Should the system detect this and fall back?

### 4. The Empirical Question

Can an LLM produce a calibrated premium for an orchestrator's project-level Float Plan? This is more tractable than per-agent pricing — the insurer assesses one entity on one question ("will this orchestrator deliver?") with richer signal (orchestrator's track record across multiple past projects). But it's still unvalidated. If the answer is "not yet," is there a hybrid (formula baseline + insurer adjustment) that bootstraps the market?

### 5. Orchestrator Reputation and Adverse Selection

New orchestrators have no track record. If premiums are high for newcomers, only established orchestrators can afford to take on work — creating a barrier to entry. The cold start problem from your original proposal applies here too, but at the orchestrator level rather than the agent level. Does the graduated task access model (newcomers start with small projects) work, or is there a better mechanism?

---

## What I Plan to Build

Based on our exchanges, here's the sequence:

**Phase 1: Merge Queue** (no economics, useful immediately)
- Agents submit completed work to a queue
- Conflict prediction (AST-level, not just textual)
- Optimal merge ordering to minimize total conflict cost
- This is building department infrastructure — anyone can use it

**Phase 2: Orchestrator Role** (coordination, no insurance)
- Orchestrators register as agents with a project-level Float Plan
- Orchestrators spawn and coordinate sub-agents
- Port Daddy tracks orchestrator outcomes (delivered/failed)
- Builds the track record data insurers will eventually need

**Phase 3: Competitive Insurance** (your proposal)
- Insurer agents bid premiums on orchestrator Float Plans
- Darwinian wealth selection
- Settlement: did the orchestrator deliver?
- Self-improving as models improve

Each phase delivers value independently. Phase 1 is useful without economics. Phase 2 is useful without insurance. Phase 3 is your mechanism, applied to the right unit.

---

## What's Changed Since the First Brief

| Component | Status | Relevance |
|---|---|---|
| **Arbiter** (runtime invariant enforcement) | Built, running | Can enforce orchestrator-level invariants |
| **Note encryption** (AES-256-GCM, ProVerif-verified) | Built, running | Evidence chains for settlement |
| **Fleet engine** (declarative YAML agent management) | Built, running | Insurer and orchestrator agents as fleet members |
| **Pheromone signals** (evaporating reputation markers) | Built, running | Orchestrator and insurer reputation tracking |
| **File claim conflict detection** | Built, running | Merge conflict data for orchestrators |
| **Agent spawning** (`pd spawn`) | Built, running | Orchestrators can spawn sub-agents |
| **Semantic identity trie** | Built, running | O(k) lookup of concurrent agents by project |

---

## The Paper

I think there are now two papers:

1. **The Anchor Protocol** (cryptographic identity, formally verified) — written, published on our site.

2. **The Bonded Commons** (governance + economic alignment) — written, but Section 7.4 (bond pricing) is explicitly deferred to "collaboration with economists." Your competitive insurance mechanism is the answer to that section, and the orchestrator framing completes it.

The contribution would be: the first competitive insurance market for AI agent labor, with the orchestrator as the insured unit, applied to a running system with formal verification of the underlying security properties. The merge externality analysis (why per-agent pricing fails, why the GC analogy holds) is the motivating argument for the orchestrator framing.

If this is interesting, I'd love to write it together.
