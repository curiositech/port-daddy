# Plates for the Book

Art plates for *The Harbor, the Person, and the Economy* (textbook edition).
Every file here is optional: the Book's TeX checks `\IfFileExists` for each
slot and lays the page out without the plate when the file is absent.

| Slot | File | Where it appears |
|---|---|---|
| Cover | `jacket.jpg` | full-bleed wash behind the minimal Times-set type of the cover (A4 ratio) |
| Frontispiece | `frontispiece.jpg` | the etched colossus on the page after the imprint page |
| Part openers | `part-<numeral>.jpg` | technical drawing rendered as cream ink on the part's hue, on each part's full-bleed page (3:2) |
| Chapter openers | `chapter-<prefix>.jpg` | technical drawing under the epigraph on each chapter's opener page (3:2) |

The numerals and prefixes come from `whitepaper/textbook.json`.

## Art system

- **Cover:** a faded watercolor wash (the beached moon: a vast machine sphere
  resting in a harbor, a lighthouse beside it) bleeding over the whole page. The
  title, subtitle, author, and imprint are set in TeX over it, never rendered
  into the image. Type is minimal and set in Times.
- **Frontispiece:** a copper-plate etching in the manner of a baroque book
  frontispiece: the harbor's sovereign, a colossus composed of its clerks,
  rising behind a lighthouse and a harbor. The cartouche is empty.
- **Interior plates (parts and chapters):** technical-report drawings, one dark
  ink, exploded and cutaway views of the chapter's mechanism with blank
  callout boxes. Chapter plates print as ink on the page stock; part plates are
  the same register rendered as cream ink on the part's hue, blueprint-style.
- Display text stays ink; color is carried by rules, bands, and the plates.

## Provenance and regeneration

`PROVENANCE.json` records, for every plate, the source render, the full prompt,
the model, the post-processing, and the encoded size. The renders were made
with Google's Nano Banana model (`gemini-3-pro-image-preview`) through the
`nano-banana-image-gen` skill script; the API key lives only in the generating
session's environment and is never written to this repository. Post-processing
is deterministic given the render: crop away any studio background and sheet
edge, balance the paper tone to the page stock (`#FBF7EF`, percentile white),
composite part drawings as cream ink on the part hue, Lanczos resize to an
1800 to 2300 px long edge, JPEG.

Budget: all plates together must stay under 8 MB so the Book PDF stays under
12 MB. Current total is in `PROVENANCE.json` (sum of `bytes`).
