---
license: Apache-2.0
name: make_copy_and_media_human
description: Review and rewrite copy, web UI, slides, READMEs, marketing pages, and generated imagery to strip AI-isms — Claudeisms, GPT-isms, Codexisms, Geminisms, and the v0/Lovable design look — producing a line-item fix plan as static HTML. Use before shipping any outward-facing text or design, when something "reads like AI", or when auditing a property for machine tells. NOT for grammar/spell checking, SEO optimization, plagiarism detection, or detecting whether a third party used AI (this is an editing skill, not a forensics tool).
allowed-tools: Read,Write,Edit,Bash,Grep,Glob,WebFetch
argument-hint: '[file-or-directory] [--medium prose|web|deck|image] [--report out.html]'
metadata:
  category: Writing & Editing
  tags:
    - humanize
    - copy-editing
    - ai-isms
    - design-review
    - voice
  pairs-with:
    - skill: vibe-matcher
      reason: vibe-matcher finds the target voice; this skill removes the machine accent from it
    - skill: design-critic
      reason: design-critic judges quality; this skill specifically hunts generated-look tells
    - skill: seo-content-blogging
      reason: run this skill after content generation, before publish
---

# Make Copy and Media Human

Strip the machine accent from anything outward-facing. The skill catalogs the tells — per model dialect and per medium — detects them with a two-layer pipeline, strikes them, and hands back a line-item fix plan as a self-contained static HTML report.

## Philosophy

AI output has an accent. Not one accent — dialects: Claude's staccato and em-dashes, GPT's service voice and emoji headers, Gemini's caveat stacks, Codex's narrating comments, and the v0/Lovable visual register of Inter, indigo, and glassmorphism. Humans clock these in seconds even when they can't name them. The fix is never "paraphrase it" — it is to find each tell, understand why a person wouldn't have produced it, and make the decision a person would have made.

Two laws bind this skill:

1. **No keyword-list NLP.** Phrase-level tropes are judged by the model against a rubric, never by substring lists over free text. The script layer measures only structural signals: densities, variances, ratios, codepoints, hex values, font names — values you control or can count.
2. **The output must pass its own review.** The report template uses Georgia/Menlo, an oxide-red accent, ≥14px text, no emoji, no indigo. If this skill's own artifacts look generated, nothing it says is credible.

## Decision Tree

```mermaid
flowchart TD
    A[Input received] --> B{What medium?}
    B -->|prose / README / blog / email| C[Structural pass: scripts/humanize_review.py]
    B -->|web UI / CSS / JSX| D[Markup pass: colors, fonts, tokens, emoji-in-chrome]
    B -->|slide deck| E[Export text + notes, treat as prose + layout review]
    B -->|image / hero art| F[LLM-judge only: references/visual-design-tells.md rubric]
    C --> G[Model judge pass against references/catalog.json]
    D --> G
    E --> G
    F --> G
    G --> H{Findings?}
    H -->|yes| I[Write findings.json, merge: humanize_review.py --findings]
    H -->|no| J[Report clean — say so plainly, no certificate theater]
    I --> K[Static HTML report: struck text + rewrite per line item]
    K --> L{User wants fixes applied?}
    L -->|yes| M[Apply rewrites file-by-file, re-run to verify]
    L -->|no| N[Deliver report, stop]
```

## Process

### 1. Scope the input
Identify medium and stakes. A tweet gets the judge pass only; a marketing site gets both layers plus a render check. For decks (`.pptx`/Keynote), dump text and speaker notes first (python-pptx), review as prose, then review the visual idiom separately.

### 2. Run the structural layer

```bash
python3 scripts/humanize_review.py FILE [FILE...] --out report.html --json structural.json
```

