# scripts/

Runnable tools. Both are libraries first and CLIs second, so a project's own gate can
import them instead of re-implementing (and re-breaking) fence parsing.

- `extract-examples.mjs` — delimiter-tracking parser that pulls every fenced block out of
  a markdown file with its line number, language, and declared `readme-verify` tier.
  Exports `extractFences()`, `shellInvocations()`, and `tokenize()`. Run it to see what a
  README's blocks actually are before checking them.
- `readme-scorecard.mjs` — scores a README against the rubric in `../SKILL.md`: the
  two-minute gate, broken media and links, the length budget, verification hygiene,
  section order, and voice. Exports `scoreReadme()`. Errors exit non-zero; warnings do
  not. Run it before shipping any README change.
