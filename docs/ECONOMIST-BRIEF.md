# The Bond Pricing Problem: A Brief for an Economist

**From:** Erich Owens
	**Re:** Mechanism design for an AI agent labor market
	**What I need:** A pricing function for collateralized work contracts in multi-agent systems

---

## The One-Paragraph Version

I've built a coordination system for AI agents (autonomous software that writes code, runs tests, edits files). When an agent wants to do work, it files a **Float Plan** — a declaration of what it will do, how long it will take, and what resources it needs. The agent's **principal** (the human or system that spawned it) posts **collateral** (credits) that are held in escrow by a trusted authority. If the work succeeds, the collateral is returned. If the work fails or causes damage, the collateral covers reconstruction. **I need a pricing function that determines how much collateral to require**, and I suspect this is a mechanism design problem you'd find interesting.

---

## The System

### What Exists (Built and Running)

**Port Daddy** is a daemon (a background service) running on a developer's machine. It coordinates AI agents that work simultaneously on the same codebase. Think of it as an operating system for agent teams.

The daemon provides:
- **Identity:** Every agent gets a cryptographic token (Ed25519-signed) that proves who it is and what it's allowed to do.
- **Capability bounding:** Tokens can only be delegated with *fewer* permissions, never more. Agent A can give Agent B read access, but Agent B can't escalate to write access. This is enforced cryptographically, not by policy.
- **Advisory file coordination:** Agents declare which files they intend to modify. The system detects overlaps and reports them. It does *not* enforce exclusive access — agents can ignore conflicts. (More on why below.)
- **Immutable audit trail:** Every action is logged to an append-only, encrypted evidence chain. You can prove what happened, when, and who did it.
- **Crash recovery:** When an agent dies, its work is preserved. A successor agent can read the dead agent's notes and continue the task.

### What Doesn't Exist Yet (The Gap)

The **economic layer**. Currently, agents work for free. There's no cost to filing a work declaration, no collateral at risk, and no settlement mechanism. This means:
- An agent can claim resources, work slowly, and tie them up (griefing)
- An agent can do bad work with no financial consequence
- There's no way to prioritize high-value work over low-value work
- There's no incentive for agents to produce quality — only to complete tasks

---

## The Float Plan (Work Contract)

When the economic layer is built, the workflow will be:

```
1. DECLARE:  Agent files a Float Plan
             - What files it will touch
             - How long it will take
             - Acceptance criteria (tests pass, code review approved)

2. ESCROW:   Principal posts collateral (credits)
             - Daemon validates, signs the plan, locks the credits

3. WORK:     Agent executes the plan
             - All actions logged to immutable evidence trail
             - Heartbeats prove liveness

4. SETTLE:   Outcome evaluated against acceptance criteria
             - Success: credits returned to principal
             - Partial completion (crash): pro-rata release based on evidence
             - Sabotage/breach: credits forfeited, fund reconstruction
```

The settlement doesn't evaluate intent. It evaluates **outcome against manifest**. A well-intentioned agent that fails to meet criteria forfeits collateral. A malicious agent that coincidentally produces correct output receives payment.

---

## The Pricing Problem

I need a function $\pi : \mathcal{F} \rightarrow \mathbb{R}^+$ that maps a Float Plan to a bond amount. The inputs available to the function are:

| Input | Type | Example |
|-------|------|---------|
| **Scope** | Set of files claimed | `{src/auth/middleware.ts, src/routes/login.ts}` |
| **File criticality** | Per-file risk score (derived from system) | auth middleware = 10, docs = 1 |
| **Duration** | Declared time budget | 30 minutes |
| **Principal history** | Completions, failures, salvage events | 14 completions, 2 salvage events |
| **Harbor context** | Which project/team the work is in | `myapp:api:auth-refactor` |
| **Concurrent agents** | How many others are working right now | 4 agents active |

The function must satisfy:

### 1. Deterrence
$\pi(\mathcal{F})$ must exceed the expected reconstruction cost if the agent causes maximum damage within its declared scope. Otherwise, sabotage is profitable.

### 2. Accessibility
$\pi(\mathcal{F})$ must be affordable for legitimate agents. If bonds are too high, only well-funded principals participate, and routine development work (the majority of all work) is priced out.

