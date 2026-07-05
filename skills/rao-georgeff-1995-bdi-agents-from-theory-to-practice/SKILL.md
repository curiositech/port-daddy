---
license: Apache-2.0
name: rao-georgeff-1995-bdi-agents-from-theory-to-practice
description: >-
  Foundational framework for modeling intelligent agents through Beliefs, Desires, and Intentions with practical
  implementation strategies under resource constraints
metadata:
  category: Research & Academic
  tags:
    - bdi
    - agents
    - theory
    - practical-reasoning
    - commitment
  io-contract:
    kind: none
    covers:
      - BDI agent architecture theory
      - Rational agency under resource constraints
      - Commitment strategies in dynamic environments
      - Plan library organization and indexing
      - Belief update granularity trade-offs
      - Agent failure modes and detection
      - Decision trees for agent design
allowed-tools: Read,Write,Edit,Glob,Grep
---

# SKILL: BDI Agents - Practical Rational Agency Under Resource Bounds

**Skill ID**: `bdi-agents-theory-practice`  
**Domain**: Agent architectures, AI system design, decision-making under resource constraints  
**Source**: Rao & Georgeff, "BDI Agents: From Theory to Practice"

## Decision Points

### Primary Decision Tree: Commitment Strategy Selection

```
INPUT: Environment volatility + Goal clarity + Computation budget

IF Environment volatility = LOW (changes slower than plan execution):
  └─ IF Goal clarity = HIGH (specific, measurable outcomes):
     └─ CHOOSE: Blind commitment
        • Perceptual cue: Plan steps complete in predictable timeframes
        • Trigger reconsideration: Only when goal achieved/failed
  └─ IF Goal clarity = LOW (abstract, evolving objectives):
     └─ CHOOSE: Single-minded commitment
        • Perceptual cue: Subgoal failures indicate impossibility

IF Environment volatility = MEDIUM (changes comparable to plan duration):
  └─ IF Computation budget = HIGH:
     └─ CHOOSE: Open-minded commitment
        • Perceptual cue: Monitor for better opportunities
        • Trigger reconsideration: Goal deprioritization OR impossibility
  └─ IF Computation budget = LOW:
     └─ CHOOSE: Single-minded commitment
        • Perceptual cue: Focus on clear failure signals only

IF Environment volatility = HIGH (changes faster than typical plans):
  └─ IF Goal urgency = CRITICAL:
     └─ CHOOSE: Reactive execution (bypass BDI deliberation)
        • Perceptual cue: Environmental state requires immediate response
  └─ ELSE:
     └─ CHOOSE: Open-minded with frequent reconsideration windows
        • Perceptual cue: Schedule reconsideration at plan checkpoints
```

### Decision Tree: Plan Library Organization Strategy

```
IF Domain knowledge = COMPLETE AND STABLE:
  └─ Pre-compile all plans with full context conditions
  └─ Use hash-table indexing on event types

IF Domain knowledge = INCOMPLETE OR EVOLVING:
  └─ Use hierarchical decomposition with abstract plans
  └─ Enable runtime plan composition
  └─ Index on goal patterns, not specific events

IF Real-time constraints = CRITICAL:
  └─ Sacrifice completeness for speed
  └─ Cache frequent plan instantiations
  └─ Use compiled pattern matching over full search
```

### Decision Tree: Belief Update Granularity

```
IF Environmental change rate > Belief update rate:
  └─ Use event-triggered updates only
  └─ Accept temporary inconsistency for speed

IF Belief inconsistency tolerance = LOW:
  └─ Implement belief revision with dependency tracking
  └─ May require pausing execution during updates

IF Memory constraints = TIGHT:
  └─ Maintain only current-state beliefs
  └─ Compile temporal dependencies into plan preconditions
```

## Failure Modes

### 1. Thrashing Agent (Continuous Reconsideration)
**Symptoms**: Agent switches between plans rapidly, never completing goals, high deliberation overhead
**Detection Rule**: If reconsideration frequency > 1 per plan step execution, you're thrashing
**Root Cause**: "Potentially significant change" detection is too sensitive OR commitment strategy is too weak for environment
**Fix**: Tighten change detection criteria, increase commitment strength, or batch environmental updates

