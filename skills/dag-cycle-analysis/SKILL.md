---
license: Apache-2.0
name: dag-cycle-analysis
description: Graph algorithms for detecting and resolving cycles in directed graphs and workflow definitions
category: Agent & Orchestration
tags:
  - dag
  - cycle-detection
  - graph-theory
  - validation
  - algorithms
---

# Hierarchical Cycle Analysis

**Skill ID**: `hierarchical-cycle-analysis`  
**Domain**: Complex systems, network science, information architecture  
**Source**: Vasiliauskaite, Evans & Expert — "Cycle Analysis of Directed Acyclic Graphs"

## Description

This skill applies rigorous cycle-theoretic methods to understand the hidden organizational structure of hierarchical systems. It reveals how systems that appear "acyclic" (DAGs) actually contain rich cyclic structure that determines their information-processing capabilities, and provides frameworks for distinguishing functional differences that topology alone cannot capture.

## Activation Triggers

Load this skill when:
- Analyzing hierarchical systems (org charts, citation networks, task dependencies, software architectures)
- Someone claims a system is "acyclic" or "has no loops"
- Trying to understand why two similarly-structured hierarchies behave differently
- Diagnosing bottlenecks or failure modes in information flow
- Evaluating whether structural metrics actually capture functional differences

## Core Mental Models

### 1. DAG = Undirected Graph + Directional Metadata

Every DAG decomposes into two separable elements:
- An **undirected substrate** containing the actual topology (cycles, connectivity)
- **Directional metadata** derived from an ordering constraint (time, causality, hierarchy, dependency)

"Acyclic" only means directions respect the ordering — it does NOT mean the underlying structure lacks cycles. The same undirected structure + different metadata = different information processing.

### 2. The Four-Class Cycle Taxonomy

After path-wedge contraction, all cycles belong to exactly four classes:

| Class | Structure | Information Role | Present in TR-DAG? |
|-------|-----------|------------------|-------------------|
| **Feedback Loop** | All neutral nodes | Recirculation, refinement | No |
| **Shortcut** | Transitively reducible | Redundant path, acceleration | No |
| **Diamond** | Unitary antichains | Resilient alternatives, robustness | **Yes** |
| **Mixer** | Non-unitary antichain | Multi-source integration | **Yes** |

In transitively-reduced DAGs, **only diamonds and mixers exist** — the fundamental organizing structures of hierarchies.

### 3. Transitive Reduction as Truth-Seeking

TR removes shortcuts (informationally redundant), preserves diamonds (genuinely different paths), and reveals mixers (true integration points). Apply when distinguishing essential from accidental complexity. **Warning**: shortcuts may optimize latency — informational redundancy ≠ functional uselessness.

### 4. Antichains as Hierarchical Coordinates

An antichain is a set of nodes with no ordering relationship — incomparable, parallel, at the "same level." Cycle antichain structure determines class: unitary → Diamond; non-unitary → Mixer.

### 5. The Topology-Metadata Gap

Purely topological metrics (node count, edge count, clustering) **cannot distinguish DAGs with different functional behaviors**. Always combine topological metrics (cycle count, size) with metadata metrics (height, stretch, balance, antichain structure).

## Decision Points

### Algorithm Selection Tree

```
IF analyzing system behavior/comparison
├── THEN decompose DAG = undirected graph + directional metadata
├── IF need functional differences between similar topologies
│   └── THEN use metadata metrics (height, stretch, balance) + topology
└── IF need structural simplification
    └── THEN apply transitive reduction first

IF detecting cycles in DAG
├── IF raw cycle count needed
│   └── THEN use DFS on undirected substrate
├── IF functional classification needed
│   ├── THEN apply path-wedge contraction first
│   └── THEN classify: feedback/shortcut/diamond/mixer
└── IF comparing cycle organization
    └── THEN compute antichain structure + metadata positioning

IF system shows unexpected behavior despite "good" topology
├── THEN check antichain structure (parallel vs sequential)
├── THEN measure cycle height/stretch/balance distribution
└── IF still unclear, THEN load metadata-localizes-topology framework

IF redesigning hierarchical process
├── IF need resilience THEN preserve/add diamonds (parallel alternatives)
├── IF need integration THEN check mixer positioning (multi-level convergence)
└── IF optimizing efficiency THEN identify shortcuts for potential removal
```

### Stopping Criteria

- **Stop iterating** when TR converges (no more transitive edges to remove)
- **Stop analysis** when all cycles classified into four classes
- **Stop decomposition** when undirected substrate + metadata separated
- **Escalate to domain expert** if >50% of cycles are mixers (unusual integration pattern)

## Failure Modes

### Topology Blindness
**Symptom**: Two hierarchies have identical node/edge counts but behave differently  
**Diagnosis**: Analyzing structure without considering ordering metadata  
**Detection Rule**: Degree distributions match but information flow differs  
**Fix**: Decompose into undirected graph + metadata, compute metadata-derived metrics

### Acyclic Confusion
**Symptom**: Claiming "no cycles exist" in hierarchical system  
**Diagnosis**: Confusing directional constraint-compatibility with topological absence  
**Detection Rule**: Someone says "it's a DAG so no loops"  
**Fix**: Extract undirected substrate to reveal hidden cyclic structure

### Cycle Conflation
**Symptom**: Counting all cycles as equivalent structural features  
**Diagnosis**: Missing functional differences between diamonds vs mixers  
**Detection Rule**: Analysis treats 3-node triangle same as 6-node mixer  
**Fix**: Apply path-wedge contraction, classify into four classes

