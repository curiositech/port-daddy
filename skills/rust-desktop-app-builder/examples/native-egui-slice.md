# Native egui/eframe Slice

## Request

"Build a fast Rust desktop utility with a gorgeous native control surface."

## Slice

Use egui/eframe when immediate feedback, inspectors, metrics, or realtime controls are the app's center of gravity.

First implementation:

- `AppState` split into domain state, transient UI state, and worker task handles.
- Top menu and command palette.
- Left navigation rail, resizable content region, and bottom status strip.
- Style module with type scale, spacing, color roles, and focus treatment.
- Worker channel for long-running task with cancel/progress.
- Persistence for settings and recent files.

## Guardrails

- Do not let the whole app become one `update()` function.
- Do not poll every frame unless animation or live data requires it.
- Do not hide keyboard behavior because "tools are mouse-driven".
- Do not accept the default debug-panel look as product design.

## Acceptance Gates

- Resize, high-DPI, and text scaling screenshots.
- Worker task remains responsive during long operation.
- Focus and keyboard path verified.
- `cargo clippy --all-targets --all-features -- -D warnings` passes.
