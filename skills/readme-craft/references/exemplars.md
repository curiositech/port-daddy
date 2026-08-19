# Exemplars — what to steal, and from whom

Each entry names one technique worth copying and the reason it works. Read the entry for
the section you are currently writing; there is no reason to read this file end to end.

---

## ink — `vadimdemedes/ink`

The reference for a README that serves both a newcomer and a returning user without
compromising either.

**Steal: the tagline as a blockquote.** "React for CLIs. Build and test your CLI output
using components." One analogy the reader already holds, then the literal claim. The
analogy does the work of three paragraphs of explanation, and the second sentence keeps it
honest.

**Steal: "Who's using Ink".** Sixty-plus real projects, each a link, placed high — before
the table of contents. It converts "is this real?" into a checkable fact in the position
where the reader is asking the question. The stated inclusion bar ("100+ stars and showcase
Ink beyond a basic list picker") is what keeps it from decaying.

**Steal: images for visual features.** The text-styling section shows a JPEG of each
rendered variant next to its prop. For anything whose output is visual, a picture of the
output is the documentation; the prop name is just the index into it.

**Do not steal: the length.** ink's README is ~10,000 words and doubles as the full API
reference. That works because ink is a library with a closed, stable API surface — the
reference genuinely fits and genuinely does not churn. A daemon or platform with an open
surface cannot make that trade; its reference must live in `docs/` where it can be
paginated and owned per-page.

---

## VHS — `charmbracelet/vhs`

The reference for making a CLI tool feel like a product.

**Steal: demo before explanation.** A working GIF appears above any prose describing what
the tool does, with a link to the source file that generated it. The reader sees the result
and the input that produced it before being asked to read anything.

**Steal: tutorial before installation.** VHS opens with `vhs new demo.tape` — a thing to do
— and defers platform-specific install instructions into a collapsed `<details>` block
below. The ordering assumes the reader has not yet committed, which is correct.

**Steal: GIF-per-setting in the reference section.** Where a setting has a visual
consequence, the reference entry shows it rather than describing it. This is the same
principle as ink's styling images, applied to configuration.

**Steal: the collapsed platform matrix.** `<details><summary>` around the six-package-manager
install table keeps the happy path one line long without deleting the information.

---

## uv — `astral-sh/uv`

The reference for a tool whose pitch is a comparison.

**Steal: the benchmark chart as the hero.** uv's claim is speed, so its hero image is a bar
chart of resolution times against the incumbent. The pitch and the proof are the same
artifact. If a project's differentiator is measurable, measuring it *is* the pitch — an
adjective in that position is a wasted opportunity, not just weak writing.

**Steal: "Highlights" as a scannable seven.** Seven bolded lead-ins, one clause each,
covering the whole product. It is the capability tour compressed to fit above the fold,
which is what lets the detailed tour live in `docs/`.

---

## ripgrep — `BurntSushi/ripgrep`

The reference for a README that has to defend a claim.

**Steal: the honest comparison table.** ripgrep's README states where it loses to
alternatives, not only where it wins. A README that names its own weaknesses is read as
more credible on its strengths, and it filters out readers who would have churned anyway.

**Steal: "Why should I use ripgrep?" and "Why shouldn't I?" as adjacent headings.** This is
the who-it's-for/who-it's-not-for pair from the identity interview, made literal.

---

## The pattern across all four

None of them open with a table of contents. All of them show output within the first
screenful. All of them push exhaustive reference either into a collapsed block, into a
`docs/` site, or into a section explicitly marked as reference and placed after the tour.

The common structural move is: **evidence first, orientation second, reference last.** Most
bad READMEs invert this exactly — reference first (a command index), orientation buried,
evidence never.
