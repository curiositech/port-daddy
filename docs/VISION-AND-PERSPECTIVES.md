# Port Daddy: Vision and Perspectives

**Author:** Erich Owens
**Date:** March 30, 2026
**Status:** Strategic reference document
**Origin:** Deep design session synthesizing mechanism design, category theory, and multi-agent systems architecture

This document preserves the strategic frameworks, key insights, and architectural decisions from a design session about Port Daddy's future. It is a reference for future sessions, not a tutorial. Read it when you need to understand *why* something was built the way it was, or what comes next.

For implementation timelines, see `V4-UNIFIED-ROADMAP.md`. For specific engineering plans, see `MERGE-INFRASTRUCTURE-PLAN.md`. For the economic model, see `ECONOMIST-BRIEF.md` and `ECONOMIST-BRIEF-2-ORCHESTRATORS.md`.

---

## 1. The Building Department Model

Port Daddy is the building department. It is not the architect.

### What a building department does

| Function | Construction | Port Daddy |
|----------|-------------|------------|
| **Issue permits** | Building permits, occupancy permits | Claims, agent registrations, merge slots |
| **Enforce code** | Fire code, electrical code, zoning | Arbiter invariants -- non-negotiable structural rules |
| **Inspect** | Foundation inspection, final walkthrough | Post-merge verification, test gate enforcement |
| **Maintain records** | Permits filed, inspections logged, liens recorded | Sessions, notes, activity log, immutable audit trail |

### What a building department does not do

It does not decide the floor plan. It does not choose materials. It does not hire the plumber. It does not sequence the trades.

That is the architect's job. In Port Daddy's world, the architect is the **orchestrator**.

### The separation

**Port Daddy provides infrastructure.** Ports, locks, identities, sessions, notes, merge queues, conflict prediction, the Arbiter, pub/sub, DNS, salvage, tunnels. These are generic capabilities. They work for any project, any language, any team topology.

**Orchestrators provide intelligence.** They decompose tasks, assign agents, decide merge ordering, choose prompts, manage context windows, handle retries. Their competitive advantage IS their domain knowledge. A React orchestrator knows about component boundaries. A Rust orchestrator knows about borrow checker constraints. A monorepo orchestrator knows about package dependency graphs.

This is Evans' Domain-Driven Design distinction: Port Daddy is the **Generic Subdomain** (infrastructure that every system needs), and the orchestrator is the **Core Domain** (the intelligence that differentiates one system from another).

### Default orchestrator

PD ships a default FIFO orchestrator. It is deliberately simple: first in, first out. No intelligence about the codebase, no conflict prediction heuristics, no domain-specific decomposition. It works for solo devs and small trusted fleets.

Users bring private orchestrators as plugins. The plugin interface is defined in `lib/orchestrator-plugins.ts`. Hot-swap is supported -- you can replace the orchestrator without restarting the daemon.

---

## 2. Competitive Merges and Priced Cooperation

### The trust spectrum

Not all agents are equally trusted. The coordination model must reflect this.

**Dev mode** (solo dev, trusted fleet): The daemon just decides. It has perfect information and aligned incentives. No auction, no pricing, no bonds. This is the strong leader model from Raft. The daemon is the authority. Agents obey because they were spawned by the same principal.

**Trust boundaries** (OSS contributors, marketplace agents, cross-org collaboration): Pricing internalizes externalities. When agents are not aligned by default, you need economic mechanisms that make cooperation cheaper than defection.

### Why "just don't conflict" is naive

An orchestrator that could perfectly partition work -- assigning each agent a non-overlapping set of files -- would need to understand the codebase well enough to solve the problem itself. The scope of non-trivial work is discovered during execution, not before. Agent A is assigned `auth.ts` but discovers the bug is actually in `session.ts`. Agent B was assigned `session.ts`. Now you have a conflict that no amount of upfront planning could have prevented.

Prices don't prevent conflicts. They make the agent who causes a conflict bear its cost. Cooperation becomes the cheapest strategy not because agents are "nice" but because defection is expensive.

### Pricing mechanisms

Four mechanisms, used in combination:

1. **Conflict surface premiums.** Agents pay proportional to how many other agents' work they could affect. Touching a utility file imported by 40 modules costs more than touching a leaf component. Tree-sitter provides the dependency graph; the premium formula uses it.

2. **Broadcast credits.** Proactive information sharing reduces merge cost for everyone. An agent that publishes "I changed the return type of `validateToken()`" via pub/sub earns credits that offset its conflict premium. This makes communication economically rational.

