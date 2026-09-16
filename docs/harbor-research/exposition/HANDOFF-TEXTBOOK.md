# Handoff: the Textbook Edition (PR #10064)

Written 2026-09-06 for whichever agent picks this up next: a Sonnet companion
session, a Codex agent when the author's Claude usage runs out, or a later
Claude session. Everything here is verifiable in the repo; nothing depends on a
session's memory.

## 1. What this is

One book, *The Harbor, the Person, and the Economy: a textbook of accountable
autonomous work*, by Erich Owens, imprint Curiositech, built from eight chapter
sources and printed in three editions from one source. Branch
`claude/white-paper-pr-review-uncpxg`, PR #10064 against `main`. The plan of
record is [`docs/roadmap/whitepaper-research-program.md`](../../roadmap/whitepaper-research-program.md)
— the Book's doc-authority under `docs/roadmap/AUTHORITY.md`, and since
2026-09-08 the only place the forward plan lives. `TEXTBOOK-BUILD-LEDGER.md`
(this directory) records what landed; this file says how to build and resume;
the standing instructions from the author are in §5 below.

Sources of truth, in order: `whitepaper/textbook.json` (chapter order, parts,
titles, questions, epigraphs) → `scripts/generate-mega-whitepaper.mjs` (the Book
generator) → `website-v2/public/whitepaper/coordination-papers-mega-volume.tex`
plus `-preamble.tex` (the Book root and its preamble) → the eight chapter sources
(`whitepaper/single-writer-kernel.tex`, `whitepaper/legible-swarm.tex`, and six
under `website-v2/public/whitepaper/`) → shared apparatus in `figures/`
(`pd-pedagogy.tex`, `pd-figure-language.tex` and its `-swiss`/`-technical`
overrides, `pd-palette.tex`, `pd-hyperlinks.tex`; the first two exist as
byte-identical twins under both `whitepaper/figures/` and
`website-v2/public/whitepaper/figures/` and must be edited together).

## 2. How to build and look

