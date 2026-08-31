---
name: high-quality-latex-whitepaper
description: >
  Produce academic LaTeX whitepapers that look expensive, not cheap. Use when
  writing or revising a technical whitepaper (.tex), designing its TikZ figures,
  or reviewing one that "looks cheap." Encodes a restraint-first house style (one
  serif typeface, one accent color, consistent figure craft), the anti-cheap
  checklist, the pedagogic apparatus (callouts, exercises, reader's-map,
  pull-quotes), and a mandatory render-read-audit loop.
io-contract:
  kind: deliverable
  produces:
    - kind: code
      description: LaTeX whitepaper source with bibliography, figures, and build configuration
    - kind: critique
      description: Revision review of an existing whitepaper draft
---

# High-Quality LaTeX Whitepaper

A whitepaper is a credibility object. It is judged in the first three seconds, by
its *look*, before a word is read. Cheap-looking typesetting tells the reader "a
script made this," and no amount of good content recovers that first impression.
This skill is the discipline that makes a paper look like it came from a press.

> **The cardinal rule: restraint reads as authority.** One typeface. One accent
> color. Consistent figures. Generous whitespace. Every time you reach for a
> second font, a third color, or a saturated fill, you are spending credibility.

## When to use

- Writing or revising a technical whitepaper in LaTeX.
- Designing or fixing its TikZ figures.
- Someone said the PDF "looks cheap," "looks like a script made it," or "yikes."
- Building a multi-paper volume that must read as one set.

## NOT for

- Slide decks (different medium, different rules).
- Marketing landing copy (use `port-daddy-marketing-copy`).
- The *argument* itself (use `research-craft`) or doc *structure* (use `technical-writer`).

---

## The seven cheap tells (find and kill every one)

These are the exact defects that make a paper look amateur. Grep, look, fix.

| # | Cheap tell | Why it reads cheap | The fix |
|---|-----------|--------------------|---------|
| 1 | **Off-palette color** (a lime-green bar, a neon rule, a primary-blue box) | One wrong color screams "default" and destroys the page's restraint | Every color comes from the *defined palette*. No raw green/blue/red; no decorative bars. Grep `\definecolor` — if a color isn't in your palette block, it doesn't exist. |
| 2 | **Sans-serif text inside figures on a serif body** | The font-clash is the #1 "a script assembled this" signal | Figures use the **same serif** as the body. **Never `\sffamily` in a figure** unless the whole document is sans. |
| 3 | **Multi-colored / multi-weight bold** (a rainbow status key) | Busy, juvenile, no hierarchy | One accent color, used *once* per figure for the single most important thing. Status labels: muted ink/gray, differentiated by *weight or small-caps*, not by hue. |
| 4 | **Saturated default box fills** (bright beige, full-opacity blue) | Looks like a wireframe tool's defaults | One subtle fill (sand at ~15–40% opacity), identical across every figure in the paper. |
| 5 | **Labels riding on lines; cramped boxes** | The eye can't parse it; feels unfinished | Labels sit in clear bands beside/above arrows, never on them. Generous inner padding, consistent node sizes. |
| 6 | **Inconsistent scale/spacing between figures** | Each figure looks like a different author | Define box/arrow/label *styles once* in the preamble; every figure uses them. Same line width, font size, palette. |
| 7 | **A status key / footer shouting in color** | Internal bookkeeping leaking into the artifact's chrome | Footer is quiet (small, single ink color, a thin rule). Status labels live in an appendix table, not a colored footer band. |

If a figure has any of these, it is a defect, not a style choice.

---

## The house style (the governing rules)

The full canonical preamble — packages, palette, theorem envs, `fancyhdr`, the
`\keyidea`/`\pitfall`/`exercises`/`\pullquote` commands, and the shared TikZ
styles — is in **`references/preamble.tex`**. Copy it verbatim; do not improvise a
parallel one. The rules it enforces:

### Typography
- `\documentclass[11pt,a4paper]{article}`, `lmodern`, `geometry` margins ~2.5cm.
- **One typeface family for the whole document, body and figures: the serif.**
- Hierarchy comes from **size, weight, and small-caps** (`\textsc`) — not color, not a second font.
- `microtype` on. Real ligatures, em-dashes, quotes.

