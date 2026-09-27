---
name: law-enforcement-decision-making-during-crisis
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
          Structured methodology for diagnosing whether a high-stakes decision should use recognition-and-act vs.
          deliberate-and-compare, calibrated to time pressure and situation familiarity
        format: markdown
      - kind: critique
        description: >-
          Post-hoc analysis of a failed decision, identifying whether failure originated in situation assessment, action
          selection, or premature closure
        format: markdown
      - kind: knowledge-elicitation-plan
        description: >-
          Structured interview protocol and retrospective reconstruction method to surface tacit expert knowledge from
          decision-makers
        format: markdown
      - kind: agent-architecture-design
        description: >-
          Specification for building pattern-recognition-first decision systems with explicit satisficing thresholds and
          situation-model validation gates
        format: markdown
---
# SKILL.md: Naturalistic Decision Making for High-Stakes Domains

license: Apache-2.0
```yaml
metadata:
  name: naturalistic-decision-making
  version: 1.0
  source: "Zimmerman, L.A. (2006). Law Enforcement Decision Making During Critical Incidents"
  domain: expert-cognition, decision-making, agent-architecture
  activation_triggers:
    - "how should I handle this under time pressure"
    - "expert vs novice decision making"
    - "when to act vs when to analyze"
    - "building knowledge bases from expert knowledge"
    - "why did this decision fail"
    - "how do I handle incomplete information"
    - "pattern recognition vs deliberation"
    - "satisficing vs optimizing"
    - "situation assessment"
    - "tacit knowledge elicitation"
```

---

## When to Use This Skill

Load this skill when facing problems that involve:

- **Time-pressured decisions** where analytic comparison of all options is not feasible
- **Ambiguous situations** where the facts are incomplete and action is still required
- **Diagnosing decision failures** — understanding *why* something went wrong, not just *what* went wrong
- **Designing agent decision architectures** — especially where the agent must behave reliably under uncertainty
- **Extracting expert knowledge** to encode into systems, prompts, or documentation
- **Assessing expertise level** of a system or agent to calibrate appropriate behavior
- **Distinguishing situation assessment from action selection** when debugging poor outcomes

This is **not** a general optimization or planning skill. It is specifically for understanding and replicating expert cognition in high-stakes, dynamic, time-pressured conditions.

---

## Core Mental Models

### 1. Recognition Before Deliberation
Experts don't compare options — they recognize situations. When a pattern matches a stored mental model, they generate **one plausible course of action** and mentally simulate its consequences. Only when simulation fails do they generate an alternative. This is faster than analysis and surprisingly reliable — but only if the mental model library is rich enough.

> **Agent implication**: Build pattern-matching first. Reserve option-generation for genuine novelty. Never enumerate all options as a default.

---

### 2. Situation Assessment Is the Core Skill
The primary separator between expert and novice is not better action selection — it is better understanding of *what is happening*. Experts invest cognitive resources in building a coherent "situation model" (cues → story → prediction) before selecting action. Novices skip to action scripts.

> **Agent implication**: Diagnosis quality determines outcome quality. A correct action applied to a misread situation fails. Invest in reading the situation before choosing the action.

---

### 3. The Five-Stage Expertise Arc Has Predictable Failure Modes
Novice → Advanced Beginner → Competent → Proficient → Expert. Each stage has characteristic decision signatures and failure modes. **Competent** is paradoxically most dangerous: the agent starts breaking rules but lacks the situational models to know when rule-breaking is safe.

> **Agent implication**: Know your level. Novice agents should follow rules strictly. Expert agents can adapt — but only if they have the situational models to justify adaptation. Competent agents claiming expert flexibility are a hazard.

---

### 4. Satisficing Is Rational, Not a Fallback
Under real-world constraints, the optimal strategy is the **first solution that clears an acceptable threshold**, not the globally best solution. The goal is to stop searching when a solution is good enough, given: time available, cost of error, and situation familiarity.

> **Agent implication**: Build explicit stop-search rules. Unbounded optimization in time-pressured contexts is not sophistication — it is a failure mode that produces decision paralysis or delayed action.

---

### 5. Tacit Knowledge Requires Structured Elicitation
Experts cannot directly report how they decide. But structured retrospective interviews — timeline reconstruction, progressive deepening, hypothetical probing ("what would have changed your read?") — can surface the cues, heuristics, and mental models they cannot otherwise articulate.

