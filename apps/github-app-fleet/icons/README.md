# Port Daddy Fleet — App Icon Options

Three direction concepts, each rendered at three sizes. Pick one when you
register the App; the others stay in the repo as documentation of what was
considered.

All icons are flat architectural-blueprint illustration in the live
Port Daddy palette: cream `#f2eee6` surface dominant, cobalt blue `#003fb8`
primary, deep teal / sage green `#006b5f` accent, near-black `#1f1f1f`
linework. No painterly chiaroscuro, no warm amber, no cinnabar — strict
blueprint discipline per `memory/feedback_blog_robot_art_must_be_on_brand.md`.

Sizes per direction:

| File             | Use                                                        |
|------------------|------------------------------------------------------------|
| `icon-1024.png`  | App marketplace listing, App settings page, social previews|
| `icon-256.png`   | High-density favicon, in-product use                       |
| `icon-60.png`    | Marketplace thumbnail, profile-sized rendering             |

## Direction A — Lighthouse (recommended)

`A-lighthouse/icon-1024.png`

A single stylized lighthouse with a directional sage beam. Civic, legible
at favicon size, scales to a full brand mark. The "harbormaster watches the
port" metaphor. Reads cleanly at 60×60.

**Strengths**: clearest at the smallest size; instantly recognizable as a
nautical / oversight tool; the directional beam carries the "fleet watches"
idea visually without needing seven of anything.
**Weaknesses**: doesn't literally show the fleet — that's a layer of
abstraction. If the operator wants the icon to *mean fleet*, B is more
literal.

## Direction B — Anchor with orbiting fleet

`B-anchor/icon-1024.png`

Central admiralty anchor in cobalt, seven small sage-green sailboat
silhouettes orbiting it on a faint dashed cobalt circle. Carries the
fleet metaphor literally — one anchor (Port Daddy), seven ships (the fleet).

**Strengths**: most literal mapping to the product; the seven-ship motif is
a story.
**Weaknesses**: at 60×60 the ships become dots; the eye reads "anchor with
something around it." Still legible, but the fleet metaphor weakens at
favicon scale.

## Direction C — Harbormaster's lantern

`C-lantern/icon-1024.png`

A hexagonal storm lantern in cobalt with cross-hatched metal, holding a
cluster of seven sage flames inside. Most evocative direction; the seven
flames carry the seven-ship idea without needing seven of *anything*
recognizable.

**Strengths**: most distinctive silhouette; least likely to be confused
with another agent-tools brand; the warm-presence-without-warm-palette
trick (flames in cool sage) is a small visual joke.
**Weaknesses**: most complex at small size; the flame cluster becomes a
smudge at 60×60 even though the lantern body still reads.

## How to swap directions later

If you ship A first and later want C, replace the `icon-1024.png` linked
in the App settings page and GitHub regenerates everything else from it.
The 256 and 60 variants in this folder are convenience exports for
in-product use; GitHub itself only takes one image per App.

## Regenerating

```bash
bash scripts/generate-icons.sh --force    # all three, fresh from prompts
bash scripts/generate-icons.sh            # only missing 1024s
bash scripts/generate-icons.sh --resize-only   # re-derive 256/60 from existing 1024s
```

Prompts live in `scripts/prompts/A-lighthouse.txt`, `scripts/prompts/B-anchor.txt`,
`scripts/prompts/C-lantern.txt`. Edit a prompt and re-run with `--force`
to iterate on a direction.
