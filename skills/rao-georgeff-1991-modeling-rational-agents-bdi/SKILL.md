---
license: Apache-2.0
name: rao-georgeff-1991-modeling-rational-agents-bdi
description: >-
  Formal framework for modeling intelligent agents through Beliefs, Desires/Goals, and Intentions as distinct mental
  states with rigorous semantics
metadata:
  category: Research & Academic
  tags:
    - bdi
    - agents
    - theory
    - rational-agency
    - formal-methods
  io-contract:
    kind: none
    covers:
      - BDI agent architecture formalism
      - Beliefs, Desires, Intentions as distinct mental attitudes
      - Commitment strategies and persistence axioms
      - Intention-goal independence and side-effects problem
      - Multi-agent coordination semantics
      - Branching time and intention-worlds semantics
allowed-tools: Read,Write,Edit,Glob,Grep
---

# SKILL: BDI Agent Architecture

**Name:** BDI Rational Agent Design  
**Description:** Formal framework for modeling intelligent agents through Beliefs, Desires/Goals, and Intentions as distinct mental states with rigorous semantics  
**Author/Source:** Anand S. Rao & Michael P. Georgeff (1991)  
**Activation triggers:** agent architecture, intelligent systems, commitment reasoning, intention modeling, action planning, side-effects problem, goal decomposition, multi-agent systems, autonomous behavior

## DECISION POINTS

### Primary Decision Tree: Commitment Strategy Selection
```
Environment Stability Assessment:
├─ STABLE environment + HIGH resources
│  └─ Choose BLIND commitment (AI₁)
│     • Persist until believed achieved
│     • Maximize goal completion
├─ UNSTABLE environment + LIMITED resources  
│  └─ Choose SINGLE-MINDED commitment (AI₂)
│     • Drop if impossible OR achieved
│     • Balance persistence with realism
└─ HIGHLY DYNAMIC + EXPLORATORY goals
   └─ Choose OPEN-MINDED commitment (AI₃)
      • Drop if no longer desired OR achieved
      • Track changing preferences

Goal Decomposition Decision Tree:
├─ PRIMITIVE action (under agent control)
│  └─ INTEND(does(action)) → guarantees execution
├─ ACHIEVEMENT goal (world determines outcome)
│  └─ INTEND(achievement) → guarantees attempt only
└─ COMPLEX goal requiring subgoals
   ├─ IF sequential: INTEND(q) before INTEND(p) where q enables p
   └─ IF disjunctive: Choose specific branch to commit to

Side-Effects Resolution:
├─ BELIEVE(action → wanted_effect AND unwanted_effect)
│  └─ Can INTEND(does(action)) without INTEND(unwanted_effect)
│     • Intention-worlds select specific branches
│     • Avoid closure under believed implications
└─ Multiple paths to same goal
   └─ Select path minimizing unwanted side-effects
```

### Multi-Agent Coordination Decision Tree
```
Other Agent's Mental States:
├─ What I BELIEVE they INTEND
│  └─ Plan coordination assuming their commitment
├─ What I INTEND regarding their actions
│  └─ My commitment to outcomes involving them
└─ Commitment conflicts detected
   ├─ IF my commitment is stronger → maintain, negotiate
   └─ IF their commitment is stronger → revise, delegate
```

## FAILURE MODES

### 1. **Intention-Goal Collapse**
**Detection:** If you find yourself saying "intention = persistent goal" or treating INTEND(p) as equivalent to GOAL(p) + high_priority.

**Diagnosis:** Missing the independence of mental attitudes. Intentions have separate persistence conditions from goals.

**Fix:** Implement separate axioms for each attitude. An agent can intend something while no longer desiring it (obligation case) or desire something while not committing to it (wish case).

### 2. **Logical Closure Trap**
**Detection:** If BELIEVE(p → q) AND INTEND(p) forces INTEND(q), creating unwanted commitments to side-effects.

**Diagnosis:** Treating intentions as closed under logical entailment instead of using sub-world compatibility.

**Fix:** Apply geometric constraints: intention-worlds are sub-worlds of belief-worlds. You intend specific branches, not entire logical consequences.

### 3. **Wrong Commitment Strategy**
**Detection:** Agent gives up too easily (needed blind commitment) or persists irrationally (needed open-minded commitment).

**Diagnosis:** Mismatched persistence axiom for environmental demands.

**Fix:** Reassess environment stability and resource constraints. Switch axioms: AI₁ for stable/high-resource, AI₂ for collaborative/resource-limited, AI₃ for dynamic/exploratory.

