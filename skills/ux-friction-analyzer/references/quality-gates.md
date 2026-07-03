# Quality Gates

Use this when you need the full checklist before declaring a UX friction
audit complete. `SKILL.md` links here rather than inlining the whole
checklist so the primary decision tree and failure modes stay front and
center for everyday use.

Before considering a UX friction audit complete, verify:

**Quantitative Metrics:**
- [ ] Task completion time reduced by ≥25% from baseline
- [ ] Error rate decreased to ≤5% for primary user flows
- [ ] Cognitive load score ≤6/10 (measured via NASA-TLX or user interviews)
- [ ] Time-to-first-value ≤60 seconds for new users
- [ ] Context switch recovery time ≤90 seconds

**User Experience Validation:**
- [ ] 3+ real users completed full journey without assistance
- [ ] Zero critical accessibility violations (WCAG AA compliance)
- [ ] Mobile touch targets ≥44px for all interactive elements
- [ ] Page load times ≤3 seconds for all critical path pages

**Design System Compliance:**
- [ ] All ADHD-friendly patterns implemented (auto-save, progress indicators, calm UI)
- [ ] Fitts' Law violations eliminated (button sizing, placement)
- [ ] Working memory limits respected (≤4 simultaneous UI elements requiring attention)
- [ ] Every user action has clear feedback within 0.1 seconds
- [ ] Error states include specific recovery instructions, not generic messages

## Which gates `scripts/friction_audit.mjs` can check for you

The auditor script can only check gates expressible as structured fields on a
flow spec. It mechanically enforces:

- Mobile touch targets ≥44px (`touchTargetsMinPx`)
- Reflow at 320px with no horizontal scroll (`worksAt320pxNoHscroll`)
- Feedback within 0.1s of every action (`feedbackWithin100ms`)
- Working-memory limit of ≤4 simultaneous attention elements (`simultaneousAttentionElements`)

Everything else on this page — task completion time deltas, error rates,
NASA-TLX scores, real-user validation, WCAG AA compliance — requires
measurement against a live product or user study and cannot be inferred from
a flow description alone. Treat a `pass: true` from the script as a
necessary, not sufficient, condition for shipping.
