# Friction Audit: [Flow Name]

[One-sentence description of the flow being audited and the user intent it serves.]

**Verdict**: [PASS | FAIL] — [one-line summary of why, referencing
`node scripts/friction_audit.mjs --input <flow>.json` output if run].

## Flow Summary

[Numbered list of the flow's steps, each with cognitive state, time, and
chunk count — mirrors `steps[]` in `schemas/flow-audit.schema.json`.]

1. [Step label] ([Xs], [N chunks], [cognitive state])
2. [Step label] ([Xs], [N chunks], [cognitive state])

## Failure-Mode Check

| Failure Mode | Status | Notes |
| --- | --- | --- |
| Overwhelm Cascade | [Clear \| Flagged] | [simultaneous attention elements, primary-action visibility] |
| Context Switch Death Spiral | [Clear \| Flagged] | [auto-save / context-preservation gaps, by step] |
| Invisible Progress Paralysis | [Clear \| Flagged] | [any step >5s with no progress indicator] |
| Micro-Friction Accumulation | [Clear \| Flagged] | [count of steps with 2+ chunks] |
| Expert User Imprisonment | [Clear \| Flagged] | [whether a power-user path exists] |

## Mobile / Touch / Feedback Gates

| Gate | Value | Status |
| --- | --- | --- |
| Min touch target | [Npx] | [Pass \| Fail, threshold 44px] |
| 320px reflow, no h-scroll | [true \| false] | [Pass \| Fail] |
| Feedback within 100ms | [true \| false] | [Pass \| Fail] |

## Quality Gates Still Requiring Human Validation

(These cannot be checked mechanically — see `references/quality-gates.md`.)

- [ ] Task completion time reduced ≥25% from baseline
- [ ] 3+ real users completed the flow unassisted
- [ ] Zero critical WCAG AA violations
- [ ] Cognitive load score ≤6/10 (NASA-TLX or interviews)

## Recommendation

[What to fix first, referencing the `recommendations[]` array from the
deterministic audit and any judgment calls the script cannot make.]

---
Validate the machine-checkable portion with:
`node scripts/friction_audit.mjs --input <this-flow-as-json>.json`
