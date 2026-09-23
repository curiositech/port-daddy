---
name: task-analysis-of-pier-side-ship-handling
description: >-
  Apply cognitive task analysis to expert work that depends on perceptual cues, branching judgment, and recurring
  monitoring loops. Use when decomposing expert capability into agent structure, simulation design, or validation
  interviews. NOT for ordinary step-by-step SOP capture or simple pipelines with no tacit cue layer.
license: Apache-2.0
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
metadata:
  category: Cognitive Science & Decision Making
  tags:
    - cognitive-task-analysis
    - goms
    - critical-decision-method
    - expertise
    - simulation
    - perception
  pairs-with:
    - skill: task-decomposer
      reason: CTA improves decomposition when branch points depend on real cues rather than tidy procedures.
    - skill: mermaid-graph-writer
      reason: Hierarchies and monitoring loops are easier to inspect visually than in prose alone.
  provenance:
    kind: legacy-recovered
    sourceDocument: A Task Analysis of Pier Side Ship-Handling for Virtual Environment Ship-Handling Simulator Scenario Development
    sourceAuthors:
      - Charles R. Grassi
    sourceArtifact: .claude/skills/task-analysis-of-pier-side-ship-handling/_book_identity.json
    importedFrom: legacy-recovery
    owners:
      - some-claude-skills
  authorship:
    authors:
      - Charles R. Grassi
    maintainers:
      - some-claude-skills
  io-contract:
    kind: deliverable
    produces:
      - kind: task-decomposition
        description: >-
          Hierarchical goal structure with explicit branch conditions, selection rules, and cue inventories that
          separate expert judgment from procedural steps
        format: markdown
      - kind: interview-protocol
        description: >-
          Critical Decision Method probes and knowledge-elicitation questions tailored to extract tacit perceptual cues
          and monitoring loops from subject-matter experts
        format: markdown
      - kind: cue-inventory
        description: >-
          Catalog of perceptual signals, environmental indicators, and tool-state observations that trigger expert
          branch decisions and sustain monitoring loops
        format: markdown
      - kind: agent-architecture-spec
        description: >-
          Simulation or orchestration design that models recurring assessment goals, redundant sensing channels, and
          cue-linked decision nodes instead of flat sequential workflows
        format: markdown
      - kind: validation-plan
        description: >-
          Multi-expert review protocol and edge-case scenarios to expose missing task structure and confirm cue fidelity
          against real performance
        format: markdown
---

# Expert Task Analysis And Capability Design

Use this skill when a task model seems procedurally complete but still misses the perceptual triggers, monitoring loops, and tool-use habits that separate expert performance from a checklist.

## When to Use

- You need to turn expert performance into an agent architecture, simulator, or training environment.
- A written SOP explains the steps but not how experts know which branch to take.
- The system works on normal cases and fails on edge cases that hinge on situational judgment.
- You are interviewing subject-matter experts and need a method for extracting tacit knowledge rather than just narrated procedure.
- A DAG or orchestration tree needs recurring monitoring loops instead of only one-shot sequential nodes.

## NOT for Boundaries

This skill is not the right primary tool for:
- Simple, deterministic workflows where explicit procedures already capture the whole task.
- Low-stakes automation that does not depend on perceptual pattern recognition.
- Post-hoc documentation exercises that do not need validation against real expert performance.
- Simulations where visual realism matters more than cue fidelity for decision making.

## Core Mental Models

### Science Layer vs. Art Layer

Expert performance has a declarative layer that experts can usually explain and a perceptual layer that often shows up only when they are pushed on branch points. GOMS captures the former. Critical Cue Inventories and Critical Decision Method interviews are how you recover the latter.

### Cues Drive Decisions

Wake patterns, line tension, a sound change, or a subtle positional relationship are not decorative details. They are the actual inputs to expert choice. If the system cannot see the cues, it cannot reproduce the expert decision function.

### Hierarchy With Selection Rules

Expert work is a nested goal hierarchy with local branch conditions, not a flat list of steps. The important structure is not only what gets done, but what conditions select method A rather than method B.

### Recurring Monitoring Loops

