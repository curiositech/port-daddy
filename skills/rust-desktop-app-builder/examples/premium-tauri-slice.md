# Premium Tauri Slice

## Request

"Make this Rust desktop app feel modern and shippable."

## Slice

Create the smallest real shell that proves the product can become a polished desktop app:

- Native window/titlebar decision.
- Menu model with platform shortcuts.
- One real primary workflow.
- Rust command boundary with typed request/response.
- Capability file for only the current workflow.
- Loading, empty, error, offline, and update-ready states.
- Light/dark tokens and screenshots.
- Installer/updater decision recorded, even if not implemented yet.

## File Shape

```text
src-tauri/
  capabilities/main.json
  src/
    commands.rs
    menu.rs
    updater.rs
    main.rs
ui/
  src/
    app/AppShell.tsx
    app/commandPalette.ts
    design/tokens.css
    platform/shortcuts.ts
crates/
  app-core/
    src/lib.rs
```

## Acceptance Gates

- Renderer cannot call arbitrary filesystem APIs.
- Every command validates payloads in Rust.
- Keyboard-only user can complete the workflow.
- Window resize does not overlap text or controls.
- Update/signing limitations are visible in the release checklist.
