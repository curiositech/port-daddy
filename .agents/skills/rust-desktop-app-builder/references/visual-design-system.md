# Visual Design System

"Hot" desktop UI is not a gradient, a glass card, or a website in a fixed window. It is a dense, responsive, physically credible interface that feels native while still having a strong product identity.

## Taste Contract

Set these before implementation:

- Density: compact by default, with comfortable touch targets only where touch is real.
- Type: use platform fonts by default unless brand typography earns its keep. Verify variable font behavior at 1x, 1.5x, 2x, and high-contrast modes.
- Color: semantic roles only. Avoid one-hue palettes. Reserve accent color for action and selection, not decoration.
- Materials: use blur/glass/translucency only where content hierarchy remains legible and platform-appropriate.
- Motion: short, causal, interruptible, and reduced-motion aware. Motion should explain where something went.
- Icons: use platform-recognizable symbols for common actions; label only when ambiguity remains.
- Chrome: decide native titlebar, custom titlebar, or hybrid intentionally. Do not hide window affordances for aesthetics.
- First screen: show real app state or real workflow immediately, not a marketing hero.

## Platform Translation

### macOS

Anchor on Apple HIG principles: hierarchy, harmony, and consistency. Respect menu bar behavior, keyboard shortcuts, sidebar/list/detail patterns, vibrancy/material restraint, large-title use only where it belongs, and drag regions.

Do:
- Use Command-key shortcuts and standard menu placement.
- Make toolbar controls feel spatially connected to the content they affect.
- Test full screen, Stage Manager-like window widths, and multiple displays.

Avoid:
- Windows-style ribbon density.
- Fake traffic-light controls.
- Glass effects that fight current macOS materials.

### Windows

Anchor on Fluent and Windows app resources. Use Segoe UI Variable and Fluent icons where native Windows fit matters. Respect titlebar behavior, snap layouts, context menus, system accent, and keyboard access.

Do:
- Make resize and snap feel excellent.
- Use clear command surfaces and settings organization.
- Test high contrast, text scaling, and keyboard focus.

Avoid:
- macOS sidebars and translucent chrome copied wholesale.
- Custom controls with weak focus rectangles.

### Linux

Anchor on GNOME HIG when targeting GNOME/GTK-like expectations, while staying respectful of KDE and distro diversity. Design for adaptiveness, Wayland/X11 differences, theming expectations, and file dialog realities.

Do:
- Test fractional scaling and font fallback.
- Keep windows resizable and useful at narrow widths.
- Follow system light/dark preference where the framework allows.

Avoid:
- Assuming one Linux desktop.
- Hardcoded paths, fonts, or notification behavior.

## Desktop-Specific UI Requirements

- Menus: every app with documents, files, editing, windows, or settings needs a real menu model.
- Shortcuts: define a shortcut table with platform variants.
- Command palette: useful for dense tools, but never as a replacement for visible primary actions.
- Drag/drop: specify accepted types, hover affordance, failure state, and security restrictions.
- File dialogs: use OS-native dialogs where possible.
- Tray/status item: only when background value exists; otherwise it is clutter.
- Notifications: actionable, rate-limited, and permission-aware.
- Offline/local state: visible sync/save/conflict status when data matters.
- Update state: show checking, downloaded, ready-to-restart, failed, and rollback messaging.

## Motion And Feel

Targets:
- Pointer feedback within 50 ms.
- Button/selection state immediately on input.
- Page/panel transitions usually 120-220 ms.
- Long operations show progress within 300 ms.
- Expensive visual transitions are skippable and reduced-motion aware.

Good motion:
- Reveals causality.
- Preserves spatial memory.
- Never blocks input longer than necessary.

Bad motion:
- Decorative bounce.
- Slow opacity-only fades masking loading.
- Parallax or blur that degrades text legibility.

## Visual Review Checklist

- Desktop, laptop, narrow window, and ultrawide screenshots.
- Light, dark, high contrast where supported.
- 1x, 1.5x, 2x scaling.
- Empty, loading, error, disabled, selected, focused, active, offline, update-ready states.
- Keyboard-only path through primary workflow.
- Text expansion by at least 30 percent.
- Menu bar/titlebar/window control audit.
