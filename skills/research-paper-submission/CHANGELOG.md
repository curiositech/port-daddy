# Research Paper Submission — Changelog

## 1.1.0 — 2026-08-31

- Declared the cross-skill reference indexer as an explicit dependency instead of a nonexistent local script.
- Registered the bundle as a general publication method, not an authority for corpus findings.

## 1.0.0 — 2026-08-26

Initial release. Built from five parallel primary-source research passes:
venue CFPs fetched and read, fifteen recent strong papers read in full,
practitioner writing guidance traced to its authors, the cognitive-load and
perceptual-encoding literature checked against its actual experiments, and a
corpus of real positioning failures from an in-house six-paper program.

**Added**

- `SKILL.md` — transplantation decision tree, seven-step order of work, eight
  anti-patterns in Novice/Expert/Detection/Real-cost form, sixteen quality gates.
- `references/venue-map.md` — page/blindness table across 15 venue families, the
  three transplantation failure shapes, the empirical-bar warning, live adjacent
  conversations.
- `references/finding-prior-art.md` — snowballing protocol, controlled
  vocabularies (ACM CCS, MSC, JEL, arXiv), per-tool blind spots, the naming check.
- `references/exposition-craft.md` — verbatim practitioner guidance (Halmos,
  Knuth, Krantz, Tao, Mermin, Peyton Jones, Dreyer, Tsitsiklis) plus the two
  cognitive-load effects and Gentner's systematicity test.
- `references/exemplar-structures.md` — nine opening moves with verbatim
  examples, per-community structural conventions, two structures worth copying.
- `references/figures-and-examples.md` — evidence tiers marked
  [experiment]/[expert opinion]/[craft lore], Cleveland–McGill ranking, the
  Okabe–Ito palette, theory-figure conventions, caption rules.
- `templates/positioning-worksheet.md` — ten sections, each derived from a real
  failure.
- `scripts/submission_lint.py` — structural, citation, reference, figure and
  overclaim checks for a LaTeX submission.
- `scripts/test_submission_lint.py` — 20 assertions, including a regression for
  the `\\{` brace-counting bug (a naive `replace(r'\{','')` matches the second
  backslash of an escaped `\\` and reports a phantom imbalance on files that
  compile).

**Evidence discipline**

Every factual claim carries `[verified]`, `[probable]` or `[uncertain]`, and
claims that could not be checked against a primary source are marked as such
rather than dropped or asserted. Deadlines are cycle-stamped because they move.
