---
name: investigations-of-naturalistic-decision-making
description: "license: Apache-2.0 NOT for unrelated tasks outside this domain."
license: Apache-2.0
metadata:
  provenance:
    kind: legacy-recovered
    owners:
      - some-claude-skills
  io-contract:
    kind: deliverable
    produces:
      - kind: decision-framework
        description: >-
          Recognition-primed decision model applied to a specific agent design, decision failure diagnosis, or
          multi-agent coordination problem
        format: markdown
      - kind: critique
        description: >-
          Analysis of where an existing decision process violates RPD principles (e.g., forcing analytical overhead on
          recognition-capable experts)
        format: markdown
      - kind: design-doc
        description: >-
          Situation classification schema, response-mapping prototypes, and mental simulation checkpoints for a
          decision-capable agent
        format: markdown
      - kind: diagnostic-plan
        description: >-
          Post-mortem protocol to distinguish situation misclassification, analogue selection error, or response
          execution failure in a confident decision gone wrong
        format: markdown
---
# SKILL.md: Recognition-Primed Decision Making (Klein & Calderwood)

license: Apache-2.0
```yaml
name: recognition-primed-decision-making
version: 1.0
source: "Investigations of Naturalistic Decision Making and the Recognition-Primed Decision Model (ARI Research Note 90-59)"
authors: Gary A. Klein, Roberta Calderwood
description: >
  Empirically-grounded model of how experts actually decide under pressure.
  Activates when designing decision agents, diagnosing decision failures,
  building expertise systems, or structuring multi-agent coordination.
activation_triggers:
  - expert decision making
  - naturalistic decision making
  - recognition-primed decision
  - RPD model
  - fireground command
  - decision under time pressure
  - situation assessment
  - mental simulation
  - option evaluation
  - novice vs expert errors
  - analytical decision methods
  - agent orchestration design
  - distributed decision making
```

---

## When to Use This Skill

Load this skill when you encounter:

- **Designing decision-capable agents** — especially those operating under time pressure, incomplete information, or dynamic conditions
- **Diagnosing why a decision process is failing** — slow, paralyzed, or generating wrong answers despite correct data
- **Choosing between analytical vs. heuristic approaches** — when the question is whether to impose structured analysis on an experienced system
- **Structuring multi-agent coordination** — when asking how agents should share state and divide action without central control
- **Building or evaluating expertise models** — when the question is what an "expert" agent actually knows vs. what it computes
- **Decomposing complex tasks** — when deciding how to break a problem into sub-tasks for agents
- **Post-mortem on confident failures** — when an experienced actor made a bad decision fast and with conviction

---

## Core Mental Models

### 1. Recognition Replaces Deliberation
Experts under pressure do not compare options. They recognize the situation as a **familiar type**, which immediately activates a **standard response**. The cognitive question is not *"which option is best?"* but *"is this option workable?"* — a far cheaper operation. Recognition is the primary cognitive act; selection is almost automatic downstream of it.

**Implication**: A system that forces option generation and comparison on a recognition-capable agent is not helping it decide — it is breaking its decision machinery.

### 2. Situation Assessment Is the Core Skill
Experts and novices perceive the same cues. The difference is the **inferential depth** drawn from those cues. Experts form:
- **Expectancies** — what should happen next if the situation is what they think it is
- **Plausible goals** — which objectives make sense given the situation type
- **Cue clusters** — which combinations of signals confirm or disconfirm the classification

Novices have shallow situation models. Their data intake is fine; their world model is thin. This is where the gap lives — not in reasoning power, but in situational knowledge.

### 3. Serial Evaluation via Mental Simulation
When experts *do* evaluate an option consciously, they run a **forward mental simulation** — imagining how the option unfolds in the specific situation. They look for **fatal flaws**, not rankings. If no fatal flaw appears, the option is accepted. If a flaw appears, they modify the option or reject it and test the next candidate. This is **progressive deepening**: focused, sequential, leveraging domain knowledge about where failure lives. It is not exhaustive; it is targeted.

### 4. Analytical Methods Are Contraindicated for Experts Under Pressure
Prescriptive decision tools (decision matrices, multi-attribute utility, generate-and-compare protocols) impose exactly the cognitive overhead that expertise exists to bypass. Under time pressure, requiring analytical methods:
- Prevents recognition from operating
- Leaves the decision maker without a ready action during analysis
- Degrades accuracy by substituting explicit weighting for calibrated pattern knowledge
- Introduces false precision on dimensions the expert's intuition already integrates

