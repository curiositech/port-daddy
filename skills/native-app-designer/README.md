# Native App Designer

Design breathtaking, organic-feeling iOS/macOS and native-feel web UI — then prove it against Apple HIG and this repo's hard native-design rules (no emoji icons, no tiny fonts, 44pt tap targets, WCAG contrast, light/dark, safe areas) with a deterministic auditor.

Use this skill when designing SwiftUI/UIKit interfaces, native-feel React/Vue animations, physics-based motion, or when a native design needs to pass a HIG compliance check before shipping.

## Quick Start

1. Read `SKILL.md` for the animation-timing, mood-to-personality, and platform-strategy decision trees, plus the five aesthetic anti-patterns (Generic Card Syndrome, Linear Animation Death, Rainbow Vomit, Animation Overload, Inconsistent Spacing) and the three HIG/repo-rule anti-patterns.
2. Skim `references/swiftui-patterns.md`, `references/react-patterns.md`, or `references/custom-shaders.md` for the platform you're building on.
3. Fill in `templates/output-template.md` for the design handoff (brief recap, screens, motion, platform-compliance checklist).
4. Build a native-ui-spec JSON matching `schemas/native-ui-spec.schema.json` and audit it:

```bash
node scripts/native_design_audit.mjs --input <your-design>.json
```

5. Compare against `examples/expected-output.md` to see a failing spec (emoji icons, 11pt captions, no Dynamic Type, sub-44pt targets, low contrast, light-only) audited, then the same design fixed and passing.
