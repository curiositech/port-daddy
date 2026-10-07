# Sealed Harbor: controls, authorizers and recipients — 20 September 2026

Scoped local acceptance after parent and independent exact-proof review. The Book remains
unfinished and unpublished. This records a figure change, not evidence that a
confidential runtime or the pictured architecture has been deployed.

The preceding goal turn made progress: it integrated the enforcement redraw,
repaired its page flow and produced an independently reviewed exact PDF. This
pass builds on those bytes, not on an unexecuted plan.

## Exact proof and scope

- Current PDF: `.cache/book-sealed-pipeline-20260920/coordination-papers-mega-volume.pdf`
- PDF SHA256: `eae607067ec43f31e687a3950e6d6d9f8bb9846ad5d719cd718e0820b05e1968`
- AUX SHA256: `da99a99027a42c4f5f29d1ed3c5101805fb003b3cbfeab02b324c734101d02af`
- 698 pages, unchanged from the preceding enforcement proof, SHA256
  `8aa77ebdacf250671232bc8be7af0406d09cdfaefab422ed7f0945f9289f6177`.
- Figure **3.5**, physical **187**, folio **159**; stable label
  `sealed:fig:sealed-pillar-pipeline`, atlas `VIII/fig:sealed-pillar-pipeline`.
  The sidecar's Figure 3.6 / folio 155 was a wrapper fixture, not Book numbering.
- Reader extract: `.cache/book-sealed-pipeline-20260920/sealed-pipeline-pages.pdf`,
  actual pages 186–189, not an independently typeset chapter.
- Independent review:
  `/Users/erichowens/coding/tmp/book-sealed-pipeline-independent-review-20260920/REVIEW.md`.

Changed source:
`website-v2/public/whitepaper/figures/fig-sealed-pillar-pipeline.tex`, SHA256
`91fdb2ac96260b8bd1874d63fa0b096ab0a0014106edb0ed5ef66a75c6300dfb`.
This is byte-identical to Goodall's reviewed candidate. The previous fragment
is retained as `before-fig-sealed-pillar-pipeline.tex` in the current cache,
SHA256 `680ef0c30e568baab493696189d7cb6290fedd7fec1724b3ed110d7ab5fde700`.
The owning chapter is unchanged, SHA256
`689048742a055ec499c718ef409b6b5dc518e5a4288cbd18d5475f6bd57ea6a6`.

## Six-line brief

1. Reader question: which controls mediate an output, and whose permission
   authorizes each recipient's release?
2. Claim: the proposed worker path passes through an in-guest monitor and an
   outer gateway, then branches into independently authorized releases.
3. Relation: component/control flow, with distinct configuration bindings;
   not a time axis, formal UML model or observed execution trace.
4. Required evidence: work order signed by both principals; handles-only
   worker; monitor inside the guest; Derek-controlled gateway outside it;
   distinct monitor/gateway responsibilities; restricted candidate; two
   separate owner-specific removals and explicitly named opposite recipients.
5. Counter-reading: neither gate removes both restrictions; owner is not
   recipient; no unmediated bypass; no serial requirement to obtain both
   authorizations; omitted public receipt is not a nonexistent channel.
6. Acceptance boundary: proposed architecture, source-owned labels and flow;
   no runtime confidentiality, key-appraisal or full C1 coverage claim.

The atlas's component/control-flow grammar is retained. Folded-paper records
identify artifacts, while bounded control rectangles and the guest grouping
identify different roles. Solid arrows carry candidates/releases; dashed
links bind controls to the work order. Both release columns have equal
geometry. Text, position and line style preserve distinctions without color.
The user-approved pictographs and categorical colors take precedence over
stale blanket metaphor/two-color prohibitions in older skill guidance.

A serial chain through both owners was rejected because it would imply both
removals were required and produce an unrestricted state. The canonical old
fragment already had parallel gates: this pass improves layout, bindings,
controller/timing labels and artifact hierarchy, not a newly fixed serial-gate
error. A second four-checker ledger inside the figure was rejected because
the neighboring Table 3.3 already supplies that different comparison.

## Actual-page review and impact

Parent opened the actual native-size figure on 187, its owning comparison and
introduction on 186, the untouched Swiss plate on 188 and the section opening
on 189. The gate owners and opposite recipients are aligned and legible;
configuration shafts and the outer output gutter are visible. Caption remains
beside the figure's top in the right outside margin. No collision or clipped
label was observed in this inspected scope.

Native figure size is **321.775 × 474.85 TeX pt**, inside the 325.21503pt body
measure. Shared `SGType` stays **9/11**, with licensed Suisse and the genuine
Book's `newpxmath` letters. No scaling, font substitution, clipping, white
masks or local font overrides were added. The larger figure reduces its old
234.0pt empty lower band to 117.4pt without moving the next plate or section.
The figure's semantic content, rather than font inflation, uses that space.

