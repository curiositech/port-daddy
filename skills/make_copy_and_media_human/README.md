# Make Copy and Media Human

Strip the machine accent from copy, web UI, slides, READMEs, commits, PRs,
marketing pages, and generated imagery before anything outward-facing ships.

Reach for this skill when text or design reads like AI, before you publish
anything customer-facing, or when you're auditing a property for machine tells:
Claudeisms, GPT-isms, Codexisms, Gemini caveat stacks, engineering-artifact slop,
and the v0/Lovable design look.

What it won't tell you whether a person used AI. That question has bad answers and
worse consequences, and `references/fairness-and-false-positives.md` lays out
why: detectors miss most machine text while falsely flagging around 61% of
essays by non-native English speakers. So this is an editing tool. Every fix in
the catalog improves writing regardless of who or what produced it, which is what
lets you skip the authorship question entirely.

## Quick start

Read `SKILL.md` first for the three laws, the five finding families, and the
process. Then collect two or three pieces of the author's own earlier writing,
because comparing against their baseline is what turns the weakest half of the
catalog into the strongest.

```bash
python3 scripts/humanize_review.py FILE... --baseline 'posts/*.md' \
    --out report.html --json structural.json
```

Next, run the judge pass yourself against `references/catalog.json`. Every item
marked `llm-judge` needs an editor's read rather than a checklist tick, and so do
the `structural` items the script doesn't implement. Write your findings to JSON
matching `templates/output-template.md`, then merge them:

```bash
python3 scripts/humanize_review.py FILE... --findings judge.json --out report.html
```

If you're asked to apply fixes, work `templates/rewrite-checklist.md` top-down
and re-run both layers afterward. A clean result has to come from a re-run and
never from a claim. Use `--fail-on high` to gate this in CI, and `--validate` to
confirm the script and the catalog still agree about every ism and threshold.

## How the two layers split the work

`scripts/humanize_review.py` is the structural layer. It measures only countable
things: densities, variances, ratios, codepoints, hex values, font names, and
identifier overlap between a comment and the line beneath it. It is stdlib-only
and carries a `--selftest` that checks both that it catches known tells and that
it stays silent on a sample of real human prose.

It deliberately does not implement every structural item in the catalog. Several
of them need a diff, a repo history, or a resolver that this script has no
business owning, so they're marked structural for you to check with the tools
that do. Thresholds live in `references/catalog.json` rather than in the code,
which is what stopped the rubric and the implementation from drifting apart.

`scripts/regenerate_references.py` rebuilds the per-dialect markdown views from
the catalog. It refuses to write if any item would land in no file, because an
earlier typo silently dropped an item out of every reference and nothing noticed.

## Bundle contents

| Path | Purpose |
| --- | --- |
| `SKILL.md` | Three laws, five families, decision tree, process, shibboleths, failure modes |
| `references/fairness-and-false-positives.md` | Why findings are cues and not evidence; read before your first review |
| `references/catalog.json` | Source of truth: 120 tells with thresholds, false-positive notes, currency, and evidence |
| `references/*.md` | Generated per-dialect and per-medium views of the catalog |
| `scripts/humanize_review.py` | Structural detector and report renderer |
| `scripts/regenerate_references.py` | Regenerates `references/*.md`; fails on orphaned items |
| `templates/rewrite-checklist.md` | Checklist to run after every humanizing pass |
| `templates/output-template.md` | Shape of a judge-pass finding and the delivery summary |
| `examples/` | Before and after pairs for prose and a landing page, plus a rendered report |
| `agents/openai.yaml` | Subagent descriptor for a delegated review |
