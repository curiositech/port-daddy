# Cut-Paper Art — Generation Prompts (blessed 2026-07-04)

Model: `gemini-3-pro-image-preview` · aspect 16:9 · sequential only.

```bash
set -e
STYLE_LIGHT="Handcrafted cut-paper diorama photographed macro with shallow depth of field, soft warm studio light. Every object is layered matte cardstock with visible paper thickness and crisp knife-cut edges, standing on a warm cream paper tabletop (hex f2eee6) with a plain cream backdrop. Strict color discipline drawn from one palette: deep cobalt blue 003fb8, deep teal 006b5f, sage green 1f7a4d, chartreuse cad900, earthy rust brown 7a4514, clear purple 933fa5, deep olive gold 666a00, warm cream fbf7ef, near-black ink 121212. Swiss-modern composition: one hero subject, generous negative space, objects aligned to an invisible grid. All labels and signage rendered as blank color blocks and plain paper rectangles, keeping the scene entirely wordless."
STYLE_DARK="Handcrafted cut-paper diorama photographed macro with shallow depth of field, dramatic low-key studio lighting with a soft cool rim light. Every object is layered matte cardstock with visible paper thickness and crisp knife-cut edges, standing on a matte near-black paper tabletop (hex 101216) with a plain near-black backdrop. Strict color discipline drawn from one palette: deep cobalt blue 003fb8, deep teal 006b5f, sage green 1f7a4d, luminous chartreuse cad900, earthy rust brown 7a4514, clear purple 933fa5, warm cream fbf7ef paper for light panels, near-black ink 121212. Swiss-modern composition: one hero subject, generous negative space, objects aligned to an invisible grid. All labels and signage rendered as blank color blocks and plain paper rectangles, keeping the scene entirely wordless."
PR="Scene: one large upright cream paper pull-request document at center, a tall cut-paper sheet with a cobalt corner tab and rows of blank paper strips as its text. Six small cut-paper robot critics arranged in a neat semicircle before it, each cut from a different palette color (cobalt, teal, sage, rust, purple, olive gold), each raising a tiny paper magnifying glass toward the document. Thin paper ribbons curve from each critic to one small cream paper tray at front center holding a single consolidated paper card."
MAN="Scene: a cut-paper harbor seen slightly from above. A dignified paper harbor-master's office tower with a tiny signal mast stands at the pier's end, flying a string of small paper signal flags including one flag of vertical cobalt and chartreuse halves. Four terraced paper quays step upward behind it, each terrace a different palette color (cobalt lowest, then sage, teal, olive gold highest). Small paper tugboats rest at their berths, one per quay, connected to the office by thin paper mooring lines."
LIB="Scene: a gallery wall built of paper inside a cut-paper study. Seven upright paper tablets mounted in two rows: a top row of three cream tablets each bearing a round rust-colored paper seal medallion, a bottom row of four tablets in cobalt, sage, teal, and purple, each with rows of blank paper strips as text. A tiny cut-paper tugboat on a wheeled paper stand sits below, gazing up at the wall. A small paper anchor emblem leans against the wall's base."
SCOUT="Scene: a cut-paper dockside worktable seen close up. A small paper brass-look spyglass rests open on a coiled paper rope, angled up and out toward the harbor. Beside it a slim paper signal mast rises from a wooden paper base, flying two square signal flags stacked on one halyard: the upper flag a solid cobalt blue field with a small cream rectangle centered in it, the lower flag banded in three horizontal stripes of chartreuse, cobalt, and chartreuse. A single paper gull sits on the mast's truck. A rolled paper chart and a small cream paper notebook lie nearby on the table, their pages rendered as blank paper edges."
B=/Users/erichowens/.claude/jobs/0619c9eb/tmp/banana.py
D=docs/design/story-linework/art
python3 $B --scene "$STYLE_LIGHT $PR"  --out $D/pr-fleet-light.png  --aspect 16:9
python3 $B --scene "$STYLE_DARK $PR"   --out $D/pr-fleet-dark.png   --aspect 16:9
python3 $B --scene "$STYLE_LIGHT $MAN" --out $D/manifesto-light.png --aspect 16:9
python3 $B --scene "$STYLE_DARK $MAN"  --out $D/manifesto-dark.png  --aspect 16:9
python3 $B --scene "$STYLE_LIGHT $LIB" --out $D/library-light.png   --aspect 16:9
python3 $B --scene "$STYLE_DARK $LIB"  --out $D/library-dark.png    --aspect 16:9
python3 $B --scene "$STYLE_LIGHT $SCOUT" --style $D/manifesto-light.jpg --out $D/scout-light.png --aspect 16:9
python3 $B --scene "$STYLE_DARK $SCOUT"  --style $D/manifesto-dark.jpg  --out $D/scout-dark.png  --aspect 16:9
```

The pr-fleet light scene was regenerated once with the header forced to a solid cobalt bar (wordless rule).

