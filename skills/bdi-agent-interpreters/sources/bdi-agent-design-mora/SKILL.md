---
license: Apache-2.0
name: bdi-agent-design-mora
description: Design patterns for BDI agents using the MORA methodology for practical multi-agent system development
metadata:
  category: Research & Academic
  tags:
    - bdi
    - agents
    - design-patterns
    - mora
    - architecture
  io-contract:
    kind: deliverable
    produces:
      - kind: design-doc
        description: >-
          BDI agent architecture specification using Extended Logic Programming with operational semantics, including
          belief revision rules, intention commitment mechanisms, and deliberation triggers
        format: markdown
      - kind: code
        description: >-
          Executable BDI agent implementation in Extended Logic Programming (Prolog-based) with paraconsistent negation,
          conflict resolution procedures, and intention persistence logic
        language: prolog
      - kind: diagram
        description: >-
          Decision flow diagrams for intention revision triggers, negation strategy selection, and conflict resolution
          approaches in multi-agent deliberation cycles
        format: svg
      - kind: critique
        description: >-
          Analysis of theory-practice gaps in proposed BDI system design, identifying failure modes (perpetual
          re-deliberation, negation conflation, contradiction handling) and recommending fixes
        format: markdown
allowed-tools: Read,Write,Edit,Glob,Grep
---

# BDI Agent Design (Móra et al.)

**Skill ID**: `bdi-agent-design-mora`  
**Version**: 1.0  
**Author**: Based on "BDI Models and Systems: Reducing the Gap" by Móra, Lopes, Viccari, and Coelho  
**Activation Triggers**: BDI architecture, agent systems, intention reasoning, belief-desire-intention, operational semantics, agent deliberation, commitment mechanisms, rational agents

## Description

Design and implement rational agent systems using the Beliefs-Desires-Intentions (BDI) paradigm with executable semantics. This skill bridges the theory-practice gap by using Extended Logic Programming with paraconsistent semantics as both formal specification AND reasoning engine.

## When to Use This Skill

Load this skill when facing:
- **Theory-practice gaps**: Formal agent specifications that can't be executed, or implemented systems lacking formal grounding
- **Commitment modeling**: Designing how agents maintain intentions over time without perpetual re-deliberation
- **Desire conflicts**: Systems where goals naturally contradict and agents must choose rationally among competing objectives
- **Deliberation control**: Determining when agents should reconsider commitments vs. persist with current plans
- **Belief revision**: Handling contradictory information or discovering beliefs incompatible with intentions
- **Practical rationality**: Building agents that make "good enough" decisions with bounded computational resources

## Decision Points

### Core Architecture Choice
```
IF building theoretical specification OR formal verification required
├─ Use axiomatic modal/temporal BDI logics (Cohen & Levesque, Rao & Georgeff)
└─ Accept theory-implementation gap

IF building executable agent system
├─ Use Extended Logic Programming with operational semantics
└─ Formal specification IS the reasoning engine
```

### Intention Revision Triggers
```
IF action completes/fails
├─ Remove completed intentions from commitment set
├─ Check if failure makes other intentions impossible
└─ Filter satisfied desires from candidate pool

IF deadline reached
├─ Remove expired intentions
├─ Re-evaluate previously delayed desires
└─ Trigger replanning for dependent actions

IF belief-intention contradiction detected
├─ IF abduction can find missing preconditions → revise beliefs
└─ IF intention truly impossible → abandon intention

IF higher-priority desire becomes feasible
├─ IF conflicts with current intentions → trigger deliberation
└─ IF compatible → adopt without disrupting commitments

IF no trigger condition met
└─ Maintain current intentions (commitment persistence)
```

### Negation Strategy Selection
```
IF representing "agent actively believes/desires X is false"
└─ Use explicit negation: ¬P

IF querying "is there evidence for X?"
└─ Use negation-by-failure: not P

IF detecting conflicts between mental states
├─ Need explicit negation for: desire(P) ∧ desire(¬P)
└─ Negation-by-failure cannot detect this contradiction
```

