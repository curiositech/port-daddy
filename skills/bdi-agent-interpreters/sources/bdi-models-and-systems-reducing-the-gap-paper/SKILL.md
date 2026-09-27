---
name: bdi-models-and-systems-reducing-the-gap-paper
description: >-
  Implement executable BDI reasoning with explicit negation, paraconsistent revision, trigger-based commitment updates,
  and abduction. Use for runtime agent semantics and conflicting desires. NOT for purely axiomatic modal logic,
  black-box planners, or classical logic without operational semantics.
license: Apache-2.0
allowed-tools: Read,Write,Edit,Glob,Grep
metadata:
  category: AI & Agents
  tags:
    - bdi
    - logic-programming
    - paraconsistency
    - commitment
    - abduction
    - revision
  pairs-with:
    - skill: agentspeak-l-bdi-architecture
      reason: Use it when you need the architectural complement to the revision-centric runtime semantics.
    - skill: causal-reasoning-klein
      reason: Use it when contradiction handling and abductive probes meet messy real-world diagnosis.
  provenance:
    kind: legacy-recovered
    owners:
      - some-claude-skills
    sourceDocument: "BDI Models and Systems: Reducing the Gap"
    sourceAuthors:
      - Michael C. Móra
      - José G. Lopes
      - Rosa M. Viccari
      - Helder Coelho
    importedFrom: legacy-recovery
  authorship:
    authors:
      - Michael C. Móra
      - José G. Lopes
      - Rosa M. Viccari
      - Helder Coelho
    maintainers:
      - some-claude-skills
  io-contract:
    kind: deliverable
    produces:
      - kind: design-doc
        description: >-
          BDI agent architecture specification with explicit negation, paraconsistent revision rules, trigger-based
          commitment updates, and abduction procedures
        format: markdown
      - kind: code
        description: >-
          Executable BDI reasoning engine or proof procedure implementation with revision semantics and conflict
          resolution
        language: python|prolog|lisp
      - kind: critique
        description: >-
          Analysis of formalism choice, operational semantics coverage, and gap closure between theory and runtime
          execution
        format: markdown
      - kind: refactor-plan
        description: >-
          Migration strategy from axiomatic BDI logic or black-box planners to executable paraconsistent revision with
          explicit negation
        format: markdown
---

# Executable BDI Revision Semantics

Use this skill when the main problem is closing the gap between a pretty BDI theory and a reasoning engine that can actually run, revise commitments, and survive contradiction.

## When to Use

- You need a BDI formalism that doubles as a runtime reasoning mechanism.
- Desires can conflict and the system must deliberate without collapsing under inconsistency.
- Commitment persistence should be operational, trigger-based, and revisable.
- The agent needs explicit negative beliefs or negative intentions, not just absence of proof.
- Feasibility checking requires abductive reasoning over missing preconditions or blocked actions.

## NOT for

- Purely axiomatic modal or temporal logic work where executability is not required.
- Planner wrappers that hide all reasoning inside black-box services.
- Classical logic systems where contradiction should explode the theory instead of trigger revision.
- Simple task lists where commitment, revision, and explicit negation add no value.

## Core Mental Models

### The Gap Comes from Choosing the Wrong Formalism

The problem is not that BDI theory is too abstract. The problem is selecting specification formalisms with no proof procedure or operational semantics. Choose a computational formalism from the start if you want executable agents.

### Explicit Negation Is Not the Same as Failure to Prove

Agents need to represent "I believe not-P" and "I intend not-P" as positive negative information. That is different from merely lacking evidence for P.

### Contradiction Should Trigger Deliberation

Conflicting desires are normal. Paraconsistent semantics treat contradiction as a signal to revise beliefs or intentions, not as a fatal error.

### Commitment Lives in the Revision Rules

Intentions persist because the revision procedure constrains what new intentions can be adopted and when reconsideration is triggered.

### Preference over Revisions Is Deliberation Policy

Priority ordering, maximal satisfaction, and minimal change are not after-the-fact cleanups. They are the operational content of deliberation.

## Decision Points

```mermaid
flowchart TD
  A[Need runnable BDI reasoning] --> B{Must the logic execute at runtime?}
  B -->|No| C[Pure axiomatic logic may suffice]
  B -->|Yes| D[Choose operational formalism]
  D --> E{Need explicit negative mental states?}
  E -->|Yes| F[Use explicit negation]
  E -->|No| G[Expect weak conflict handling]
  F --> H{Conflicts or contradictions appear?}
  H -->|Yes| I[Use paraconsistent revision]
  H -->|No| J[Proceed with current commitments]
  I --> K{Trigger for reconsideration fired?}
  K -->|Yes| L[Revise beliefs and intentions by preference]
  K -->|No| M[Keep commitments stable]
```

- If the agent reasons at runtime, prefer a formalism with proof procedures rather than an elegant but non-executable theory.
- Use explicit negation whenever negative beliefs or negative intentions are part of the domain.
- Treat contradiction as input to a revision mechanism, not as a reason to abort reasoning.
- Specify the triggers that force reconsideration; everything else should preserve commitment by default.