## Scout (added 2026-07-06)

Generated via `nano-banana-image-gen` (`gemini-3-pro-image-preview`), using
`manifesto-{light,dark}.jpg` as the style-template reference for maximum
consistency with the established set. The flag mast flies two of the nine
Papa/Delta-family signal flags verified against Pub. 102 that same session
(`international-code-of-signals` skill, `icos_lookup.py code P` / `code D`) —
Papa (blue field, cream/white center rectangle) over Delta (three horizontal
bands) — read as the "P·D" call-sign motif. This line used to name a
swiss-maritime-tokens stylesheet under a design-passes directory as the pair's
other home; no such file has ever existed in this repository, and the
doc-citation guard caught it the first time anything touched this file. What
survives is the half that can be checked: the flags are Pub. 102's, verified
with `icos_lookup.py`, not copied off a decorative flag chart.
Themed to Scout (the spyglass = "capture where your eyes already are"), and
fills a real gap: the W2 image-overhaul plan (ch20 §"Image overhaul plan")
named Scout as a route needing hero art with none yet produced.

## Book and Program (added 2026-09-08)

Two replacement hero scenes, generated the same way as Scout
(`nano-banana-image-gen`, `gemini-3-pro-image-preview`, aspect 16:9,
`manifesto-{light,dark}.jpg` as the style-template reference for the matching
theme). Output as `book-{light,dark}.png` and `program-{light,dark}.png`,
converted to 1600px webp at `website-v2/public/img/generated/library/`.

BOOK is the hero for the `/whitepaper` route and retires the `LIB` seven-plate
gallery-wall composition above. That scene showed seven separate documents
mounted on a wall, which was true when the whitepaper was seven standalone
papers; the whitepaper is now one volume of eight chapters in four parts, so a
wall of seven plates no longer describes what a reader is being handed. The
replacement is one book: four spine bands for the four parts, eight ribbon
markers for the eight chapters. The tugboat and the anchor emblem carry over
from `LIB` so the two read as the same family.

PROGRAM is the hero for the `/research` route. It splits the frame in two
because the route's claim is two-sided: submission-form papers on the left,
machine-checked evidence on the right. The mast flies the same Papa-over-Delta
pair as Scout. Its prompt asks for seven manuscripts and the plate that
shipped fans six — a difference between the brief and the take, recorded in
the note after the block rather than quietly reconciled. The prompts here are
the ask; the notes are what came back, and where they disagree the notes are
the truth about the file on disk.

```bash
BOOK="Scene: one substantial cut-paper book standing upright and closed on a small paper reading stand at center, seen three-quarters on. Its spine is built from four stacked horizontal colour bands, bottom to top: deep cobalt blue, deep teal, clear purple, deep olive gold. Eight slim paper ribbon markers of varying lengths fan out from the block of pages, each a plain strip of one palette colour. A tiny cut-paper tugboat on a wheeled paper stand sits at the book's foot, looking up at it. A small paper anchor emblem leans against the stand's base. Generous cream negative space around the single hero object."
PROGRAM="Scene: a cut-paper drafting table seen from directly above, split left and right by a single thin paper rule down the middle. On the left, seven flat cream paper manuscripts fanned in an overlapping arc, each bearing one small round rust-coloured wax seal medallion and rows of blank paper strips as text. On the right, a small boxy cut-paper checking machine in deep cobalt with a slim paper tape feeding out of it and curling across the table, the tape scored with regular rectangular notches punched clean through. A slim paper signal mast rises from a wooden paper base at the top edge, flying two square signal flags stacked on one halyard: the upper a solid cobalt blue field with a small cream rectangle centred in it, the lower banded in three horizontal stripes of chartreuse, cobalt, chartreuse."
G=~/.claude/skills/nano-banana-image-gen/scripts/generate.py
D=docs/design/story-linework/art
python3 $G --scene "$STYLE_LIGHT $BOOK"    --style $D/manifesto-light.jpg --out $D/book-light.png    --aspect 16:9 --image-size 2K
python3 $G --scene "$STYLE_DARK $BOOK"     --style $D/manifesto-dark.jpg  --out $D/book-dark.png     --aspect 16:9 --image-size 2K
python3 $G --scene "$STYLE_LIGHT $PROGRAM" --style $D/manifesto-light.jpg --out $D/program-light.png --aspect 16:9 --image-size 2K
python3 $G --scene "$STYLE_DARK $PROGRAM"  --style $D/manifesto-dark.jpg  --out $D/program-dark.png  --aspect 16:9 --image-size 2K
```

`book-dark` was regenerated once: the first take fanned only seven ribbons.
`program-light` was regenerated once and the first take kept — the re-roll
scattered the manuscripts' text strips loose across the table. The kept
`program-light` fans six sealed manuscripts rather than seven; every other
plate matches the brief. All four are wordless.
