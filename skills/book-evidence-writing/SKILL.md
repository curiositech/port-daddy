---
name: book-evidence-writing
description: >-
  Revise the Harbor Book so prose, drawings, and marginalia explain the same argument
  without unpublished development-document dependencies. Use for chapter additions,
  substantive rewrites, caption editing, visual exposition, and eliminating internal ADR citations.
license: Apache-2.0
allowed-tools: Read,Write,Edit,Grep,Glob
metadata:
  category: Writing & Publishing
  tags:
    - book
    - manuscript
    - editorial
    - marginalia
    - tufte
    - prose-review
    - evidence-writing
  provenance:
    kind: first-party
    owners:
      - port-daddy
  authorship:
    maintainers:
      - port-daddy
  pairs-with:
    - skill: tufte-evidence-design
      reason: Coordinates page architecture, margin apparatus, and typography rules.
    - skill: tikz-diagram-craft
      reason: Draws the geometric companion figures placed beside the prose.
    - skill: whitepaper-figure-system
      reason: Determines semantic role and evidence claims in the figure atlas.
  io-contract:
    kind: deliverable
    consumes:
      - kind: chapter-draft
        format: markdown-or-latex
        description: Target book section, neighbouring paragraphs, or rendered pages.
    produces:
      - kind: inspectable-text
        format: markdown-or-latex
        description: Revised manuscript section with self-contained mechanisms and clear margin cues.
---

# Write the Argument the Reader Can Inspect

These are editorial decisions from manuscript review and visual evidence examples,
ensuring every claim in the Harbor Book (*The Harbor, the Person, and the Economy*)
can be inspected by the reader without relying on unpublished design records, private ADRs,
or workshop jargon.

## Read First

Read the target section with its neighbouring paragraphs, its rendered Book pages, and
`skills/tufte-evidence-design/references/margin-apparatus.md`. For numerical or protocol
figures, also read Tufte Evidence Design and the relevant chartwork rules.
Consult the reference documents in `references/`:
- [01-argument-inspection.md](references/01-argument-inspection.md): Eliminating private authority and stating verifiable mechanisms.
- [02-marginalia-and-cues.md](references/02-marginalia-and-cues.md): Writing active margin assertions, cues, and sidecars.

See concrete worked before-and-after transformations in `examples/`:
- [adr-to-inspectable-argument.md](examples/adr-to-inspectable-argument.md): Converting internal ADR citations into reader-inspectable prose and marginalia.

## Core Rules for Revision

1. **State the reader's difficulty first.** Begin with the real-world operational problem:
   a revoked credential returns after restore; a new identity escapes a penalty; a reviewer
   shares another reviewer's blind spot.
2. **Give a concrete instance before generalizing.** Name actors, quantities, actions,
   and consequences. Define necessary vocabulary at first use.
3. **State the mechanism and its assumptions.** Replace *"the design record says"* with what
   must hold and why. Unpublished ADR numbers, private proposal paths, and branch histories
   cannot serve as reader-facing authority.
4. **Preserve epistemic status distinctions.** Distinctly demarcate:
   - *Theorem / formal proof*
   - *Bounded mechanical check*
   - *Implemented slice*
   - *Proposed mechanism*
   - *Empirical hypothesis*
   Removing an internal citation must not convert a proposal into a shipping claim.
5. **Make each visual and textual mode contribute uniquely:**
   - *Prose* develops reasoning.
   - *A drawing* exposes spatial or relational topology.
   - *A table* permits direct numeric lookup.
   - *The margin* offers an example, counterexample, or concrete warning.
   Eliminate redundant restatements across these modes.
6. **Eliminate workshop narration.** Strip out filler phrases like *"the honesty rider"*,
   *"this is the hinge"*, *"the whole story"*, and *"precisely the synthesis"*. Replace them
   immediately with the concrete proposition being made.
7. **Conclude with consequences and remaining limits.** Never end with a promotional summary.
   Cross-reference upcoming topics by concept name, never by private file path or issue number.
8. **Margin cues must state the claim or warning.** Never print a bare *"Pitfall"*, *"Key idea"*,
   or *"Note"*. Use an active sentence: *"A restore can undo revocation"* or *"Access is not permission"*.

## Verification Checklist

- [ ] **Read without captions:** The text flows logically and makes sense on its own.
- [ ] **Read without prose:** Figures and tables are self-explanatory with proper labels.
- [ ] **Zero private citations:** No ADR-XXXX, internal branch names, or private issue IDs appear.
- [ ] **No bare margin tags:** All margin annotations state active assertions or warnings.
- [ ] **Epistemic honesty:** Implementation status is clearly separated from proposed designs.
- [ ] **Automated Tests:** Verify bundle integrity and editorial gates with `pytest tests/test_book_evidence_writing.py`.
