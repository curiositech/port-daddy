# The margin is an evidence column

Updated 2026-09-20. This replaces the old portrait-only proposal. Follow the
complete Tufte Evidence Design skill and its references, especially
skills/tufte-evidence-design/references/margin-apparatus.md.

## What belongs beside the argument

The main text carries the argument. The outside column can carry a small
calculation, counterexample, diagram, analogy, reference or specific warning.
A caption identifies its exhibit; it is not a second essay. A portrait belongs
only where its subject's contribution matters, and only with cleared rights.

Use the full 1.3-inch margin at its native type size. Never scale a crowded
diagram until its labels fit. Shorten, split or move the exhibit to the main
column. Keep each margin exhibit and its own short caption together.

## Current additions

| Owner in the Book | Margin content | Stable ID / asset |
|---|---|---|
| C1 single-writer discipline | Like our single-writer daemon, the platen handles jobs one after another; one caption, no repeated heading | swk-one-printing-press / one-printing-press |
| C2 attenuation | A smaller key suggests reduced authority; cryptographic binding remains a separate requirement | anchor-reduced-key / reduced-key |
| C3 sealed evidence | An opaque specimen case and outside receipt distinguish concealed contents from an attestation | sealed-specimen |
| C4 digest with zoom | Map and lens keep a route from summary to detail | map-and-lens |
| C5 finite probation | Four capped dates buy only 16.875 units of deterrence, not 18 | probation-capacity |
| C5 continuity | Overlapping rope strands illustrate connections that persist without one strand spanning the whole history | stp-splice-continuity / ch05-continuity-rope-splice |
| C6 licensed skills | One printing block can yield many impressions without requiring its maker to print each one | reusable-pattern / ch06-reusable-printing-block |
| C6 joint reviewer errors | Two equiprobable three-bit panels have identical pairwise correlations but different all-miss probability | joint-misses |
| C7 collateral | Balance analogy: compare expected loss with gain, not face value alone | collateral-balance / bond-balance |
| C8 settlement accounting | A cleared 100-unit bond can pay 80 and return 20 without occupying two lifecycle states | bond-recipients |
| C8 residual detection | Three-node path with spectrum 0,1,3 and zero cycle residual | tree-residual |
| C1 WAL configuration | Commit-to-sync exposure interval, with no invented time bound | wal-exposure-window |
| C1 recovery | Heartbeat pulses followed by silence and a suspicion deadline | heartbeat-suspicion |
| C4 consent | Intersection of stakes and reversibility bounds; other guards remain necessary | consent-region |
| C4 service variability | Equal-mean exponential and Lomax survival curves on an explicit log scale | heavy-tail-shape |
| C5 fission | A debited 100-unit source splits into two discounted 45-unit successors | no-mint-split |
| C6 unreliable specialist | Common-scale decomposition of the 4.17 versus 8.17 downtime canary | downtime-amplification |
| C8 admission | Certificate lifetime clipped by the earlier epoch or policy expiry | certificate-lifetime |
| C8 local sovereignty | A visitor credential presented at a turnstile does not compel the receiving authority to admit its holder | fh-local-admission-turnstile / ch08-local-admission-turnstile |
| C8 witness equivocation | Contradictory signed roots must reach the same auditor | equivocation-pair |

These are analytic examples, physical analogies or sourced photographs, not
observations of a deployed system. Generated drawings retain exact prompt,
tool, model-if-reported and hash sidecars under
website-v2/public/whitepaper/plates/margin-evidence/.
Eight drawings are now placed, one per chapter. The latest three above passed
parent and independent native-page review in the 713-page art proof; their
complete checkpoint is still in reproof for downstream Table 7.4 composition.
The minimum five-per-chapter user requirement remains unfinished.
The earlier real printing-stamp JPG and its rights/provenance JSON are retained
unchanged, as is the older unused generated movable-type drawing.

Two generated candidates are not accepted for publication: rope-splice contains
unwanted lettering; canal-lock has ambiguous arrows. Neither is placed. New
drawings must be inspected individually and then on their actual Book page.

### New object reading contracts

These are physical analogies, not data or empirical findings. All are displayed
at native 1.3-inch width with an empty heading argument and one caption.

| Owner paragraph / reader question | Five-second reading and boundary |
| --- | --- |
| C5 “The level at which they agree…”: how can continuity span successive connections? | Follow the overlapping strands. No single strand must traverse the whole splice; this drawing is not a proof of personal identity. Formal qualifications remain in the body. |
| C6 “Skill/tool as licensed good”: how does reusable work differ from labor sold per job? | One block makes multiple impressions. The analogy concerns reuse, not zero marginal cost, copyright status or measured market demand. |
| C8 “Sovereignty over the Card”, before “Return to Failure”: what does a valid foreign credential compel? | A pass and a locally controlled turnstile remain distinct. The receiving harbor still applies its admission policy. |

First-batch evidence and unchanged image hashes are in
`~/coding/tmp/book-margin-object-candidates-20260920/INTEGRATION.md` and the
canonical `test_book_margin_object_batch.py`. A3/A4/A6 experiments were not rerun.

