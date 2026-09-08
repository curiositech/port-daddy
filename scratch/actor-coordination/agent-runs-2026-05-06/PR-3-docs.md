# PR-3 — Docs index + sections + tutorials

**Branch name:** `voice-design-pr3-docs`
**Worktree path:** `~/coding/port-daddy/.claude/worktrees/voice-design-pr3-docs`

## Files you own (and ONLY these)

- `website-v2/src/pages/DocsPage.tsx`
- `website-v2/src/pages/docs/DocsSectionPage.tsx`
- `website-v2/src/pages/docs/sdk/Harbors.tsx`
- 5 more pages from `website-v2/src/pages/docs/sdk/` and `docs/features/`
  — pick the ones with the most lines (highest-trafficked surfaces)
- `website-v2/src/components/tutorials/TutorialLayout.tsx`
- `website-v2/src/pages/TutorialsPage.tsx`
- `website-v2/src/pages/tutorials/**`

## What to do

1. **Voice pass** — same playbook. Docs are *teaching* surfaces; the
   wild-analogy gear should always be engaged here.
2. **Design pass** — color blocking + padding cuts; primitive bypasses
   in TutorialLayout (the audit flagged 34 of these across the site;
   tutorial layout is one of the worst offenders).
3. **No raw colors** in this scope per the audit; focus is voice +
   design + primitive fixes.

## Validation gates + PR template

- Audit primitive-bypass count for `TutorialLayout.tsx` should drop
- Docs nav rhythm should feel calmer (fewer surface clashes)
- Screenshots of /docs and /tutorials in `.scratch/`
