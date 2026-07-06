---
license: Apache-2.0
name: bordini-hubner-2007-jason
description: Jason multi-agent platform implementing AgentSpeak(L) for practical BDI agent programming and deployment
metadata:
  category: Research & Academic
  tags:
    - jason
    - bdi
    - agents
    - multi-agent-systems
    - agentspeak
  io-contract:
    kind: deliverable
    produces:
      - kind: design-doc
        description: >-
          BDI agent architecture decision framework covering plan selection strategies, failure recovery matrices, and
          coordination protocols for multi-agent systems
        format: markdown
      - kind: code
        description: >-
          AgentSpeak(L) agent implementations demonstrating belief-desire-intention programming patterns, plan context
          conditions, and reactive-proactive behavior
        language: agentspeak
      - kind: critique
        description: >-
          Analysis of common BDI implementation pitfalls (monolithic plans, belief staleness, goal cascades,
          communication deadlocks, context pollution) with diagnostic rules and remediation strategies
        format: markdown
      - kind: refactor-plan
        description: >-
          Guidance for decomposing procedural multi-agent logic into declarative BDI plans with appropriate context
          guards and failure handlers
        format: markdown
allowed-tools: Read,Write,Edit,Glob,Grep
---

# SKILL: Programming Multi-Agent Systems with BDI Architecture

## When to Use This Skill

Load this skill when facing challenges involving:
- Goal-directed autonomy where systems determine HOW to achieve objectives
- Dynamic replanning when paths are blocked requiring alternative approaches
- Reactive-proactive integration balancing deliberation with responsiveness
- Distributed coordination between autonomous entities
- Context-sensitive behavior where goals require different implementations
- Cascading failure handling where low-level failures trigger high-level recovery

## Decision Points

### Plan Selection Strategy Tree

```
Triggering Event Occurs:
├── Single applicable plan?
│   └── Execute immediately
├── Multiple applicable plans?
│   ├── Context conditions differ? → Select first applicable (specificity order)
│   ├── All contexts true? → Apply selection heuristics:
│   │   ├── Success rate (prior execution history) → Choose highest
│   │   ├── Cost estimate (resource requirements) → Choose lowest
│   │   └── Recency (when last used) → Choose most recent
│   └── Priority conflicts? → Use plan annotation weights
└── No applicable plans?
    ├── Generate failure event (-!goal)
    └── Check for failure handlers

Communication Coordination Decision:
├── Information sharing needed?
│   ├── One-way update → .send(agent, tell, belief)
│   ├── Query response → .send(agent, askOne, query)
│   └── Complete knowledge → .send(agent, askAll, query)
├── Work delegation needed?
│   ├── Agent capable? → .send(agent, achieve, goal)
│   ├── Agent unknown? → Broadcast achieve request
│   └── Critical task? → Send with timeout handling
└── Coordination protocol?
    ├── Sequential handoff → Chain achieve messages
    ├── Parallel execution → Multiple concurrent achieves
    └── Consensus needed → Negotiation protocol
```

### Failure Recovery Decision Matrix

| Failure Type | Detection Rule | Recovery Strategy |
|-------------|----------------|-------------------|
| Action failure | Action returns error/timeout | Try remaining plan body, then backtrack |
| Context invalidated | Context query becomes false | Switch to alternative plan for same goal |
| Goal impossible | All plans exhausted | Propagate failure to parent goal |
| Communication failure | Send timeout/agent unavailable | Retry with alternative agents or methods |
| Belief inconsistency | Contradictory percepts | Trigger belief revision or conflict resolution |

## Failure Modes

### 1. Monolithic Plan Bodies (Procedural Thinking)
**Symptom**: Plans contain complex conditionals handling multiple cases
**Detection Rule**: If plan body has >3 if-then branches based on beliefs
**Diagnosis**: Programmer thinking procedurally instead of declaratively
**Fix**: Split into separate plans with different context conditions

### 2. Belief Staleness Loops (World-Model Drift)
**Symptom**: Agent repeatedly selects inapplicable plans or wrong behaviors
**Detection Rule**: If same plan fails >3 times consecutively with same context
**Diagnosis**: Beliefs not synchronized with world state changes
**Fix**: Add perception updating plans and belief revision guards

### 3. Goal Cascade Explosions (Uncontrolled Decomposition)
**Symptom**: System generates exponentially growing subgoals or infinite recursion
**Detection Rule**: If intention stack depth >10 or same goal readopted cyclically
**Diagnosis**: Missing termination conditions or circular goal dependencies
**Fix**: Add cycle detection guards and base case plans

### 4. Communication Deadlocks (Synchronous Assumption)
**Symptom**: Agents waiting indefinitely for responses that never come
**Detection Rule**: If .send() followed by blocking wait without timeout
**Diagnosis**: Treating asynchronous communication as synchronous RPC
**Fix**: Add timeout handling and alternative response plans

### 5. Context Pollution (Over-Specific Guards)
**Symptom**: No plans applicable despite reasonable belief state
**Detection Rule**: If events generated but no plans selected repeatedly
**Diagnosis**: Context conditions too restrictive or beliefs incomplete
**Fix**: Add default catch-all plans with "true" context

