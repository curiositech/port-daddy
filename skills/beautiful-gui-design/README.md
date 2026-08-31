# Beautiful GUI Design

Treat the screen as a designed surface, not a dump of controls: hierarchy, color, type,
motion, and accessibility are critical, and every choice must survive light/dark mode,
small and large viewports, keyboard and screen-reader use, and the platform it ships on.

Use this skill when designing or reviewing a web app, desktop GUI (Electron/Tauri), or
native app (SwiftUI/AppKit, Jetpack Compose, WinUI), or when establishing/fixing a design
system: tokens, type scale, spacing, component states, contrast, or theming.

## Quick Start

1. Read `SKILL.md` for the decision tree, Visual System Rules, and the anti-patterns.
2. Skim the relevant `references/0N-*.md` file before making a call in that lane (layout,
   color, type, motion, accessibility, or component systems/platform idioms).
3. Fill in `templates/output-template.md` for the actual design-system-and-layout deliverable.
4. Build a GUI-spec JSON matching `schemas/gui-spec.schema.json` and audit it:

```bash
node scripts/gui_design_audit.mjs --input <your-gui-spec>.json
```

5. Compare against `examples/expected-output.md` to see a bad spec audited, then the same
   design fixed and passing.
