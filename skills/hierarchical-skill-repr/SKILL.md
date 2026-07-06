---
license: Apache-2.0
name: hierarchical-skill-repr
description: Representations for hierarchical skill structures including knowledge graphs and ontological decomposition
metadata:
  category: Research & Academic
  tags:
    - skill-representation
    - hierarchical
    - knowledge-graphs
    - decomposition
    - ontology
  io-contract:
    kind: deliverable
    produces:
      - kind: design-doc
        description: >-
          Hierarchical skill decomposition architecture with control affordances, nullspace composition rules, and
          Bayesian affordance models for sensorimotor grounding
        format: markdown
      - kind: diagram
        description: >-
          Control hierarchy diagrams showing subordinate ⊳ superior composition, schema convergence flowcharts, and
          curriculum progression decision trees
        format: svg
      - kind: refactor-plan
        description: >-
          Skill acquisition curriculum design with resource scaffolding stages, convergence criteria, and failure mode
          recovery strategies
        format: markdown
      - kind: critique
        description: >-
          Analysis of schema interference, affordance model drift, and exploration-exploitation tradeoffs in
          hierarchical control systems
        format: markdown
allowed-tools: Read,Write,Edit,Glob,Grep
---

# Hierarchical Skills and Affordance-Based Representation

**Source**: Sen, Sherrick, Ruiken, Grupen (UMass Amherst Laboratory for Perceptual Robotics)  
**Domain**: Robotics, AI, control theory, cognitive architecture

## When to Use This Skill

Load this skill when facing problems involving autonomous skill acquisition, sensorimotor grounding, hierarchical control composition, or bridging symbolic reasoning with continuous control. Particularly effective when agents must learn domain-general capabilities without task supervision.

**Also load for**:
- Representational discontinuity: systems needing both continuous control AND discrete symbolic reasoning
- Object knowledge grounding: recognition that supports action selection (knowing *what you can do* vs. labeling)
- Action selection under uncertainty: deciding whether to gather more information or commit
- Transfer and generalization: learning skills that work across varied instances

**Struggles when**: Tasks require pure symbolic reasoning without sensorimotor grounding, real-time constraints prevent exploratory information gathering, or the environment provides no convergent feedback signals.

## Core Mental Models (Brief)

1. **Control Affordances as Primitives**: Objects are distributions of reliable control relationships (SEARCHTRACK schemas that converge), not static feature bundles. *act→converge→recognize* rather than perceive→plan→act.
2. **Intrinsic Curriculum via Resource Restriction**: Reward 0→1 convergence transitions; restrict sensorimotor resources so simple schemas stabilize before unlocking complex ones.
3. **Nullspace Composition**: c₂ ⊳ c₁ — subordinate uses leftover DOF from superior. Combined: **a** = **a₁** + (I - J₁†J₁)**a₂**.
4. **Bayesian Affordance Models**: Object model = generative Bayesian over p (schema convergence), f (feature geometry), r (spatial relationships). Supports both recognition (invert) and planning (forward).
5. **Information-Theoretic Exploration**: Before committing, compute I(a; g) = H(g) − H(g|a) to select maximally informative exploratory actions.

> Load detailed references for any of these (see Reference Documentation below).

## Decision Points

### Schema Selection for Ambiguous Objects

```
IF object_uncertainty > convergence_threshold:
    IF low-cost_visual_exploration available:
        → Execute visual inspection from multiple angles
        → Update Bayesian belief over object affordances
    ELSE IF tactile_exploration safe:
        → Execute gentle contact with surface normals
        → Track force convergence patterns
    ELSE:
        → Default to most probable schema based on priors

IF object_uncertainty ≤ convergence_threshold:
    IF goal_affordance_confidence > action_threshold:
        → Execute goal schema (grasp, manipulate)
    ELSE:
        → Select schema maximizing I(action; goal_affordance)
```

### Curriculum Progression Logic

```
IF schema_convergence_rate < stability_threshold:
    → Check prerequisite schemas are stable
    → Reduce DOF constraints further
    → Increase practice iterations before advancement

IF schema_convergence_rate ≥ stability_threshold:
    IF subordinate_schemas available AND superior_schema stable:
        → Attempt nullspace composition: subordinate ⊳ superior
    ELSE IF next_complexity_level unlocked:
        → Add sensorimotor resource (additional DOF, sensor modality)
        → Initialize new schema learning
```

