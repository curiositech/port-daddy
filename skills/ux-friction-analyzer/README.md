# UX Friction Analyzer

Analyze and optimize user experience through cognitive psychology,
ADHD-friendly design, Gestalt principles, and flow state engineering:
friction audits, user journey simulation, cognitive load optimization, and
Fitts' Law application.

Use this skill when you need to diagnose why users abandon a flow, decide
where to chunk a form into wizard steps, or check a proposed flow against
the 5 known UX failure modes before it ships.

## Quick Start

1. Read `SKILL.md` for the decision matrix, primary decision tree, the 5
   failure modes, and the quality gates checklist.
2. Load `references/worked-examples.md` for two full journey-simulation
   audits (ADHD checkout, SaaS dashboard) showing the diagnosis-to-fix
   process end to end.
3. Load `references/quality-gates.md` for the full completeness checklist,
   including which gates the deterministic script can and cannot check.
4. Describe the candidate flow as JSON matching
   `schemas/flow-audit.schema.json` (see `examples/sample-input.json`), or
   fill `templates/output-template.md` for the narrative report.
5. Run `node scripts/friction_audit.mjs --input flow.json` to mechanically
   check the 5 failure modes and the mobile/touch/feedback quality gates.

A flow that scores `pass: true` has cleared the mechanical checks only —
real-user validation, WCAG AA compliance, and completion-time measurement
still require the checklist in `references/quality-gates.md`.
