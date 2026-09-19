# Rewrite Checklist — run after every humanizing pass

Work the report top-down, highest severity first, then verify each line below.

<!-- humanize:ignore-start
     A checklist is genuinely a list, so bullet-colonization and heading-spam are
     documented false positives here (see each item's false_positive_when line in
     catalog.json). The markers are the honest way to say so, rather than padding
     this file with prose it doesn't need. -->

## Surgical-edit verification
- [ ] Every fix touched only the flagged span; surrounding text is byte-identical
- [ ] No new tropes introduced (re-run both layers; report should be empty or low-only)
- [ ] Meaning preserved — claims, numbers, and commitments unchanged

## Voice restoration
- [ ] Contractions present where a person would use them
- [ ] At least one sentence per section a template would never produce (an aside, an admission, a specific memory)
- [ ] Sentence lengths vary; read one paragraph aloud as the test
- [ ] Opinions stated as opinions, not hedged into mush

## Specificity
- [ ] Every adjective either earns its place with a number/fact or is gone
- [ ] CTAs name what actually happens on click
- [ ] No audience trifectas ("whether you're a, b, or c")

## Visual (if applicable)
- [ ] Typeface was chosen, not defaulted; accent color traceable to a decision
- [ ] Zero emoji in UI chrome; one icon system throughout
- [ ] Layout has at least one designed irregularity
- [ ] Text ≥14px / 0.875rem everywhere; zoom not locked

## Final
- [ ] Read the whole piece aloud once. Anywhere you stumble or cringe, fix it
- [ ] Report regenerated and archived next to the artifact
<!-- humanize:ignore-end -->

For lessons and research explanations:
- [ ] The hard step in each worked example is visible and independently checked.
- [ ] Prerequisites are taught or explicitly assumed before later use.
- [ ] At least one appropriate independent task can reveal misunderstanding.
- [ ] Synthetic data, illustration, empirical evidence, and conjecture remain distinct.
- [ ] Claims match the source's population, method, result and limits.
- [ ] Each surviving title layer contributes distinct information or orientation.
- [ ] No typography or style cue has been converted into an authorship accusation.