### Hierarchical Control Composition

```
IF multiple_control_objectives active:
    Rank by criticality:
    IF safety_constraint violated:
        → All controllers ⊳ collision_avoidance
    ELSE IF visual_track required for task:
        → force_control ⊳ visual_track
        → orientation_adjust ⊳ (force_control ⊳ visual_track)
    ELSE:
        → Apply standard priority hierarchy from training

Calculate: a_combined = a_superior + (I - J_superior†J_superior) * a_subordinate
```

## Failure Modes

### Schema Interference Cascade
**Detection**: Subordinate performance degrades when superior activates, or combined error increases monotonically
- **Symptom**: Tracking error increases when force control added to visual servoing
- **Fix**: Recalculate J_superior†, add damping term, or reduce subordinate controller gains

### Premature Convergence Lock
**Detection**: Schema reports "converged" but goal affordance uncertainty H(g) remains above threshold
- **Symptom**: Robot attempts grasp after single visual glimpse, fails due to pose uncertainty
- **Fix**: Tighten convergence criteria, enable exploratory action selection, validate affordance confidence before commitment

### Resource Scaffolding Collapse
**Detection**: Complex schema learning fails repeatedly; prerequisite schemas show instability
- **Symptom**: Force-based manipulation never converges despite extended training
- **Fix**: Return to simpler resource restrictions, retrain prerequisite schemas, validate tracking error bounds

### Affordance Model Drift
**Detection**: Object recognition confidence decreases over time despite consistent sensory input
- **Fix**: Recalibrate Bayesian priors, validate sensor calibration, reset affordance statistics

### Exploration-Exploitation Deadlock
**Detection**: I(a; g) never decreases below action threshold despite multiple exploratory actions
- **Symptom**: Robot circles object endlessly without attempting goal action
- **Fix**: Implement exploration timeout, reduce information threshold, validate sensor noise models

## Worked Examples

### Example 1: Learning Cup Grasping with Resource Progression

**Initial State**: 7-DOF arm, RGB camera, force sensors. No prior cup knowledge.

**Phase 1 — Visual Tracking (L1)**
- Resource restriction: Vision only, 3 DOF
- Schema: SEARCHTRACK_visual on cup rim; reward: error < 5px for 2s
- *Novice miss*: attempting full 7-DOF grasping immediately
- *Expert insight*: visual stability is a prerequisite for force-based schemas

**Phase 2 — Reach Coordination (L2)**
- Resource addition: arm motion (3 DOF translation)
- Schema: REACH ⊳ SEARCHTRACK_visual
- Decision: if visual tracking error > threshold → pause reach, re-stabilize vision

**Phase 3 — Force Integration (L3)**
- Full resources: 7-DOF + vision + force
- Schema: SEARCHTRACK_force ⊳ (REACH ⊳ SEARCHTRACK_visual)
- Decision: force contact detected → switch superior objective from visual to force while maintaining visual in nullspace

**Final affordance model**: Cup = {rim_visual_tracking: [x,y,θ] distribution, surface_force_tracking: normal directions, grasp_points: force + visual intersection}

### Example 2: Object Recognition Under Uncertainty

**Scenario**: Ambiguous cylindrical object (cup vs. can vs. bottle) partially occluded.

**Decision trace**:
1. Initial: P(cup)=0.4, P(can)=0.3, P(bottle)=0.3 → H(object)=1.58 bits
2. Goal: grasp handle (cups only). H(handle_affordance)=1.2 bits > threshold=0.5
3. I(rotate_view; handle)=0.8 bits vs I(gentle_contact; handle)=0.2 bits
4. Execute: rotate view 45°
5. Updated: P(cup)=0.8, handle confidence=0.9 → H=0.3 bits < threshold → execute grasp
- *Expert insight*: information-theoretic selection prevented a failed grasp attempt

## Reference Files