### 4. **Action-Result Confusion**
**Detection:** Treating failed outcomes as defective intentions when environmental factors prevented success.

**Diagnosis:** Confusing volitional commitment (does(action)) with result achievement (succeeds(action)).

**Fix:** Apply AI₄ correctly: INTEND(does(e)) guarantees execution, but INTEND(achieves(goal)) only guarantees attempt.

### 5. **Branch-World Conflation**
**Detection:** Using branching time to represent epistemic uncertainty instead of choice options.

**Diagnosis:** Collapsing two-dimensional structure (choices within worlds, uncertainty across worlds).

**Fix:** Separate optional/inevitable (branch quantification within worlds) from BEL/GOAL/INTEND (world quantification across epistemic alternatives).

## WORKED EXAMPLES

### Example 1: Multi-Agent Coordination with Commitment Revision

**Scenario:** Two autonomous robots (A and B) must coordinate to move a heavy table. Initially, both have GOAL(table_moved) and different movement strategies.

**Initial State:**
- Robot A: BELIEVE(I_can_push_alone), GOAL(table_moved), INTEND(push_from_north)
- Robot B: BELIEVE(need_coordination), GOAL(table_moved), INTEND(coordinate_with_A)

**Decision Point Navigation:**
1. **Environment Assessment:** Dynamic (robots moving), limited resources (both needed)
2. **Commitment Strategy:** Single-minded (AI₂) - drop if impossible, maintain if achievable
3. **New Information:** A discovers table is heavier than expected - BELIEVE(¬I_can_push_alone)

**Expert vs. Novice:**
- **Novice:** Drops INTEND(push_from_north), starts new planning from scratch
- **Expert:** Maintains GOAL(table_moved), revises strategy to INTEND(coordinate_with_B), leverages B's existing coordination intention

**Resolution:** A adopts compatible sub-goal INTEND(push_while_B_pulls), maintaining higher-level commitment while adapting method.

### Example 2: Side-Effect Handling in Medical Diagnosis

**Scenario:** Diagnostic AI system must recommend treatment knowing it causes side-effects.

**Setup:**
- BELIEVE(chemotherapy → tumor_shrinkage AND nausea AND fatigue)
- GOAL(tumor_shrinkage)
- Patient explicitly states: NOT GOAL(nausea)

**Decision Tree Navigation:**
```
Treatment recommendation:
├─ Can INTEND(prescribe_chemotherapy) 
│  ├─ WITHOUT intending nausea (sub-world selection)
│  └─ WITH explicit management plan for side-effects
└─ Must inform about side-effects (belief obligation)
   └─ But not commit to wanting them (goal independence)
```

**Critical Insight:** The system intends the specific branch where chemotherapy achieves tumor shrinkage with minimal nausea (through sub-world selection), not the entire logical closure including all side-effects.

**Alternative Strategies Considered:**
- Lower-dose regimen (BELIEVE(lower_dose → less_shrinkage AND less_nausea))
- Combination therapy (BELIEVE(chemo+anti_nausea → shrinkage AND reduced_nausea))
- Sequential treatment (INTEND(try_alternatives_first))

### Example 3: Commitment Revision Under Resource Constraints

**Scenario:** Autonomous research assistant managing multiple paper deadlines with computation budget.

**Initial Commitments:**
- INTEND(finish_paper_A_by_deadline) [requires 100 GPU hours]
- INTEND(finish_paper_B_by_deadline) [requires 80 GPU hours]  
- BELIEVE(available_GPU_hours = 120)

**Crisis Point:** Halfway through, budget reduced to 60 hours total.

**Strategy Comparison:**
- **Blind Commitment (AI₁):** Maintain both intentions despite impossibility
- **Single-minded (AI₂):** Drop one intention, focus resources
- **Open-minded (AI₃):** Re-evaluate which paper is still desired more

**Expert Decision Process:**
1. **Impossibility Recognition:** BELIEVE(¬(finish_A AND finish_B))
2. **Goal Prioritization:** Reassess GOAL rankings based on impact
3. **Resource Allocation:** Choose INTEND(finish_A) OR INTEND(finish_B), not both
4. **Fallback Planning:** Develop INTEND(submit_preliminary_results) for dropped paper

**Trade-off Analysis:** Single-minded commitment chosen because collaboration context requires reliability (better to deliver one complete paper than two incomplete ones).

## Reference Files

- `diagrams/01_stateDiagram-v2_bdi_mental_state_transitions_&.md` — State machine showing BDI mental state transitions across belief/goal/intention updates and commitment strategy branches. **Read when** designing agent lifecycle or debugging intention persistence logic.

