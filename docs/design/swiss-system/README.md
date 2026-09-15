# Swiss system

Three documents.

- **`system.html`** — the Harbor Swiss System spec: one grotesk (Archivo), one
  grid, colour as information. This is the **normative** file — the contract
  for how the system's components, patterns and states are built. Open it
  directly; it needs no server and no build step.
- **`ROADMAP.md`** — how the website gets converted onto this system, and what
  "100% normalized" is defined to mean: the ratchet file is empty. Each of the
  system's taste rules is paired with the CI rule that fails when it breaks.
- **`fleetbar-research-report.html`** — the design-research report on
  FleetBar's fractional-border and colour-blocking language that the system was
  distilled from; the eight-pattern taxonomy and the six-state dot contract
  both trace back to it. Background reading, not a second source of truth —
  where it and `system.html` disagree, `system.html` wins.

## The typeface stack, and why

Archivo plus IBM Plex Mono, chosen by **register** rather than by habit. The
house typography reference sorts faces by the register a thing is written in;
this work sits in *Quiet Swiss / neo-grotesque*, whose libre entries are
Archivo and Hanken Grotesk. Archivo is also that reference's named replacement
for Helvetica and Neue Haas.

One family does display and text, at two widths — `wdth` 100 for reading,
`wdth` 125 for the oversized numerals, so the numerals are an expanded cut of
the same family rather than a second face. IBM Plex Mono is the permitted third
family, carrying machine truth only: ids, timestamps, hexes, tokens.

The research report shipped with Inter / Geist Mono / Fraunces — all three
rejected — and was re-cut onto this stack when it came into the repository. Its
type specimens were re-labelled to match: a specimen captioned with a face the
page no longer sets is simply false.

## What is measured, and what is not

`system.html` is audited headlessly at 1280 / 860 / 390 px in both light and
dark. It passes clean: no horizontal page scroll, no JavaScript errors, and no
text below the 14px floor except labels that earn the 12px exception by
carrying weight ≥600, uppercase, and tracking ≥0.1em. One exception is stated
in the source rather than hidden: display type at ≥48px is set at 1.0 leading,
below the 1.05 heading floor, because that is how this tradition sets a
masthead.

**The research report does not meet that bar, and is not expected to.** It
carries **146 text nodes below 14px**, inherited from the original document. It
is an archival research artifact; rewriting its typography would damage the
thing that makes it worth keeping, which is that it is the research as it was
written. Its page-level horizontal scroll at phone width *was* fixed, because
that is a defect rather than a style — the wide comparison table now scrolls
inside its own container instead of dragging the page sideways with it.

If the report is ever promoted from background reading to a published page,
those 146 nodes become in-scope and this paragraph is the record of the debt.

## One rule this directory cannot satisfy

The typography reference says self-host WOFF2 and never reach for Google Fonts
CSS, which costs a render-blocking round trip. Both pages here link Google
Fonts, because each has to travel as a single file you can open by
double-clicking. **The site does not get that excuse**: it subsets and
self-hosts, with `font-display: swap` and a `size-adjust` fallback to kill
layout shift. That is a task in `ROADMAP.md`, not a preference.
