---
name: towards-a-taxonomy-of-cognitive-task-analysis
description: >-
  Use for cognitive task analysis, CTA method selection, knowledge capture, tacit expertise routing, and representation
  design by matching elicitation methods to knowledge type. NOT for generic ontology naming, benchmark-only model
  evaluation, or ML architecture tuning.
license: Apache-2.0
allowed-tools: Read,Grep,Glob
metadata:
  category: Knowledge Engineering
  tags:
    - cta
    - knowledge-capture
    - routing
    - taxonomy
    - procedural-knowledge
  provenance:
    kind: first-party
    owners:
      - some-claude-skills
    source:
      title: Towards a Taxonomy of Cognitive Task Analysis Methods
      authors:
        - Kenneth Anthony Yates
  authorship:
    authors:
      - some-claude-skills
    maintainers:
      - some-claude-skills
  io-contract:
    kind: deliverable
    produces:
      - kind: critique
        description: >-
          Assessment of knowledge capture strategy: identifies whether elicitation methods match the target knowledge
          type (declarative, procedural-classify, procedural-change) and flags representation bias or automation-gap
          blindness.
        format: markdown
      - kind: refactor-plan
        description: >-
          Reorganization roadmap for skill libraries or knowledge bases: consolidates near-duplicate skills by knowledge
          type, proposes routing logic grounded in cognitive architecture rather than naming, and charts a path from
          typology to theory-driven taxonomy.
        format: markdown
      - kind: design-doc
        description: >-
          CTA method selection and knowledge-capture design: specifies which elicitation methods (interviews,
          observation, process tracing, contrastive cases) to apply to each knowledge component, justified by
          automation-gap risk and knowledge type.
        format: markdown
---
# Towards a Taxonomy of Cognitive Task Analysis Methods

Source basis: Kenneth Anthony Yates on how elicitation methods bias what kinds of expert knowledge get captured and how that affects system design.

## When to Use

- An agent underperforms experts and the missing capability feels tacit or hard to verbalize.
- A knowledge base or prompt was built mainly from expert interviews or self-report.
- You need to decide how to capture, represent, or route expertise across a skill library.
- A taxonomy keeps growing without an organizing theory or any reduction pressure.
- You suspect the chosen representation format is driving the capture method instead of the other way around.

## NOT for

- Generic label taxonomies or ontology cleanup with no link to expert-performance capture.
- Benchmark-focused model evaluation that does not involve knowledge elicitation or capability routing.
- Pure machine learning architecture selection divorced from the problem of expert knowledge capture.

## Decision Points

1. Classify the target knowledge: declarative, procedural-classify, or procedural-change.
2. Estimate automation-gap risk. If experts are fast and reliable but poor at explanation, self-report alone is insufficient.
3. Choose capture methods based on the knowledge type, not on the output format you hope to build.
4. Decide whether the library is a typology or a real taxonomy by asking what theory would let categories consolidate over time.

## Decision Flow

```mermaid
flowchart TD
  A[Knowledge capture request] --> B{Knowledge type}
  B -->|Declarative| C[Use interviews, document analysis, structured schemas]
  B -->|Procedural classify| D[Use observation, examples, contrastive cases]
  B -->|Procedural change| E[Use process tracing, simulation, replay, intervention review]
  C --> F{Automation gap high?}
  D --> F
  E --> F
  F -->|Yes| G[Do not rely on self-report alone]
  F -->|No| H[Proceed with mixed methods]
  G --> I{Representation driving capture?}
  H --> I
  I -->|Yes| J[Reset around knowledge type first]
  I -->|No| K[Design routing and taxonomy]
  J --> K
```

## Working Model

- Expertise has an automation gap. The knowledge that makes experts fast and reliable is often the part they can least report directly.
- Knowledge has architecture. Declarative facts, procedural classification, and procedural change skills are different targets and need different capture strategies.
- Methods are not neutral. Interviews, concept maps, protocol analysis, and observation open access to different layers of cognition.
- Representation bias is circular. If rules, templates, or embeddings dictate capture method, you will overfit the knowledge to the format.
- Taxonomies should reduce, not just proliferate. Growth without consolidation signals missing theory.

## Failure Modes

- Interviewing experts and mistaking articulate explanations for complete knowledge capture.
- Choosing capture methods because they map neatly to a preferred output format.
- Using one expert or one method and assuming the blind spots will average out.
- Routing skills by keyword or name when the real difference is knowledge type.
- Growing a capability library by accretion instead of revising the underlying organizing theory.

## Reference Files