> **Agent implication**: You cannot build an expert agent from explicit rules alone. The knowledge that matters is the knowledge experts don't know they have. Eliciting it requires specific, multi-pass methodology.

---

## Decision Frameworks

### Should I recognize-and-act or deliberate-and-compare?

```
Is the situation pattern-matchable to prior experience?
  YES → Generate one plausible action. Mentally simulate consequences.
         Simulation passes? → Act.
         Simulation fails? → Modify action or generate next candidate.
  NO  → Is this a genuine novelty or a failure of pattern library?
         Genuine novelty → Deliberate carefully. Document for future pattern addition.
         Pattern library gap → Flag as training/knowledge gap. Proceed with explicit uncertainty.
```

---

### The Quick Test: When to think vs. when to act

```
Is delay acceptable given time pressure?     NO → Act on best current read
Is the cost of error catastrophic?           YES → Think longer before acting
Is the situation unfamiliar or atypical?     YES → Slow down; situation assessment first
Are cues conflicting or incomplete?          YES → Seek targeted information; don't act blind
```
> See: `references/satisficing-and-the-quick-test.md`

---

### Diagnosing a decision failure

```
Did the action fail because the situation was misread?
  YES → Failure is in SITUATION ASSESSMENT. Review cue interpretation, not action selection.
Did the action fail because the wrong action was chosen from a correct read?
  YES → Failure is in ACTION SELECTION. Review option generation or simulation quality.
Did the agent act before completing situation assessment?
  YES → Failure is in PREMATURE CLOSURE. Novice or Competent-stage behavior.
Did the agent keep analyzing past the point where action was needed?
  YES → Failure is in DECISION PARALYSIS. Satisficing rules were absent or violated.
```
> See: `references/failure-modes-in-high-stakes-dynamic-systems.md`

---

### Calibrating behavior to expertise level

```
Agent is Novice or Advanced Beginner?
  → Follow rules strictly. Do not improvise. Flag uncertainty explicitly.
Agent is Competent?
  → Rules apply. Beginning to see exceptions — but do not act on exceptions
    without explicit situational justification. This is the danger zone.
Agent is Proficient or Expert?
  → Pattern recognition is reliable. Intuitive reads are trustworthy signals.
    Anomalies in intuition should be examined, not overridden automatically.
```
> See: `references/expert-vs-novice-decision-signatures.md`

---

### Building a knowledge base from expert knowledge

```
Start with: Simulate realistic scenarios (don't use retrospective verbal reports alone)
Then: Structured CDM interview — timeline reconstruction → progressive deepening → hypotheticals
Extract: Cues noticed, mental models applied, decision points, what would have changed the read
Encode as: Pattern + Situation Model + Prediction + Action + Simulation result
Validate: Have other experts challenge the encoded model
```
> See: `references/tacit-knowledge-elicitation-for-agent-knowledge-bases.md`

---

## Reference Files

- `references/recognition-primed-decision-making.md` — How experts bypass option comparison and recognize correct actions instantly. **Read when** designing pattern-matching-first agent architectures or understanding why deliberation fails under time pressure.

- `references/situation-assessment-as-the-critical-skill.md` — Expert performance depends on situation understanding, not action selection. **Read when** diagnosing why a decision failed or building robust situation-model validation.

- `references/expert-novice-gap-in-situation-assessment.md` — Experts see differently because they organize knowledge into coherent patterns, not just accumulate facts. **Read when** assessing agent expertise level or designing knowledge transfer.

- `references/expert-vs-novice-decision-signatures.md` — Five-stage skill arc with characteristic failure modes at each level. **Read when** identifying where a system sits on the novice-to-expert spectrum.

- `references/failure-modes-in-high-stakes-dynamic-systems.md` — Taxonomy of failure patterns in complex systems. **Read when** designing safeguards or post-hoc analyzing a failed decision.

- `references/failure-modes-plan-fixation-and-update-failure.md` — Why good initial plans become catastrophic when situations change. **Read when** understanding persistence of wrong decisions or building situation-update mechanisms.

- `references/satisficing-and-the-quick-test.md` — How to decide when to deliberate vs. act under time pressure. **Read when** calibrating satisficing thresholds or designing decision gates.

- `references/tacit-knowledge-elicitation-and-the-cdm.md` — Critical Decision Method for extracting expert knowledge that experts cannot consciously articulate. **Read when** building knowledge bases from expert interviews.