*These tools have appropriate uses — with novices, with low time pressure, for post-decision audit. Not with experts acting.*

### 5. Analogical Reasoning Is the Exception — and the Primary Error Source
Most expert experience has been **abstracted into prototypes**: individual cases merge into situation types. Analogical reasoning (this is like the incident in 2019...) re-emerges only for **non-routine situations**. When it does, **analogue selection becomes the critical variable**. The wrong comparison case drives a confident, well-executed, wrong response. Analogy is not a fallback — it is a distinct mode with a distinct failure signature.

---

## Decision Frameworks

### When Designing a Decision Agent

| Situation | Guidance |
|-----------|----------|
| Agent operates under time pressure | Build recognition-first: situation classification precedes option generation |
| Agent has rich domain training data | Store situation-type → response-schema mappings as primary knowledge asset |
| Agent must evaluate options | Implement serial simulation (one option at a time, fatal-flaw scan) not scoring matrices |
| Agent is performing well analytically but slowly | Don't add more analysis — add situation prototypes to compress the recognition step |
| Agent is fast but confidently wrong | Audit the situation classification layer, not the reasoning layer |

### When Diagnosing a Decision Failure

```
1. Was the situation classified correctly?
   → If NO: situation misclassification failure (expert solved wrong problem well)
   → Intervention: expectancy monitoring, confirmation-disconfirmation probes

2. If classified correctly — was the response schema appropriate?
   → If NO: inappropriate analogue activation (wrong comparison case)
   → Intervention: analogue validation protocol, check what triggered the match

3. If schema appropriate — was the simulation adequate?
   → If NO: progressive deepening failure (fatal flaw passed undetected)
   → Intervention: failure-mode-focused simulation, adversarial probing of the option
```

### When Structuring Multi-Agent Coordination

- **If agents share a situation schema**: coordination can be lightweight — broadcast expectancies, not instructions
- **If agents have divergent situation models**: synchronize schemas first; action coordination on top of misaligned models produces coherent-looking but fragile execution
- **If a central orchestrator exists**: its role is schema synchronization and expectancy broadcasting, not action assignment
- **If coordination is failing despite good individual performance**: check for schema divergence at the situation-assessment layer

### When Choosing Analytical vs. Recognition-Based Approach

```
Is the decision maker experienced in this domain?
  NO  → Analytical methods appropriate (novice has no prototypes to activate)
  YES → Is there adequate time?
          YES and LOW STAKES → Analytical methods can add value as audit
          NO or HIGH STAKES  → Recognition-first; analytical overlay degrades performance
```

---

## Reference Files

- `references/recognition-primed-decision-core-model.md` — Core RPD framework: situation assessment, recognition, expectancies, mental simulation. **Read when** designing decision agents or understanding how experts actually decide.
- `references/rpd-recognition-primed-decision-model.md` — RPD model architecture and why it differs from normative decision theory. **Read when** building agent systems that must operate under time pressure.
- `references/situation-assessment-as-primary-intelligence.md` — Why situation understanding, not option selection, is the hard cognitive problem. **Read when** diagnosing why a decision process is slow or paralyzed.
- `references/situation-assessment-the-overlooked-half-of-decision-making.md` — How experts prioritize situation assessment over option comparison. **Read when** evaluating whether analytical methods are harming expert performance.
- `references/expertise-as-situational-knowledge-not-analytical-power.md` — Expertise is pattern recognition, not faster calculation. **Read when** designing expertise models or training systems.
- `references/expertise-gap-cues-vs-inferences.md` — Experts and novices see same cues but draw different inferences. **Read when** understanding why novice interventions fail on experts.
- `references/analogical-reasoning-and-its-failure-modes.md` — Analogical reasoning is rare; recognition is primary. **Read when** deciding whether to build case-based reasoning into an agent.
- `references/progressive-deepening-mental-simulation-as-evaluation-tool.md` — Mental simulation replaces option scoring. **Read when** implementing option evaluation without multi-criteria comparison.
- `references/progressive-deepening-mental-simulation-as-evaluation.md` — How experts trace execution paths to evaluate options. **Read when** building mental simulation checkpoints into agent design.
- `references/serial-evaluation-and-satisficing-under-time-pressure.md` — Why first-good-answer beats optimization under pressure. **Read when** choosing between satisficing and exhaustive search.
- `references/serial-evaluation-vs-concurrent-comparison.md` — Serial evaluation vs. concurrent comparison in expert cognition. **Read when** structuring how agents should evaluate candidate actions.
- `references/analytical-prescriptions-vs-recognitional-expertise.md` — Why universal analytical methods harm expert performance. **Read when** deciding whether to impose structured decision processes on experienced agents.
- `references/why-analytical-decision-methods-fail-experts.md` — How analytical tools break recognition-capable systems. **Read when** diagnosing why a decision aid is slowing experts down.
- `references/novice-vs-expert-error-patterns.md` — Experts and novices fail differently; interventions must match expertise level. **Read when** designing error recovery or post-mortem protocols.
- `references/failure-modes-in-operational-decision-systems.md` — Breakdown conditions for RPD; graceful failure design. **Read when** building robustness into decision-capable agents.
- `references/critical-decision-method-eliciting-knowledge-from-experts.md` — CDM protocol for extracting tacit expert knowledge. **Read when** interviewing experts to build situation classification schemas.
- `references/critical-decision-method-for-knowledge-elicitation.md` — CDM methodology for surfacing automatic expertise. **Read when** conducting knowledge elicitation for agent design.
- `references/distributed-decision-making-and-coordination-without-central-control.md` — Multi-agent coordination via shared situation models, not central control. **Read when** designing distributed agent teams.
- `references/distributed-decision-making-without-central-control.md` — Wildland fire incident command as model of decentralized coordination. **Read when** structuring multi-agent orchestration without central authority.

