# Color Contrast Auditor

Detects color contrast violations that make text and UI unreadable, and provides WCAG-compliant fixes backed by a real relative-luminance calculation — not an eyeballed guess.

Use this skill when checking a screenshot, CSS/Tailwind file, or design brief for accessibility, or when a color pair "looks fine" but needs to be proven fine.

## Quick Start

1. Read `SKILL.md` for the WCAG 2.1 contrast requirements, the audit methodology, and the three anti-patterns.
2. Skim `references/safe-color-pairs.md` for pre-verified color combinations before hand-picking a fix.
3. Build a contrast-spec JSON matching `schemas/contrast-spec.schema.json` and audit it:

```bash
node scripts/contrast_audit.mjs --input <your-contrast-spec>.json
```

4. Compare against `examples/expected-output.md` to see a spec with a subtle near-miss ratio, an invalid hex, and a color-only signal audited, fixed, and re-audited to `pass:true`.
5. Fill in `templates/output-template.md` for the actual audit report handed back to a designer or reviewer.

## Why the script matters

WCAG contrast is genuine math, not a style opinion: `scripts/contrast_audit.mjs` computes the real relative-luminance contrast ratio for every declared pair (per the WCAG 2.x formula) and fails closed — an unparseable color or a color-only semantic signal is never treated as "probably fine." The canonical example is `#777777` text on `#FFFFFF`: it looks like it should clear the 4.5:1 body-text floor, but the computed ratio is 4.48:1 — under the line.