```
# generate the Book tree (jest empties this directory; regenerate before every build)
node scripts/generate-mega-whitepaper.mjs .cache/whitepaper-build/coordination-papers-mega-volume
# compile one edition (xelatex via tectonic; 4-6 minutes; run in the background)
cd website-v2/public/whitepaper
tectonic -X compile --keep-logs --outdir OUT coordination-papers-mega-volume.tex          # maritime
tectonic -X compile --keep-logs --outdir OUT coordination-papers-mega-volume-swiss.tex    # Swiss
tectonic -X compile --keep-logs --outdir OUT coordination-papers-mega-volume-technical.tex
```
Then: `python3 scripts/harbor-research/page_overflow.py OUT/x.pdf` (ink past the
paper edge, and the pictures the safety net rescued), `overfull_attrib.py`
(overfull lines attributed to source lines), `page_spills.py` (opener spills,
stranded headings, short pages), `leading_scan.py`. Render pages with PyMuPDF
and look at them; do not trust a compile that merely succeeds. Figures are
judged only under `skills/harbor-chartwork/scripts/compile_fragment.sh FRAG
--preamble book` (the Book's 4.5 in column); the chapter preamble is Latin Modern
on A4 and misleads. Never `pkill -f tectonic`; never run jest during a build.

CI: `scripts/build-whitepapers.sh` compiles the chapters with pdflatex and the
three editions with xelatex; two bots regenerate PDFs after every push and their
commits then head the PR, leaving their own workflow runs in `action_required`.
Read the runs on the author's commits. After a bot regen: fast-forward, then
`cd website-v2 && npm run fix:whitepaper-metadata`, commit, push.

## 3. Design contracts (settled)

- Trim 7 × 10 in, one-sided, text column 4.5 in with a 1.3 in margin column always
  on the right (Tufte's asymmetric page, chosen so pages read well in a one-page
  view). Body Palatino (newpx), display Termes (maritime) or Heros (Swiss,
  technical), mono Source Code Pro sized to the lowercase. Under xelatex the math
  alphabets must be bound to these faces explicitly (see the preamble's XeTeX
  branch); left alone they fall to Latin Modern.
- Page grammar: content kind is signalled by typography and margin, never by a
  tinted rectangle. Claims are run-in heads with a kind tag (Theorem, Design
  invariant, Model-checked property, Empirical hypothesis); runtime claims name
  an assurance mode; exercises live at chapter end; recall prompts sit in the
  margin, bottom-aligned to their paragraph; sessions are full-width, typed input
  bold, output regular, no box; code listings have no frame, small grey numbers.
- Three editions: maritime (watercolour plates), Swiss (part pages in the part
  colour with a numeral, chapter openers as a colour band; Müller-Brockmann, not
  Material), technical (every opener a drawing sheet with a title block; burnt
  orange numerals; monoline figures). Each edition needs its own cover and, for
  Swiss and technical, its own plates (open work; see §6).
- Figures: the legibility rubric in `skills/harbor-chartwork/references/craft-rules.md`
  (one readable fact, concrete instance, anchored geometry, print contrast, no
  collisions). Sentence case, at most three type voices, no fills on text nodes,
  colour on strokes, weights 0.55/0.8/1.0/1.6 pt, Stealth 2.2 mm. Only palette
  colours (`pd-palette.tex`; the palette guard rejects anything else). The
  author rejected primary-strength cobalt/green/red and every "line drawing"
  exemplar so far; the colour direction is still open and is the author's call.
- Imprint: Curiositech, on the title page and colophon, all editions. "Mundus
  Press" was an invented name and is gone.

## 4. Where the book stands (measured, not remembered)

- 529 pages maritime, 531 Swiss and technical; 0 undefined references; 0 pages
  with ink past the paper edge; 45–62 pictures per edition set at full width by
  the safety net (listed by `page_overflow.py`; they want redrawing, not
  scaling); 130 overfull lines; 5 stranded headings.
- Maturity ledger across the chapters: 46 rows Built, 85 BuiltWeak or Partial,
  51 Open or Proposed, 33 Closed proofs. The book prescribes a design that is
  roughly forty percent built and mostly speaks in the present tense; the
  author is deciding whether page one should say so plainly (see §6).
- Chapter uniformity: openers, running heads, pedagogy and listings are
  uniform. Not uniform: `\resizebox` appears only in chapters 5–8 (figure text
  sizes differ between the halves); two chapter-7 figures and the anchor-phases
  figure set labels in sans; chapter 7 embeds three matplotlib PDFs; chapter 4
  figures use raw colour names; chapter 5 has two Roman-numeral chapter
  references left; fragments that name `hh*` colours directly bypass the
  edition overrides and stay maritime-coloured in the other two editions.
- Marginalia: eleven portraits and title pages cleared against the Commons API
  (licence, artist and sha1 in a sidecar per image; Coase not cleared, Ramadge
  has no free portrait), converted to duotone at 1.3 in, ten placed with
  `\pdmarginfigure{slug}{caption}` at the point where the person's idea is
  critical, an Image credits page in the appendices, and a sidecar check in
  the library-checks workflow. Lovelace is cleared but unplaced.
- Editions: maritime keeps the watercolour; the technical edition carries the
  engraving system (exploded drawings with empty callouts, white on the part's
  ink for parts, on cream for chapters, recovered from the art-system commit
  plus a Sealed Harbor plate and a cover in the same register); the Swiss
  edition draws its cover and plates in TikZ from `SWISS-BRIEF.md` with three
  registered print inks. Each edition has its own cover; the imprint is
  Curiositech everywhere.

## 5. Standing instructions from the author

Build and open interim PDFs as you go, saying what changed in each. Think
critically per page: what does the page present, would a visual carry it, which
kind. Move things around within a chapter when it aids flow; log each move in
the build ledger. Thin material is developed (a run, a plot, a worked example),
not decorated. Scan on the page: bold for defined terms and claim heads, italic
once a page, small caps for kind tags, mono for identifiers only, colour in the
body only for links and the chapter rule. Asides are named kinds: Interlude, At
the terminal, Marginalia. Every mechanism the book claims has a run the reader
can see. Flag and block when unsure; trim, font, page grammar, colour and
anything that spends money are checkpoints. Delegation: deterministic planned
work to Sonnet workers in their own worktrees cut from the branch (never git in
the main checkout from a worker); creative and syllogistic work stays with the
lead; digests short; at most six or seven workers at once.

## 6. Open decisions for the author (do not decide these for them)

1. Is the effect hypervisor the enforcement substrate the book should
   prescribe, with the git shim and coordination guard named only as today's
   stand-ins in chapter 1's Limitations section?
2. May the book be openly prospective on page one (what the reference
   implementation is today versus what the design specifies)?
3. Which threads to cut or demote to interludes (candidates: the Parfit
   interlude; Hobbes, Sen and Krakoa in chapter 7; sheaf cohomology in chapter 8;
   the NP-complete deontic frontier; the SPRT canary). A section-to-claim
   inventory should precede the cut.
4. The figure colour direction and the figure standard exemplar.
5. The Swiss cover and plates (a research brief is in progress under the
   scratchpad, to be committed as `SWISS-BRIEF.md` here) and the technical
   cover and plates in the site's blueprint register.
6. The four parked branches: `wave-11/tikz-craft-skill`, `wave-11/opentikz-exemplars`,
   `wave-11/ch5-figures`, `wave-11/ch678-figures` (figure drafts the author
   rejected; keep, mine, or delete).

## 7. Next work, in order, once the decisions above are made

Math typography fix verified in a full build → Swiss/technical opener fixes
verified (compact chapter list, the technical sheet's bounding box) → covers per
edition → thread inventory and the page-one honesty paragraph → marginalia fetch,
clearance, duotone and placement (`pdmarginfigure` and `pdgloss` to be added to
the pedagogy twins) → the figure standard and the redraw wave (kernel first,
inspected in all three editions on one contact sheet) → pseudocode listings to
the CLRS register with `algpseudocode` → sessions for chapters 3–6, the
worked-example floor, the plots from the R-scripts → overfull lines and stranded
headings → whole-book contact sheets, three editions.

## 8. Skills: which help, which mislead

Help: `harbor-exposition`, `harbor-results`, `falsification-first`,
`harbor-chartwork`, `whitepaper-figure-system` (semantic form only),
`tikz-figure-engineering`, `latex-whitepaper-engineering`, `tlaplus-practitioner`,
`proverif-tamarin-protocol-modeling`, `nano-banana-image-gen` (plates only; the
key lives in the environment, never in a file the repo tracks).

Mislead here: `high-quality-latex-whitepaper` (its preamble and one-accent rule
are the standalone chapters', not the Book's; judging Book figures under it is
how every figure passed QA and still overflowed); the maritime-imagery ban in the
figure skills applies to figures, not to the plates; `swiss-modern-website-design`,
`dataviz`, `color-theory-palette-harmony-expert`, `artifact-diagramming` are web
and photo tools whose palettes and grids do not transfer to TikZ;
`port-daddy-expository-writer` is the site's essay voice, not the book's.
