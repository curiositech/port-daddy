# Skill Scoring Rubric

Use this rubric for per-skill scorecards and bulk-upgrade triage.

## Dimensions

Score each dimension `0-10`.

### 1. Activation precision

- How specific is the description?
- Does it include a strong NOT-for clause?
- Does it avoid false positives?

### 2. Runtime correctness

- Are Claude Code runtime claims current?
- Are native runtime-only fields used only when justified?
- Are hooks, channels, and scheduled tasks described accurately?

### 3. Knowledge depth

- L1 present
- L2 present
- L3 present
- expert shibboleths, contrastive cues, and recovery moves

### 4. Progressive disclosure

- `SKILL.md` stays lean
- references are on-demand
- support files reduce context rather than duplicate it

### 5. Structural completeness

- decision points
- failure modes
- worked examples
- quality gates
- NOT-for boundaries

### 6. Affordance discipline

- scripts used where determinism matters
- templates used where output regularity matters
- examples used where trigger or output boundaries are subtle
- browser-open or HTML artifacts only where materially useful

### 7. Reference hygiene

- referenced files exist
- `references/INDEX.md` exists when references are non-trivial
- no giant unlabeled dumps

### 8. Maintainability

- `CHANGELOG.md` exists and is current
- the skill is modular enough to update without rewriting everything
- validation or scorecard tooling exists where the skill is important

## Composite grade

Use either:

- simple average across dimensions, or
- a weighted score where Activation, Runtime Correctness, and Knowledge Depth count double for high-impact skills

Suggested grades:

| Score | Grade |
|---|---|
| 9.0-10.0 | A |
| 7.5-8.9 | B |
| 6.0-7.4 | C |
| 4.0-5.9 | D |
| <4.0 | F |

## Fast bulk heuristics

- Activation weak if description is vague or missing NOT-for.
- Runtime weak if the skill confuses hooks, channels, scheduled tasks, or fork semantics.
- Progressive disclosure weak if `SKILL.md` is huge and references are absent.
- Structural completeness weak if the core L3 sections are missing.
- Affordance discipline weak if scripts, templates, or examples are absent where the skill obviously needs them, or present without any justification.

## Useful automation

```bash
python scripts/validate_skill.py /path/to/skill
python scripts/check_self_contained.py /path/to/skill
python scripts/audit-skills.py --json
```
