# Make Copy and Media Human

Strip the machine accent from copy, web UI, slides, READMEs, marketing pages, and generated imagery before anything outward-facing ships.

Use this skill when text or design "reads like AI," before publishing anything customer-facing, or when auditing a property for machine tells (Claudeisms, GPT-isms, Codexisms, Gemini caveat stacks, the v0/Lovable design look).

## Quick Start

1. Read `SKILL.md` for the philosophy, the two-layer detection pipeline, and the process (scope → structural pass → judge pass → merge → fix → re-run).
2. Run the structural layer against the target file(s):
   ```bash
   python3 scripts/humanize_review.py FILE [FILE...] --out report.html --json structural.json
   ```
3. Run the judge pass yourself against `references/catalog.json` — every `detection_type: llm-judge` item needs a human-editor read, not a checklist tick. Write findings to a JSON file matching the schema in the script's docstring.
4. Merge and render the final report:
   ```bash
   python3 scripts/humanize_review.py FILE... --findings judge.json --out report.html
   ```
5. If asked to fix, work through `templates/rewrite-checklist.md`, then re-run both layers — a clean result must come from a re-run, never a claim.
6. Compare against `examples/before-after-prose.md`, `examples/before-after-landing-page.md`, and `examples/sample-report.html` to calibrate what "done" looks like.

## Why No Separate Scorer Script

`scripts/humanize_review.py` already IS this skill's deterministic auditor: it takes files, applies structural checks only (densities, variances, ratios, hex values, font names — no keyword-list NLP over free text), and renders a severity-sorted findings report. It is stdlib-only, has a `--selftest` mode, and is the merge point for the model's judge-pass findings. A second, redundant `.mjs` scorer was deliberately not added on top of it.

`scripts/regenerate_references.py` is a companion helper, not the auditor: it regenerates the per-dialect `references/*.md` files from `references/catalog.json`, the source of truth for the judge-pass rubric.

## Bundle Contents

| Path | Purpose |
| --- | --- |
| `SKILL.md` | Philosophy, decision tree, process, shibboleths, dos/don'ts, failure modes |
| `scripts/humanize_review.py` | Structural detector + report renderer (the deterministic auditor) |
| `scripts/regenerate_references.py` | Regenerates `references/*.md` from `references/catalog.json` |
| `references/catalog.json` | Source of truth: 70 AI-isms across model dialects and media |
| `references/*.md` | Generated, per-dialect/per-medium views of the catalog |
| `templates/rewrite-checklist.md` | Checklist to run after every humanizing pass |
| `templates/output-template.md` | Template for a judge-pass finding entry and the delivery summary |
| `examples/` | Before/after prose and landing-page pairs, plus a sample rendered report |
| `agents/openai.yaml` | Subagent descriptor for delegated humanization review |
