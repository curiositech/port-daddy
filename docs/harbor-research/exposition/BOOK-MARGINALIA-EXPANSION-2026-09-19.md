# Margin drawings and crowded-exhibit repairs — 19 September 2026

## Result and boundary

Eight explanatory margin drawings, three requested portraits, and one real-object
photograph are now in the assembled Book. Table 2.3 and Figure 3.7 have been
recomposed, and the repeated Leviathan frontispiece has been removed. This is a
local manuscript revision and rendered proof, not a published edition or an
approval of every existing figure.

The Tufte evidence-design and Book figure skills guided the work: put a small
graphic beside the sentence it explains, draw quantitative claims from explicit
inputs, preserve readable native-size labels, and judge the assembled page.
Two lower-cost native agents handled bounded photo research and the crowded
exhibits. The lead checked the sources, mathematics, and rendered results.
No local Port Daddy runtime, hooks, services, or agent launcher were invoked.

## Added margin content

Page numbers below distinguish printed folios from physical PDF pages.

| Graphic | What it explains | Folio | PDF page |
| --- | --- | ---: | ---: |
| Commit is not sync | The exposed interval before WAL synchronization | 11 | 39 |
| Silence is ambiguous | Missing heartbeats do not establish process death | 48 | 76 |
| Both bounds must hold | Stakes and reversibility jointly constrain consent | 192 | 220 |
| Same mean, longer tail | Equal-mean exponential and Lomax survival curves | 204 | 232 |
| Divide; do not duplicate | A 100-unit debit splits into 45 + 45 live units | 287 | 315 |
| A queue amplifies downtime | Common-scale decomposition of 4.17 versus 8.17 | 360 | 388 |
| The earliest expiry wins | Card validity ends with its earliest dependency | 534 | 562 |
| One epoch, two roots | Contradictory signed roots must reach one auditor | 544 | 572 |

These are reusable native-width TikZ commands in
`website-v2/public/whitepaper/figures/pd-margin-sketches.tex`. None is a screenshot
of an experiment or evidence of a deployed system. The heavy-tail graph is a
survival plot on a logarithmic vertical scale, not a density plot: exponential
`exp(-t)` and Lomax `(1+t/2)^(-3)` both have mean 1. The Lomax example has variance
3; it does not purport to be the separate `c_s^2 = 6` example in the prose.

The portraits appear beside the relevant arguments: Hobbes at consent (folio
186 / PDF 214), Sen at decisive allocation (436 / 464), and Jonathan Hickman at
the limits of the backup analogy (442 / 470). Each appears exactly once.
The retained Leviathan appears once at the Chapter 4 introduction (182 / 210).

A licensed photograph of the face and reverse of one probable printing stamp
replaces the previous movable-type analogy in the licensed-goods passage
(358 / 386). The source's uncertainty is retained: this is a *probable* stamp,
not a definitively identified printing technology. The first candidate, a
six-view catalogue plate, was rejected after viewing it at margin size.

## Exhibit repairs

- **Table 2.3 (106 / 134):** two readable columns, with phase and model in
  full-width group headings. All seven results remain, including the intended
  negative result. The long delegation query is broken at logical operators.
  Source comparison also found an omitted direct-issuance alternative; the
  table now agrees with the surrounding theorem and displayed model output.
- **Figure 3.7 (157 / 185):** separated nodes, visible arrow shafts and terminal
  gaps, padded checker boundary, and clear paired lanes. The outputs now read
  `g(s)` and `g(t)`, preserving the distinction the drawing is meant to teach.
  Its shortened caption remains in the adjoining margin.
- The second Chapter 4 Leviathan placement was deleted, not the asset. The
  earlier illustration assets remain on disk; five of the six previously
  accepted margin drawings are still placed.

## Measured effect and checks

| Measure | Previous proof | This proof |
| --- | ---: | ---: |
| PDF pages | 704 | 703 |
| Registered and placed margin objects | 896 | 906 |
| Numbered captions | 230 | 230 |
| Recorded floating-owner adjacency checks | 190 | 190 |
| Margin geometry issues | 0 | 0 |
| Whitespace review candidates | 39 | 34 |
| PDF bytes | 14,049,420 | 28,912,168 |

The net ten additional margin objects comprise eight sketches and three
portraits, less the duplicate Leviathan; the object photo replaces an existing
placement. The page reduction is combined manuscript reflow, not a claim that
illustrations inherently save pages. The image originals increase file size.

