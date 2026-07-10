---
license: Apache-2.0
name: ux-friction-analyzer
description: Comprehensive UX analysis using cognitive psychology, ADHD-friendly design, Gestalt principles, and flow state engineering. Specializes in friction audits, user journey simulation, cognitive load optimization, and Fitts' Law application. Activate on "analyze UX", "friction audit", "user journey", "ADHD-friendly", "optimize flow", "reduce cognitive load", "UX audit", "conversion optimization". NOT for visual design execution (use web-design-expert), A/B testing implementation (use frontend-developer), or accessibility compliance auditing (use accessibility-auditor).
allowed-tools: Read,Write,Edit,WebFetch
metadata:
  category: Design & UX
  tags:
    - ux
    - accessibility
    - cognitive-load
    - adhd-friendly
    - user-research
  provenance:
    kind: first-party
    owners:
      - port-daddy
  pairs-with:
    - skill: port-daddy-users
      reason: Supplies the 24 concrete named personas whose journeys get simulated during a friction audit when the product being evaluated is Port Daddy itself.
    - skill: agentic-coding-ux-designer
      reason: Turns friction-audit findings into concrete AI-coding-agent product flows (prompt-to-diff, plan/apply/review, checkpoint rollback).
    - skill: human-gate-designer
      reason: Friction findings about approval/review moments feed directly into where and how a DAG places human-in-the-loop gates.
    - skill: agentic-app-architecture
      reason: Friction findings about hidden reasoning, missing state preservation, or ungated long operations surface architecture-level shape decisions this skill owns.
  io-contract:
    kind: deliverable
    consumes:
      - kind: ux-flow-description
        format: markdown
      - kind: friction-audit-input
        format: json
    produces:
      - kind: friction-audit
        format: markdown
      - kind: friction-audit-report
        format: json
---
# UX Friction Analyzer

A comprehensive skill for analyzing and optimizing user experience through cognitive psychology, ADHD-friendly design, and flow state engineering.

## Decision Points

Use this decision matrix when conflicting ADHD principles and cognitive load types collide:

### Cognitive Load vs ADHD Principle Conflicts

| Situation | If High Intrinsic Load | If High Extraneous Load | If High Germane Load |
|-----------|----------------------|------------------------|-------------------|
| **Progressive Disclosure vs Information Need** | Hide advanced features; show essentials only | Remove ALL decorative elements; show task steps linearly | Group related info; use expandable sections |
| **Context Preservation vs Working Memory** | Auto-save every keystroke; show current state banner | Clear all non-essential UI; focus on one input field | Save drafts; provide "where you left off" panels |
| **Chunked Progress vs Task Flow** | Break into micro-tasks (1-2 min each) | Show progress bar; hide future steps completely | Use card-based UI; each card = one concept |
| **Predictable Navigation vs Personalization** | Keep identical layout always; disable customization | Use breadcrumbs; limit to 3-level hierarchy max | Offer simple/advanced modes; user chooses complexity |

### Primary Decision Tree

```
User arrives → What's their cognitive state?

├─ FOCUSED & ENERGETIC
│  ├─ Goal: Complete complex task
│  │  → Use power-user shortcuts + batch operations
│  └─ Goal: Explore/learn
│     → Show advanced features + guided tour
│
├─ DISTRACTED/MULTITASKING  
│  ├─ On mobile
│  │  → Single-column layout + floating action button
│  └─ On desktop
│     → Minimize chrome + auto-save everything
│
├─ OVERWHELMED/ANXIOUS
│  ├─ First-time user
│  │  → Wizard flow + success celebrations
│  └─ Returning user hitting error
│     → Clear error recovery + undo options
│
└─ TIME-PRESSURED/URGENT
   ├─ Regular task
   │  → Smart defaults + keyboard shortcuts
   └─ Crisis situation
      → Emergency mode UI + direct contact options
```

### Friction vs Feature Trade-offs

When feature requests conflict with friction reduction:

- **If feature adds >2 seconds to primary flow**: Defer to advanced mode
- **If feature requires >4 mental chunks**: Break into wizard steps
- **If feature serves <20% of users**: Hide behind "More options"
- **If feature needs learning curve**: Provide in-context help only

## Failure Modes

### 1. Overwhelm Cascade
**Detection Rule**: If user abandons before completing first meaningful action
- **Symptom**: High bounce rate on landing page, users don't scroll
- **Diagnosis**: Too many choices presented simultaneously
- **Fix**: Progressive disclosure - show only 1-2 primary actions initially

### 2. Context Switch Death Spiral
**Detection Rule**: If user takes >23 minutes to complete familiar 5-minute task
- **Symptom**: Users losing place repeatedly, restarting workflows
- **Diagnosis**: Interface doesn't preserve context across interruptions
- **Fix**: Add "Continue where you left off" persistent banner

### 3. Invisible Progress Paralysis
**Detection Rule**: If users repeatedly ask "Is this working?" during long operations
- **Symptom**: Users refresh page during background processing
- **Diagnosis**: No feedback on system state or progress
- **Fix**: Real-time progress indicators + time estimates

### 4. Micro-Friction Accumulation
**Detection Rule**: If completion rates drop >15% despite no major UX changes
- **Symptom**: Users complete individual steps but abandon before final step
- **Diagnosis**: Small frictions compound into abandonment
- **Fix**: Remove one minor friction point per week systematically

