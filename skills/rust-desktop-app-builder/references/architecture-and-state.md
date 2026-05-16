# Architecture And State

Premium desktop Rust apps need a boringly strong architecture underneath the glow.

## Recommended Workspace Shape

```text
app/
  Cargo.toml
  crates/
    app-core/          # domain, commands, persistence, validation
    app-platform/      # OS integration, dialogs, tray, notifications
    app-ui/            # framework-specific UI when Rust-native
    app-render/        # optional wgpu/custom rendering
  src-tauri/           # Tauri shell when applicable
  ui/                  # web UI when applicable
  tests/
```

Rules:
- Keep domain logic in a Rust library that can be tested without a window.
- Keep UI framework code thin enough to replace or wrap.
- Make platform behavior explicit. Do not scatter `cfg(target_os)` through product logic.
- Use typed config and migration versions for local data.

## State Models By Stack

### Tauri

- Frontend owns view state.
- Rust owns privileged operations, secrets, filesystem, sidecars, and data validation.
- IPC commands are small, typed, versioned, and denied by default.
- Events are named, documented, and rate-limited.

### Dioxus

- Components manage UI state through Dioxus primitives.
- Native tasks should sit behind services with desktop/web feature gates.
- Do not assume browser APIs just because the renderer is a WebView.

### Slint

- Slint components own presentation state.
- Rust owns domain models and heavy work.
- Define callback boundaries and model updates explicitly.

### egui/eframe

- App struct owns immediate-mode state.
- Long-running work goes through channels/tasks and requests repaint only when needed.
- Split panels/views into modules once the app has more than one workflow.

### iced

- Messages are the public nervous system of the app.
- Keep update logic boring, typed, and testable.
- Use subscriptions for async and external events.

### wgpu

- Separate renderer resources, scene/data model, and app shell state.
- Handle device loss, resize, scale factor changes, and surface reconfiguration.
- Keep shader inputs versioned and validated.

## Async And Long Work

Never:
- Block the main event loop with IO, indexing, model loading, network, compression, or export.
- Hide long tasks behind frozen spinners.
- Let cancel buttons be decorative.

Always:
- Use worker tasks or threads.
- Report progress and cancellation.
- Preserve partial results only when safe.
- Bound concurrency for local machine respect.

## Persistence

Define:
- Settings path via OS conventions.
- Cache path separate from user data.
- Database or file format version.
- Backup/restore or export path for user-owned data.
- Crash-safe writes for important documents.
- Migration tests.

## OS Integration

Specify per platform:
- Menu model.
- Shortcut map.
- File associations.
- Deep links/custom protocol.
- Tray/status item.
- Notifications.
- Auto-start/background behavior.
- Installer and update channel.
- Logs and crash dumps.

If an integration does not exist, say so in the release notes. Silent missing behavior feels broken.