## Worked Examples

### Example: Autonomous Package Delivery Robot

**Scenario**: Robot must deliver package to Building B, Room 205.

**Initial State**: 
- Beliefs: `at(lobby_A)`, `battery(90)`, `hasPackage(pkg123)`
- Goal adoption: `+!deliver(pkg123, building_B, room_205)`

**Decision Process**:

1. **Plan Selection**: Event `+!deliver(pkg123, building_B, room_205)` triggers plan search
   - Plan A context: `battery(X) & X > 80` ✓
   - Plan B context: `battery(X) & X < 30` ✗ 
   - Plan C context: `true` ✓
   - **Select Plan A** (most specific applicable)

2. **Plan A Execution**: 
   ```
   +!deliver(Pkg, Building, Room) : battery(X) & X > 80 <-
       !navigate(Building);
       !findRoom(Room);
       !handover(Pkg).
   ```

3. **Subgoal Decomposition**: `!navigate(building_B)` triggers navigation plans
   - Context check: `hasMap(building_B)` → False
   - Select fallback: `!requestDirections(building_B)`

4. **Dynamic Replanning**: During navigation, belief update `+obstacle(hallway_3)`
   - Current plan: `followRoute(route_1)` 
   - Context invalidated: route blocked
   - **Automatic replan**: Select alternative route plan

5. **Failure Handling**: `!handover(pkg123)` fails (recipient absent)
   - Generates failure event: `-!handover(pkg123)`
   - Failure handler triggered: 
   ```
   -!handover(Pkg) <- !findAlternateRecipient(Pkg); !handover(Pkg).
   ```

**Novice vs Expert Differences**:
- **Novice**: Would write single monolithic navigation function with all cases
- **Expert**: Encodes multiple context-sensitive plans allowing dynamic adaptation
- **Novice**: Would treat failures as exceptions requiring global error handling  
- **Expert**: Designs cascading failure handlers at appropriate abstraction levels

## Reference Files

- `diagrams/01_flowchart_bdi_reasoning_cycle.md` — Mermaid flowchart of the BDI perception-event-plan-execution cycle. **Read when** understanding how agents perceive, generate events, select plans, and execute actions.
- `diagrams/02_sequenceDiagram_multi-agent_coordination_via_s.md` — Sequence diagram showing multi-agent coordination via speech acts (tell, askOne, achieve). **Read when** designing agent-to-agent communication protocols.
- `diagrams/03_stateDiagram-v2_plan_execution_&_failure_recov.md` — State machine for plan execution, failure detection, and recovery transitions. **Read when** implementing failure handlers and plan backtracking logic.
- `references/context-driven-plan-selection.md` — Explains how AgentSpeak encodes procedural knowledge as context-sensitive plan libraries instead of monolithic procedures. **Read when** designing plan libraries with multiple applicable plans for the same goal.
- `references/goal-subgoal-decomposition.md` — Covers hierarchical goal decomposition and intentions as dynamic execution stacks. **Read when** breaking complex goals into subgoals or managing goal cascades.
- `references/graceful-failure-and-recovery.md` — Discusses plan failure inevitability and cascading recovery strategies. **Read when** designing failure handlers and alternative plan selection.
- `references/knowledge-level-communication.md` — Explains speech acts and mental state coordination beyond byte-passing. **Read when** implementing agent communication for cooperation and coordination.
- `references/procedural-knowledge-encoding.md` — Distinguishes know-how (procedural) from know-that (declarative) and the plan library paradigm. **Read when** converting domain procedures into AgentSpeak plans.
- `references/reactive-proactive-integration.md` — Addresses integrating reactive stimulus-response with proactive goal-driven behavior. **Read when** balancing event-driven and goal-driven agent behavior.

## Quality Gates

- [ ] Each goal has at least 2 plans with different contexts
- [ ] Every plan has explicit failure handler or alternative
- [ ] All belief updates trigger relevant reactive plans
- [ ] Communication includes timeout and failure handling
- [ ] No plan body contains complex conditional logic (>3 branches)
- [ ] Context conditions are testable and mutually exclusive where intended
- [ ] Goal decomposition has clear termination conditions
- [ ] Intention stack depth bounded (detect cycles)
- [ ] All external actions have error handling plans
- [ ] Plan library coverage verified for common scenarios

## NOT-FOR Boundaries

**Do NOT use this skill for**:
- Simple event-driven systems → Use basic event handlers instead
- Stateless request-response APIs → Use REST/microservices instead  
- Deterministic workflows → Use process orchestration tools instead
- Real-time control loops → Use control theory/embedded systems instead
- Large language model agents → Use prompt engineering patterns instead

**When to delegate**:
- For distributed consensus → Use consensus algorithms like Raft
- For load balancing → Use container orchestration tools  
- For data processing → Use stream processing frameworks
- For user interfaces → Use reactive UI frameworks
- For machine learning → Use ML pipeline tools

This skill is specifically for programming autonomous agents that must pursue goals while adapting to changing conditions through plan selection and failure recovery.