### 2. Zombie Plans (Blind Persistence)
**Symptoms**: Agent continues executing obviously obsolete plans, ignores contradictory evidence, goals never achieved
**Detection Rule**: If plan execution continues after preconditions become false, you have zombie plans
**Root Cause**: Missing "impossibility" detection in termination conditions OR belief update failures
**Fix**: Add explicit plan precondition monitoring, implement belief-intention consistency checks

### 3. Option Generation Bottleneck
**Symptoms**: Long delays before any plan selection, agent appears "frozen" before acting, timeout failures
**Detection Rule**: If time-to-first-action > environment change period, option generation is the bottleneck
**Root Cause**: Plan library too large for real-time search OR matching algorithm is naive
**Fix**: Index plans by triggering events, use compiled pattern matching, accept incompleteness for speed

### 4. Schema Bloat (Over-Detailed Plans)
**Symptoms**: Plan library grows exponentially, new situations require entirely new plans, brittle to minor variations
**Detection Rule**: If adding new capability requires modifying >10% of existing plans, you have schema bloat
**Root Cause**: Plans encode too much detail rather than using hierarchical decomposition
**Fix**: Use abstract plans with subgoal decomposition, separate invariant patterns from situation-specific details

### 5. Desire-Intention Confusion
**Symptoms**: Agent attempts impossible combinations, violates resource constraints, goals conflict in execution
**Detection Rule**: If multiple intentions require mutually exclusive resources, desires and intentions are confused
**Root Cause**: Deliberation process doesn't filter desires for mutual consistency before commitment
**Fix**: Implement explicit compatibility checking in deliberation, maintain resource allocation tracking

## Worked Examples

### Example 1: Robot Navigation Under Deadline Pressure

**Scenario**: Delivery robot must reach destination in 10 minutes. Environment has pedestrians (medium volatility) and network connectivity for map updates (computation budget = medium).

**Decision Process**:
1. **Commitment Strategy Selection**: Medium volatility + medium budget → Open-minded commitment
2. **Initial Plan**: Direct path using A* with current map
3. **Execution**: At waypoint 3, pedestrian blocks path
4. **Reconsideration Trigger**: Blocked path = "potentially significant change" because it affects plan feasibility
5. **New Deliberation**: 
   - Option 1: Wait for pedestrian (risks deadline)
   - Option 2: Detour via loading dock (adds 2 minutes)
   - **Choose**: Detour (keeps deadline feasible)
6. **Continued Execution**: At waypoint 7, network update shows construction blocking detour
7. **Reconsideration**: Construction = significant change → New deliberation finds alternate route

**Key Insight**: Agent commits to paths but reconsiders when assumptions (clear route) become invalid. Novice would either replan at every pedestrian (thrashing) or ignore the blocked path (zombie plan).

### Example 2: Trading Algorithm Under Market Volatility

**Scenario**: Algorithm trading in options market, goal is profit maximization, market shows high volatility.

**Decision Process**:
1. **Environment Analysis**: High volatility + profit goal (clear but moving target) → Open-minded commitment with frequent reconsideration
2. **Initial Plan**: Buy puts on overvalued stock XYZ
3. **Execution**: Places orders
4. **Reconsideration Window**: Every 30 seconds (predetermined based on typical option price movement)
5. **Window 1**: XYZ down 2%, puts profitable → Continue plan
6. **Window 2**: News breaks: XYZ merger announced → Stock will gap up
7. **Reconsideration**: News = significant change → Goal no longer achievable with current plan
8. **New Deliberation**: Exit put position, consider call options or different stock

**Failure Trace**: Without proper reconsideration windowing, agent either:
- Reacts to every price tick (thrashing, transaction costs destroy profit)
- Ignores merger news (zombie plan, massive losses)

### Example 3: Satellite Control Under Communication Delays

**Scenario**: Earth station controlling satellite with 3-second communication delay, goal is maintain orbital position.

