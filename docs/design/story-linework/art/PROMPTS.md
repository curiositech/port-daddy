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
bands) — the same authentic pair used as the "P·D" call-sign motif in the
Swiss-Modern-Maritime design pass (`docs/design/design-passes/swiss-maritime-tokens.css`).
Themed to Scout (the spyglass = "capture where your eyes already are"), and
fills a real gap: the W2 image-overhaul plan (ch20 §"Image overhaul plan")
named Scout as a route needing hero art with none yet produced.