Many expert tasks depend on continual assessment goals that run alongside sequential action. A workflow that only models one-shot nodes loses anticipation and turns expertise into reaction.

### Validation Gap

Single-expert task models are predictably incomplete because routine tools and setup behaviors vanish from conscious awareness. Validation is not an optional polish pass; it is how the missing task structure becomes visible.

## Decision Points

See the modeling flow in [diagrams/01_flowchart_decision-points.md](diagrams/01_flowchart_decision-points.md).

```mermaid
flowchart TD
  A[Need expert capability model] --> B[Decompose goals and methods]
  B --> C{Branch point explained procedurally?}
  C -->|Yes| D[Record explicit selection rule]
  C -->|No| E[Probe for perceptual cues]
  D --> F{Recurring monitoring required?}
  E --> F
  F -->|Yes| G[Model monitoring loop and redundant sensing]
  F -->|No| H[Keep sequential subgoal]
  G --> I[Validate with more experts or traces]
  H --> I
```

### 1. Decide the Right Grain of Decomposition

- Stop at the level where a meaningful method choice first appears.
- If a branch condition is still hidden, decompose deeper and probe the cue that selects the branch.
- If no branch points remain, you are now documenting execution rather than task architecture.

### 2. Decide What Knowledge-Elicitation Method to Use

- Use structured decomposition for explicit procedures and tool sequencing.
- Use Critical Decision Method probes when the expert says "I just know" or "it depends."
- Use multi-expert validation whenever the first model seems strangely clean or tool-free.

### 3. Decide What to Simulate

- Simulate cues that actually trigger branch decisions.
- Add redundant sensing where experts rely on more than one channel.
- Omit cosmetic detail that does not change cue recognition or choice quality.

## Failure Modes

### 1. Flat Checklist Capture

**Symptoms:** the task model reads smoothly but fails as soon as the environment deviates.  
**Detection rule:** branch conditions are missing or hidden inside prose instead of explicit selection rules.  
**Recovery:** convert the checklist into a goal hierarchy with cue-linked branch points.

### 2. Cue-Free Simulation

**Symptoms:** trainees or agents succeed in the simulator but fail in deployment.  
**Detection rule:** the simulation reproduces procedures but not the signals experts use to choose between them.  
**Recovery:** build a Critical Cue Inventory and redesign the environment around cue fidelity.

### 3. Single-Channel Fragility

**Symptoms:** one noisy or missing input collapses the whole decision process.  
**Detection rule:** a critical judgment depends on exactly one source.  
**Recovery:** add redundant channels and explicit cross-check behavior.

### 4. One-Expert Blind Spot

**Symptoms:** essential tools or context-setting actions never appear in the first model.  
**Detection rule:** validation experts immediately mention omitted equipment, routines, or monitoring behavior.  
**Recovery:** treat disagreement as evidence of missing structure, not as noise.

### 5. Sequential-Only Architecture

**Symptoms:** the system can react to events but cannot sustain ongoing assessment.  
**Detection rule:** all nodes are one-shot tasks and none represent recurring monitoring goals.  
**Recovery:** add explicit monitoring loops with predict-observe-compare-adjust behavior.

## Worked Examples

### Example 1: Turning Expert Judgment Into an Agent Tree

A shipping-domain expert gives a procedural narrative for docking. The first draft decomposes cleanly into steps but still fails when current, tug availability, and line behavior shift together. The skill adds selection rules at the relevant branch points, records the cue inventory that drives those choices, and introduces recurring monitoring loops instead of only sequential nodes.

### Example 2: Simulation Fidelity Triage

A training simulator renders water, vessels, and pier geometry beautifully, yet trainees still overrun the stop point. CTA reveals that experts rely on relative motion against fixed shore references and line-tension cues that the simulator never emphasizes. The skill routes design effort toward those cues instead of more visual polish.

## Quality Gates

- [ ] The task model distinguishes explicit procedure from perceptual cue knowledge.
- [ ] Branch points include the cues or conditions that select each method.
- [ ] Recurring monitoring goals are modeled separately from one-shot sequential goals.
- [ ] Critical decisions have redundant information channels where experts rely on them.
- [ ] At least one validation pass challenges the model with additional experts or traces.