### 5. Expert User Imprisonment
**Detection Rule**: If power users complain about "dumbed down" interface
- **Symptom**: Feature requests for keyboard shortcuts, batch operations
- **Diagnosis**: Optimized for beginners, frustrated experts
- **Fix**: Adaptive UI that reveals complexity based on user behavior

See `references/worked-examples.md` for two full journey simulations (an
ADHD-user checkout audit and a SaaS dashboard report-building audit) showing
these failure modes diagnosed and fixed step by step.

## Quality Gates

Before considering a UX friction audit complete, verify the quantitative
metrics, user-experience validation, and design-system compliance checklists
in `references/quality-gates.md`. The mechanical subset of those gates
(touch-target size, 320px reflow, sub-100ms feedback) is also enforced by
`scripts/friction_audit.mjs` below.

## Deterministic Audit

Encode a candidate flow as a JSON object (`steps[]` each with `label`,
`cognitiveState`, `timeSeconds`, `chunks`, `autoSaves`, `showsProgress`,
`contextPreserved`, plus flow-level `primaryActionObviousWithin3s`,
`touchTargetsMinPx`, `worksAt320pxNoHscroll`, `feedbackWithin100ms`,
`simultaneousAttentionElements`, and optional `hasPowerUserPath`) and run:

```
node scripts/friction_audit.mjs --input examples/sample-input.json
```

`auditFrictionFlow(flow)` checks the flow against all 5 failure modes above
plus the mobile/touch/feedback quality gates and returns
`{ pass, findings, recommendations }`. Use it to gate whether a flow
description is ready to ship or needs another pass — it will not catch
subjective taste issues, only the mechanical failure-mode triggers.

## NOT-FOR Boundaries

**Do NOT use this skill for:**

- **Visual design execution** → Use [web-design-expert] instead
  - Creating mockups, choosing colors, typography decisions
  - Pixel-perfect layout implementation

- **A/B testing setup or statistical analysis** → Use [frontend-developer] + [data-analyst] instead
  - Test implementation, traffic splitting, conversion tracking
  - Statistical significance calculations, test result interpretation

- **Accessibility compliance auditing** → Use [accessibility-auditor] instead
  - WCAG checklist verification, screen reader testing
  - Legal compliance documentation, remediation prioritization

- **Technical performance optimization** → Use [frontend-developer] instead
  - Code optimization, bundle splitting, caching strategies
  - Database query optimization, API response times

- **User research methodology** → Use [user-researcher] instead
  - Interview guide creation, survey design, usability testing protocols
  - Qualitative data analysis, persona development from research

**Boundary Decision Rule**: If the task requires specialized domain expertise beyond UX psychology and cognitive principles, delegate to the appropriate specialist skill.

## References

| File | Load When |
| --- | --- |
| `references/worked-examples.md` | Need the two full journey-simulation worked examples (ADHD checkout, SaaS dashboard report). |
| `references/quality-gates.md` | Need the full quantitative/UX/design-system checklist before declaring an audit complete. |
| `examples/sample-input.json` | Need a passing flow spec to copy as a starting point. |
| `examples/expected-output.md` | Need the shape of a finished friction-audit report. |
| `templates/output-template.md` | Need a reusable audit-report template to fill in. |
| `schemas/flow-audit.schema.json` | Need to validate a flow spec's structure programmatically. |
| `scripts/friction_audit.mjs` | Need deterministic, repeatable scoring of a flow spec against the 5 failure modes. |
| `agents/openai.yaml` | Need a subagent descriptor for delegated friction auditing. |

<!-- BEGIN BUNDLE INDEX (auto: index_references.py) -->

## Skill Bundle Index

*Every file in this skill, and when to open it. Auto-generated; run `scripts/index_references.py --fix`.*

**root**
- [`CHANGELOG.md`](CHANGELOG.md) — UX Friction Analyzer — Changelog — - Upgraded to the agentic-family bundle standard: `metadata.provenance`, `metadata.pairs-with`, and `metadata.io-contract` added to frontmat
- [`README.md`](README.md) — UX Friction Analyzer — Analyze and optimize user experience through cognitive psychology, ADHD-friendly design, Gestalt principles, and flow state engineering: fri

**`agents/`**
- [`agents/openai.yaml`](agents/openai.yaml) — openai (data/schema)

**`examples/`**
- [`examples/expected-output.md`](examples/expected-output.md) — Example Output: UX Friction Audit — Scenario: auditing the optimized 3-step checkout flow in `references/worked-examples.md` (Example 1) — the flow *after* the friction fixes w
- [`examples/sample-input.json`](examples/sample-input.json) — sample input (data/schema)

**`references/`**
- [`references/quality-gates.md`](references/quality-gates.md) — Quality Gates — Use this when you need the full checklist before declaring a UX friction audit complete.
- [`references/worked-examples.md`](references/worked-examples.md) — Worked Examples — Two full journey simulations showing the failure modes and decision points from `SKILL.md` diagnosed and fixed step by step.

**`schemas/`**
- [`schemas/flow-audit.schema.json`](schemas/flow-audit.schema.json) — flow audit.schema (data/schema)

**`scripts/`**
- [`scripts/friction_audit.mjs`](scripts/friction_audit.mjs)

**`templates/`**
- [`templates/output-template.md`](templates/output-template.md) — Friction Audit: [Flow Name] — [One-sentence description of the flow being audited and the user intent it serves.] **Verdict**: [PASS | FAIL] — [one-line summary of why, r

<!-- END BUNDLE INDEX -->
