# Port Daddy — logo roster

The official set of Port Daddy marks. Every file here is **theme-aware** and
drawn from the brand palette. Do **not** reintroduce the retired Harbor-Heritage
warm colors (cinnabar `#CC3D2E`, brass `#B08D57`, patina `#5C7A6A`) — the
`scripts/check-brand-colors.mjs` guard fails CI on them.

## Palette

The mark uses a small, fixed palette (distinct from the site's UI tokens — these
are the *logo* colors, tuned per theme for the radar/monogram):

| Role | Light | Dark |
|---|---|---|
| Cobalt (primary, P-stroke) | `#2076FE` | `#2076FE` |
| Seafoam (secondary, D-stroke) | `#12B88F` | `#20DEB0` |
| Amber (intersection accent) | `#F5A623` | `#FFB505` |
| Ground (when not transparent) | `#F4F7FA` | `#070B12` |

The monogram is two interlocked strokes — a cobalt **P** and a seafoam **D** —
with an amber wedge where they cross. The full mark wraps it in an
architectural-blueprint radar.

## The roster

| File | What it is | When to use |
|---|---|---|
| `portdaddy-animated-lightmode.svg` | Big glossy **animated** mark, light | Hero / full-logo moments on light ground. The spinning radar. |
| `portdaddy-animated-darkmode.svg` | Big glossy **animated** mark, dark | Same, on near-black ground. |
| `portdaddy-static-lightmode.svg` | Big glossy **static** mark, light | Print, PDFs, dense pages, reduced-motion, og fallbacks. |
| `portdaddy-static-darkmode.svg` | Big glossy **static** mark, dark | Same, dark ground. |
| `portdaddy-mark.svg` | Legacy single-file animated mark (light palette) | Back-compat only — prefer the theme-aware pair above. |
| `portdaddy-mark-small-light.svg` | Favicon-grade small mark (monogram only), light | 16–32px chrome on light: tabs, crumbs, compact toolbars. |
| `portdaddy-mark-small-dark.svg` | Favicon-grade small mark (monogram only), dark | Same, on dark. |
| `portdaddy-mark-mono.svg` | Monochrome inline mark (`currentColor`) | Buttons, nav links, footers — any single-color glyph slot. |
| `portdaddy-wordmark-light.svg` | "Port Daddy" lockup (mark + type + rule), light | Headers, footers, share cards, slides. |
| `portdaddy-wordmark-dark.svg` | "Port Daddy" lockup, dark | Same, on dark. |
| `portdaddy-app-tile.svg` | Monogram on a cream tile (app-icon source) | Source for `../apple-touch-icon.png` + the OG-card logo. |

Raster derivatives (generated, do not hand-edit):

| File | Source | Generator |
|---|---|---|
| `../favicon.svg` | hand-authored | — |
| `../favicon.png` | `portdaddy-mark-small-light.svg` | `scripts/rasterize-logos.py` |
| `../apple-touch-icon.png` | `portdaddy-app-tile.svg` | `scripts/rasterize-logos.py` |
| `../img/og/home.jpg` (logo region) | `../apple-touch-icon.png` | `scripts/regen-home-og.py` |

> **Why Chromium for rasterizing?** The SVGs use `:root { --x }` + `var(--x)`
> for their stroke colors. `librsvg` / `cairosvg` ignore those custom
> properties; Chromium (the browser we actually ship to) resolves them. So the
> raster pipeline renders through headless Playwright, not rsvg-convert.

## Using the marks in code

Prefer the typed wrappers in `src/components/brand/` over hard-coding a path —
they pick the right theme variant automatically:

```tsx
import {
  PortDaddyMark,        // flagship radar mark (animated by default)
  PortDaddyMarkSmall,   // favicon-grade monogram
  PortDaddyMarkMono,    // currentColor inline glyph
  PortDaddyWordmark,    // mark + type lockup
} from '@/components/brand'

<PortDaddyMark size={44} />                 // hero
<PortDaddyMark size={40} animated={false} />// static
<PortDaddyMarkMono size={20} className="text-[var(--brand-primary)]" /> // in a button
<PortDaddyWordmark width={280} />           // header / footer
```

Live gallery: **`/brand`** (route registered in `src/main.tsx`,
page at `src/pages/BrandPage.tsx`).

## Regenerating rasters

```bash
cd website-v2
python3 scripts/rasterize-logos.py   # favicon.png + apple-touch-icon.png
python3 scripts/regen-home-og.py      # refresh the home OG card's logo
```

(Requires a Python with Playwright + Chromium installed, and Pillow for the OG
card.)