3. **Merge slot auctions.** When multiple agents want to merge, order matters. The first to merge faces zero conflicts; the last faces all of them. Vickrey second-price auctions determine merge ordering. Agents bid their true valuation because the second-price mechanism makes truthful bidding dominant strategy.

4. **Quality bonds.** Agents (or their principals) post collateral when submitting to the merge queue. If post-merge tests fail, the bond is forfeit and used to compensate agents whose work was damaged by the bad merge. This creates skin in the game -- you only merge when you are confident.

### Theoretical grounding

This is mechanism design (Hurwicz, Nobel 2007). The goal is to design the rules of the game so that individually rational behavior produces collectively good outcomes. The mechanism doesn't require agents to be altruistic. It requires them to be self-interested in a system where the incentive structure rewards cooperation.

The connection to Ostrom's commons governance (Nobel 2009) is direct. Ostrom identified eight design principles for sustainable commons. Port Daddy's coordination layer implements six of them:

| Ostrom Principle | Port Daddy Implementation |
|-----------------|--------------------------|
| Clear boundaries | File claims, agent registration, harbor membership |
| Proportional costs | Conflict surface premiums scaled to impact |
| Collective choice | Agents choose approaches within the cost structure |
| Monitoring | Arbiter invariants, activity log, immutable audit trail |
| Graduated sanctions | Warnings, increased premiums, bond forfeit |
| Conflict resolution | Merge queue ordering, orchestrator mediation |

---

## 3. The Olog Arbitrage Opportunity

### What ologs are

Ologs (ontology logs) are a formalization from Spivak (MIT, 2012). An olog models a problem domain as a category: objects are types, arrows are functional relationships, commutative diagrams are invariants. They look like ER diagrams but have stricter semantics -- every arrow must be functional (each input maps to exactly one output), and commutative diagrams must actually commute.

See `OLOG-LIBRARY-PROGRAM.md` for the 12-week construction program.

### The arbitrage

Solving problem P costs C. Building the olog for P's domain takes some additional effort. But P belongs to an equivalence class -- a set of problems that share the same structure. Functors (structure-preserving maps) between ologs establish this equivalence formally.

If P's equivalence class has K members, each subsequent solve after the first costs approximately zero -- you transport the solution through the functor. The ROI is:

```
ROI = K * value_per_problem / C
```

This creates three investment opportunities:

1. **Solve hard, high-K problems.** A problem with many structural equivalents pays off K times. CI pipeline scheduling is equivalent to recipe execution, manufacturing workflows, and course prerequisite resolution. Solve it once with a correct decomposition; apply the functor K times.

2. **Identify equivalence classes.** Finding that two apparently different problems are functor-equivalent is itself valuable. The work is in constructing the functor -- once found, it is a permanent asset.

3. **Invest in olog construction speed.** LLM-assisted olog construction with human verification reduces the time to model a new domain from hours to minutes. The faster you can build ologs, the faster you find functors, the faster the library compounds.

### Where this lives architecturally

The olog engine lives inside orchestrators, not inside PD. PD provides the building department that orchestrators trust. The orchestrator's olog library is its deepest competitive advantage -- it is the thing that lets one orchestrator recognize a problem as "structurally equivalent to something I solved last month" while another orchestrator treats it as novel.

PD does not need to build the olog engine. PD needs to provide:
- The symbol index (tree-sitter) that feeds olog construction
- The merge queue that the orchestrator controls
- The audit trail that proves solutions were correctly transported
- The Arbiter that enforces the invariants the olog specifies

---

## 4. Operads and Jury-rig

### What operads formalize

An operad formalizes "things that decompose into parts." Each operation has typed inputs and typed outputs. Composition rules specify how operations wire together. The monoidal product specifies how independent operations run in parallel.

Jury-rig IS an operad. DAG nodes are operations. Wiring between nodes is composition. Wave scheduling (parallel execution of independent nodes) is the monoidal product.

### What operads add beyond "it's a DAG"

Three things that plain DAGs don't give you:

1. **Type-safe composition.** Invalid wirings are rejected before execution, not at runtime. If operation A outputs a `TestReport` and operation B expects a `CodeDiff`, the operad catches the type mismatch at DAG construction time. This eliminates a large class of runtime failures.

2. **Compositionality proofs.** If each component operation is correct, the composed operation is correct. This is a mathematical guarantee, not a testing heuristic. It means you can verify components independently and trust their composition.