### Conflict Resolution Approach
```
IF desires directly contradict (P ∧ ¬P)
├─ Apply priority ordering
└─ Keep higher-priority desire, remove lower

IF desires have incompatible resource requirements
├─ Use abduction to test joint feasibility
├─ IF multiple consistent subsets exist → apply maximality preference
└─ IF no consistent subset → escalate to user/higher-level goal

IF paraconsistent contradiction detected
├─ Trigger minimal revision procedure
├─ Restore consistency through preference-guided removal
└─ Use contradiction as deliberation input, not error condition
```

## Failure Modes

### **Modal Logic Without Proof Procedures**
**Detection**: Elegant BDI specifications exist but implementation uses ad-hoc data structures with no resemblance to specification  
**Root Cause**: Choosing specification formalisms that cannot execute  
**Fix**: Use formalisms where specification IS executable (Extended Logic Programming) or commit to mechanized modal logic with runtime theorem proving

### **Negation Conflation**
**Detection**: System uses only `not P` for both "unknown" and "actively false"; cannot represent negative intentions like "intend NOT to interrupt user"  
**Root Cause**: Treating negation-by-failure as sufficient for all negative information  
**Fix**: Use explicit negation `¬P` for affirmative negative knowledge; reserve `not P` for closed-world queries

### **Perpetual Re-deliberation**
**Detection**: Agent recalculates optimal intentions every cycle; never executes plans longer than one decision cycle; high CPU usage in deliberation  
**Root Cause**: No commitment mechanism; treating all desires as immediate commands  
**Fix**: Implement trigger-based revision with explicit commitment constraints; intentions persist between triggers

### **Contradiction Crashes**
**Detection**: System enters undefined state or throws exceptions when desires conflict; requires pre-filtering desires for consistency  
**Root Cause**: Classical logic semantics where contradictions make everything provable  
**Fix**: Use paraconsistent semantics (WFSX) where contradictions are detectable signals triggering deliberation

### **Combinatorial Preference Explosion**
**Detection**: System generates all possible consistent desire subsets then applies preference; exponential slowdown with desire set size  
**Root Cause**: Treating preference as post-processing filter rather than search guidance  
**Fix**: Integrate preference into revision procedure; guide search toward preferred revisions without enumerating all possibilities

### **Beliefs and Intentions in Separate Systems**
**Detection**: Belief reasoner separate from intention manager; manual synchronization required; no integrated feasibility checking  
**Root Cause**: Representing beliefs and intentions in independent systems with no unified semantics  
**Fix**: Represent beliefs and intentions in the same logical framework (ELP); unified revision mechanisms enable integrated consistency checking and abductive reasoning

## Worked Examples

### Example 1: Belief-Intention Contradiction Resolution

**Scenario**: Household robot intends to `serve_coffee` but discovers `coffee_maker_broken`.

```prolog
% Initial state
belief(coffee_maker_broken).
intention(serve_coffee).
action_precondition(serve_coffee, working_coffee_maker).

% Contradiction detection (paraconsistent semantics)
contradiction :- 
    intention(serve_coffee),
    belief(coffee_maker_broken),
    action_precondition(serve_coffee, working_coffee_maker),
    not belief(working_coffee_maker).

% Abductive feasibility check
missing_precondition(X) :-
    intention(A), action_precondition(A, X),
    not belief(X), not belief(¬X).

% Option 1: Abandon intention
revised_intentions_1([]) :- contradiction.

% Option 2: Abductive belief revision (find alternative)
revised_beliefs_2([belief(use_instant_coffee), belief(working_instant_dispenser)]) :-
    contradiction,
    alternative_action(serve_coffee, use_instant_coffee),
    abducible(working_instant_dispenser).
```

**Decision Process**: (1) Contradiction detected → trigger deliberation. (2) Check abductive alternatives → instant coffee possible. (3) Preference evaluation → satisfying desire preferred over abandoning. (4) Revise beliefs, maintain intention.