### Color — the discipline that matters most
- A **named palette block** at the top (warm paper, ink, one accent, a few muted structural tones). Nothing outside it.
- **One accent color** (e.g. a cinnabar/oxblood). It marks the single most important thing on a page or in a figure — the "you are here," the one warning, the one result. Used more than once per view, it stops meaning anything.
- **Structural color is muted and functional**: arrows, rules, a subtle fill. Never decorative, never saturated.
- **Banned:** raw red/green/blue, neon/lime anything, colored footer bars, full-opacity fills, more than one accent.

### Figures (TikZ)
- Define `box`, `accentbox`, `arrow`, `label` styles **once** in the preamble; reuse everywhere.
- One fill (paper-sand, low opacity). One stroke (ink). The accent only on the one node that earns it.
- Figure text = the body serif, ~`\small`/`\footnotesize`, consistent across figures.
- Labels in clear bands; arrows `-{Stealth}` (arrows.meta), consistent width.
- Every figure's `\caption` states the takeaway, not just names the parts.

### Pedagogic apparatus (tasteful, not loud)
- **Callouts** (`\keyidea`, `\pitfall`): a thin left rule + a *very* subtle fill, label in small-caps. A `\pitfall` may use the accent on its *label only*, never a saturated box.
- **`exercises`** environment: a quiet boxed list — check / trace / starred-open-problem.
- **Pull-quotes**: large italic, a single accent left-stripe, generous margin.
- **Reader's-Map** table at the top (reader type → section). **Honest-status** mapping (built/partial/specified/proposed) goes in an *appendix table*, muted ink with small-caps/weight differences — never a colored key in the running chrome.

---

## The render → read → audit loop (mandatory, not optional)

A figure you have not *looked at* is not done. For every figure:

1. Compile (or the whole paper) with `pdflatex` (3 passes for refs/TOC).
2. Render the page to PNG (`pdftoppm -png -r 150`, or `magick`).
3. **Read the PNG with your own eyes** (the Read tool shows images).
4. Audit against the seven cheap tells + this paper's other figures (same scale? same fill? labels clear? accent used once?).
5. Fix and re-render until clean.
6. For Port Daddy corpus work, preserve the accepted color contact sheet, page evidence, and
   tour in `whitepaper/proof/current/`; build-directory PNGs are disposable diagnostics, not
   the review record.

"It compiles" is not the bar. "It looks like a press made it, and it matches its siblings" is the bar.

---

## The expensive-look checklist (run before commit)

- [ ] `pdflatex` clean: 0 undefined references, 0 undefined citations, 0 large overfull boxes.
- [ ] **One typeface** in the whole PDF (no sans-in-figures clash).
- [ ] **One accent color**; every color traces to the palette block; no off-palette/neon/bar.
- [ ] No multi-colored/multi-weight bold; status shown by weight/small-caps, not hue.
- [ ] All figures share one box style, one fill, one arrow style, consistent scale.
- [ ] Every figure rendered and *looked at*; no labels on lines; generous padding.
- [ ] Callouts/pull-quotes/exercises are quiet (thin rule, subtle fill), not saturated boxes.
- [ ] Footer/header small, single-ink, a thin rule — no colored band.
- [ ] Real citations with `\cite`; first use of a term in **bold**; a references section.
- [ ] Reader's-Map present; status/maturity table in an appendix, not the chrome.
- [ ] Read one page aloud: does it *look* like a journal article? If you wince, fix the wince.

---

## Anti-patterns (named, so they're refusable)

- **The ransom note.** Three+ colors and two+ fonts on one page — the most common way a generated paper looks cheap. Cure: one font, one accent.
- **The wireframe.** Saturated default TikZ box fills (`fill=blue!20`, bright beige). Cure: one subtle paper-sand fill, palette-defined.
- **The neon footer.** A colored bar or rainbow status key in the running chrome. Cure: quiet footer; status to an appendix.
- **The compile-and-ship.** Calling a figure done because it compiled, without rendering and looking. Cure: the render→read→audit loop.
- **The lonely figure.** A figure that looks like a different author than its siblings (different scale/fill/font). Cure: shared preamble styles.
- **The decorative theorem.** Color/boxes used to *look* rigorous. Cure: rigor is in the proof; the typesetting stays quiet.

---

## Why this is the skill, not just a preamble

The preamble is necessary but not sufficient — an agent with the right `\definecolor`
block will still ship a lime-green bar if it does not *look*. This skill is the
judgment: a small palette, one font, and a habit of rendering and auditing every
figure against its siblings. That habit is the difference between a PDF that looks
like a press made it and one that looks like a script did.
