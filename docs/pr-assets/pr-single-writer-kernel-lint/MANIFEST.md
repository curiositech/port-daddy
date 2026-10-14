# Visual Proof — Fix textbook-craft audit defects in The Single-Writer Kernel

Provenance manifest for the page renders in this directory, per the
`agent-visual-evidence-manifest` skill and the figure/print-territory rule in
`scripts/check-pr-requirements.mjs`.

## How these were made

Every PNG here is a **genuine `xelatex` compile of the actual before/after
chapter source**, rasterized with `pdftoppm` at 150 dpi — not a mockup, not a
screenshot of an editor, not a hand-drawn approximation.

```
# before (this PR's merge-base with main)
git show <merge-base-sha>:whitepaper/single-writer-kernel.tex > before.tex
xelatex -interaction=nonstopmode before.tex   # x3 passes, resolves \ref/\cite
pdftoppm -png -r 150 -f <N> -l <N> before.pdf before-<label>

# after (this PR's head)
xelatex -interaction=nonstopmode whitepaper/single-writer-kernel.tex   # x3 passes
pdftoppm -png -r 150 -f <N> -l <N> single-writer-kernel.pdf after-<label>
```

Both compiles share the same `figures/` tree (untouched by this PR) and the
same `xelatex` toolchain available in this container — a real LaTeX
toolchain **was** available here (`xelatex`, `pdflatex`, `latex`; no
`tectonic`), so both the before and after PDFs are genuine compiles, not a
brace-balance proxy. Each compiled cleanly (exit 0), stably across three
passes, with **zero** `undefined reference` / `undefined citation` warnings
and an **identical** overfull-hbox count (2 → 2) before and after. Page
count: 59 → 61 (the two extra pages are exactly the added worked-example
material; no section moved or exploded).

Because content was added mid-chapter, the "after" page holding a given
passage is sometimes one or two pages later than the "before" page holding
the same passage — each pair below states both page numbers rather than
assuming they match.

## The pairs, and what each shows

- **`before-opener-05.png` / `after-opener-05.png`** (page 5, both).
  The chapter opener (§1, "Where this paper sits"). *After* adds a
  `pdexample` previewing the Alice-and-Bob port-7421 collision that
  §6 (the resource organ) works out in full — satisfying the
  chapter-template's "first worked example before any definition" rule at
  the whole-chapter level, using a number introduced honestly (forward
  reference to the section that owns it, not a new invented one).

- **`before-p9-09.png` / `after-p9-09.png`** (page 9, both).
  Definition 4.1 ("Single-writer discipline"), §4 (the substrate organ).
  *After* adds one sentence stating the claim's epistemic kind (**design
  invariant**) and its maturity (`\Built`) inside the definition's own body
  — this is one of the 8 previously-untagged claims `claims_carry_epistemic_kind`
  flagged.

- **`after-p10-10.png`** vs. **`before-p10-10.png`** (page 10, both — the
  same subsection, "The configuration is the durability claim").
  *After* adds a new `pdexample` grounding the section's "bounded
  auto-checkpoint interval, bounded busy-wait" prose in the two real
  numbers the reference implementation's own pragma set fixes
  (`wal_autocheckpoint=200`, `busy_timeout=5000`, both already stated in
  this same chapter's Appendix A) — no invented number, only the stated
  constants' own arithmetic consequences.

- **`before-p15-15.png` / `after-p15-15.png`** (page 15, both).
  §6 (the resource organ), Theorem 6.1 ("Atomic Mutual Exclusion and Fenced
  Leases") and the "Alice and Bob race for one port" dramatization. *After*
  (a) tags the theorem with its epistemic kind (**theorem**, `\Built`
  mechanism) and (b) promotes the already-fully-narrated port-7421
  dramatization from a bare `\paragraph` into a real `pdexample` environment
  — the "nearly free" fix the method calls for, with zero new numbers.

- **`before-attest-31.png` / `after-attest-32.png`** (page 31 before, page
  32 after — the chapter grew by one page between the two sections shown).
  §9 (the continuity organ) and §10 (the self-attestation organ). *After*
  adds two `pdexample`s that **count, rather than invent**: one counts the
  continuity organs' own stated grades (1 of 3 `\Built`, 2 of 3
  `\BuiltWeak`), the other counts Table 7's thirteen invariant rows (7
  `\Built`, 5 `\BuiltWeak`, 1 `\NotGuar`) to show concretely what Property
  10.1's "honest self-report" actually prints. Property 10.1 itself also
  gains its epistemic-kind sentence (**design invariant**, `\Built`).

- **`before-atomicity-37.png` / `after-atomicity-39.png`** (page 37 before,
  page 39 after). §12, "Cross-organ atomicity: a buildable defect, not a
  frontier." *After* adds a `pdexample` tracing the section's own opening
  "three writes" sentence both ways (unwrapped vs. wrapped in one
  transaction) — the count of "three" is the section's own first sentence,
  not a new invented number.

- **`before-escapes-39.png` / `after-escapes-41.png`** (page 39 before, page
  41 after). §13 (the threat model), "The enforcement gate proves; it does
  not yet compel." *After* promotes the already-narrated "at least five
  escapes" parenthetical into a numbered, counted `pdexample` — the five
  items were already named in the prose; this only counts and numbers them.

## What is not shown

Two more blocking-floor fixes (the deontic-split Definition 8.1's kind tag,
and the two `Metric-control separation` / `Oracle-bound closure` Property
tags, plus three more Theorem tags: the prevention-bound theorem, the
decidability theorem, and the consistency theorem) follow the identical
one-sentence-inside-the-body pattern shown in the `p9` and `p15` pairs
above and are not separately rendered here, to keep this manifest to a
representative set rather than one image per edit.

## Reproducing

From a checkout of this PR's branch at its head commit:

```sh
cd whitepaper && xelatex -interaction=nonstopmode -halt-on-error single-writer-kernel.tex
xelatex -interaction=nonstopmode -halt-on-error single-writer-kernel.tex   # resolve refs
pdftoppm -png -r 150 -f <N> -l <N> single-writer-kernel.pdf out
```
