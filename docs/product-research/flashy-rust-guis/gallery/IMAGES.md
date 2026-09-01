# Gallery — canonical image URLs + descriptions

Real, citable image URLs for every notable app, with a precise description of the
visual. Verification status is noted. A few static, verified images are also
downloaded into this folder by `docs/product-research/flashy-rust-guis/scripts/fetch-gallery.sh` (see that script);
GitHub `user-attachments` and CMS-hashed URLs are left as links (they rotate /
hotlink-protect and shouldn't be vendored).

> Honesty note: live WASM demos (Slint, Bevy, gpui-component gallery, makepad.dev)
> can't be hotlinked as a static image — capture them yourself with the browser /
> playwright MCP if you need a frozen frame. The URLs below are the canonical
> reference images each project publishes.

---

## GPUI / Zed
- **Zed "videogame" blog hero** — `https://images.zed.dev/blog/videogame/feature_image.png` (verified 200). The 3D-exploded UI-layers render that announced GPUI's game-style approach.
- **Zed home OG** — `https://zed.dev/img/home/og.webp` (verified 200). The editor in its One Dark theme.
- **Texture/glyph atlas diagram** — `https://images.zed.dev/blog/videogame/texture-atlas.png` (cited by the blog; not independently 200-verified).

## gpui-component (longbridge) — the flashiest GPUI showcase
- **Component gallery hero** — `https://github.com/user-attachments/assets/e1ecb9c3-2dd3-431e-bd97-5a819c30e551` (1763px). Full shadcn-style component set: themed tables, charts, forms, markdown — the single best "flashy GPUI" still.
- **Live WASM gallery** (capture-it-yourself) — https://longbridge.github.io/gpui-component/gallery/

## Loungy (GPUI launcher)
- **Preview** — `https://raw.githubusercontent.com/MatthiasGrandl/Loungy/main/img/preview.webp`. Translucent macOS Spotlight-style launcher: floating rounded panel, fuzzy search, result list. (MIT.)

## Vello (Linebender)
- **Splash / GhostScript tiger composite** (README hero) — `https://github.com/linebender/vello/assets/8573618/cc2b742e-2135-4b70-8051-c49aeddb5d19`. Montage of test scenes: the orange/black vector tiger torture-test, gradient swatches, stroked paths, text — crisp MSAA16 AA.

## Xilem (Linebender)
- **Calculator (Masonry)** — `https://raw.githubusercontent.com/linebender/xilem/main/docs/screenshot_calc_masonry.png`
- **To-do MVC** — `https://raw.githubusercontent.com/linebender/xilem/main/docs/screenshot_to_do_mvc.png`
- **Chess board** — `https://raw.githubusercontent.com/linebender/xilem/main/docs/screenshot_chess_app.png`
  (Repo-relative `docs/screenshot_*.png`; confirm 200 before embedding.) Clean flat modern widgets, Vello-AA'd — "tasteful," less overtly flashy than Makepad.

## Makepad (the flashiest Rust UI)
- **Live demo** (capture-it-yourself) — https://makepad.dev/ (wasm/WebGL build; open on desktop or phone).
- **Ironfish synth** — repo https://github.com/makepad/makepad/tree/master/examples/ironfish. Dark hardware-synth panel: knobs, sliders, oscilloscope/spectrum, piano keyboard — every control an SDF shader with glow/bevel. ⚠️ No direct README image URL extracted; capture from makepad.dev or the GitNation talk.
- **Robrix (Matrix client)** — https://robrix.app/ , repo https://github.com/project-robius/robrix. ⚠️ Screenshot asset URL not extracted; see robrix.app / repo `docs/`.

## iced
- **Solar system** (animated Canvas) — `https://iced.rs/examples/solar_system.gif` (verified). Orbiting bodies on a starfield, drawn with the Canvas API.
- **Halloy (IRC)** — `https://iced.rs/showcase/halloy.gif` (GPL-3.0 app — inspiration only).
- **Sniffnet (network monitor)** — `https://raw.githubusercontent.com/GyulyVGC/sniffnet/main/resources/repository/pages/overview.png` (+ `inspect.png`, `notifications.png`). Apache-2.0. Polished charts + gradients.
- **Icebreaker (local LLM chat)** — `https://iced.rs/showcase/icebreaker.gif`
- ⚠️ `custom_shader` / `gradient` GIFs 404 on iced.rs — capture yourself from the example.

## egui
- **Demo** — `https://raw.githubusercontent.com/emilk/egui/main/media/demo.gif` , **widget gallery** — `.../media/widget_gallery.gif` , **light mode** — `.../media/demo_light_mode.png`.
- **custom3d snapshot** (wgpu triangle) — `https://raw.githubusercontent.com/emilk/egui/main/crates/egui_demo_app/tests/snapshots/custom3d.png`
- **Painting demo** — `https://raw.githubusercontent.com/emilk/egui/main/crates/egui_demo_lib/tests/snapshots/demos/Painting.png`
- **Live demo** (capture-it-yourself) — https://www.egui.rs/#demo

## Slint
- **Energy Monitor** (flashiest) — `https://github.com/user-attachments/assets/abfe03e3-ded6-4ddc-82b7-8303ee45515c` · live https://slint.dev/snapshots/master/demos/energy-monitor/
- **Printer demo** — `https://github.com/user-attachments/assets/34627f84-affd-46a6-9c52-1f623d33a507`
- **Home Automation** — `https://github.com/user-attachments/assets/607e07a5-2e79-4045-9fe4-3da2493ba187`
- **Widget gallery** — `https://github.com/user-attachments/assets/e37ad016-475a-4c01-8d1b-1326ee7aa733`
- **Weather** — `https://github.com/slint-ui/slint/blob/master/demos/weather-demo/docs/img/desktop-preview.png?raw=1`

## Floem / Lapce
- **Lapce editor** — `https://raw.githubusercontent.com/lapce/lapce/master/extra/images/screenshot.png` (verified ~966KB, decoded). Dark VS-Code-adjacent editor: activity bar, file tree, syntax highlight, autocomplete popup, modal-edit "Insert" badge — rendered by Floem/Vello/wgpu.
- **Floem widget gallery** — `https://github.com/lapce/floem/blob/main/docs/img/widget-gallery-dark.jpg?raw=1`

## Dioxus / Blitz
- **Blitz counter example** — `https://raw.githubusercontent.com/DioxusLabs/screenshots/main/blitz/counter-example.png`. GPU-rendered HTML/CSS via Vello+Stylo+Taffy+Parley (pre-alpha).

## Freya (Skia)
- **Components gallery** — `https://freyaui.dev/blog/0.3/components_gallery.png` (byte-verified live PNG)
- **Radial gradient** — `https://freyaui.dev/blog/0.3/radial_gradient.png` · **Conic** — `.../conic_gradient.png` · **Rainbow gradient borders** — `.../border_1.png`, `.../border_2.png`

## Rerun (egui + wgpu + re_renderer)
- **Hero** — `https://static.rerun.io/opf_screenshot/bee51040cba93c0bae62ef6c57fa703704012a41/full.png` (verified, decoded). macOS window; large 3D point-cloud viewport of a photogrammetry stone-monument reconstruction; RGB axis gizmo; wireframe camera frustum; olive-to-maroon gradient skybox; bottom timeline/transport strip. Dark-chrome, high-contrast.
- **Banner** — `https://static.rerun.io/d0f5443d4803cac65c73fcc064936c09f5e7f208_rerun_banner.png`

## Warp (custom Rust UI + Metal)
- **Hero** — `https://cdn.sanity.io/images/1ygbk6d0/production/c026d81afeb87c43fc438f4cf681a1c51d5ed1c4-1840x1174.png` (⚠️ CMS hash may rotate). Dark rounded terminal on lavender; sessions sidebar; a command **block** (`Cargo check` + colored compiler output). Each command+output is one bordered block.
- Stable alt: docs `https://docs.warp.dev/terminal/blocks/`.

## Ruffle (wgpu)
- ⚠️ No static UI screenshot exists (site ships only `logo.svg`). Canonical visual = **live demo** https://ruffle.rs/demo/ — a single stage canvas of crisp Flash vector art, gradients, blits, and filter effects.

## Rio (Rust + wgpu CRT terminal)
- Repo/site: https://github.com/raphamorim/rio · https://rioterm.com/docs/features/retroarch-shaders — RetroArch-style CRT via librashader (wgpu backend).
