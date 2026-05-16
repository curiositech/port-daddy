# Visual Inspiration, Tutorials, And Templates

Use this reference when the user wants examples that prove Rust desktop can look excellent. The goal is not to copy skins; it is to extract product-grade taste patterns.

Open the companion board:

```text
skills/rust-desktop-app-builder/examples/rust-desktop-inspiration-board.html
```

## Apps Worth Studying

| App | Stack Signal | Why It Is Hot | Source |
|-----|--------------|---------------|--------|
| Zed | Rust + GPUI | GPU-native editor with tight density, elegant dark chrome, fast collaboration and agent workflows | https://zed.dev/ |
| Lapce | Rust + Floem + wgpu | Native GPU editor, clean VS Code-adjacent layout, low-latency feel, terminal/editor integration | https://lap.dev/lapce/ |
| Rerun Viewer | Rust + egui + wgpu | Rich multimodal 2D/3D/time UI; proof that egui can be product-grade with enough design discipline | https://github.com/rerun-io/rerun |
| Slint Material Gallery | Slint + Material 3 | Polished controls, touch-friendly density, responsive UI across device sizes | https://material.slint.dev/getting-started/ |
| Makepad | Rust + shader/native/web UI | Experimental, visually ambitious live-designed Rust UI and examples | https://makepad.nl/ |
| Cap | Tauri + Rust + Solid/TypeScript | Modern screen recorder with smooth creator-tool positioning, editor/share workflow, privacy angle | https://github.com/CapSoftware/Cap |
| Spacedrive | Rust data core + cross-platform app | Local-first file/data product with futuristic file management aesthetic and Rust-heavy core | https://spacedrive.com/ |
| Yaak | Tauri app signal | Clean, themeable, offline API client; a good anti-bloat Tauri inspiration point | https://yaak.app/ |

## Taste Patterns To Steal

- Dense but breathable panels: Zed, Lapce, Rerun, and Yaak all avoid oversized marketing UI inside the app.
- Sidebars that carry real work: project tree, requests, timelines, file index, inspector, and agent threads are visually distinct but not ornamental.
- Dark mode that is not just black: use layered neutrals, restrained borders, quiet active states, and very few saturated accents.
- High-end utility surfaces: app polish comes from the boring states: search, filters, empty panels, progress, errors, import/export, recent files, settings, update dialogs.
- Native trust beats novelty: menus, shortcuts, file dialogs, high-DPI detail, updater/signing, and platform-specific packaging all affect whether the app feels expensive.
- Rust-native rendering has its own look: egui, Slint, Floem, Makepad, and GPUI do not need to mimic Electron. Let the app feel precise and fast.

## Official Templates And Starter Paths

| Stack | Starter | Use When |
|-------|---------|----------|
| Tauri 2 | `npm create tauri-app@latest`, `cargo create-tauri-app` | Web-quality UI with Rust system integration and production bundling |
| Dioxus | `dx new` templates, desktop guide examples | Rust component model and web/desktop/mobile code sharing |
| Slint | `slint-rust-template`, `material-rust-template` | Declarative native/custom UI with Rust business logic |
| egui/eframe | `emilk/eframe_template` | Fast native utility, inspector, or tool with immediate-mode UI |
| iced | `iced` examples repository | Elm-style native app with typed update loop and async subscriptions |
| Floem | `lapce/floem` examples and widget gallery | Fine-grained reactive native Rust UI with wgpu/vello/vger rendering |
| Makepad | UI Zoo tutorial and examples | Experimental live-designed Rust UI across native and web |

## Tutorials To Point Agents At

- Tauri 2 docs: project creation, capabilities, signing, updater.
- Dioxus desktop guide: desktop renderer, custom assets, lower-level wry integration.
- Slint docs and Material getting started: `.slint` UI, Rust bindings, Material components.
- egui docs and `eframe_template`: fastest path to native/web immediate-mode app.
- iced examples: message/update architecture and async workflows.
- Makepad UI Zoo tutorial: live DSL, widgets, layout, animation, shader mental model.

## How To Use This In A Build

1. Pick 3 inspiration references: one app for layout, one for visual polish, one for framework architecture.
2. Screenshot or link them in the on-disk plan.
3. Write what to borrow and what to avoid.
4. Convert inspiration into tokens, components, and verification gates.
5. Do not copy brand identity or screenshots into shipped product UI.

## Anti-Patterns

### Pinterest Without Translation

Novice: Gather pretty screenshots and ask the app to "feel like these."

Expert: Extract concrete mechanics: panel density, shortcut model, border weight, type roles, motion timing, empty states, and release trust.

### Framework Demo Worship

Novice: Assume a gallery widget equals a production app.

Expert: Galleries prove primitives. Production quality comes from state modeling, accessibility, performance, error handling, updater trust, and platform adaptation.