**Novice Miss**: Abandons intention immediately without checking alternatives  
**Expert Catch**: Uses abduction to find feasible alternative means to same end

### Example 2: Competing Desire Deliberation

**Scenario**: Personal assistant agent with conflicting scheduling desires.

```prolog
desire(schedule_meeting(client_A, 2pm)).
desire(¬schedule_meeting(client_A, 2pm)).  % Explicit negation - active aversion
desire(schedule_workout(2pm)).

priority(schedule_meeting(client_A, 2pm), 8).
priority(schedule_workout(2pm), 6).

conflicts(schedule_meeting(client_A, 2pm), schedule_workout(2pm)) :- 
    same_time_slot(2pm, 2pm).

% Paraconsistent contradiction detection
find_contradictions([(desire(P), desire(¬P)) | Rest]) :-
    desire(P), desire(¬P), find_contradictions(Rest).

% Priority-based resolution
resolve_by_priority([(desire(P), desire(¬P))], [desire(P)]) :-
    priority(P, X), priority(¬P, Y), X > Y.
```

**Decision Process**: (1) Explicit negation detects desire(schedule_meeting) ∧ desire(¬schedule_meeting). (2) Priority resolution: meeting (8) beats ¬meeting. (3) Resource check: meeting conflicts with workout. (4) Adopt schedule_meeting(client_A, 2pm), reject others.

**Novice Miss**: Uses only negation-by-failure, missing the explicit aversion  
**Expert Catch**: Recognizes explicit negative desires as different from mere absence

### Example 3: Commitment Persistence Under Temptation

**Scenario**: Study assistant maintains focus intention despite social media desires.

```prolog
committed_intention(study_mathematics, until(exam_complete)).
committed_intention(¬use_social_media, until(study_session_end)).

desire(check_facebook).
desire(browse_instagram).

conflicts_with_commitment(X) :-
    committed_intention(¬X, Until),
    \+ condition_met(Until).

trigger_deliberation :-
    (action_completed(_) ; deadline_reached(_) ; impossibility_detected(_)).

current_intentions(Result) :-
    \+ trigger_deliberation,
    findall(I, committed_intention(I, _), Result).
```

**Decision Process**: (1) New desires arise but no trigger condition met. (2) Commitment constraints block social media desires. (3) Study intentions persist without re-evaluation.

**Novice Miss**: Re-evaluates all desires, breaking commitment  
**Expert Catch**: Commitment means NOT reconsidering unless specific triggers fire

## Quality Gates