- `references/automated-knowledge-the-hardest-target.md` — Explains why expert automation (fast, unconscious procedural knowledge) is invisible to introspection. **Read when** an expert cannot articulate their own decision-making.
- `references/building-theory-driven-agent-capability-taxonomies.md` — Maps CTA classification lessons to multi-agent skill libraries; shows how to move from overlapping skill names to principled routing. **Read when** designing or reorganizing a large skill library.
- `references/declarative-vs-procedural-knowledge-for-agent-design.md` — Operationalizes the declarative/procedural distinction using ACT-R; the master fault line for knowledge architecture. **Read when** classifying what kind of knowledge a task requires.
- `references/declarative-vs-procedural-knowledge-in-agent-systems.md` — Contrasts how declarative facts and procedural skills must be acquired, stored, and applied differently. **Read when** deciding representation format or elicitation method.
- `references/expert-knowledge-automation-gap.md` — Defines the automation gap: why experts cannot fully report their own expertise. **Read when** self-report alone is failing to capture performance.
- `references/expert-knowledge-is-invisible-by-design.md` — Shows why behavioral observation alone misses automated cognitive steps. **Read when** planning observation-based knowledge capture.
- `references/instructional-design-principles-for-agent-capability-building.md` — Connects CTA to capability transfer; what makes knowledge transfer produce genuine performance. **Read when** building agent training or knowledge-base design.
- `references/knowledge-compilation-in-expert-systems-and-agent-design.md` — Traces knowledge from slow/declarative to fast/procedural; applies ACT-R to agent design. **Read when** understanding expertise trajectory or performance bottlenecks.
- `references/knowledge-elicitation-as-a-three-phase-pipeline.md` — Structures CTA as elicitation → analysis → representation; defines quality gates for each phase. **Read when** designing a knowledge-capture workflow.
- `references/knowledge-elicitation-as-toolkit-pairing.md` — Shows CTA always pairs extraction method with representation method; neither alone is sufficient. **Read when** selecting which elicitation + representation combination to use.
- `references/method-selection-drives-knowledge-outcomes.md` — Empirical evidence (154 studies) that different methods capture different knowledge types; the differential access hypothesis. **Read when** choosing between interviews, observation, process tracing, or contrastive cases.
- `references/multi-method-coordination-for-knowledge-coverage.md` — Explains why no single method is complete; how to coordinate multiple methods for full coverage. **Read when** planning multi-method elicitation strategy.
- `references/representation-bias-and-knowledge-extraction-validity.md` — Identifies how intended output format corrupts what gets extracted before elicitation begins. **Read when** suspecting the representation format is driving the capture method.
- `references/representation-bias-and-knowledge-fidelity.md` — Deep dive into representation bias as invisible distortion; how output format loss leaves no trace. **Read when** auditing knowledge-base design for format-driven bias.
- `references/skill-selection-as-cognitive-task-analysis-problem.md` — Reframes agent skill routing as a CTA problem, not just classification. **Read when** designing routing logic for multi-skill orchestration.
- `references/taxonomy-progress-and-classification-failure.md` — Parallels DSM classification failure to skill taxonomy proliferation; why wrong classification blocks progress. **Read when** evaluating whether a taxonomy is scientific or merely descriptive.
- `references/taxonomy-theory-and-the-proliferation-trap.md` — Shows how 100+ CTA methods and dozens of schemes fail without theory; what scientific progress requires. **Read when** deciding whether to consolidate or expand a taxonomy.
- `references/the-automated-knowledge-problem-for-ai-agents.md` — Comprehensive treatment of why automated knowledge is hardest to specify and verify in expert systems. **Read when** diagnosing why an agent underperforms despite having access to expert input.

## Anti-Patterns and Shibboleths

- Anti-pattern: collecting articulate interview answers and calling the tacit layer captured.
- Anti-pattern: designing the embedding schema or template first and then forcing the elicitation method to fit it.
- Shibboleth: if routing logic could be replaced by keyword matching with no loss, the CTA taxonomy is still too shallow.

## Worked Examples

- A dispatcher-support agent fails on edge cases even though its prompt contains expert-written rules. The likely issue is procedural knowledge captured declaratively; add observation and process tracing before rewriting the prompt.
- A large skill library keeps spawning near-duplicate skills for planning, diagnosis, and review. The likely issue is typological growth; reorganize by knowledge type produced and consumed, then consolidate.

## Fork Guidance

- Stay in-process when you are classifying one task and choosing one capture strategy.
- Fork separate subagents only when you need independent audits of knowledge type, capture method, and routing theory for the same system before merging findings.

## Quality Gates

- The target task is decomposed by knowledge type before method selection starts.
- Capture methods are justified by what knowledge they can reach, not by what output artifact they produce.
- Procedural blind spots are named explicitly when self-report is used.
- The resulting taxonomy has a path to consolidation, not just more categories.
- Routing logic uses theory about knowledge type rather than surface naming alone.

## Reference Routing

- `references/expert-knowledge-automation-gap.md`: load when experts outperform the system in ways they struggle to explain.
- `references/declarative-vs-procedural-knowledge-in-agent-systems.md`: load when representation is mismatched to the kind of expertise required.
- `references/method-selection-drives-knowledge-outcomes.md`: load when choosing among capture methods.
- `references/representation-bias-and-knowledge-fidelity.md`: load when format is starting to dictate what knowledge gets captured.
- `references/skill-selection-as-cognitive-task-analysis-problem.md`: load when routing or orchestration fails on ambiguous cases.
- `references/building-theory-driven-agent-capability-taxonomies.md`: load when the library needs an organizing theory instead of more names.
- `references/taxonomy-theory-and-the-proliferation-trap.md`: load when category growth outpaces explanatory power.