Detects (measurable signals only): em-dash density >1.2/100w, staccato fragment share, uniform sentence length, zero contractions, broetry line-break runs, heading spam, bullet colonization, bold-label-colon grids, unattributed blockquotes, arrow chains, emoji-as-structure, AI-default hex accents (#6366F1 family), AI-default typefaces (Inter/Geist/Sora/Manrope/Space Grotesk), glassmorphism/rounded-2xl/gradient token repetition, emoji inside UI chrome.

### 3. Run the judge pass (you, the model)
Read `references/catalog.json`. For each item with `detection_type: llm-judge`, ask its rubric question of the text. Read the text **as a hostile, taste-having human editor**, not as a checklist executor. Write findings to JSON matching the schema in the script docstring — file, line, excerpt, ism, dialect, severity, explanation, rewrite. The rewrite field is mandatory for high-severity findings: a finding without a fix is a complaint.

### 4. Merge and render

```bash
python3 scripts/humanize_review.py FILE... --findings judge.json --out report.html
```

One self-contained HTML file. Struck originals, inset rewrites, severity-sorted.

### 5. Fix, then re-run
Apply rewrites if asked, working through `templates/rewrite-checklist.md` — it covers surgical-edit verification, voice restoration, and specificity checks. Re-run both layers; the report after fixes should be empty or low-only. Never declare clean without the re-run.

### Maintaining the catalog
`references/catalog.json` is the source of truth. To add or sharpen a tell, edit the JSON, then run `python3 scripts/regenerate_references.py` — the per-dialect markdown files are generated views and must not be edited by hand.

## The Dialects (load on demand)

| Reference | Load when |
|---|---|
| `references/catalog.json` | Always, at judge-pass time — the machine-readable rubric |
| `references/claudeisms.md` | Text suspected from Claude: staccato, em-dashes, "not X but Y", escalating compliments, unattributed quotes |
| `references/gptisms-codexisms.md` | READMEs, code comments, service-voice copy, emoji headers |
| `references/other-model-dialects.md` | Gemini caveat stacks, DeepSeek/Qwen register, Grok edge-lord voice, cross-model translationese |
| `references/visual-design-tells.md` | Any web UI, landing page, slide visuals, or generated imagery |
| `references/structure-and-deck-tells.md` | Long docs, slide decks, marketing pages, LinkedIn posts, email |
| `references/sources.md` | When you need citations — published catalogs and stylometry research |

## Shibboleths

- **The em-dash is not the crime; the rate is.** Human essayists use em-dashes. 1.2+ per 100 words across a document is machine cadence. Count before you cut.
- **"You're absolutely right" has no human attestation.** No person writes this in review feedback. Same family: the escalating compliment — "you're the only [role] who [trait], [more specific], [more specific still]" — flattery shaped like a binary search.
- **A quote nobody said is not a pull quote.** Pull quotes excerpt the document itself. An italicized aphorism with no source is manufactured gravitas: attribute it or kill it.
- **Inter at 400 weight on #6366F1 buttons means nobody made a decision.** The tell isn't the font or the hex; it's that they co-occur with rounded-2xl and a gradient headline. Defaults cluster.
- **Codex narrates; engineers annotate.** `// increment the counter` above `count++` is generated. A human comment states the constraint the code can't: `// TAO writes dogpile above 50qps — batch`.
- **Perfect parallelism is a tell, not a virtue.** Twelve bullets with identical grammatical shape and length were generated. Humans drift.
- **The fix for staccato is not longer sentences. It is fewer sentences.** Merge the fragments back into the thought they were chopped from.

## Dos and Don'ts

**Do**
- Quantify before flagging prose rhythm (the script gives you the numbers).
- Preserve meaning exactly when rewriting; you are removing accent, not content.
- Match the property's established voice — read 2–3 adjacent published pieces first.
- Flag your own draft output with the same pipeline before delivering it.
- Say "clean" when it's clean. A zero-finding report is a valid result.

**Don't**
- Don't paraphrase-launder: running text through one more LLM pass adds a second accent on top of the first.
- Don't build keyword lists to catch phrases. Judge pass only.
- Don't strip personality along with tropes — contractions, opinions, and irregularity are the goal, not casualties.
- Don't add the report's findings as comments in the source file; the HTML report is the deliverable.
- Don't treat severity:low as a to-do list; low items are taste calls the author may keep.

## Failure Modes

### Paraphrase Laundering
**Detection**: "fixed" text has new tropes the original lacked.
**Fix**: rewrites must be surgical — edit the flagged span, leave the rest byte-identical.

### Voice Flattening
**Detection**: post-fix text is clean but beige; the author's tics went with the machine's.
**Fix**: diff against 2–3 pieces of the author's known-human writing; restore their fingerprints.

### Checklist Myopia
**Detection**: judge pass returns only catalog items, zero novel observations.
**Fix**: the catalog is a floor, not a ceiling. One free-form "what else smells generated?" pass is mandatory.

### Forensics Drift
**Detection**: user asks "did a student/employee write this with AI?" and the skill answers.
**Fix**: out of scope. This skill edits; it does not accuse. Detection-for-accusation has miserable false-positive economics.

## Examples

`examples/before-after-prose.md` — a launch announcement, machine accent vs. edited.
`examples/before-after-landing-page.md` — the v0 look vs. a designed page, token by token.
`examples/sample-report.html` — what a finished fix plan looks like.
