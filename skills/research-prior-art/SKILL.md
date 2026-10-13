---
name: research-prior-art
description: >-
  Find and verify the closest prior work when a research result crosses
  disciplinary vocabularies. Use before a novelty claim, coined term,
  contribution paragraph, or related-work section. NOT for doing the proof
  or experiment, choosing a venue, formatting a submission, or general
  technical writing.
license: Apache-2.0
metadata:
  category: Research
  tags: [prior-art, literature, novelty, terminology]
  pairs-with: [research-paper-submission, research-craft]
---

# Research Prior Art

A vocabulary search can miss the closest result. Search for the *structure*
of the claim in the language of each adjacent field, then verify the exact
hypotheses and conclusion in primary sources. A search result or secondary
summary is a lead, not a citation.

## Protocol

1. State the proposed contribution without the terminology of the field it
   imports from. List its objects, relation, hypotheses, and output.
2. Search each adjacent field's own controlled vocabulary. Record terms and
   search paths, including unsuccessful searches.
3. Start from at least one primary seed and follow its references backward
   and citations forward. Follow a second round for the closest candidates.
4. Compare the nearest result at the theorem or mechanism level: assumptions,
   quantifiers, degenerate cases, construction, and proven boundary.
5. Quote the exact statement from the primary work in a private research note;
   paraphrase carefully in the submission with citation.
6. Search any proposed new name verbatim. If the term already names the same
   concept, adopt and cite it; if it names another concept, choose a new name.
7. Record the delta as one of: new bridge, stronger result, narrower
   application, independent implementation, or relabeling. A relabeling needs
   a different contribution claim.

The detailed search and verification procedure is in
`references/finding-prior-art.md`. For venue, page budget, and final submission
structure, hand the evidence to `research-paper-submission`.

## Output

Produce a concise comparison table with each candidate's primary citation,
its exact hypotheses, what it proves, and the delta from the current result.
Keep a search ledger so another reviewer can reproduce the novelty check.
State what remains unknown; absence of a search hit is not proof of novelty.

## Checks

- The nearest modern instance and the foundational result have both been
  considered where applicable.
- At least one search used another field's own vocabulary.
- Each claimed difference is visible in the primary statement or method.
- Every coined term has an exact phrase check.
- No bibliography entry is used to support a claim the work does not make.
