---
name: evaluating-rapport-based-approach
description: >-
  Apply rapport-based elicitation to resistant or semi-cooperative humans and agents. Use when coercive prompting or
  brittle handoffs damage cooperation. NOT for routine cooperative tasks, pure technical debugging, or already reliable
  exchanges.
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
    - rapport
    - interviewing
    - cooperation
    - resistance
    - elicitation
    - training
  pairs-with:
    - skill: rapport-based-elicitation
      reason: Use it when you need the broader practice surface around rapport-driven extraction and cooperation.
    - skill: expert-knowledge-elicitation
      reason: Rapport is often the prerequisite for surfacing expert reasoning that resists direct extraction.
  provenance:
    kind: legacy-recovered
    sourceDocument: >-
      Evaluating the Benefits of a Rapport-Based Approach to Investigative Interviews: A Training Study With Law
      Enforcement Investigators
    sourceAuthors:
      - Laure Brimbal
      - Christian A. Meissner
      - Steven M. Kleinman
      - Erik L. Phillips
      - Dominick J. Atkinson
      - Rachel E. Dianiska
      - Jesse N. Rothweiler
      - Simon Oleszkiewicz
      - Matthew S. Jones
    sourceArtifact: .claude/skills/evaluating-rapport-based-approach/_book_identity.json
    importedFrom: legacy-recovery
    owners:
      - some-claude-skills
  authorship:
    authors:
      - Laure Brimbal
      - Christian A. Meissner
      - Steven M. Kleinman
      - Erik L. Phillips
      - Dominick J. Atkinson
      - Rachel E. Dianiska
      - Jesse N. Rothweiler
      - Simon Oleszkiewicz
      - Matthew S. Jones
    maintainers:
      - some-claude-skills
  io-contract:
    kind: deliverable
    produces:
      - kind: critique
        description: >-
          Assessment of whether current interaction failure is rooted in resistance/cooperation breakdown vs. task
          difficulty or system state, with diagnosis of which rapport layer (foundation, conversational, relational) is
          missing.
        format: markdown
      - kind: refactor-plan
        description: >-
          Staged tactic sequence to rebuild cooperation: specific question reframing, listening/narrative adjustments,
          autonomy-support signals, and pressure-signal removal in layered order.
        format: markdown
      - kind: design-doc
        description: >-
          Monitoring framework for the tactic→rapport→cooperation→disclosure causal chain, including behavioral
          indicators to watch, pressure-contamination red flags, and corroboration checkpoints before trusting
          high-stakes output.
        format: markdown
---

# Evaluating the Benefits of a Rapport-Based Approach

Use this skill when the hidden problem is not lack of instructions but a damaged cooperation pathway. The doctrine here is simple: pressure can force words, but it cannot force truthful, high-yield disclosure.

## When to Use

- A human or sub-agent is giving minimal, evasive, or suspiciously polished responses.
- Adding pressure, constraints, or accusation-like framing keeps making output worse.
- A handoff is failing because the receiver does not feel safe, prepared, or respected enough to cooperate.
- The system is over-trusting confidence signals instead of observed behavioral performance.
- You need to reason about why evidence or better tactics are not being adopted in resistant settings.

## NOT for Boundaries

This skill is not the primary tool for:
- Straightforward cooperative tasks where the other party is already responsive and truthful.
- Pure technical root-cause analysis when the main problem is system state, not resistance or cooperation.
- Compliance regimes where the design requirement is rigid procedure execution rather than disclosure quality.
- Situations where the operator is looking for intimidation or output-forcing tactics instead of trustworthy information.

## Core Mental Models

### Coercion Corrupts the Channel

Pressure-based tactics often produce the worst kind of success: output that looks usable but is structurally contaminated by compliance pressure, guesswork, or fabrication.

### Rapport Is a Mediated Causal Chain

The chain is tactic -> perceived rapport -> willingness to cooperate -> disclosure. If the cooperation step never forms, "more extraction pressure" is a category mistake.

### The Layers Must Stack in Order

Foundation questioning comes first, conversational rapport second, relational rapport third. Skipping the lower layers and jumping to high-trust asks is a design failure, not a shortcut.

### Self-Reported Capability Is Not Behavioral Capability

Practitioners and agents often say they understand the tactic while behaving as though they do not. Evaluate the behavior under pressure, not the self-description.

## Decision Points

```mermaid
flowchart TD
  A[Low-yield or resistant interaction] --> B{Foundation questioning stable?}
  B -->|No| C[Fix open questions, listening, and narrative space]
  B -->|Yes| D{Perceived rapport improving?}
  D -->|No| E[Add autonomy support, empathy, adaptation]
  D -->|Yes| F{Cooperation threshold reached?}
  F -->|No| G[Use relational rapport and remove pressure signals]
  F -->|Yes| H[Request disclosure or higher-stakes detail]
  H --> I{Output plausible but suspect?}
  I -->|Yes| J[Check for pressure-induced fabrication and reset]
  I -->|No| K[Continue with calibrated follow-up]
```

### 1. Decide Whether the Problem Is Resistance or Difficulty

- If the counterpart is confused but willing, simplify the task.
- If the counterpart is resistant, treat cooperation-building as the main work.

### 2. Decide Which Layer Is Missing

- Weak questions or no listening means the foundation is missing.
- Good questions with poor willingness signals means conversational rapport is missing.
- Basic cooperation with continued guardedness means relational rapport is the next lever.

### 3. Decide Whether to Trust the Output

- If output arrived only after stronger pressure, distrust it.
- If confidence rose without observable behavioral improvement, distrust the self-report and watch the behavior.

