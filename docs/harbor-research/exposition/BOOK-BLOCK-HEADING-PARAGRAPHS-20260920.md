# Content-block heading paragraphs

Operator directive, 20 September 2026, 16:34 PDT: each content block's type,
number and optional name stand alone; its first sentence starts in the next
paragraph. This is a presentation rule, not a new statement kind or counter.
Earlier requirements and the whole-Book todo remain active.

## Implementation and boundaries

- Shared `pdblockheadingend` ends the heading, keeps it with the first body
  lines, and restores ordinary unindented body paragraphs.
- Claims and Numbers by Hand retain their shared sequence, title case,
  parentheses, bold weight, Lucide icons and asymmetric closed frames.
- Book amsthm statements, including unnamed definitions and remarks, flush
  the deferred heading into a paragraph before reading body tokens.
- Protocols retain all four source interfaces and their original counters.
- Proofs retain amsthm's optional heading and QED stack; scenes, exercises
  and collected solutions also separate their authored heading from prose.
- Margin-only labels, Recall lists and transcript/data titles are already
  separate from body prose. This does not turn internal protocol fields,
  bold emphasis, citations or ordinary inline terms into new blocks.

Both shared source mirrors are edited together. No font-size reduction,
scientific-model execution, new experiment or local Port Daddy runtime was used.

## Verification

The expanded `lucide-blocks-book.tex` fixture has named, unnamed, wrapped,
list-first and display-first cases. The rendered regression checks 22
heading/body pairs on their actual physical page and also checks that the
opening list marker accompanies the item below the heading. Existing checks
retain bold title grammar and resolved numbered references.

The original run-in specimen visibly puts “A bounded counter” on the same
line as its definition heading. An intermediate newline-based fix separated
the item text but left its numeral next to the heading; visual review rejected
that candidate. The corrected implementation ends a real heading paragraph.
Parent inspected the wrapped/unnamed cases and the repaired list-first page.

Candidate artifacts are under `.cache/book-heading-paragraphs-20260920`.
The 13-page specimen passes ten enabled test methods. Its PDF SHA-256 is
`d01f7714` (prefix; complete digest belongs with the artifact). Parent viewed
the final list-first page, not just extracted text.

Full-Book `second-proof` compiled to 710 pages, SHA-256
`be0e15fb98519c863a8d956f67060aa6ac0bd503654ba5b613888b8f2ded7a03`.
All 2,172 public identities, 271 section anchors and all 553 complete citation
occurrence records remain unchanged. Compare citation records by occurrence,
not raw AUX write order: deferred writes reorder across pages.

The full suite ran 250 tests, initially with four failures. Two were obsolete
layout assumptions, corrected without widening tolerances: the historical
definition note now aligns with its opening body sentence, and discretionary
line-end hyphenation is normalized within (never across) a physical page.
The focused 20-test rerun passed with one inapplicable negative-PDF test skipped.

This full candidate is **not accepted**. Remaining actual reflow findings:

- The finite noninterference scope clause broke across the page; an opening
  reservation is now in source, awaiting the next proof.
- The Wald portrait was lifted 16.45pt above its proof; the owning passage's
  reservation now includes the portrait height, awaiting the next proof.
- Recall margin object 957 is off-page on physical page 498, and Figure 5.14's
  caption is displaced on page 382. Maxwell owns bounded diagnosis/sidecar
  repair; no canonical fix is claimed yet.
- The independent eight-chapter sample flagged a short theorem opening on
  page 483. Shared frame reservation is now seven instead of five baselines
  to accommodate the standalone heading, padding and opening body lines.

Parent inspected actual pages 198 and 200; the independent reviewer inspected
39, 135, 189–190, 231, 327, 410, 483–484 and 578–579. That is bounded review,
not all-page visual certification. The next proof must use the latest source
and rerun margins, captions, overflow, references and the full scoped suite.
The earlier accepted 04f453 Book remains the accepted baseline. Publication
and whole-Book acceptance are still pending.

## Subsequent integration review

The old second-proof findings above are historical. Subsequent source-local
repairs retain Recall in bounds, restore Figure 5.14 caption adjacency, keep
Wald with its proof, and keep the noninterference/Six Pairs/Structural Scope
reading units intact. Parent and independent actual-page review passed these
targets in the art proof. The latest `art-proof3` is 712 pages and passes 251
scoped tests plus three new object-placement tests. Public reference and
citation identities remain unchanged.

Checkpoint acceptance is still withheld: final TeX output reports pending
margin convergence even though instrumented geometry passes. The earlier
baseline has the same warning. Additional passes and a bounded diagnosis of
the convergence gate are in progress; see BOOK-MARGIN-OBJECTS-20260920.md.
