# Impact preview design study

Open [the interactive study](index.html) locally. It uses three invented cases
and six proposed paths: analytics exception, encrypted replay, and a spending
halt. It performs no network calls, starts no service or agent, and cannot
accept a decision. The constitution link opens a local document only if clicked.

The visual hierarchy puts applicable evidence beside a proposed path, followed
by consequences and retained dissent. Warm neutral surfaces, dark green text,
serif headings and quiet separators distinguish evidence from the decision
preview without adding a dashboard of scores. The same content stacks at narrow
widths. This is a standalone design study, not the shipping console's design
system or a validated replacement for it.

## Evidence

- [Desktop screenshot](preview-desktop.png): analytics removal, light, 1100px.
- [Mobile screenshot](preview-mobile-dark.png): halted retry, dark, 390px.
- [Layout report](layout-report.json): eight initial width/theme combinations,
  no detected collisions, clipping or horizontal overflow.
- [Interaction report](interaction-report.json): 48 expanded case/path/width/theme
  combinations; no detected geometry violations, page errors or network requests;
  keyboard checks and CSS enlarged-text reflow.
- [Design plan declarations](design-plan.json) and [audit result](design-audit.json):
  78/100, **not a complete design pass**. The three-second primary-action test
  and human navigation/task-completion study have not been performed. Their
  booleans are conservatively false, not evidence that human participants failed.

Measured contrast is at least 5.53:1 for the tested opaque text/background
combinations. Clickable targets are at least 44px; radio buttons use their whole
associated label. Text uses four sizes and three weights. Browser-native select
popup internals, screen readers, real mobile hardware, forced colors and OS text
scaling were not tested. CSS text enlargement is not a browser-zoom test.

The 0.051-second design-plan load value is the rounded maximum local-file DOM
ready time in this run, not time-to-interactive under hosted 3G conditions.
The shared design scorer cannot express that distinction; its score is
conditional on this local profile and does not establish a hosted performance
gate. Appearance consistency is an author assessment. No user-study results
are inferred from automated geometry or a screenshot.

## Reproduction

Use Python with Playwright and installed headless Chromium. Run
`verify_preview.py` with `--layout-guard` pointing to the installed
layout-overflow-guard's `check_layout.py`. The harness generates the interaction
report and two screenshots here. Run that guard directly at widths
320,390,720,1100 in light,dark to regenerate the initial layout report.
No local web server is required.

The first geometry run counted the closed disclosure's nonpainted descendants
as visible. An explicit closed-state `display: none` makes its hidden content
unambiguous to the checker and preserves native disclosure behavior. The final
checks cover both that initial state and expanded dissent in every case/path.

The follow-through pins `script-src` to the SHA-256 of the exact inline script,
replacing `unsafe-inline` without changing the preview's pixels or interactions.
The dependency-free `harness/test_preview.mjs` test in the research package
checks the digest and a tampered-script negative. This is CSP binding evidence,
not a claim that every possible injection has been excluded.

Run the repository's web-design-expert auditor against `design-plan.json` to
reproduce its conditional score. That scorer returns a `pass` field but does
not make its process exit status fail for a negative score; inspect the JSON.
Do not change unmeasured human-study fields to true just to clear it.
