---
license: BUSL-1.1
name: windags-skill-cdm-elicitation
description: 'Runs CDM (Critical Decision Method) interviews to elicit the perceptual layer missing from science-only SKILL.md files. Activate when: Looking Back Q3 fires with scope≠narrow, a pattern_crystallization event is detected, a skill underperforms (expectancy_violation), or a novel task has no catalog match. Produces structured SKILL.md v2 metadata: recognition-cues, expectancies, decision-cues, adaptive-workarounds. NOT for: general Q&A, skill selection, DAG execution.'
allowed-tools: Read,Write,Edit
category: Agent & Orchestration
tags:
  - skill-creation
  - cdm
  - elicitation
  - knowledge-capture
  - cci
pairs-with:
  - skill: skill-architect
    reason: CDM output feeds skill-architect to produce the final SKILL.md draft
  - skill: windags-looking-back
    reason: Looking Back Q3 fires this elicitation; Q4 feeds taxonomy updates
io-contract:
  kind: structured
  outputSchema: ./schemas/output.json
metadata:
  recognition-cues:
    - "Looking Back Q3 returns q3_generalizable=true with scope=medium or broad"
    - "Session log shows 3+ consecutive failures on same subtask then success"
    - "A skill was injected but confidence score < 0.4 after execution"
    - "Task completes with BM25 top-score below 0.35 (no catalog match)"
  expectancies:
    - "Interview produces at least 3 decision-cue entries mapping branch → cue → indicates"
    - "Recognition-cues describe the task description, not the task category"
    - "Adaptive-workarounds capture at least one departure from the documented procedure"
    - "Output maps cleanly to SKILL.md v2 metadata fields with no ambiguity"
  decision-cues:
    - branch: "Select pattern_crystallization interview (fail→succeed)"
      cue: "Session shows N failures then success on same subtask within one session"
      indicates: "Expert knowledge just crystallized — hot cognition, interview NOW"
    - branch: "Select pattern_extension interview (novel success)"
      cue: "Task completed with high confidence AND BM25 top-score below 0.35"
      indicates: "New pattern not in catalog — extract recognition boundary via contrast"
    - branch: "Select expectancy_violation interview (skill underperformed)"
      cue: "Skill was injected AND confidence < 0.4 AND which_expectancy is known"
      indicates: "Skill's causal model is wrong or its NOT-FOR boundary needs extension"
  adaptive-workarounds:
    - "When the session expert (LLM) says 'I don't know why it worked' — use the timeline probe before the decision-point probe, the sequence reveals the cue"
    - "When interview produces abstract answers — ask 'What does the task description look like when you recognize this?' not 'When do you use this skill?'"
  execution-pattern: sequential
  needs-cdm: false
---

# WinDAGs Skill CDM Elicitation

Runs Critical Decision Method interviews to extract the perceptual layer that makes
skills expert-level rather than just procedural (science-only).

## When to Activate

**Activate on:**
- "Looking Back Q3 fired" / "Q3 scope=broad" / "Q3 scope=medium"
- "pattern crystallization" / "skill needs CDM" / "elicitation interview"
- "skill underperformed" / "expectancy violation" / "which expectancy failed"
- `needs-cdm: true` in any skill's metadata

**NOT for:**
- General skill writing (use `skill-architect`)
- Post-execution quality review (use `windags-looking-back`)
- Skill selection during DAG planning (use skill-selector)

## Three Interview Protocols

Choose based on the trigger type. Each targets a different knowledge layer.

---

### Protocol A: Pattern Crystallization (fail→succeed)

**When:** 3+ consecutive failures then success on the same subtask, within one session.

**Why this protocol:** Hot cognition. The expert (LLM session) just solved a hard problem.
The solution path is maximally articulable RIGHT NOW. This is the moment Klein calls
"crystallization" — a new entry is being added to the pattern library.

**Probe sequence:**

1. **Timeline reconstruction** (extracts the contrast cases automatically):
   > "Walk me through the attempts that failed. What did you try first? Then what?"

2. **Switch-point probe** (extracts the key decision cue):
   > "At attempt [N-1], what changed that made you try something different?
   > What were you noticing or observing at that point?"

3. **What-if probe** (extracts the implicit prerequisite — the thing that would have
   let you succeed on attempt 1):
   > "If you had known [X] from the start, would attempt 1 have worked?
   > What is X?"

4. **Cue inventory probe** (extracts the recognition signal):
   > "What does the task description look like — what are you reading or detecting —
   > when you know this approach is the right one?"

