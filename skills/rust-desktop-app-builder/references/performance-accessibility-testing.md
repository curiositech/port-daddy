# Performance, Accessibility, And Testing

A beautiful desktop app that stutters, traps keyboard focus, or fails to install is not beautiful.

## Budgets

Set budgets per product. Reasonable starting targets:

- Cold launch to useful UI: under 1 second for small utilities, under 2 seconds for complex pro apps.
- Input feedback: under 50 ms.
- Long task progress visible: under 300 ms.
- Idle memory: measured and justified per stack. WebView shells must be honest about baseline overhead.
- Frame pacing: no recurring jank during resize, scroll, drag, or animation.
- Installer size: tracked per platform and explained.

## Performance Proof

Use:
- `cargo build --release` and timed launches.
- Framework profiler/debug overlays where available.
- OS profilers: Instruments, Windows Performance Analyzer, Linux `perf` or Sysprof.
- Tracing with spans around startup, command execution, IO, render, and update checks.
- Screenshot/video capture during resize, theme switch, and long operations.

Watch for:
- Blocking filesystem or network calls on UI thread.
- Excessive polling.
- Rebuilding entire UI state on every tick.
- Large font/image bundles.
- Slow shader compilation.
- Logging in hot paths.

## Accessibility

Define support by stack:
- WebView UI: semantic HTML, ARIA only when needed, keyboard order, focus-visible, contrast, reduced motion, text zoom.
- egui/eframe: enable and test accessibility integration where available; verify keyboard alternatives for pointer-heavy flows.
- iced/Slint/native custom UI: inspect accessible names, roles, focus order, and platform screen-reader behavior.
- wgpu/custom rendering: provide a parallel accessible control model for nonvisual interaction.

Always test:
- Keyboard-only primary workflow.
- Visible focus on every interactive element.
- Screen-reader names for critical controls.
- High contrast or forced colors where supported.
- System text scaling.
- Reduced motion.
- Color-blind safe status encoding.

## Cross-Platform Test Matrix

Minimum:
- macOS arm64.
- Windows x64.
- Linux x64 on a mainstream desktop environment.

When relevant:
- macOS Intel if supporting older devices.
- Windows arm64.
- Linux Wayland and X11.
- High-DPI and fractional scaling.

CI gates:
- `cargo fmt --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --all-features`
- Framework-specific build.
- Installer build.
- Static audit script from this skill.

Manual gates:
- First-run experience.
- Window resize, snap/tile/full screen.
- Theme switch.
- Primary workflow with keyboard.
- Local data migration/upgrade.
- Offline behavior.
- Update from previous version.
- Uninstall cleanup.

## Visual Regression

Capture:
- Home/default state.
- Dense data state.
- Empty state.
- Loading and long task.
- Error/recovery.
- Settings/preferences.
- About/update dialog.
- Light/dark/high contrast.

For Tauri/Dioxus webview UI, browser automation can cover much of the renderer. Still verify the built desktop shell because menus, titlebar, native dialogs, updater, and WebView differences are not browser-only truth.
