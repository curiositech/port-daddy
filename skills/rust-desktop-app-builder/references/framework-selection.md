# Framework Selection

The first expert move is refusing to choose a desktop framework from vibes alone. Pick the shell from product constraints.

## Selection Matrix

| Need | Prefer | Why | Main Risk |
|------|--------|-----|-----------|
| Web-quality product UI with deep OS integration | Tauri 2 | Mature app shell, small WebView-based bundles, Rust commands, plugins, signing/updater path | IPC/capability mistakes can turn frontend bugs into local privilege bugs |
| Rust-first UI with web/fullstack reuse | Dioxus desktop | Rust components, hot reload, desktop renderer on system WebView through wry | WebView renderer does not grant normal browser APIs everywhere |
| Designed native/custom UI, industrial/pro tooling, embedded-adjacent reuse | Slint | Declarative UI language, Rust integration, tested desktop targets, strong custom component model | Separate UI language and theming system must be designed deliberately |
| Native tools, inspectors, control panels, realtime visual controls | egui/eframe | Immediate-mode speed, low ceremony, wgpu default renderer, native and web targets | Can feel like a debug UI unless layout/type/color/motion are governed |
| Elm-style native app with type-safe update loop | iced | Cross-platform GUI library, async subscriptions, native widgets, wgpu/tiny-skia renderer options | Experimental documentation posture; assumes strong Rust fluency |
| Custom graphics, visualization, simulation, canvas, GPU compute | wgpu plus shell | Safe portable Rust graphics over Vulkan, Metal, D3D12, GL, WebGPU/WebGL | Rendering substrate only; you still need app architecture and UI affordances |

## Stack Rules

### Tauri 2

Use when the UI wants modern web tooling, a compact desktop shell, tray/menu/window/system integration, updater support, and a Rust backend.

Require:
- Capability files per window/webview.
- IPC command allowlist with typed payload validation.
- CSP and remote-content policy.
- Sidecar process policy when bundling extra binaries.
- macOS notarization and Windows signing plan for public downloads.

Reject or challenge when:
- The app must avoid WebView memory/runtime dependency.
- The UI is primarily custom GPU rendering.
- The team wants to expose broad filesystem/system APIs to the renderer.

### Dioxus Desktop

Use when the team wants Rust components and shared fullstack/web/desktop concepts. Dioxus desktop renders in a system WebView, while Rust code runs natively and can access system APIs.

Require:
- A clear boundary between desktop-only APIs and shared UI code.
- A plan for JavaScript interop only when absolutely needed.
- Build/test coverage for desktop target behavior, not only web.

Reject or challenge when:
- The product depends on complex browser APIs that Dioxus desktop does not expose ergonomically.
- Designers expect CSS/web behavior to be identical to browser deployment.

### Slint

Use when the product needs polished custom UI, predictable rendering, Rust business logic, and a UI language suitable for desktop and embedded-adjacent products.

Require:
- A component library, token map, and live preview workflow.
- Rust-to-UI data contracts with explicit model ownership.
- Platform-specific testing for Windows console behavior and Linux graphics dependencies.

Reject or challenge when:
- The team expects HTML/CSS ecosystem reuse.
- The app needs rich DOM accessibility or browser-native text behavior.

### egui/eframe

Use when iteration speed, direct manipulation, inspectors, telemetry, panels, and visualization controls matter more than native widget mimicry.

Require:
- A style contract from day one.
- Layout constraints for resize and high-DPI.
- AccessKit consideration and keyboard navigation checks.
- Long-running work off the render/update path.

Reject or challenge when:
- The product must feel like a traditional document editor with platform widgets.
- Designers expect retained-mode layout and CSS-like styling.

### iced

Use when the app benefits from a typed Elm architecture, subscriptions, async actions, and native-widget structure.

Require:
- Strong Rust ownership fluency.
- Message/update taxonomy before feature sprawl.
- Theme and custom widget plan.

Reject or challenge when:
- The team is new to Rust and needs docs to hold every step.
- The app is mostly web content in a shell.

### wgpu

Use when rendering is the product: creative tools, maps, visual simulation, media timelines, 3D/2D GPU composition, or custom canvas.

Require:
- Separate app shell decision.
- Device/surface lifecycle handling.
- Shader pipeline validation.
- CPU/GPU frame budget and fallback path.

Reject or challenge when:
- The request is ordinary forms, settings, CRUD, or dashboards.

## Hybrid Patterns

- Tauri plus custom canvas: Web UI for chrome and workflow, Rust/wgpu for high-performance surface.
- egui plus wgpu: immediate-mode controls around custom render passes.
- Slint plus Rust service core: designed UI with a reusable domain library.
- Dioxus plus Rust workers: Rust UI and native tasks with a constrained bridge.

## Framework Decision Output

Use `templates/framework-decision-matrix.md`. Always include:
- Target OS list.
- Accessibility and release requirements.
- Security boundary.
- Rendering model.
- Team skill fit.
- Rejected alternatives with concrete reasons.