All 906 registered margin objects were placed once. No recorded margin
collision, missing shipped object, content-loss flag, or footer intrusion was
found. All 230 numbered captions pass margin bounds; adjacency is checked for
190 recorded floating owners, not every non-floating table or listing.
Thirty-one width advisories remain, including intentionally placed margin art;
they are not blanket visual acceptance or failure.

The new inventory check verifies eight unique registered sketch IDs against
their actual printed titles and folios, and verifies the decoded image content
and unique placement of all four sourced images and the retained Leviathan.
Five mathematical/source regression tests pass. All 15 image-sidecar checks
pass; the assembled contents checks (6) and Suisse typography checks (16) pass.
Chapter art in the contents and the existing part-opening spreads are retained.

Full-page inspection covered the eight sketch pages, four new photo pages,
single-Leviathan opening, both repaired exhibits and adjoining pages. Contact
sheets cover all 34 whitespace candidates plus the affected pages and credits.
The final table refinement was recompiled and inspected again. This review does
not certify every label or mathematical claim in all 703 pages.

The broader review still includes blank separators, short section-ending leaves,
dense older figures, references/credits reflow, and existing small-caps and
overfull-box warnings. In particular, physical pages 7, 29, and 379 are blank or
near-blank; pages 443, 516, 653, and 700 are short leaves. These are retained
review candidates, not silently labelled intentional. No type was shrunk to
hide whitespace or collisions.

## Sources and media preservation

All four new images are unchanged originals, with source URLs, hashes, creator,
licence, and framing recorded in adjacent JSON files under
`website-v2/public/whitepaper/plates/marginalia/`. Printed credits are included.

- [Thomas Hobbes, after John Michael Wright](https://commons.wikimedia.org/wiki/File:Thomas_Hobbes_(portrait).jpg): public-domain source.
- [Amartya Sen, Fronteiras do Pensamento](https://commons.wikimedia.org/wiki/File:Amartya_Sen_no_Fronteiras_do_Pensamento_S%C3%A3o_Paulo_2012_%286964218850%29.jpg): CC BY-SA 2.0.
- [Jonathan Hickman, Pat Loika](https://commons.wikimedia.org/wiki/File:Jonathan_Hickman_-_5976523290.jpg): CC BY 2.0; no endorsement implied.
- [Probable printing tile or stamp, Teresa Gilmore / Birmingham Museums Trust](https://commons.wikimedia.org/wiki/File:Post_medieval,_Probable_Printing_tile_or_stamp_(FindID_973303).jpg): CC BY 2.0, FindID 973303.

The four new JPEG originals total 15,412,497 bytes. They are candidates for the
existing R2 media work, but no upload or deletion was performed here. Any
migration must preserve original hashes, attribution sidecars, and a verified
build consumer. Repository slimming and delivery-image sizing remain separate
from the correctness of these placements.

## Reproducible proof and handoff

- Previous PDF: `.cache/book-equilibrium-followup-20260919/build/coordination-papers-mega-volume.pdf`
- Previous SHA-256: `e757793da8c26142494fa91cff625277f2782f05ef4753beae663ec2ba1a2729`
- Current PDF: `.cache/book-marginalia-expansion-20260919/build/coordination-papers-mega-volume.pdf`
- Current SHA-256: `d4bc82a7bb7e3ddb912e30d1117b8eaf8b161c8252c79a1d6311e5da87b5ef02`
- Reports: `.cache/book-marginalia-expansion-20260919/{expansion,layout,caption,overflow}-audit.json`
- Page proofs: `.cache/book-marginalia-expansion-20260919/review-final/`
- Build transcript: `.cache/book-marginalia-expansion-20260919/book-build-output.log`

The expansion audit includes hashes for the touched manuscript/figure inputs
and new asset/sidecar files. The proof uses cached Tectonic with four passes,
`SOURCE_DATE_EPOCH=1789689600`, and the private Suisse files referenced in place.
Those font files were not copied into the repository. Standalone chapter builds
and hosted publication are not certified by this proof.

The shared dirty worktree was preserved without broad staging or commit. The
durable PR steward must retain this source slice during reconciliation and must
not mistake it for an independently committed, merge-ready branch. Protected
publication and ambiguous PR closures remain subject to the existing hold.

The attempted handoff of this report's local paths, hashes, and publication
status to the existing **Book, Media & Hook PR Steward** task was rejected by
the app's permission review. No handoff was delivered; specific permission to
share that unpublished-manuscript metadata is still needed. No alternate
channel or workaround was used.