3. **VOYAGER-style skill accumulation.** New skills slot into existing DAG structures if their types match. You don't need to redesign the DAG -- you extend it. A new `lint-rust` skill with the same input/output types as `lint-typescript` can replace it in any DAG that uses linting. The operad structure guarantees the replacement is valid.

---

## 5. Agent Mental Model Encoding

### The problem

When an agent dies mid-task, its successor currently gets: session notes (free text), file claims (paths), and the salvage queue entry (purpose string). This is a lossy representation of what the agent actually knew. The dead agent had hypotheses about why a test was failing, understood which files depend on which, knew which approaches it had tried and rejected. All of that is lost.

### Three tiers of outboard cognition

**Tier 1: Mechanical (zero agent cooperation required).** Captured server-side from tool call traces. The agent doesn't need to do anything special.

- Tool call trace: what was called, when, what it returned
- File access log: which files were read or written, in what order
- Error log: every error, with full context

**Tier 2: Introspective (periodic agent dumps).** The agent periodically exports a `MentalModelSnapshot` -- a structured object containing its current understanding.

- Active hypotheses: "I think the test fails because `validateToken` returns null on expired tokens"
- Decisions made: "Chose approach B over approach A because A required changing the public API"
- Plan state: "Completed steps 1-3, currently on step 4 of 6"
- Dependency beliefs: "File X depends on file Y via import; changing Y's interface will break X"

**Tier 3: Shared knowledge (cross-session persistence).** Knowledge that outlives any single agent or session.

- Codebase beliefs: "The auth module uses the factory pattern; all modules self-initialize their tables"
- Error patterns: "SQLite BUSY errors correlate with concurrent agent writes; use WAL mode"
- File heat maps: which files change most frequently and conflict most often
- Architecture decisions: "We chose Express over Fastify because of middleware ecosystem"

### The six components

Research identified that an agent's mental model consists of six things, each needing a different persistence strategy:

| Component | Persistence | Update frequency |
|-----------|------------|-----------------|
| Access trace | Automatic (server-side) | Every tool call |
| Dependency understanding | Snapshot on claim, update on discovery | Per-file |
| Design rationale | Agent-authored note | When decisions are made |
| Plan state | Structured snapshot | Every major step |
| Hypotheses | Agent-authored, tagged | When formed or refuted |
| Error memory | Automatic + agent annotation | On error |

---

## 6. Tree-Sitter as General-Purpose Code Understanding

Tree-sitter is not a conflict prediction tool that happens to parse code. It is a general-purpose code understanding engine. Conflict prediction is one application. Here are the others.

### Applications

| Application | How | Value |
|-------------|-----|-------|
| **Conflict prediction** | Compare symbol dependency graphs of two branches; overlapping modified symbols = predicted conflict | Enables merge queue ordering by conflict surface |
| **Auto-documentation** | Extract docstrings attached to exported symbols | Agents can read documentation without reading source |
| **Inline test examples** | Extract `@example` tags from JSDoc/TSDoc | Feed examples to agents as usage patterns |
| **Parity tracking** | For every route handler, verify CLI command + SDK method + MCP tool exist | Automate the command parity matrix |
| **Dead code detection** | Symbols with zero inbound edges in the dependency graph | Identify safe deletion candidates |
| **API surface monitoring** | Track exports over time; alert on unintended changes | Prevent accidental breaking changes |
| **Complexity metrics** | Cyclomatic complexity, nesting depth, function length from AST | Prioritize refactoring targets |
| **Architecture enforcement** | Compare import graph against allowed-dependency rules | Catch violations before they ship |
| **Onboarding maps** | Dependency-ordered reading lists for new contributors | "Read these 8 files in this order to understand auth" |

### Update strategy

Parsing is fast (tree-sitter processes a file in ~1ms on modern hardware) but must be debounced to prevent dogpiling during major refactors.

- **On claim:** Parse the claimed file. 1 file, ~1ms. Always current for the file the agent is about to work on.
- **On commit:** Parse changed files only. Triggered by git hook or merge queue completion.
- **Periodic sweep:** Every 60 seconds, check file hashes against cached ASTs. Re-parse only changed files.
- **Debounce:** If more than 50 files changed in the last 5 seconds (major refactor, branch switch), defer the sweep by 30 seconds.

Implementation: `lib/symbol-index.ts` (~1395 lines). Uses tree-sitter WASM for cross-platform compatibility. Supports TypeScript, JavaScript, Python, Rust, Go, and C out of the box.

---

## 7. The Layer Stack