## Anti-Patterns

**Forcing experts to compare options explicitly.**
Comparison is not a universal cognitive upgrade. For experts under pressure, it is a regression to a slower, less calibrated process. Don't require it unless time and stakes allow.

**Treating fast decision making as shallow decision making.**
Speed in experts reflects deep pattern recognition, not cognitive shortcuts. Fast + confident + wrong is a situation-classification problem, not a deliberation-depth problem.

**Assuming more analysis = better decisions.**
The research directly contradicts this for experienced actors in time-pressured domains. Analysis without recognition produces slow, brittle decisions. Recognition without analysis produces fast, flexible ones — with specific, manageable failure modes.

**Building agent coordination on action protocols rather than shared situation models.**
Agents who agree on what they're doing but disagree on what the situation is will coordinate locally and fail systemically. Schema alignment is load-bearing.

**Treating analogical reasoning as safe because it's expert reasoning.**
Analogy is one of the primary mechanisms of confident expert error. An expert reasoning from the wrong case is more dangerous than a novice who knows they don't know — the expert's conviction is high and their execution is competent in the wrong direction.

**Eliciting expert knowledge through self-report alone.**
Experts cannot reliably report their own decision processes. The cognitive operations that produce expert performance are largely tacit and inaccessible to introspection. Self-report produces rationalized reconstructions, not process descriptions.

**Applying RPD as a justification for not designing decision support.**
RPD shows that certain types of support fail experts. It does not argue for removing all support. Expectancy monitoring, schema validation tools, and analogue checking are all RPD-consistent interventions.

---

## Shibboleths

How to tell if someone has truly internalized this work vs. skimmed a summary:

**They talk about situation assessment, not option selection.**
Someone who absorbed the book leads with "what situation type is this?" before "what should we do?" Someone who read a summary leads with the RPD label and skips to the recognition-response shortcut.

**They distinguish the three RPD variants.**
Casual familiarity produces "experts recognize patterns and act." Deep familiarity knows that simple recognition, diagnosed recognition, and creative evaluation are structurally distinct — with different failure modes and different support needs.

**They understand that analogy is a failure mode, not just a technique.**
Summary readers treat analogical reasoning as an expert tool. Book readers know that Klein's team expected analogy to be central and found it was marginal — and that when it appears, it is where the most damaging errors enter.

**They can describe what progressive deepening actually does.**
Not "experts imagine the option playing out" (summary) but "experts run a forward simulation looking for the first fatal flaw, then either modify or reject and proceed to the next option serially, drawing on domain knowledge to direct attention toward the most probable failure points" (internalized).

**They resist the urge to prescribe analytical methods as a universal improvement.**
Someone who has internalized Klein asks "is this actor experienced?" and "what are the time and stakes constraints?" before recommending any decision structure. Someone who hasn't will add decision matrices reflexively.

**They know that novice and expert errors require different fixes.**
Summary readers treat error reduction as uniform. Book readers know that novices err by failing to act on available cues (thin situation model) while experts err by acting on confidently misclassified situations — and that the intervention for one makes the other worse.