Batch 2 artwork is approved but not placed: a parking meter for finite grants,
a speaking tube for authorized passage versus meaning, and an annunciator for
selective escalation. The meter has a plausible owner slot; the other two
original slots displace source notes and are held for better local composition.
See `~/coding/tmp/book-margin-object-batch2-20260920/INTEGRATION.md`.

### Batch 3: two accepted placements, one citation-flow trial

Three inspected generated illustrations and their exact prompt/checksum sidecars
are now copied to `plates/margin-evidence/`. Parent and independent review of
the 719-page second decompression proof accept the ticket dispenser (physical
page 52) and repair kit (518). The card index (344) is visually clear but awaits
compaction and baseline recheck of the Condor/Orleans citation stack. The count
is ten accepted placements, not eleven; chapter counts are 2,1,1,1,1,1,2,1.
Proof SHA256: `f82c739bc4541acfe9e8f6df426a65b570305a9915bf5d9eab212df21de8e6cc`.
Four object test methods pass, matching straight RGB and transparency-mask pixels
and checking owner adjacency. Whole-volume margins have no collisions or footer
intrusions; the unrelated Figure 2.5 caption remains a milestone blocker.

| Owner / reader question | Five-second reading, status and boundary |
| --- | --- |
| C1 ticket-lock proposal, before `claim_tickets`: what would replace repeated acquisition races? | A dispenser issues successive turns. The caption explicitly says **proposed**; it does not claim the absent ticket table or crash-path fairness is implemented. |
| C5 checkpoint opening: what does a successor receive when only recorded memory survives? | A selected card is a retrievable record, not the process that produced it. The anchor is the checkpoint paragraph, where the body explicitly distinguishes forwarded summaries from execution state. The earlier memory-subsection slot was rejected as too crowded beside Table 5.3 and the Park citation. |
| C7 cleanup-cost paragraph: what work remains after a breach? | A wrench, damaged fitting and replacement washer make repair tangible. The analogy illustrates cleanup work and material, not a finite bound on catastrophic losses; the adjacent unbondable-tail-risk limitation remains. |

Source art is retained under `~/coding/tmp/book-margin-object-batch3-20260920`.
All three are 1086 by 1448 pixels, rendered at the native 1.3-inch margin width.
The optional heading is empty, leaving one caption rather than repeating it.
The source/PDF test matches the actual image pixels, not merely dimensions, so
another same-size illustration cannot satisfy the owner check accidentally.

## Language at the anchor

Do not print bare labels such as 'Pitfall', 'Key idea' or 'The main point'.
Name the actual claim: 'Access is not permission', 'A summary cannot resume
execution', 'Shared errors defeat extra reviewers'. The optional argument of
the existing keyidea/pitfall commands supplies this cue. Without an optional
argument, the command prints ordinary prose, not a generic label.

Do not turn every paragraph into a callout. A cue earns its space by helping a
reader locate a warning, distinction or conclusion. Its adjacent text must
establish exactly that claim. Remove prose references to 'the pitfall above'.

## Implementation and checks

The pdmarginexhibit command measures title, exhibit and caption as one margin
object. pdmarginanalogy supplies an inspected image and a short limitation.
Native tables and diagrams live in figures/pd-margin-evidence.tex and
figures/pd-margin-sketches.tex. Each object
registers a stable ID in the Book's auxiliary inventory.

Placement uses shipped-page anchors and the measured margin allocator, not
source-time page-height guesses. Evidence never adds its full height to a
main-column float. Long captions cannot hold the main text below their bottoms.

For every revision:

1. Build the whole Book using its purchased Suisse configuration.
2. Run caption bounds/adjacency, all-margin geometry and page-overflow checks.
3. Render every new or moved exhibit's complete page. Inspect label size,
   attachment to the relevant prose, collisions and footer clearance.
4. Inspect selected neighboring pages and retain the illustrated ToC, four part
   spreads and chapter opening art.
5. Report arithmetic checks separately from layout and visual acceptance.

## Portraits and real objects

The older portrait assets and rights sidecars remain in plates/marginalia/.
Use their actual Book anchors, not the obsolete source-line list from the
original proposal. Preserve the Wonham portrait's recorded resolution warning.
Do not add the uncleared Coase image or force Lovelace into an unrelated passage.
A portrait and credit must fit entirely above the footer; move the unit earlier
or to a nearby page rather than letting it spill off the page.

Hobbes belongs beside the consent argument, Sen beside the limits of decisive
allocation, and Jonathan Hickman beside the explicitly limited backup analogy.
Keep one Leviathan frontispiece at the chapter opening, not two copies on the
same page. A real photograph is evidence of the depicted person or object;
it is not evidence that the adjacent software mechanism works.

The heavy-tail sketch plots survival, not density: exponential exp(-t) and
Lomax (1+t/2)^(-3) both have mean 1, but the latter's variance is 3 rather
than 1. Its curve is not the chapter's separate c_s^2=6 example. A log scale
makes the far tail visible in 1.3 inches. Keep the scale and analytic-example
qualification when reusing this sketch.

The style guide's margin examples support this richer column. Its example
theorems are not authority for the Book's claims, and its Latin Modern choices
do not override the purchased Suisse typography.