```
LAYER 6: MARKETPLACE (future)
  Orchestrators compete on track record
  Bonds + settlement for cross-trust work
  Olog libraries as proprietary assets

LAYER 5: ORCHESTRATORS (plugins)
  Default: simple FIFO, ships with PD
  Private: domain-specific intelligence
  The "architect" -- decides HOW to build

LAYER 4: INTELLIGENCE SERVICES (PD provides)
  Semantic conflict prediction (tree-sitter symbol index)
  Merge queue + post-merge inspection
  Mental model snapshots
  Dependency graph maintenance

LAYER 3: BUILDING DEPARTMENT (PD core)
  Permits: claims, registrations, merge slots
  Code enforcement: Arbiter invariants (non-negotiable)
  Inspections: post-merge verification
  Records: sessions, notes, audit trail

LAYER 2: INFRASTRUCTURE (PD core)
  Daemon + mesh (multi-machine via DAEMON-MESH-ARCHITECTURE.md)
  SQLite + WAL, pub/sub, tunnels, DNS
  Harbor Cards, mTLS, capability attenuation

LAYER 1: PRIMITIVES (PD core)
  Ports, locks, semantic identities (project:stack:context)
  Agent lifecycle, heartbeats, salvage
  Pheromone trails, file claims
```

### What PD owns vs. what plugins own

PD owns Layers 1-4. These are the generic subdomain -- infrastructure every multi-agent system needs regardless of what it is building.

Orchestrators (Layer 5) are plugins. PD ships one default. Users bring their own. The plugin interface (`lib/orchestrator-plugins.ts`) defines what an orchestrator can do: submit merge requests, query the symbol index, set merge ordering, register Arbiter rules.

Layer 6 (marketplace) is future work. It requires the daemon mesh (`DAEMON-MESH-ARCHITECTURE.md`) and the economic layer (`ECONOMIST-BRIEF.md`). The marketplace is where orchestrators compete on track record, post bonds for cross-trust work, and trade olog libraries as proprietary assets.

---

## 8. Jury-rig Skill Accumulation Gap

### Current state

Jury-rig has the machinery for skill management but the wiring is incomplete:

- **The Curator** has Thompson sampling for skill selection, Kuhnian crisis detection (detect when the current paradigm is failing), and skill crystallization (promote ad-hoc solutions to named skills). But it never executes. It is a design, not a running system.
- **dag-pattern-learner** detects recurring DAG structures and proposes them as reusable patterns. It is disconnected from the Curator and from execution.
- **skill-logger** records skill usage with metrics (time, cost, success rate). It is standalone -- nothing reads its output.
- **next-move** proposes what to do next based on project state. It does not capture feedback from execution or detect skill gaps.
- There is no persistent **Knowledge Library** -- a searchable registry of validated skills with typed interfaces.
- There is no **skill composition mechanism** -- combining two skills into a new skill that handles their intersection.

### The fix

1. Wire the Curator into the meta-DAG after the Evaluator. The Evaluator judges output quality; the Curator uses that judgment to update skill scores (Thompson sampling posteriors) and detect crises.
2. File-based skill registry with typed interfaces. Skills are `.md` files with structured frontmatter (input types, output types, prerequisites, success metrics). The registry is searchable by type signature, not just by name.
3. next-move skill gap detection. When next-move proposes a task and no skill matches the required type signature, it flags a gap. Gaps accumulate into a prioritized list of skills to build.
4. Connect skill-logger to the Curator. Usage metrics feed Thompson sampling. Skills that consistently fail get demoted. Skills that consistently succeed in novel contexts get promoted.

---

## 9. Implementation Sequence

Resequenced based on dependency analysis. Each phase builds on the previous.

### Phase 0: Tree-Sitter + Symbol Claims (Weeks 1-3) -- START HERE

**Why first:** Everything else depends on understanding what code exists and how it connects. Conflict prediction needs the symbol graph. Arbiter merge rules need symbol-level claims. Orchestrators need the dependency graph to make intelligent decisions.

**Deliverables:**
- `lib/symbol-index.ts` -- WASM-based tree-sitter, symbol extraction, dependency tracking, conflict prediction (DONE, ~1395 lines)
- `routes/symbols.ts` -- 6 endpoints for querying the symbol index (DONE, ~266 lines)
- Symbol-level file claims (extend `session_files` table)
- Periodic sweep with debounce

### Phase 1: Arbiter Invariants for Symbols/Merges (Weeks 3-4)

**Why second:** Before building the merge queue, define what "correct" means. Arbiter rules are non-negotiable -- they are the building code.

