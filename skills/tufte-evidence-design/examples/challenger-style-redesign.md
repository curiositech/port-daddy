# Before/After: Chronological Incident Chart → Causal Scatter (the Challenger pattern)

**Situation**: A postmortem or reliability report needs to argue that a
specific factor (temperature, load, config version, region) causally predicts
an incident/failure.

## Before (the Morton Thiokol pattern)

- A table or bar chart of incidents ordered by **date** (chronological, the
  order the data happened to arrive in), showing only the incidents that
  failed, with the suspected causal variable (e.g., deploy-time CPU load)
  buried in a footnote or a separate column the reader must cross-reference.
- Cluttered supporting slides: small multi-colored icons per row, inconsistent
  fonts, and a wall of similar-looking numbers with no visual sort by the
  variable that matters.

**Why it fails the doctrines**: this is exactly Tufte's Challenger diagnosis
(doctrine 12) — ordering by an irrelevant variable (time) instead of the
causally relevant one (temperature/load/whatever the hypothesis is) hides the
correlation in plain sight; showing only the failures (not the full data)
violates "show comparisons" (doctrine 9.1) because there's no baseline of
successful cases at the same causal-variable values to compare against.

## After (the Tufte redesign pattern)

- One scatter plot: causal variable on the x-axis, outcome severity (not just
  binary fail/pass) on the y-axis, **every** case plotted — successes AND
  failures — so the reader can see the full distribution, not a
  survivorship-biased subset.
- Direct-labeled outliers (the specific incident IDs at the extremes), no
  legend needed if there's only one series; a second series (e.g., a different
  environment) gets a small-multiples panel, not a second overlaid color if
  that would clutter the same axes.
- A one-sentence caption stating the causal claim as a checkable sentence
  (doctrine 13): "Every failure occurred at CPU load above 85%; no failure
  occurred below it" — not "Figure 4: Incidents by load."
- If the report also needs the ceremony of an official chronology, keep it as
  a SEPARATE table for the record — doctrine 15 (tables for lookup, graphics
  for pattern) — rather than forcing one chart to serve both purposes badly.

**Net effect**: the reader sees the causal relationship in the time it takes to
look at one plot, the same way Tufte's redesign of the Thiokol data makes the
temperature/O-ring-damage correlation visible in one image where the original
13 charts, ordered by date, did not.
