# Port Daddy Fleet — App Icon Options

Two direction concepts for the App icon, each rendered at three sizes.
Pick one when registering the App; the other stays in the repo as
documentation of what was considered. A third direction (`C-lantern/`)
sits in the directory as a reference render and is not in active rotation.

All active icons are flat editorial illustration on a **fully transparent
canvas** — the icons must read on the GitHub marketplace listing
(light), on a dark profile chrome, and on tinted in-product surfaces.
The palette is the live Port Daddy palette plus a warm amber accent:

| Role         | Hex       | Where it lives                                |
|--------------|-----------|-----------------------------------------------|
| Primary      | `#003fb8` | Cobalt — structural linework (tower, anchor) |
| Secondary    | `#006b5f` | Sage — accents (shoals, rope, ship hulls)    |
| Warmth       | `#e8a23a` | Amber — the trust / safe-approach signal     |
| Linework     | `#1f1f1f` | Near-black — thin outlines                   |

The amber accent is the load-bearing color: it carries the *safe trade,
trust, surety, connection* semantics. Mariners trust lighthouses because
they signal safe approach; they trust anchors because they hold. The amber
is the visual answer to "is this a place where I can do business safely?"

## Sizes

| File             | Use                                                        |
|------------------|------------------------------------------------------------|
| `icon-1024.png`  | App marketplace listing, App settings page, social previews|
| `icon-256.png`   | High-density favicon, in-product chrome                    |
| `icon-60.png`    | Marketplace thumbnail, profile-sized rendering             |

All three sizes are PNG with alpha (no cream fill, no white fill).

## Direction A — Lighthouse with amber beam

`A-lighthouse/icon-1024.png`

A single tall lighthouse on rocky shoals. The tower is cobalt line art
with hatched bands; the lantern room is sage; the shoals are sage with
cross-hatched stone texture. From the lantern room a wide warm-amber
beam sweeps to the right, fading toward transparent at its outer edge.
On the horizon, three tiny cobalt sailboats turn their bows TOWARD the
beam — signaling safe approach under watchful infrastructure.

**What it communicates**: a port runs here; the harbormaster is awake;
approach is safe and welcomed.
**Reads at 60×60**: yes — the amber beam carries the icon at thumbnail.
The boats reduce to a few pixels but the structural read (tower + beam +
shoals) survives cleanly.
**Trade-off**: directional composition (lighthouse left, beam right) is
asymmetric — strong as a brand mark, less centered as a marketplace
thumbnail than direction B.

## Direction B — Anchor with amber trust-halo

`B-anchor/icon-1024.png`

A central admiralty anchor in cobalt with a sage rope wrapped once
around the stock. Around the anchor's crown, a two-band warm amber
halo radiates outward — a defined ring, not a soft glow. Three sage
sailboats orbit the halo at 120° spacing, bows along the orbit
direction. Strict bilateral symmetry around the anchor's vertical axis.

**What it communicates**: this is a trust point; the fleet gathers
here; attachment is safe; trade happens under surety.
**Reads at 60×60**: yes — the cobalt anchor stays anchored center, the
amber halo remains visible as a continuous ring, and the three ships
read as compass-point dots that suggest "constellation" rather than
"fleet of seven detailed ships."
**Trade-off**: fewer storytelling elements than direction A — the icon
is a sigil more than a scene. Stronger as a square thumbnail; less
brand-mark-extensible.

## How to swap directions later

If you ship A first and later want B, replace the `icon-1024.png`
referenced in the App settings page and GitHub regenerates everything
else from it. The 256 and 60 variants in this folder are convenience
exports for in-product use; GitHub itself takes one image per App.

## Regenerating

```bash
GEMINI_API_KEY=… bash scripts/generate-icons.sh --force         # all directions, fresh from prompts
GEMINI_API_KEY=… bash scripts/generate-icons.sh                 # only missing 1024s
bash scripts/generate-icons.sh --resize-only                    # re-derive 256/60 from existing 1024s
```

Prompts live in `scripts/prompts/A-lighthouse.txt` and
`scripts/prompts/B-anchor.txt`. Edit a prompt and re-run with `--force`
to iterate on a direction.

The generator post-processes every 1024 to enforce alpha transparency
(Nano Banana sometimes renders a near-white or checker-pattern fake
background) and downsamples to 256 / 60 via Pillow Lanczos so alpha
survives the chain.

## Why no cream background

The earlier App-icon spec assumed a cream `#f2eee6` surface. That works
for editorial illustration but fights the App icon's job, which is to
land on whatever background GitHub or the host application gives it.
Transparent PNGs solve that: the icon carries its own color story, and
the surrounding chrome stays whatever it was. The brand palette is
unchanged; the surface fill is just removed.
