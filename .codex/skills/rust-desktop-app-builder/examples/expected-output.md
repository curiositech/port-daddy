# Expected Output Example

Use this as the shape of a final handoff after a Rust desktop app slice.

```markdown
Built the first production slice of the Rust desktop app in `apps/studio-shell`.

Framework decision: Tauri 2 with a Rust core library and a React renderer. I rejected egui because the product needs rich document layout and browser-grade typography; I rejected Slint because the team already has a strong web component system and needs rapid web/desktop parity.

What changed:
- Added `crates/studio-core` for typed project loading and validation.
- Added `src-tauri/capabilities/main.json` with only window, dialog, and scoped filesystem permissions.
- Added first-run shell with native menu, command palette, settings, and update state.
- Added dark/light theme tokens and platform shortcut map.

Validation:
- `cargo fmt --check`: pass
- `cargo clippy --all-targets --all-features -- -D warnings`: pass
- `cargo test --all-features`: pass
- `npm run build`: pass
- macOS screenshot pass at 1x and 2x; Windows/Linux screenshots still pending.

Remaining risk:
- Public release still needs Developer ID notarization, Windows signing, and updater smoke from the previous version.
```