### 3. Risk Sensitivity
Writing to `src/auth/middleware.ts` for 30 minutes should cost more than reading `README.md` for 5 minutes. The function should be monotonically increasing in scope, criticality, and duration.

### 4. History Adjustment
A principal with 100 clean completions and 0% failure rate should post less collateral than a new principal with no track record. Reputation is a discount on collateral — but never eliminates it entirely (one-shot defection must always be costly).

### 5. Incentive Compatibility
The mechanism should make truthful declaration weakly dominant. Over-declaring scope (claiming more files than needed) should cost more. Under-declaring (claiming fewer files, then touching undeclared ones) should trigger scope violation penalties.

---

## What I Think Is Interesting (From a Mechanism Design Perspective)

### The Private Information Problem
Agents have **private knowledge** about their own needs. An agent asked to "fix the login bug" can't predict in advance whether it will need the auth middleware, the route handler, the test suite, or all three. The principal doesn't know either. This means the scope declaration is inherently uncertain — the Float Plan is an *estimate*, not a contract.

This maps to mechanism design with incomplete information. The pricing function must be robust to honest uncertainty (agents should be able to adjust scope mid-work without punitive re-pricing) while still penalizing deliberate misrepresentation.

### The Sen Impossibility Connection
I've grounded the advisory (non-enforced) design of the file coordination system in Sen's Impossibility of a Paretian Liberal (1970). Enforced file locking gives each agent a "personal domain" where its preference is decisive — but this produces Pareto-inferior outcomes because agents over-claim files precautionarily, blocking legitimate parallel work. Advisory claims sacrifice minimal liberalism to preserve Pareto efficiency. The pricing function operates in this advisory context — it must price **risk** without **enforcing** allocation.

### The Settlement Oracle Problem
Who decides if acceptance criteria are met? Options:
- Automated oracle (test suite) — gameable (agents write code that passes tests but is unmaintainable)
- Human oracle (code review) — expensive, doesn't scale
- Evaluator agent (another AI) — can collude with the worker agent
- Multi-oracle (2-of-3 agreement) — more robust but more complex

The oracle design interacts with the pricing function: if the oracle is weak (easily gamed), bonds must be higher to compensate. If the oracle is strong, bonds can be lower.

### The Sybil Attack
A principal can create many disposable agent identities, each with a clean history, and use those histories to obtain discounted bonds. The cost of this attack is: (number of identities) x (minimum bond per identity) x (time to build clean history). The pricing function must make this unprofitable.