## Failure Modes

### Modal Logic Without Runtime Semantics

Cue: the formal model is beautiful, but implementation requires inventing a separate reasoning engine from scratch.

Fix: move to or layer in an operational formalism with executable semantics.

### Negation-by-Failure Confusion

Cue: the system cannot distinguish active aversion from mere absence of evidence.

Fix: represent explicit negation separately from closed-world absence.

### Replanning on Every Cycle

Cue: the agent keeps recomputing intentions even when nothing important changed.

Fix: define explicit reconsideration triggers and preserve commitments between them.

### Contradiction as Exception

Cue: inconsistent desires crash the system or are forbidden before deliberation starts.

Fix: use paraconsistent semantics and revision to turn contradiction into useful signal.

### Preference as Post-Processing

Cue: the system enumerates all consistent subsets first and only then applies priorities.

Fix: encode preference into the revision procedure so it guides the search directly.

## Worked Examples

### Triage Agent with Conflicting Obligations

A healthcare triage agent must avoid interrupting one patient while escalating another urgent case. Represent the negative intention explicitly, allow contradictory candidate desires, and let priority-guided revision choose which intention set survives after new evidence arrives.

### Field Robotics with Deadlines

A robot intends to inspect a site before battery reserve drops below a threshold. New terrain beliefs make the route infeasible. The right move is not endless replanning, but trigger-based reconsideration with abductive reasoning about missing preconditions and alternative routes.

## Reference Files

- `diagrams/01_stateDiagram-v2_bdi_agent_mental_state_lifecyc.md` — Mermaid state diagram showing belief acquisition, desire formation, consistency checks, and commitment lifecycle. **Read when** designing the mental state machine or visualizing BDI transitions.
- `diagrams/02_flowchart_deliberation_&_revision_proced.md` — Decision tree for deliberation triggers (inconsistency, action failure, deadline, new info) and paraconsistent signal detection. **Read when** implementing trigger-based revision logic.
- `diagrams/03_timeline_agent_execution_timeline_with_.md` — Timeline showing execution, trigger evaluation, and conditional deliberation phases. **Read when** sequencing agent cycles and deliberation checkpoints.
- `references/abduction-as-intention-feasibility-check.md` — Explains rationality constraint: agents must not intend impossible goals; uses abduction to check preconditions. **Read when** implementing feasibility checking or blocking impossible commitments.
- `references/computational-commitment-through-revision-constraints.md` — Makes commitment operational via revision constraints; shows how intentions filter future intentions. **Read when** encoding commitment persistence or designing intention filtering.
- `references/desires-as-search-space-not-commands.md` — Distinguishes desires (potential goals) from intentions (committed goals); explains deliberation structure. **Read when** architecting goal queues or deliberation before commitment.
- `references/event-calculus-as-operational-time-and-action-model.md` — Temporal reasoning for durative goals, action consequences, and obsolete commitment detection. **Read when** adding time-dependent beliefs, deadlines, or action duration.
- `references/preference-over-consistency-restoring-revisions.md` — Addresses multiplicity in conflict resolution; encodes deliberation policy in search structures. **Read when** choosing among multiple consistent subsets or ranking revisions.
- `references/revision-mechanisms-as-non-monotonic-deliberation.md` — Frames deliberation as conflict resolution; explains paraconsistent handling of contradictory desires. **Read when** implementing non-monotonic reasoning or contradiction-triggered revision.
- `references/triggers-and-attention-in-committed-agents.md` — Analyzes commitment-deliberation tradeoff; identifies when deliberation should occur. **Read when** tuning trigger thresholds or balancing stability vs. responsiveness.

## Quality Gates

- The chosen formalism has an operational semantics or proof procedure.
- Explicit negation is used where the agent must actively represent negative mental states.
- Contradiction invokes revision rather than explosion or silent suppression.
- Reconsideration triggers are named concretely.
- Preference structure is part of the revision logic, not an afterthought bolted on later.

## Shibboleths

- If someone treats "not proved" as equivalent to "known false," they have not internalized the representational issue.
- If commitment is defined only as a persistence slogan and not as a constraint on revision, the model is still too abstract.
- If the agent cannot explain how contradictions become actionable rather than catastrophic, the design is not really using paraconsistent deliberation.

## Reference Routing

- `references/revision-mechanisms-as-non-monotonic-deliberation.md`: load when contradiction handling and revision are the main issue.
- `references/computational-commitment-through-revision-constraints.md`: load when operational commitment and reconsideration rules are central.
- `references/desires-as-search-space-not-commands.md`: load when the desire/intention distinction is collapsing.
- `references/abduction-as-intention-feasibility-check.md`: load when the main issue is whether current intentions are still achievable.
- `references/preference-over-consistency-restoring-revisions.md`: load when you need concrete preference structure for deliberation.