- `diagrams/02_flowchart_goal_decomposition_&_side-effe.md` — Decision flowchart for goal decomposition, commitment strategy selection, and side-effects reasoning. **Read when** implementing goal adoption or intention revision rules.

- `diagrams/03_mindmap_bdi_conceptual_hierarchy_&_mod.md` — Hierarchical map of BDI mental states, possible-worlds structure, and modal logic operators. **Read when** understanding conceptual relationships or explaining BDI architecture overview.

- `references/avoiding-logical-omniscience-closure-problems.md` — Explains how BDI's sub-world geometry prevents forced goals from inevitable beliefs. **Read when** debugging over-commitment or unwanted side-effect intentions.

- `references/branching-time-choice-vs-epistemic-uncertainty.md` — Separates epistemic uncertainty (agent's knowledge) from branching time (agent's choices). **Read when** modeling decision trees or multi-path planning.

- `references/commitment-strategies-as-persistence-axioms.md` — Formalizes blind, single-minded, and open-minded commitment as axioms governing intention persistence. **Read when** selecting or implementing commitment strategy for environment stability.

- `references/intention-to-action-volitional-commitment.md` — Axiom AI₄ linking intention-to-do with actual execution; distinguishes intending-to-do from intending-to-succeed. **Read when** implementing action execution or handling execution failures.

- `references/problem-decomposition-through-world-branching.md` — Implicit theory of decomposition as progressive branch selection through belief→goal→intention hierarchy. **Read when** breaking complex goals into subgoals or sequencing dependent intentions.

- `references/sub-world-compatibility-solves-side-effects.md` — Geometric solution: intention-worlds ⊆ belief-worlds allows intending goals without intending all logical consequences. **Read when** resolving side-effects problem or avoiding unwanted commitments.

- `references/when-bdi-formalism-applies-and-when-it-breaks.md` — Boundary conditions: discrete time, deterministic actions, rational agents, stable goals. **Read when** assessing whether BDI applies to your domain or debugging failures outside assumptions.

## QUALITY GATES

- [ ] Mental state consistency verified: No INTEND(p) without GOAL(p), no GOAL(p) without BELIEVE(optional(p))
- [ ] Sub-world constraints properly applied: Intention-worlds are geometric subsets of goal-worlds, which are subsets of belief-worlds
- [ ] Commitment strategy axioms explicitly chosen and justified for environment type
- [ ] Side-effects handling verified: No unwanted logical closure from BELIEVE(p→q) + INTEND(p) to INTEND(q)
- [ ] Action vs. achievement distinction maintained: does(e) vs. succeeds(e) commitments clearly separated
- [ ] Temporal persistence rules defined: Conditions for maintaining/dropping intentions over time specified
- [ ] Branch vs. world semantics correct: optional/inevitable within worlds, BEL/GOAL/INTEND across worlds
- [ ] Volitional commitment axiom (AI₄) properly implemented: INTEND(does(e)) guarantees execution
- [ ] Goal decomposition strategy validates: Complex intentions broken into achievable sub-intentions
- [ ] Multi-agent coordination model specified: Own intentions vs. beliefs about others' intentions distinguished

## NOT-FOR BOUNDARIES

**Do NOT use BDI for:**
- **Pure reactive systems** → Use subsumption architecture or behavior trees instead
- **Learning-based agents** → Use reinforcement learning or neural architectures; BDI assumes fixed logical rules
- **Real-time hard constraints** → BDI deliberation may be too slow; use real-time scheduling algorithms
- **Resource optimization problems** → Use operations research methods; BDI doesn't model resource consumption
- **Pattern recognition tasks** → Use machine learning; BDI is for deliberative reasoning about commitments
- **Emotional or social reasoning** → Use affective computing models; BDI covers only belief-goal-intention attitudes

**Delegate to other skills:**
- For planning algorithms: Use classical STRIPS/PDDL planners
- For multi-agent negotiation: Use game theory or auction mechanisms  
- For uncertainty quantification: Use Bayesian networks or Dempster-Shafer theory
- For temporal reasoning: Use temporal logic or constraint satisfaction
- For learning from experience: Use reinforcement learning or case-based reasoning

**Integration boundaries:**
- BDI provides the **semantic foundation** for deliberative commitment
- Build **procedural layers** (plan libraries, execution monitoring) on top
- Interface with **reactive layers** below for real-time response
- Combine with **learning systems** that update beliefs and goals over time