- `references/tacit-knowledge-elicitation-for-agent-knowledge-bases.md` — Structured CDM protocol and retrospective reconstruction for knowledge transfer. **Read when** planning expert knowledge elicitation sessions.

- `references/ten-characteristics-of-naturalistic-decision-environments.md` — Field conditions that break lab decision theory. **Read when** understanding why classical models fail or validating agent behavior in realistic conditions.

- `references/uncertainty-acceptance-and-information-seeking.md` — How experts operate effectively without complete information. **Read when** designing information-seeking strategies or handling incomplete data.

- `references/situation-awareness-decomposition-and-coordination.md` — Shared situation models and coordination without central control. **Read when** building multi-agent systems or distributed decision-making architectures.

- `references/training-for-expertise-deliberate-practice-and-the-experience-bank.md` — Building mental models through structured practice, not raw experience. **Read when** designing training curricula or understanding expertise development.

- `references/the-three-pronged-framework-observation-interview-training.md` — Integrated method combining observation, interview, and training to improve decision processes. **Read when** planning comprehensive decision-system improvement initiatives.

- `references/recognition-primed-decision-making-for-agents.md` — Agent-specific implications of recognition-primed models. **Read when** implementing pattern-recognition systems or designing mental simulation gates.
- `references/decisions-about-behavior-the-hardest-domain.md` — (auto-added; describe on next pass)

## Anti-Patterns

These are the mistakes this framework specifically warns against:

**1. Option enumeration as default**
Generating all possible actions before choosing is a novice pattern mistaken for rigor. Under time pressure, it is a failure mode. Experts don't enumerate — they recognize and simulate.

**2. Treating situation assessment as a formality**
Jumping to action selection before the situation is adequately understood. The action may be technically correct and still fail because the read was wrong.

**3. Competent-stage overconfidence**
Beginning to deviate from rules without having the situational models that make rule-deviation safe. The most dangerous expertise level is Competent — enough experience to improvise, not enough to know when improvisation is warranted.

**4. Unbounded optimization**
Treating "find the best solution" as always superior to "find a good-enough solution quickly." In dynamic, time-pressured conditions, optimization that delays action is a form of failure.

**5. Eliciting expert knowledge through direct self-report**
Asking experts "how do you decide?" and taking the answer at face value. Experts' verbal accounts of their own cognition are systematically incomplete. The knowledge that matters is tacit and requires structured extraction methodology.

**6. Treating uncertainty as a blocker**
Waiting for complete information before acting. Expert systems operate under irreducible uncertainty and must act on probabilistic situation models while remaining alert to disconfirming cues.

**7. Assuming failure is in action selection**
When reviewing bad outcomes, defaulting to "we chose the wrong action." Most expert-level failures are in situation assessment — the action was reasonable given the (incorrect) read.

---

## Shibboleths

*How to tell if someone has actually internalized this framework — versus just having read about it.*

**They say "what was the situation assessment?" before "what action did they take?"**
Someone who has internalized NDM goes to diagnosis before judgment. Novice thinkers evaluate the action; expert thinkers first ask whether the situation was correctly read.

**They distinguish between "not enough options generated" and "wrong situation model"**
Surface readers conflate decision failure types. Internalized thinkers immediately ask: was this a failure of recognition, simulation, or situation assessment?

**They treat satisficing as principled, not as settling**
Naive readers see satisficing as "doing your best with limited time." Internalized thinkers understand it as a *rational strategy* with explicit stop-search logic — not a concession to imperfection.

**They are suspicious of expert self-reports**
Someone who has really absorbed this framework knows that what experts *say* they do and what they *actually* do are systematically different. They design elicitation processes accordingly — they don't just interview.

**They can name what's dangerous about the Competent stage**
Novice → Expert is not a monotonic improvement in safety. The Competent stage is specifically hazardous because rule-breaking begins before situational models are rich enough to justify it. This is non-obvious and only retained through genuine engagement.

**They ask "what cues was the agent responding to?" before evaluating the response**
The cue-interpretation-action chain is central to NDM. Someone who has internalized the framework diagnoses from cues forward, not from outcomes backward.

**They treat intuition as data, not noise**
Expert intuition (feeling that something is wrong, that a situation is atypical) is the output of unconscious pattern-matching against rich experience. Internalized NDM practitioners treat strong intuitions as signals requiring investigation — not as irrationality to be suppressed.

---

*Load reference files on demand. This index is the activation point — go deeper only where the problem demands it.*