**Decision Process**:
1. **Constraint Analysis**: Communication delay means environment state is always 3 seconds stale, high cost of deliberation (each command cycle = 6 seconds minimum)
2. **Commitment Strategy**: Single-minded commitment (can't afford frequent reconsideration)
3. **Plan Structure**: Predictive control using orbital mechanics model
4. **Execution**: Send thruster commands based on predicted position
5. **Reconsideration Trigger**: Only when telemetry shows prediction error > safety threshold
6. **Example Reconsideration**: Atmospheric drag higher than predicted → orbital decay faster than expected
7. **New Plan**: Increase thruster frequency to compensate

**Expert vs Novice**:
- **Novice**: Tries to react to real-time telemetry → always 3 seconds behind, satellite drifts
- **Expert**: Uses predictive model with error-based reconsideration → maintains stable orbit despite delay

## Reference Files

- `diagrams/01_stateDiagram-v2_bdi_agent_decision_cycle:_beli.md` — Mermaid state machine showing perception → belief update → change detection → deliberation → plan adoption cycle. **Read when** understanding the core BDI loop or implementing agent control flow.

- `diagrams/02_flowchart_plan_selection_pipeline:_from_.md` — Flowchart from triggering event through plan library matching, context filtering, and execution. **Read when** designing plan selection logic or debugging why wrong plans are chosen.

- `diagrams/03_sequenceDiagram_resource-bounded_rationality:_.md` — Sequence diagram showing deliberation bottleneck: world state, agent computation, execution window, event monitoring. **Read when** analyzing time budget constraints or deliberation overhead.

- `references/commitment-strategies-and-reconsideration.md` — Formal framework for when agents should maintain vs. abandon commitments; temporal dynamics of mental attitudes. **Read when** choosing blind vs. open-minded commitment or tuning reconsideration triggers.

- `references/decision-trees-to-symbolic-reasoning.md` — Bridge between quantitative decision theory and symbolic BDI architectures; transformation from logic to practical reasoning. **Read when** converting formal specifications into executable agent code.

- `references/failure-modes-complex-agent-systems.md` — Blind agent problem, zombie plans, thrashing; implicit warnings about incomplete BDI specifications. **Read when** debugging agent misbehavior or preventing commitment failures.

- `references/option-generation-problem-filtering.md` — Computational bottleneck in applicability checking; search vs. pattern matching trade-offs for real-time performance. **Read when** optimizing plan candidate filtering or facing deliberation latency.

- `references/plans-as-knowledge-compilation.md` — Plans as compiled reasoning; why BDI logic is uncomputable and how plan libraries solve it. **Read when** designing plan library structure or understanding why pre-compilation matters.

- `references/resource-bounded-rationality-three-attitudes.md` — Why beliefs + desires alone fail; necessity of intentions for real-time dynamic environments. **Read when** justifying three-component architecture or comparing to two-attitude systems.

- `references/theory-practice-gap-practical-approximation.md` — Principled approximation strategies; gap between ideal rationality and implementable systems. **Read when** making trade-off decisions or documenting what is sacrificed vs. gained.

## Quality Gates

- [ ] Commitment strategy explicitly selected based on environment volatility, goal clarity, and computation budget
- [ ] "Potentially significant change" detection rules defined with specific triggering conditions
- [ ] Plan library indexed for sub-second option generation in target domain
- [ ] Belief-intention consistency checks prevent impossible commitments
- [ ] Deliberation process filters desires for mutual compatibility before intention adoption
- [ ] Reconsideration frequency measured and falls within acceptable bounds (not thrashing, not zombie)
- [ ] Plan preconditions accurately reflect real-world applicability conditions
- [ ] Resource constraints (time, memory, network) explicitly modeled in architecture
- [ ] Failure modes have monitoring and recovery procedures
- [ ] Abstract interpreter semantics preserved despite implementation approximations

## Not-For Boundaries

**Do NOT use BDI for**:
- **Static optimization problems** → Use mathematical programming instead
- **Pure reactive control** → Use behavior-based architectures instead  
- **Domains requiring provable optimality** → Use decision theory or game theory instead
- **Systems with unlimited computation time** → Use classical planning instead

**Delegate to other skills**:
- **For multi-agent coordination** → Use distributed consensus protocols instead
- **For learning and adaptation** → Use reinforcement learning architectures instead
- **For uncertainty quantification** → Use probabilistic reasoning frameworks instead
- **For real-time guarantees** → Use real-time systems design instead