## Reference Files

- `references/art-science-gap-in-expert-systems.md` — Distinguishes procedural knowledge from tacit perceptual judgment in expert performance. **Read when** building task models that separate what experts can articulate from what they actually do.
- `references/critical-cue-inventories-for-agent-perception.md` — Structures perceptual signals and environmental indicators that trigger expert decisions. **Read when** designing agent sensors or validating simulation fidelity against real cue patterns.
- `references/critical-decision-method-knowledge-elicitation.md` — Probes for implicit expert knowledge that cannot be volunteered without structured interview. **Read when** planning SME interviews or extracting tacit branching logic.
- `references/emergency-preparedness-and-failure-mode-classification.md` — Documents Restricted Maneuvering doctrine as redundancy design pattern. **Read when** architecting agent systems or simulators that must handle edge cases and failure modes.
- `references/expert-knowledge-two-layers.md` — Explains why expert explanation (science) differs from expert performance (art). **Read when** diagnosing why a checklist or SOP fails despite being procedurally complete.
- `references/failure-modes-in-complex-coordinated-operations.md` — Identifies structural conditions that create risk in multi-agent operations. **Read when** analyzing why complex systems fail or designing safeguards.
- `references/goms-plus-cci-dual-layer-task-modeling.md` — Combines GOMS procedures with Critical Cue Inventories for complete task representation. **Read when** choosing notation for hierarchical goal structures with perceptual branch conditions.
- `references/goms-task-decomposition-for-agent-systems.md` — Applies GOMS as agent orchestration framework with selection rules. **Read when** decomposing expert tasks into hierarchical goal trees for agent architecture.
- `references/hierarchical-decomposition-and-grain-selection.md` — Demonstrates how to choose decomposition granularity for complex tasks. **Read when** deciding what level of detail to model in task analysis.
- `references/knowledge-elicitation-methodology-for-agent-capability-building.md` — Translates expert performance into machine-executable specifications. **Read when** planning knowledge capture sessions or designing agent training data.
- `references/multi-agent-coordination-and-watch-team-architecture.md` — Models naval bridge watch team as multi-agent orchestration system. **Read when** designing agent teams or understanding redundant role structures.
- `references/perceptual-cues-as-agent-sensors.md` — Catalogs visual, auditory, and proprioceptive signals experts monitor simultaneously. **Read when** specifying what sensors an agent or simulator must provide.
- `references/redundant-sensing-in-multi-channel-environments.md` — Shows why experts maintain multiple independent channels for same information. **Read when** designing robust perception or validation protocols.
- `references/situation-awareness-and-the-conning-officers-mental-model.md` — Describes mental picture maintenance as foundation for decision-making. **Read when** modeling situation awareness or designing agent state representation.
- `references/tacit-knowledge-and-simulation-design.md` — Addresses transferring expertise through simulation without full apprenticeship. **Read when** designing training environments or agent learning systems.
- `references/the-art-science-gap-transfer-to-simulation.md` — Explains why knowing and doing diverge and implications for simulator design. **Read when** validating that simulation fidelity matches decision-making requirements.
- `references/validation-gap-what-experts-dont-know-they-know.md` — Reveals hidden assumptions through expert disagreement during validation. **Read when** planning validation reviews or interpreting discrepancies in model testing.
- `references/validation-through-disagreement.md` — Shows how model errors surface through structured expert review. **Read when** conducting multi-expert validation or analyzing what initial models miss.
- `diagrams/01_flowchart_decision-points.md` — Mermaid flowchart showing CTA capability modeling workflow with branch points. **Read when** visualizing the overall process for decomposing goals, probing cues, and validating models.

## Anti-Patterns

- Treating "tacit knowledge" as a label that ends inquiry instead of a signal to probe harder.
- Capturing only procedures and calling the result an expert model.
- Designing simulations for realism aesthetics instead of cue fidelity.
- Assuming single-expert completeness in a domain where automaticity hides the most important structure.