- [ ] Contradiction detection uses paraconsistent semantics (can detect P ∧ ¬P without system failure)
- [ ] Explicit negation distinguished from negation-by-failure (represents both "actively false" and "unknown")
- [ ] Commitment persistence prevents arbitrary re-deliberation (intentions persist unless trigger conditions met)
- [ ] Abductive feasibility checking available for intention adoption (detects missing preconditions before commitment)
- [ ] Trigger conditions explicitly specified for deliberation (action completion, deadlines, impossibility, higher-priority opportunities)
- [ ] Preference ordering integrated into revision procedure (guides search, doesn't post-filter all options)
- [ ] Beliefs and intentions represented in same logical framework (enables integrated consistency checking)
- [ ] Minimal revision procedures prefer smaller changes (stability over arbitrary change)
- [ ] Resource conflict detection prevents incompatible simultaneous intentions
- [ ] Deliberation termination criteria prevent infinite reconsideration loops

## Reference Files

- `diagrams/01_stateDiagram-v2_bdi_agent_mental_state_lifecyc.md` — Mermaid state diagram showing belief acquisition, desire formation, consistency checks, and intention adoption cycles. **Read when** designing the mental state transitions of a BDI agent.

- `diagrams/02_flowchart_deliberation_&_revision_proced.md` — Decision tree for deliberation triggers (inconsistency, action failure, deadline, belief change) and conflict resolution paths. **Read when** implementing deliberation logic or choosing negation/paraconsistent strategies.

- `diagrams/03_timeline_agent_execution_timeline_with_.md` — Timeline showing action execution, trigger evaluation, and conditional deliberation phases. **Read when** modeling agent execution cycles and when deliberation should fire.

- `references/abduction-as-intention-feasibility-check.md` — How agents use abduction to verify intentions are achievable before commitment, avoiding impossible goals. **Read when** designing belief revision or intention filtering logic.

- `references/computational-commitment-through-revision-constraints.md` — Making commitment operational by filtering future intentions through revision constraints. **Read when** implementing intention persistence and preventing perpetual re-deliberation.

- `references/desires-as-search-space-not-commands.md` — Distinguishing desires (candidate goals) from intentions (committed goals) and structuring deliberation before commitment. **Read when** architecting goal-driven systems or designing desire-to-intention filtering.

- `references/event-calculus-as-operational-time-and-action-model.md` — Using event calculus for temporal reasoning in BDI agents (durative goals, action consequences, deadline detection). **Read when** adding time-dependent reasoning or deadline-triggered deliberation.

- `references/preference-over-consistency-restoring-revisions.md` — Encoding deliberation policy by ranking multiple conflict-resolution options. **Read when** multiple consistent subsets exist and agent must choose rationally among them.

- `references/revision-mechanisms-as-non-monotonic-deliberation.md` — How paraconsistent logic enables deliberation with contradictory desires before commitment. **Read when** handling conflicting goals or designing non-monotonic reasoning.

- `references/triggers-and-attention-in-committed-agents.md` — Balancing commitment persistence against responsiveness; when deliberation should be triggered. **Read when** tuning commitment strength or designing trigger conditions.

## NOT-FOR Boundaries

**This skill is NOT for**:
- **Pure theorem proving**: For formal verification without execution, use modal BDI logics instead
- **Reactive architectures**: For stimulus-response systems without deliberation, use `reactive-agent-patterns`
- **Multi-agent negotiation**: For inter-agent protocols, use `agent-communication-protocols`
- **Learning-based adaptation**: For goal adaptation via ML, use `reinforcement-learning-agents`
- **Real-time hard constraints**: Where deliberation latency is unacceptable, use `real-time-agent-scheduling`
- **Distributed consensus**: For coordinating intentions across agents, use `distributed-agent-coordination`

**Delegate when**: agent must learn new goals → `goal-learning-systems` | agents must coordinate plans → `multi-agent-planning` | environment fully observable/deterministic → `classical-planning-agents`

## Shibboleths: Recognizing Deep Understanding

**Surface-level says**: "BDI agents have beliefs, desires, and intentions as data structures" | "Commitment means intentions don't change" | "When desires conflict, pick the highest priority"

**Deep internalization recognizes**:
- **"The formalism's operational semantics determines whether the theory-implementation gap exists"**: Asks "what's the proof procedure?" before "what's the axiomatization?"
- **"Explicit negation enables conflict detection; negation-by-failure represents incomplete information"**: `desire(¬P)` (active aversion) is distinct from absence of `desire(P)` (indifference)
- **"Paraconsistent semantics make contradictions productive inputs to deliberation"**: Conflicting desires are the *reason* deliberation exists, not errors to prevent
- **"Commitment is operationalized through revision constraints, not persistence axioms"**: Can specify trigger conditions; explains how new intentions are checked against existing ones
- **"Preference over revisions encodes deliberation policy in the revision procedure itself"**: Priority graphs guide search without enumerating all consistent subsets

**The tell-tale question**: *"How does your agent detect when two desires conflict?"*

- **Hasn't internalized**: "We check if they're logically inconsistent" or "The planner fails when constraints contradict"
- **Has internalized**: "We use explicit negation (`desire(P)` and `desire(¬P)`), then paraconsistent semantics detect the contradiction as a signal invoking preference-ordered revision. Negation-by-failure alone can't detect this—absence of `desire(P)` isn't contradictory with `desire(P)`. We need affirmative representation of both positive and negative desires."

---

*Load reference files on-demand for detailed algorithms, proof procedures, and implementation patterns.*