A fresh structural comparison covered all 698 pages against the exact 8aa
baseline. It compared raw text/glyph coordinates, vector drawing records,
image-pixel digests and placement, and page rectangles. **Only physical 187
differs**, in text/glyph and vector records; the other 697 pages match those
fields exactly. This is not a claim of whole-Book visual approval or literal
raster equality. Script, method and result are retained in `summarize.py` and
`final-summary.json` in the current cache.

Turing independently opened current pages 185–191 and 193, plus baseline
187 and 189. Cached PNG provenance and raster comparisons cover 185–195:
all cached pages match the exact current PDF, and 185–186 / 188–195 are
pixel-identical to the preceding proof. Pages 192, 194 and 195 were compared
mechanically, not visually opened. The review confirms the two owner-specific
removals, recipient mapping, bindings, proposed status and omitted-receipt
qualification. All 24 integrated text boxes match the candidate's measured
boxes. Caption top and exhibit top both sit at 61.2 PDF pt. Every Sealed figure
3.1–3.14 retains its number and destination. This is scoped acceptance, not
approval of the chapter's broader implementation or confidentiality claims.

The existing model-checked block on 189 ends with a hyphenated continuation
across the page. It is structurally unchanged from baseline, not fixed or
introduced by this pass. Retain it with the other pagination debts. The Swiss
plate, its solid text panel, part spreads and downstream figures were not
altered to make the new exhibit fit.

## Tests and evidence limits

Nine new permanent tests live in
`tests/harbor-research/test_sealed_pipeline_figure.py`. They check both fences,
the two independent authority paths, ownership/recipient labels, original
caption/identity, proposed status, explicitly omitted public receipt, native
actual-PDF geometry/type and aligned output columns. They reject 34 bounded
in-memory source variants and use the previous PDF as a negative control for
the new explicit control contract. These are diagram/specification tests,
not a declassification implementation or security proof.

The first test version had three fixture/extraction mistakes: it used the
wrapper's figure number, counted the caption's repeated work-order phrase as
a second body label, and treated a source line break as missing words. It also
initially assumed math font names contained “Math”; the genuine Book uses
`NewPXMI`. The tests now resolve Book numbering from the stable AUX label,
restrict figure searches to the body rail, normalize ordinary whitespace and
recognize the actual preamble's math face. No figure was weakened or shrunk
to conceal those test errors.

- **174 scoped tests pass; 71 generator tests pass**, with no skips.
- **1363/1363 margins**, zero registered issues.
- **233 captions**, zero failures; **193 owner-adjacency checks**.
- Zero detected lost content, margin collisions or footer intrusions. The 35
  full-width records remain an inventory, not aesthetic certification.
- **2172 public signatures, 271 section identities and 553 citation records**
  unchanged from the exact preceding AUX.
- **54 whitespace candidates**, same count; only the figure's lower gap changes.
- **42 normalized overfull warnings unchanged**, not eliminated.
- Fresh atlas audit remains **89/127, 38 missing contracts**. Its test suite is
  24 pass / one obsolete-count assertion failure. Correcting that assertion
  would not resolve the missing coverage; this is not an all-green gate.

The candidate's prior finite checker covered 24 nodes, 276 pairs, 69 structural
segments and 37 negative controls; parent had independently rerun it before
integration. Its 5.327pt text/text and 5.739pt text/mark clearances are retained
candidate geometry evidence. Those checks do not certify reader comprehension.

The four-secret, depth-7 C1 model is narrower than this architecture. Its gate
names denote destinations, not the ownership labels drawn here; it has no full
two-owner label lattice, second model secret, signature appraisal, gateway
topology or worker-computed payload register. It was not imported or run by
this integration pass. Broader implementation/test assertions in the owning
chapter are source assertions, not freshly verified deployment evidence.

## Remaining work

Goodall owns a separate next-candidate lane at
`/Users/erichowens/coding/tmp/book-atlas-evidence-20260920/sealed-two-worlds-candidate/`.
Its task is to distinguish two executions from a raw-release negative control,
preserving the finite scope and source of the trace. Dispatch is not completion;
any returned candidate still needs parent review and actual Book integration.

The citation-stack offsets, including Firecracker and Rao, the lock-header
wrap, inherited model-checked continuations and OP-3/table interruption remain
unresolved. Held signer-key, task-signability, checkpoint-acknowledgment,
replay-equivalence, work-unit settlement and Split-Digest choices still await
Erich. No paid/provider experiment ran; the $50 experimental cap is untouched.
Local Port Daddy stayed halted. No Git staging, commit, push or PR occurred in
this dirty shared figure tree. The full Book goal remains active.