**New Arbiter rules:**
- Symbol claim consistency: no two agents claim the same symbol without explicit co-claim
- Test quality gate: merge blocked if test coverage drops below threshold
- Conflict threshold: merge blocked if predicted conflict surface exceeds limit
- Queue staleness: alert if a merge request sits unprocessed for more than N minutes

### Phase 2: Merge Queue + Orchestrator Plugin Interface (Weeks 5-7)

**Why third:** The merge queue is the final integration point. It needs the symbol index (Phase 0) and Arbiter rules (Phase 1) to function correctly.

**Deliverables:**
- `lib/merge-queue.ts` -- SQLite-backed queue with conflict prediction and atomic execution (DONE, ~430 lines)
- `routes/merge-queue.ts` -- 11 endpoints (DONE, ~230 lines)
- `lib/orchestrator-plugins.ts` -- plugin registry, interface, default FIFO, hot-swap (DONE, ~320 lines)
- `MergeExecutor` interface for orchestrator-controlled merge execution

### Phase 3: Integration (Weeks 8-9)

Wire it together. The orchestrator plugin talks to the merge queue, which talks to the symbol index, which talks to the Arbiter. End-to-end: agent claims files, orchestrator assigns merge slot, symbol index predicts conflicts, Arbiter enforces invariants, merge executes, post-merge inspection runs.

---

## 10. What Was Built This Session

### Code

| File | Lines | Purpose |
|------|-------|---------|
| `lib/orchestrator-plugins.ts` | ~320 | Plugin registry, orchestrator interface, default FIFO, hot-swap support |
| `lib/merge-queue.ts` | ~430 | SQLite-backed merge queue, MergeExecutor interface, orchestrator delegation |
| `routes/merge-queue.ts` | ~230 | 11 Fastify endpoints for merge queue operations |
| `lib/symbol-index.ts` | ~1395 | Tree-sitter WASM, symbol extraction (6 languages), dependency tracking, conflict prediction |
| `routes/symbols.ts` | ~266 | 6 endpoints for symbol index queries |
| Tests | 110 new | 77 for merge queue/orchestrator + 33 for symbol index |

### Documents

| File | Purpose |
|------|---------|
| `docs/DAEMON-MESH-ARCHITECTURE.md` | Multi-machine federation design (Raft-inspired leader election, mDNS/Tailscale discovery) |
| `docs/OLOG-LIBRARY-PROGRAM.md` | 12-week olog construction program with exercises and functor search tooling |
| `docs/MERGE-INFRASTRUCTURE-PLAN.md` | Engineering plan for merge slots, Arbiter merge rules, and tree-sitter integration |
| `docs/VISION-AND-PERSPECTIVES.md` | This document |

### Skills

| Skill | Domain |
|-------|--------|
| `olog-construction` | Spivak's categorical framework for problem domain modeling |
| `operad-task-decomposition` | Formal task decomposition with typed composition and compositionality proofs |
| `mechanism-design-for-agent-labor` | Bond pricing, escrow, Vickrey auctions, marketplace dynamics |
| `semantic-conflict-prediction` | Tree-sitter AST analysis for multi-agent conflict detection and merge ordering |

---

## Appendix: Key References

| Reference | Relevance |
|-----------|-----------|
| Hurwicz (Nobel 2007) | Mechanism design -- designing rules so self-interest produces good outcomes |
| Ostrom (Nobel 2009) | Commons governance -- 8 design principles for sustainable shared resources |
| Spivak (MIT, 2012) | Ologs -- categorical modeling of problem domains, functor equivalence |
| Evans (DDD, 2003) | Generic vs. Core subdomain distinction -- PD is generic, orchestrators are core |
| Raft (Ongaro & Ousterhout, 2014) | Strong leader consensus -- used for daemon mesh and dev-mode coordination |
| VOYAGER (Wang et al., 2023) | Skill accumulation in open-ended environments -- typed skill libraries that compound |

---

## Appendix: The Trust Spectrum (Detailed)

```
FULL TRUST                                                    ZERO TRUST
solo dev          trusted fleet      OSS contributors      marketplace agents
     |                  |                    |                       |
  daemon decides    daemon decides     prices + bonds        prices + bonds
  no auction        no auction         Vickrey auction       Vickrey auction
  no bonds          no bonds           quality bonds         quality bonds
  no premiums       no premiums        conflict premiums     conflict premiums
                                       broadcast credits     broadcast credits
                                                             track record
                                                             insurer agents
```

The insight: you don't need the full economic mechanism for trusted environments. The pricing layer activates at trust boundaries. This is why Port Daddy works today (dev mode, daemon decides) while building toward a future where it also works across organizational boundaries.
