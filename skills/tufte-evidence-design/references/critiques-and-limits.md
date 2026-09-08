# Critiques and Limits

Tufte's doctrines are not universally accepted engineering law; they are one
strong, historically influential design philosophy with real, named
disagreements. Use this file to keep the skill honest and to know when to
deviate from a Tufte rule on purpose. See `references/sources.md` for
verification status of each claim below.

## Stephen Few — data-ink minimization can go too far

Few accepts the chartjunk diagnosis but argues Tufte's data-ink *maximization*
principle, taken literally, harms readability: some redundancy — a light
gridline, a repeated axis label, both a legend and direct labels — reduces the
reader's search and comparison effort even though it raises the ink count. His
sharper claim: Tufte's definition of chartjunk is broader than "elements that
harm comprehension"; some non-data ink is neutral-to-helpful and shouldn't be
purged just to raise a ratio. **Practical takeaway for this skill**: when
auditing a figure, ask "does removing this ink make the reader work harder to
get the same fact?" before removing it. If yes, keep it — the doctrine is
"erase ink that does no work," not "erase until minimal."

## Alberto Cairo — truthful is necessary but not sufficient

Cairo's five qualities (truthful, functional, beautiful, insightful,
enlightening — see `references/sources.md`) keep Tufte's insistence on honesty
(graphical integrity, the Lie Factor) as non-negotiable, but add that a visually
engaging, well-designed graphic reaches and persuades a wider audience than a
minimal one — beauty and functionality are not luxuries competing with
truthfulness, they're what gets truthful evidence actually read. Cairo has also
been willing to name specific errors in Tufte's own historical claims and
redesigns. **Practical takeaway**: don't treat "more minimal" as automatically
"more honest" or "more effective" — a slightly richer, well-crafted design that
gets read beats a minimal one that gets skipped.

## Tamara Munzner — Tufte's rules are inputs, not the whole method

*Visualization Analysis and Design* treats Tufte's rules of thumb ("no
unjustified 3D," "eyes beat memory," data-ink minimization) as useful heuristics
within a much larger, more systematic framework covering task abstraction, data
abstraction, encoding/interaction idiom choice, and validation — and explicitly
notes that Tufte's books address static, printed presentation, not the
interactive, exploratory, computationally-generated visualizations that dominate
modern tooling (zoom, brush, filter, drill-down). **Practical takeaway**: Tufte's
doctrines govern what a single static view should look like; they say nothing
about interaction design, and this skill should not be reached for when the
actual gap is "the user needs to filter/drill/explore," not "the static figure
is cluttered."

## Claus Wilke — minimalism as one heuristic, not a mandate

*Fundamentals of Data Visualization* takes a non-dogmatic stance: data-ink
reduction is one useful lens among several (also: choosing the right
geom/visual mapping for the data type, color for the right purpose, legible
text, appropriate figure sizing), not a maximization target pursued for its own
sake. Wilke is more permissive than Tufte about redundant encodings — a legend
AND direct labels, for instance — when they help different readers. **Practical
takeaway**: match the checklist in SKILL.md against the reader's actual task; a
technically "more minimal" figure that serves the task worse is a regression,
not an improvement.

## Robert Kosara — chartjunk is not one thing, and some of it helps memory

eagereyes.org distinguishes categories lumped under "chartjunk": pure
decoration that adds nothing, obfuscating clutter that actively hides the data,
and embellishment that aids recall/engagement without hiding anything (an icon,
a themed color, a pictorial motif that maps to the subject). Kosara cites
research (Bateman et al., CHI 2010 — see `references/sources.md`, "not
independently fetched this pass") finding that embellished charts were recalled
better weeks later with no measured loss in immediate reading accuracy.
**Practical takeaway**: distinguish "does this ink hide or distort a value"
(always cut) from "does this ink add a memorable, non-misleading visual hook to
an otherwise forgettable chart" (a judgment call, not an automatic cut) — but
default to cutting in this repository's technical/whitepaper context, where the
reader is a domain expert checking a claim, not a general audience who needs a
memory hook to bother looking at all.

## Accessibility — a gap none of Tufte's four books address

Tufte's doctrines predate, and are silent on, accessibility as a discipline:
color-only encoding (fails color-vision-deficient readers), tiny sparklines and
small-multiple panels (fail low-vision readers and screen magnification), and
text-as-image labeling (fails screen readers) are all compatible with a high
data-ink ratio while failing a meaningful share of readers. **This skill's
position**: apply Tufte's doctrines for density, honesty, and integration, AND
independently apply accessibility requirements (sufficient color contrast,
redundant non-color encoding, real text for screen readers, a minimum readable
size for any inline sparkline or small-multiple panel) — the two are
compatible, but Tufte's books will not tell you to do the second, so don't skip
it because a figure already scores well on data-ink.

## When to deviate from Tufte on purpose

- **General/consumer audience, first exposure to the topic**: a modest amount
  of memorable embellishment (Kosara) may beat pure minimalism for uptake —
  this is more relevant to marketing surfaces than to this repository's
  technical docs and whitepapers.
- **Exploratory/interactive tooling**: reach for Munzner's fuller framework;
  Tufte's static-print doctrines under-specify interaction.
- **Reader needs exact values, not just pattern**: keep the table (doctrine
  15), possibly with a sparkline column, rather than forcing a chart-only
  design because charts read as more "Tuftean."
- **A gridline, legend, or label duplicates information but demonstrably speeds
  reading for this audience**: keep it (Few, Wilke) — measure or reason about
  the actual reader, don't purge by rule alone.
