# Example Output: UX Friction Audit

Scenario: auditing the optimized 3-step checkout flow in
`references/worked-examples.md` (Example 1) — the flow *after* the friction
fixes were applied, corresponding to `examples/sample-input.json`.

## Deterministic script output

```
node scripts/friction_audit.mjs --input examples/sample-input.json
```

```json
{
  "pass": true,
  "findings": [],
  "recommendations": []
}
```

No mechanical failure modes triggered: attention elements stay at 3 (under
the working-memory limit of 4), every step auto-saves and preserves context
across interruption, the longest wait (30s) shows progress, no step exceeds
4 mental chunks, and the flow both meets the 44px touch-target minimum and
offers a power-user path.

## Narrative friction-audit report (markdown deliverable)

```markdown
# Friction Audit: Checkout Flow

**Verdict**: PASS — no mechanical failure modes triggered by the deterministic
auditor. Recommend a real-user validation pass (3+ users, WCAG AA check)
before treating this as fully shipped, per the Quality Gates checklist.

## Flow Summary
1. Add items to cart (10s, 1 chunk, focused)
2. Shipping & payment (30s, 3 chunks, time-pressured, auto-saved)
3. Confirm order (3s, 1 chunk, focused)

## Failure-Mode Check
| Failure Mode | Status | Notes |
| --- | --- | --- |
| Overwhelm Cascade | Clear | 3 simultaneous attention elements, primary action obvious |
| Context Switch Death Spiral | Clear | All steps auto-save and preserve context |
| Invisible Progress Paralysis | Clear | 30s payment step shows a progress bar + estimate |
| Micro-Friction Accumulation | Clear | Only 1 step carries 2+ chunks |
| Expert User Imprisonment | Clear | `hasPowerUserPath: true` (saved address, one-click reorder) |

## Quality Gates Still Requiring Human Validation
- [ ] 3+ real users completed the flow unassisted
- [ ] WCAG AA screen-reader pass
- [ ] Task completion time measured against the pre-fix baseline (target: ≥25% reduction)

## Recommendation
Ship to a limited cohort and instrument completion time + abandonment rate
before the full rollout described in the Quality Gates checklist.
```