- `references/bayesian-affordance-models-for-action-selection.md` — Generative Bayesian models of object affordances for recognition and planning. **Read when** deciding how to represent object knowledge or selecting actions under object uncertainty.
- `references/control-affordances-as-knowledge-representation.md` — Grounding object models in executable sensorimotor programs; bridges symbolic reasoning and continuous control. **Read when** designing representations that connect perception to action.
- `references/hierarchical-composition-and-nullspace-projection.md` — Coordinating multiple objectives via nullspace projection (c₂ ⊳ c₁). **Read when** composing subordinate and superior controllers without conflict.
- `references/information-theoretic-action-selection-under-uncertainty.md` — Computing I(a; g) to decide exploration vs. exploitation. **Read when** designing action selection under incomplete information.
- `references/intrinsic-motivation-for-skill-acquisition.md` — Curriculum design via resource restriction and convergence rewards. **Read when** structuring autonomous skill learning without task supervision.
- `references/hierarchical-abstraction-for-problem-decomposition.md` — Compositional task decomposition to avoid combinatorial explosion. **Read when** breaking complex tasks into learnable hierarchical subtasks.
- `references/failure-modes-in-complex-control-systems.md` — Recognizing and recovering from breakdowns in multi-level control hierarchies. **Read when** debugging or hardening hierarchical skill systems.

## Anti-Patterns

| Pattern | Wrong | Right |
|---------|-------|-------|
| Object grounding | Visual features (color, SIFT) | Spatial distributions of control affordances |
| Reward design | Hand-crafted per skill | Domain-general convergence reward (0→1) |
| Control combination | Weighted sums w₁a₁+w₂a₂ | Nullspace projection c₂ ⊳ c₁ |
| Action commitment | Act at classification threshold | Explore until H(g) < action threshold |
| Policy learning | Monolithic end-to-end | Compose primitive SEARCHTRACK schemas |
| Object models | Discriminative classifier only | Generative Bayesian (recognition + planning) |
| Object templates | Single canonical pose | Distribution over affordance locations |
| Architecture | Perceive→plan→execute (open-loop) | Closed-loop tracking controllers |

## Quality Gates

- [ ] Schema convergence rate >80% before advancing complexity level
- [ ] Tracking error <10% of signal range during stable convergence
- [ ] Nullspace projection reduces control conflict to <5% performance degradation
- [ ] Affordance models achieve >90% recognition accuracy across pose variations
- [ ] Information gain reduces goal uncertainty below action threshold within 5 exploratory actions
- [ ] Prerequisite schema stability maintained when learning dependent schemas
- [ ] Bayesian belief updates converge within 3 sigma of predicted distributions
- [ ] Control hierarchy maintains real-time performance (>10Hz for dynamic tasks)
- [ ] Schema composition produces emergent behaviors absent in individual components
- [ ] Failure recovery restores stable operation within 2 seconds of detected breakdown

## Reference Documentation

| File | When to Load |
|------|--------------|
| `control-affordances-as-knowledge-representation.md` | Grounding object models in executable control programs; SEARCHTRACK mechanics; representational discontinuity |
| `intrinsic-motivation-for-skill-acquisition.md` | Autonomous curriculum; resource restriction scaffolding; convergence-based reward without task supervision |
| `hierarchical-composition-and-nullspace-projection.md` | Nullspace math; coordinating simultaneous objectives; c₂ ⊳ c₁ notation; avoiding control conflicts |
| `bayesian-affordance-models-for-action-selection.md` | Generative object models; graphical model (O → p, f, r); inference for recognition and planning |
| `information-theoretic-action-selection-under-uncertainty.md` | Algorithm 1 implementation; mutual information computation; explore/exploit thresholds |
| `hierarchical-abstraction-for-problem-decomposition.md` | Schemas as temporally extended actions; compositional solutions; planning with skill primitives |

## NOT-FOR Boundaries

**Do NOT use for**:
- Pure symbolic reasoning without sensorimotor grounding → use logical-reasoning
- Tasks requiring millisecond response times → use reactive-control
- Environments with no convergent feedback signals → use open-loop-planning
- Single-shot recognition without action consequences → use pattern-classification

**Delegate when**:
- High-level task planning needed → hierarchical-planning
- Natural language understanding required → semantic-parsing
- Social interaction dynamics → multi-agent-coordination
- Abstract mathematical reasoning → symbolic-computation

**Resource requirements**: Closed-loop control capability, multiple DOF, reliable sensor feedback. Scales poorly with discrete-only state spaces, purely reactive tasks, or human-speed interactions.
