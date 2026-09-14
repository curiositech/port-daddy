# Plates for the Book

Art plates for *The Harbor, the Person, and the Economy* (textbook edition).
Every file here is optional: the Book's TeX checks `\IfFileExists` for each
slot and lays the page out without the plate when the file is absent.

| Slot | File | Where it appears |
|---|---|---|
| Cover | `jacket.jpg` | full-bleed wash behind the minimal Times-set type of the cover (A4 ratio) |
| Frontispiece | `frontispiece.jpg` | the etched colossus on the page after the imprint page |
| Part openers | `part-<numeral>.jpg` | full-page wash behind the part's minimal type, like the cover (A4 ratio) |
| Chapter openers | `chapter-<prefix>.jpg` | wash bled into the page stock under the chapter title (3:2) |

The numerals and prefixes come from `whitepaper/textbook.json`.

## Art system

- **Cover:** a faded watercolor wash (the beached moon: a vast machine sphere
  resting in a harbor, a lighthouse beside it) bleeding over the whole page. The
  title, subtitle, author, and imprint are set in TeX over it, never rendered
  into the image. Type is minimal and set in Times.
- **Frontispiece:** a copper-plate etching in the manner of a baroque book
  frontispiece: the harbor's sovereign, a colossus composed of its clerks,
  rising behind a lighthouse and a harbor. The cartouche is empty.
- **Interior plates (parts and chapters):** the cover's own register carried
  through the book. Faded watercolor washes reproduced on aged stock, no
  outlines, no bright color, most of the picture open wash and mist. Every
  plate is the same encounter at space-opera scale: one colossal, smooth,
  unearthly presence rendered as soft masses with almost no detail, and one
  small everyday thing beneath it, tiny and exact (a sail with a lamp lit, a
  stone watchtower, a pier lantern, a table set for two on a quay, a village
  with one window lit). Part plates fill their page edge to edge with the
  part's type set over the open wash; chapter plates bleed into the page
  stock under the chapter title. No engraving, no crews, no linework.
- Display text stays ink; color is carried by rules, bands, and the plates.

## Provenance and regeneration

`PROVENANCE.json` records, for every plate, the source render, the full prompt,
the model, the post-processing, and the encoded size. The renders were made
with Google's Nano Banana model (`gemini-3-pro-image-preview`) through the
`nano-banana-image-gen` skill script; the API key lives only in the generating
session's environment and is never written to this repository. Post-processing
is deterministic given the render: crop inside the painted sheet's edges,
balance the paper tone to the page stock (`#FBF7EF`, percentile white), feather
the borders into the page stock so no rectangle prints, Lanczos resize to an
1800 to 2300 px long edge, JPEG.

The pipeline and the render drivers live in `scripts/whitepaper-plates/`
(`plates_pipeline.py` encodes; `make_round8.py` and `make_round8_parts.py` hold the prompts). They read the API key from the environment only.

Budget: all plates together must stay under 8 MB so the Book PDF stays under
12 MB. Current total is in `PROVENANCE.json` (sum of `bytes`).

## Editions and marginalia

- `technical/` — the technical edition's plates: the engraving system (1960s
  engineering-report plates, exploded and cutaway drawings with empty callout
  boxes; part plates composited white on the part's ink, chapter plates on
  paper), recovered from the art-system commit `175f3e753`, plus a Sealed Harbor
  chapter plate and a cover generated in the same register with an existing
  plate as the style reference. `technical/PROVENANCE.json` carries every prompt.
- `swiss/` — the Swiss edition's plates, redone once already because the
  first pass — generated with no resolution flag set at all, which is most
  of why they looked the way they looked — came back low-res and, in plain
  terms, bad looking: flat, hard-edged Swiss-modern colour blocking (the
  Müller-Brockmann / Armin Hofmann register) painted by Nano Banana Pro from
  `docs/harbor-research/exposition/SWISS-BRIEF.md`, replacing the edition's
  earlier TikZ-drawn cover and plates — `../coordination-papers-mega-volume-swiss-plates.tex`
  now wires all thirteen in with `\includegraphics`. This round also pulled in
  the zonal colour-blocking and the visible construction grid off the
  author's own reference sheets ("Swiss modern design ideas," "Structural
  minimalism," "Swiss industrial design: objects of utility") — a quiet
  lattice of hairline near-black rules crossing every plate, some of them
  running past the edge of the colour block onto the paper the way the
  reference sheets do it, the chapter's hue or the part's ink still the one
  dominant plane, signal red still rationed to the three plates the brief
  reserves it for. The renders now go out at `--image-size 4K` for the cover
  and the four part plates and `2K` for the eight chapter plates (the model's
  default, unset, was roughly 1K, and 1K stretched to print width is exactly
  what "low-res" means); after post-processing the cover sits at 2267×3400
  (2:3), the four part plates at 3400×2267 (3:2), and the eight chapter
  plates at 3400×1700 (2:1) — all comfortably past the 300 dpi floor at the
  sizes the TeX actually places them, against the old set's 1533×2300 and
  1800×900. Two candidates were generated per plate and the better one kept;
  `swiss/PROVENANCE.json` carries both prompts, which one was chosen and why,
  the image size, and the pipeline version for every entry, all of it sourced
  from the committed `scripts/whitepaper-plates/swiss_prompts.py` rather than
  reconstructed from anyone's shell history — that file is also where a
  future redo of any one plate should start. No TikZ plates remain for this
  edition. Swiss plates are image renders with provenance in
  `swiss/PROVENANCE.json` — there is no drawn fallback, and a missing plate
  fails the build.
- `marginalia/` — duotone portraits and title pages for the margin column, one
  JSON sidecar per image (Commons file page, sha1, artist, licence, retrieval
  date); `scripts/harbor-research/check_marginalia_sidecars.py` fails the build
  on an image without a cleared licence; the credits page is
  `../figures/pd-marginalia-credits.tex`.
