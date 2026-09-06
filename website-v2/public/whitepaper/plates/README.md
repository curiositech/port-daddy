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
