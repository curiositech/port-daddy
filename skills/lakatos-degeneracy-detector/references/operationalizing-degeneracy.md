# Per-Skill Revision Tracking and the Degeneracy Ratio

When a skill accumulates NOT_FOR clauses faster than WHEN_TO_USE clauses, it is exhibiting the Lakatosian pattern of a degenerating research programme: every failed application produces a protective belt of exclusions rather than a positive extension of the programme's scope. This document operationalizes that diagnostic at the per-skill level.

## The Degeneracy Ratio

Define two quantities tracked across the revision history of a single skill's SKILL.md:

- **Δ(NOT_FOR)**: the count of distinct NOT_FOR clause additions since the skill's initial commit (or since the last measurement window)
- **Δ(WHEN_TO_USE)**: the count of distinct WHEN_TO_USE clause additions over the same window

The **degeneracy ratio** for a skill over a revision window is:

```
R_d = Δ(NOT_FOR) / max(Δ(WHEN_TO_USE), 1)
```

The `max(..., 1)` guard prevents division-by-zero when no WHEN_TO_USE clauses were added. A ratio above **2.0** is the ALERT threshold. A ratio above **4.0** constitutes a degeneration signal requiring review-board intervention (not just logging).

## Computing the Ratio from Git History

Given a skill at path `skills/<name>/SKILL.md`, extract clause deltas across revisions:

```bash
git log --follow --diff-filter=M -p -- skills/<name>/SKILL.md \
  | grep '^+' | grep -v '^+++' \
  | awk '
    /NOT_FOR/      { not_for++ }
    /WHEN_TO_USE/  { when_to_use++ }
    END { print not_for, when_to_use }
  '
```

This counts lines added (prefix `+`) containing each marker. For structured SKILL.md formats (YAML frontmatter or sectioned markdown), parse section-level additions rather than raw line matches to avoid false positives from context lines.

A windowing parameter is important: measuring from initial commit catches total programme drift; measuring over the last N commits (e.g., N=10) catches recent acceleration. Both are useful. The detector should emit both a **cumulative ratio** and a **recent-window ratio** (last 5 revisions).

## What the Threshold Means

**R_d > 2.0** means NOT_FOR clauses are accumulating at more than twice the rate of positive scope additions. Operationally: the skill is being shrunk by exclusion faster than it is being grown by capability. This is the Lakatosian signature of a protective belt thickening around a contracting hard core.

**Alert action**: flag the skill for scope audit. The question is whether the NOT_FOR clauses represent legitimate precision (distinguishing this skill from others that handle those cases) or defensive avoidance (excluding cases the skill should handle but fails at).

**R_d > 4.0** means the skill is almost certainly degenerating. Every new deployment attempt is generating an exclusion rather than a positive finding. The hard core — the skill's central claim about what it does — is no longer generating novel predictions. At this ratio, the skill should be:
1. Suspended from production routing
2. Queued for rewrite or decomposition into narrower skills
3. Documented in the skill registry with status `DEGENERATE`

## Distinguishing Precision from Degeneracy

Not all NOT_FOR growth is degeneracy. A skill that adds NOT_FOR clauses because it is being refined to hand off adjacent cases to more specialized skills is exhibiting healthy programme differentiation. The signal to distinguish them:

- **Healthy**: new NOT_FOR clauses coincide with the creation or promotion of a sibling skill that handles those cases
- **Degenerate**: new NOT_FOR clauses have no corresponding sibling skill handling the excluded cases; the cases simply disappear from coverage

The detector should cross-reference NOT_FOR additions against the skill registry: if an excluded case is claimed by another registered skill within the same revision window, discount that NOT_FOR from the degeneracy count. The adjusted ratio:

```
R_d_adj = (Δ(NOT_FOR) - Δ(NOT_FOR_covered_by_sibling)) / max(Δ(WHEN_TO_USE), 1)
```

Use R_d_adj as the primary metric. R_d_raw is a leading indicator.

## Key Points

- Degeneracy ratio is `Δ(NOT_FOR) / max(Δ(WHEN_TO_USE), 1)`; ALERT at 2.0, DEGENERATE at 4.0
- Measure both cumulative (from initial commit) and recent-window (last 5 revisions) to catch both slow drift and sudden acceleration
- NOT_FOR additions that transfer coverage to a sibling skill are healthy differentiation — subtract them from the degeneracy numerator
- The alert means: audit whether exclusions reflect precision or avoidance; degenerate status means suspend and rewrite
- Compute via `git log -p` line-diff on SKILL.md, filtering added lines by section marker, not raw substring

## See Also

- `lakatos-degeneracy-detector/references/lakatosian-framework.md` — the theoretical basis (hard core, protective belt, positive vs negative heuristic)
- `lakatos-degeneracy-detector/references/skill-revision-audit-protocol.md` — the full audit workflow triggered by an ALERT
- `windags-skill-selector` — the routing skill whose NOT_FOR/WHEN_TO_USE balance this metric is designed to protect