### Over-Reduction
**Symptom**: System performance degrades after applying transitive reduction  
**Diagnosis**: Removing shortcuts that were functionally valuable despite being informationally redundant  
**Detection Rule**: TR improves "structural metrics" but worsens latency/reliability  
**Fix**: Distinguish informational redundancy from functional optimization

### Antichain Ignorance
**Symptom**: Cannot explain why parallel nodes behave differently  
**Diagnosis**: Missing hierarchical coordinate system, treating all "same level" nodes as equivalent  
**Detection Rule**: Surprised by different behaviors at "same hierarchical level"  
**Fix**: Compute antichain decomposition, analyze cycle organization by level

## Worked Examples

### Example 1: Organizational Chart Analysis

**Scenario**: Two companies with identical reporting structures (30 nodes, 35 edges) but different decision-making speeds.

**Step 1 — Decomposition**:
```
Company A: Extract undirected substrate → 12 cycles found
Company B: Extract undirected substrate → 12 cycles found
```
Topology identical → analyze metadata.

**Step 2 — Classification**:
```
Company A after TR: 8 diamonds, 2 mixers
Company B after TR: 4 diamonds, 4 mixers
```

**Step 3 — Metadata Analysis**:
```
Company A: diamonds at height 2-4 (mid-hierarchy resilience), mixers at height 6-7
Company B: diamonds at height 1-2 (low-level redundancy), mixers at height 3-8
```

**Insight**: Company B's distributed mixers create more integration overhead but higher adaptability. Company A's concentrated senior mixers create bottlenecks but faster routine decisions.

**Novice miss**: Counts total cycles (12 each) and concludes structures identical.

### Example 2: Software Architecture Comparison

**Scenario**: Microservice dependency graphs with similar complexity metrics but different deployment reliability.

**Step 1 — Cycle Detection**: System X: 45 cycles; System Y: 47 cycles.

**Step 2 — TR + Classification**:
```
System X: 15 diamonds (data layer, height 1-3), 8 mixers (API gateway, height 5-6)
System Y: 8 diamonds (scattered all layers), 12 mixers (business logic, height 3-4)
```

**Step 3 — Antichain Analysis**: System X: 6 antichains (well-layered). System Y: 3 antichains (more cross-cutting concerns).

**Diagnosis**: System X better for read-heavy workloads; System Y better for complex transactional workflows.

## Quality Gates

**Analysis Complete When**:
- [ ] DAG decomposed into undirected substrate + directional metadata
- [ ] All cycles classified into exactly four classes (feedback/shortcut/diamond/mixer)
- [ ] Antichain structure computed and hierarchical coordinates established
- [ ] Both topological metrics and metadata metrics (height, stretch, balance) calculated
- [ ] Transitive reduction applied and convergence verified
- [ ] Diamond vs mixer distinction mapped to functional requirements
- [ ] Integration points (mixers) and resilience points (diamonds) documented

**Ready for Implementation When**:
- [ ] Specific cycle classes linked to system requirements (resilience needs → diamond preservation)
- [ ] Optimization targets defined (remove shortcuts vs preserve alternatives)

## Reference Documentation

| File | Load When... |
|------|--------------|
| `dag-decomposition-for-hierarchical-reasoning.md` | Formally separating topological structure from ordering constraints |
| `four-cycle-classes-information-processing.md` | Classifying specific cycles by information-processing role |
| `transitive-reduction-information-minimization.md` | Simplifying hierarchy to essential structure |
| `antichains-and-hierarchical-coordinates.md` | Understanding hierarchical positioning, identifying parallel nodes |
| `metadata-localizes-topology.md` | Two systems have similar topology but different behavior |
| `minimal-cycle-basis-as-mesoscopic-descriptor.md` | Characterizing overall system organization |
| `failure-modes-hierarchical-analysis.md` | Diagnosing why standard graph metrics aren't working |
| `when-does-dag-analysis-apply.md` | Determining if this framework fits your problem |

## NOT-FOR Boundaries

**Do NOT use this skill for**:
- **Real-time dynamic graphs**: Use `temporal-graph-analysis` instead
- **Undirected networks**: Use `community-detection` instead
- **Weighted optimization**: Use `network-flow-algorithms` instead
- **Stochastic processes**: Use `markov-chain-analysis` instead

**Delegate when**:
- **Graph size >10K nodes**: Use `distributed-graph-algorithms`
- **Real-time constraints**: Use `streaming-dag-validation`
- **Complex temporal dynamics**: Use `temporal-motif-analysis`

**Framework applies only when**:
- Clear ordering constraint exists (time, causality, hierarchy, dependency)
- System can be meaningfully represented as DAG
- Cycles represent structural relationships, not algorithmic artifacts
- Static analysis sufficient (system not rapidly evolving)

## Shibboleths

**Has NOT internalized** this framework:
- Uses "acyclic" and "has no cycles" interchangeably without qualification
- Compares hierarchies using only node/edge counts and clustering coefficients
- Treats all cycles in a network as the same kind of structure
- Cannot explain the difference between a diamond and a mixer
- Assumes transitive reduction is always desirable or always preserves function

**Has internalized** this framework:
- Immediately asks "what's the ordering constraint?" when shown a DAG
- Distinguishes substrate topology from directional metadata
- Recognizes that cycle classification requires path-wedge contraction
- Can point to specific diamonds/mixers and explain their information-processing role
- Combines topological and metadata metrics when comparing systems
- Knows when this framework's assumptions break down (`when-does-dag-analysis-apply.md`)