## Failure Modes

### Pressure-Induced Fabrication

**Symptoms:** answers become fluent, fast, and wrong immediately after pressure increases.  
**Recovery:** back out the pressure signal, restore narrative space, and re-check the mediation chain.

### Layer Skipping

**Symptoms:** operators ask for high-stakes disclosure before basic rapport is established.  
**Recovery:** step back to foundation questioning and rebuild in order.

### Resistance Misread as Defiance

**Symptoms:** hesitation is interpreted as obstinacy instead of a cue about trust, fear, or poor framing.  
**Recovery:** treat resistance as diagnostic information about the current interaction design.

### Competence Theater

**Symptoms:** training or prompting sounds correct, but real behavior under stress does not change.  
**Recovery:** evaluate coded behavior and actual disclosure quality, not familiarity or confidence ratings.

### Evidence-With-No-Adoption

**Symptoms:** strong evidence exists for better tactics, yet practitioners keep using the dominant coercive style.  
**Recovery:** provide situated demonstrations in hard cases, not abstract evidence alone.

## Worked Examples

### Example 1: Investigative Interview

An interviewer responds to guarded answers by stacking accusations and constraints. Disclosure quality drops. Switching to open narrative prompts, active listening, and autonomy-supportive framing improves perceived rapport first, then cooperation, then factual yield.

### Example 2: Orchestrator to Sub-Agent Handoff

A coordinator keeps saying "just answer exactly in this format now" to a sub-agent facing an ambiguous synthesis task. The sub-agent returns polished nonsense. Reframing the task with scope, missing-context acknowledgment, and safe partial-output permission restores cooperation and improves truthfulness.

## Quality Gates

- [ ] The current layer failure is identified before adding more pressure.
- [ ] The tactic -> rapport -> cooperation -> disclosure chain is being monitored explicitly.
- [ ] Output obtained under stronger pressure is treated as suspect until corroborated.
- [ ] Behavioral coding or observable performance is preferred over self-assessed competence.
- [ ] Adoption plans include demonstrations in hard, resistant cases rather than evidence in the abstract.

## Reference Files

- `references/autonomy-preservation-in-elicitation.md` — Why interviewers who relinquish control over questioning produce more accurate information. **Read when** designing tactics that respect source agency.
- `references/coercion-contaminates-information.md` — How pressure-based approaches systematically corrupt output quality rather than extract truth. **Read when** diagnosing why coercive prompting backfires.
- `references/coercive-vs-rapport-the-failure-mode-of-forcing-output.md` — Detailed analysis of accusatorial interrogation as a systemic failure mode in resistant systems. **Read when** evaluating why forcing output damages cooperation.
- `references/evidence-based-practice-adoption-barriers.md` — Why proven methods fail to displace inferior ones despite evidence of effectiveness. **Read when** understanding resistance to rapport-based practice change.
- `references/evidence-research-practice-gap-as-systemic-failure.md` — The 50+ year gap between research evidence and law enforcement practice. **Read when** contextualizing institutional barriers to evidence adoption.
- `references/gap-between-knowing-and-doing.md` — Why familiarity with rapport tactics predicts almost nothing about actual competence. **Read when** assessing whether training alone closes the knowing-doing gap.
- `references/information-extraction-as-indirect-problem.md` — The rapport-cooperation-disclosure causal chain as the correct model for resistant sources. **Read when** reframing extraction as an indirect problem requiring relationship mediation.
- `references/knowing-doing-gap-in-expert-systems.md` — Expert self-assessment unreliability: experienced investigators overestimate rapport competence. **Read when** questioning whether confidence signals predict behavioral performance.
- `references/mediated-causal-chains-in-agent-design.md` — Structural equation modeling of training→tactics→rapport→cooperation→disclosure chain. **Read when** designing monitoring frameworks for tactic effectiveness.
- `references/mediation-chains-and-skipping-steps.md` — Why shortcuts through intermediate states break the causal pathway. **Read when** diagnosing why pressure-based tactics fail to accelerate disclosure.
- `references/rapport-as-causal-mechanism-not-social-lubricant.md` — Rapport as causally prior to information elicitation, not parallel to it. **Read when** reframing rapport from nicety to mechanism.
- `references/resistance-as-diagnostic-signal.md` — Reluctance and evasion as data about interaction state, not obstacles to overcome. **Read when** interpreting what source resistance reveals about missing conditions.
- `references/resistance-as-information-not-obstacle.md` — How intelligent systems should process uncooperative counterparts as signals rather than problems. **Read when** reframing resistance as actionable diagnostic information.
- `references/three-layer-elicitation-architecture.md` — Productive questioning, conversational rapport, and relational rapport as ordered, foundational layers. **Read when** diagnosing which rapport layer is missing.
- `references/three-layers-of-rapport-architecture.md` — Three-dimensional rapport architecture: why treating it as a single dial fails. **Read when** designing layered tactic sequences.
- `references/training-transfer-and-skill-erosion.md` — Whether knowledge acquired in training actually changes behavior under real conditions. **Read when** evaluating training effectiveness and behavioral change.
- `references/trust-reciprocity-and-the-cooperative-threshold.md` — How rapport-building lowers the threshold for disclosure by shifting expected value. **Read when** understanding the mechanistic pathway from rapport to cooperation.

## Anti-Patterns

- Treating more pressure as the universal fix for poor yield.
- Asking for high-trust disclosure before creating a cooperative substrate.
- Using self-reported competence as a routing signal for high-stakes work.
- Confusing well-formed output with trustworthy output after a coercive interaction.