5. **Workaround probe** (extracts the art layer — what wasn't in any existing skill):
   > "Was there anything you did that you wouldn't find in a standard guide?
   > Any departure from the usual approach?"

**Output mapping:**
- Timeline → `worked-example` section in SKILL.md body
- Switch-point + What-if → `decision-cues` entry (branch, cue, indicates)
- Cue inventory → `recognition-cues` list
- Workaround → `adaptive-workarounds` list
- What the agent expected → `expectancies` list

---

### Protocol B: Pattern Extension (novel success, no catalog match)

**When:** Task completed successfully AND BM25 top-score below 0.35 (no close match in catalog).

**Why this protocol:** A new domain or technique was used that the catalog doesn't cover.
The goal is to extract the DISCRIMINATION BOUNDARY — what makes this skill different from
the adjacent ones it might be confused with.

**Probe sequence:**

1. **Domain description** (extracts what category this skill belongs to):
   > "Describe what kind of task you just completed in one sentence, as if naming a job title."

2. **Contrast probe** (extracts the recognition boundary — what makes this skill unique):
   > "What's the closest existing skill or approach this could be confused with?
   > How would you know THIS situation needs this skill rather than that one?"

3. **Anti-pattern probe** (extracts the failure modes that aren't obvious):
   > "What would a naive approach do here that this approach avoids?
   > What's the canonical mistake?"

4. **Cue inventory** (as in Protocol A, probe 4):
   > "What does the task description look like when this skill applies?"

5. **Scope probe** (helps the auditor classify this as narrow/medium/broad):
   > "Can you describe 3 other tasks where the same approach would work?
   > And 2 tasks that LOOK similar but where it wouldn't apply?"

**Output mapping:**
- Domain description → `name` and `category` in frontmatter
- Contrast → `NOT for` section + at least 2 `decision-cues` entries
- Anti-pattern → `Failure Modes` section in body
- Cue inventory → `recognition-cues` list
- Scope → determines whether to create new skill or extend existing one

---

### Protocol C: Expectancy Violation (skill underperformed)

**When:** Skill was injected AND confidence < 0.4 AND `which_expectancy` is known from the trigger event.

**Why this protocol:** The skill's causal model is wrong. Either the NOT-FOR boundary is too
narrow, the expectancies are incorrect, or the causal chain in a Decision Point is broken.
This is a surgical update, not a full skill rewrite.

**Probe sequence:**

1. **Violation reconstruction** (extracts exactly what failed):
   > "The skill said [expectancy text]. What actually happened instead?"

2. **Constraint probe** (extracts the missing L1 constraint):
   > "What was true about this situation that the skill's expectancy didn't account for?"

3. **Discrimination probe** (determines if NOT-FOR needs extending):
   > "Would this situation have been excluded by a more precise NOT-FOR clause?
   > How would you describe the situation type that the skill doesn't apply to?"

4. **Causal probe** (extracts why the skill's causal model was wrong):
   > "Why did the documented approach fail here? What's the mechanism?"

**Output mapping:**
- Violation reconstruction → update existing `expectancy` entry OR remove incorrect one
- Constraint probe → new `decision-cues` entry OR update existing Decision Point branch
- Discrimination → extend `NOT for` section in skill body
- Causal probe → update or add `Failure Modes` entry

---

## Producing SKILL.md v2 Metadata

After running the appropriate protocol, structure the output as:

```yaml
metadata:
  recognition-cues:
    - "[specific situation description — what the task looks like, not the category name]"
    - "[second distinct recognition signal]"
  expectancies:
    - "[what should happen within the session if the skill is working]"
    - "[observable outcome that confirms correct application]"
  decision-cues:
    - branch: "[which Decision Point branch this gates]"
      cue: "[the textual/contextual signal that triggers this branch]"
      indicates: "[what the signal means about the situation]"
    - branch: "[second branch]"
      cue: "[second signal]"
      indicates: "[what it means]"
    - branch: "[third branch — minimum 3 for full CCI coverage]"
      cue: "[third signal]"
      indicates: "[what it means]"
  adaptive-workarounds:
    - "[departure from procedure that experts use in edge cases]"
  execution-pattern: sequential | loop | monitor-and-react
  needs-cdm: false
```

## Quality Gates

- [ ] Interview followed the protocol for the trigger type (A/B/C), not a generic Q&A
- [ ] Recognition-cues describe task DESCRIPTIONS, not abstract category labels
- [ ] Minimum 3 decision-cue entries produced (below 3 = still science-only-risk)
- [ ] At least 1 adaptive-workaround captured (the art layer, not the procedure)
- [ ] Expectancies describe OBSERVABLE OUTCOMES within the session, not abstract goals
- [ ] Output validated against SKILL.md v2 schema before writing to file
- [ ] `needs-cdm` set to `false` after successful elicitation
- [ ] skill-architect reviewed the draft before committing

## NOT-FOR Boundaries

**Do NOT use this skill for:**
- Writing skill BODIES (use `skill-architect` for prose sections)
- Evaluating skill quality scores (use `windags-looking-back`)
- Selecting skills for a DAG node (use `skill-selector`)
- Conducting general UX research or customer discovery
- Running CDM on non-skill domains (use `cdm-interviewer`)