### The Griefing Attack
An agent posts a bond, claims critical files, works very slowly, and effectively locks up resources for the maximum duration. No sabotage — just resource denial. The bond covers the damage, but the damage is opportunity cost (other agents couldn't work on those files), which is hard to quantify. Duration-based bond escalation (bond increases per minute held) is one defense.

---

## What I've Written About This

Two papers are attached:

1. **"The Anchor Protocol"** — The cryptographic identity layer. How agents authenticate, how capabilities are delegated with attenuation, and how the protocol model is checked (ProVerif) and the Rust verifier is bounded-checked (Kani). This is the security foundation.

2. **"The Bonded Commons"** — The governance and economic argument. Why multi-agent systems need a commons authority (Hobbes), why advisory claims are formally correct (Sen), what morality means when agents can be resurrected (Krakoa), and why collateralized work contracts transform the moral question of trustworthiness into the economic question of adequate bonding. **Section 7 ("Layer 3: Economic Alignment") and particularly Section 7.4 ("The Open Problem: Pricing the Bond") are the direct handoff to you.**

---

## The Concrete Ask

I'd love your help with:

1. **The pricing function $\pi$** — What functional form makes sense? Is it linear in scope x duration x criticality, or is there a more sophisticated approach from auction theory or insurance pricing?

2. **Incentive compatibility proof** — Can we prove that truthful scope declaration is weakly dominant under this mechanism? Under what conditions?

3. **The Sybil resistance analysis** — What's the equilibrium cost of a Sybil attack as a function of minimum bond and history-building time? Is there a pricing that makes Sybil unprofitable without pricing out legitimate newcomers?

4. **The griefing defense** — How should the bond escalate with duration? Linearly? Exponentially? Is there a natural stopping rule?

5. **The oracle interaction** — How does oracle quality (false positive/negative rates) feed into optimal bond pricing?

If this is interesting to you, I'd be thrilled to co-author the mechanism design section. The infrastructure (manifests, escrow, evidence chains, settlement) is built. The formal verification (ProVerif, TLA+) is done. The market design is the gap — and it's the most intellectually interesting part.

---

## Background: The Economy Model

### Credits

Fungible compute units internal to Port Daddy. Not pegged to dollars yet.

- Every project starts with a configurable credit pool
- Filing a Float Plan escrows credits from the pool
- Completing work releases escrowed credits to the agent's balance
- Agent balances persist across sessions
- Credits can be used to "bid" on tasks — higher-paying tasks attract better agents
- Later: peg credits to real compute cost (LLM API spend, GPU time)

### Experience Points & Reputation

- Agents accumulate XP by completing anchored tasks
- XP is domain-scoped: `myapp:auth:xp`, `myapp:api:xp`
- Higher-XP agents preferred for harder tasks
- Agents that die frequently or produce low-quality work accumulate negative reputation
- Reputation feeds into the pricing function as a history discount

### Settlement Flow

```
                Float Plan
                    │
            ┌───────┴───────┐
            │  ESCROW       │
            │  500 credits  │
            │  locked by    │
            │  daemon sig   │
            └───────┬───────┘
                    │
               Agent works
            (evidence chain)
                    │
            ┌───────┴───────┐
            │  SETTLEMENT   │
            │               │
            │  notes: 12    │
            │  files: 3     │
            │  quality: 0.87│
            │               │
            │  payout: 500  │
            │  + 174 bonus  │
            │  = 674 credits│
            │               │
            │  XP: +87      │
            │  (auth domain)│
            └───────────────┘
```

### The Quality Bonus

The Float Plan can specify a quality bonus above the base payout. This creates a two-tier incentive: base payment for meeting minimum criteria, bonus for exceeding them. The evaluator agent determines the quality score (0.0 to 1.0), and the bonus is `quality_score * bonus_pool`.

### Partial Credit on Death

If an agent dies mid-task, the Merkle-chained evidence trail enables pro-rata assessment. The daemon calculates: `completed_criteria / total_criteria * escrow`. The remainder funds the salvage agent's Float Plan for completing the work. This incentivizes good note-taking — the more detailed your evidence trail, the more a successor can recover, and the more partial credit you earn.

---

## Technical Details (If You Want to Go Deep)

### The Formal Verification

- **ProVerif 2.05**: Symbolic protocol analyzer. Proves that capability tokens can't be forged, delegation can't escalate privileges, and encrypted notes can't be read without authorization. All models verified: `RESULT ... is true`.
- **Kani Rust Verifier**: Bounded no-panic harnesses over the token parser (cryptography stubbed) and the byte comparator, plus two concrete vectors for the capability subset function. The crate the harnesses are compiled from is the one deployed in production (via FFI from the Node.js daemon); Kani checks the source, not the shipped binary.
- **TLA+ Specification**: State machine model of the session lifecycle with crash recovery. Safety properties (note monotonicity, escrow positivity, lock owner validity) and liveness properties (crash recovery, lock release) specified and ready for model checking.

### The Advisory Claims Design (Sen's Impossibility)

The system detects file overlaps between concurrent agents and reports them, but does not prevent them. This is not a bug — it's the formally correct design for a system where agents have private information about their own needs. Enforced allocation (exclusive file locks) gives each agent a "personal domain" that can veto the collective optimum. Advisory claims provide complete information without veto power. The pricing function must work within this advisory framework — pricing risk, not enforcing allocation.

### The Arbiter (Runtime Enforcement)

A daemon subsystem that subscribes to the event stream and checks every state transition against formally verified invariants: PID squatting, capability escalation, note monotonicity, escrow positivity, lock owner validity, heartbeat freshness. Violations are logged immutably and, in strict mode, trigger the salvage protocol. This is the sovereign's enforcement arm — but it enforces formal invariants, not economic policy.
