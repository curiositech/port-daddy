# Example Output: Beautiful GUI Design

Scenario: the "Before" button from `SKILL.md`'s Worked Example, generalized to a whole
screen — hardcoded hex, magic padding, no dark theme, no hover/focus/disabled states, and
a type system that grew a new size and weight per screen. This is the "bad spec"
`gui_design_audit.mjs` is designed to catch.

## Bad spec — input

```json
{
  "textContrastMinRatio": 2.8,
  "touchTargetMinPx": 32,
  "spacingScale": "ad-hoc",
  "fontWeightsCount": 6,
  "fontSizesCount": 14,
  "semanticTokensUsed": false,
  "lightAndDark": false,
  "minBodyFontPx": 11,
  "interactiveStatesDefined": false
}
```

## Bad spec — audit result

```json
{
  "pass": false,
  "score": 20,
  "findings": [
    { "severity": "critical", "id": "low-text-contrast", "message": "Worst-case text contrast is 2.8:1, below the 4.5:1 WCAG AA floor." },
    { "severity": "high", "id": "missing-light-dark", "message": "Only one theme (light or dark) is designed; the other is missing or a naive inversion." },
    { "severity": "critical", "id": "tiny-body-font", "message": "Smallest body/caption font is 11px, below the 14px floor." },
    { "severity": "medium", "id": "too-many-font-weights", "message": "6 font weights are shipped, over the 3-weight ceiling before it reads as design-by-committee." },
    { "severity": "medium", "id": "too-many-font-sizes", "message": "14 distinct font sizes are shipped, over the ~8-step modular-scale ceiling." },
    { "severity": "critical", "id": "no-semantic-tokens", "message": "Components reference raw hex/px values instead of semantic design tokens." },
    { "severity": "high", "id": "ad-hoc-spacing", "message": "Spacing values are not on an 8pt or 4pt grid — one-off pixel values scattered through the system." },
    { "severity": "high", "id": "touch-target-below-minimum", "message": "Smallest interactive hit-area is 32px, below the 44px minimum." },
    { "severity": "critical", "id": "no-interactive-states", "message": "One or more interactive elements are missing hover/active/focus-visible/disabled states." }
  ],
  "recommendations": [
    "Darken/lighten the token pair (or the surface behind it) until the pair verifies at 4.5:1+ in a contrast checker.",
    "Design real light AND dark values for every semantic token and contrast-verify both — never invert one to get the other.",
    "Raise body/caption text to >=14px (0.875rem); reserve anything smaller for weight>=600 uppercase eyebrow labels with tracking>=0.1em.",
    "Collapse to 3 weights (e.g. regular/medium/bold) and justify any exception.",
    "Rebuild the type scale as a single modular ramp (~8 steps) and map every existing size onto it.",
    "Build the three-tier token model (primitive -> semantic -> component) and point every component at semantic tokens only.",
    "Adopt a single 8pt (or 4pt for micro-adjustments) spacing scale and re-map every existing spacing value onto it.",
    "Pad the interactive element (not just its visible glyph) to >=44px and space adjacent targets so they don't crowd.",
    "Define the full state machine (default/hover/active/focus-visible/disabled, +loading where async) on every interactive element."
  ]
}
```

## What fixing it actually looked like

1. **Rebuilt the token model.** Raw hex became semantic tokens (`--color-primary`, `--color-text-on-primary`, ...) derived from an OKLCH ramp, per `references/02-color-and-theming.md`.
2. **Designed dark for real**, not an inversion — re-verified both themes at 4.5:1+ body contrast with a contrast tool.
3. **Collapsed the type system** to a 7-step modular scale and 3 weights (regular/medium/bold), raised the body floor to 16px, per `references/03-typography.md`.
4. **Re-mapped every spacing value** onto an 8pt grid — no more one-off `13px` paddings, per `references/01-visual-hierarchy-layout-spacing.md`.
5. **Padded every interactive hit-area** to 44px minimum and added the full state machine (default/hover/active/focus-visible/disabled), per `references/05-accessibility-and-inclusive-design.md` and `references/06-component-systems-tokens-and-platform-idioms.md`.

## Fixed spec — input

This is `examples/sample-input.json`, unmodified:

```json
{
  "textContrastMinRatio": 7.2,
  "touchTargetMinPx": 44,
  "spacingScale": "8pt",
  "fontWeightsCount": 3,
  "fontSizesCount": 7,
  "semanticTokensUsed": true,
  "lightAndDark": true,
  "minBodyFontPx": 16,
  "interactiveStatesDefined": true
}
```

## Fixed spec — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Spec meets the beautiful-gui-design Quality Gates: contrast, type, tokens, spacing, targets, and states all clear."
  ]
}
```
