# Example Output: Native App Designer

Scenario: a quick-actions bar ships with emoji icons ("🔍" for search, "➕" for add), a hard-coded 11pt caption under each icon, no Dynamic Type support, 30x30pt hit targets, a single (light-only) palette, and a 3.1:1 caption-on-background contrast ratio.

## Before: audited and failing

```bash
node scripts/native_design_audit.mjs --input examples/failing-input.json
```

```json
{
  "pass": false,
  "score": 4,
  "findings": [
    {
      "severity": "critical",
      "id": "emoji-icons-not-sf-symbols",
      "message": "UI icons use emoji instead of SF Symbols — a hard repo rule (\"NO EMOJIS AS ICONS IN APPS\") and an HIG violation."
    },
    {
      "severity": "critical",
      "id": "body-font-below-minimum",
      "message": "Smallest body/prose/caption font is 11pt, below the 14pt readable-text floor."
    },
    {
      "severity": "critical",
      "id": "dynamic-type-not-honored",
      "message": "Text does not scale with the system Dynamic Type setting — SwiftUI text styles must be used instead of hard-coded point sizes."
    },
    {
      "severity": "critical",
      "id": "tap-target-too-small",
      "message": "Smallest interactive control's tap target is 30pt, below Apple HIG's 44pt minimum."
    },
    {
      "severity": "critical",
      "id": "contrast-below-wcag",
      "message": "Worst-case text/background contrast is 3.1:1, below the WCAG 2.1 AA minimum of 4.5:1 for normal text."
    },
    {
      "severity": "critical",
      "id": "no-light-dark-support",
      "message": "Design does not implement both light and dark appearances with semantic colors."
    },
    {
      "severity": "medium",
      "id": "no-system-materials",
      "message": "Surfaces use flat/opaque fills instead of system materials (.ultraThinMaterial, .regularMaterial, etc.)."
    }
  ],
  "recommendations": [
    "Replace every emoji-as-icon with the matching SF Symbol (or a custom vector asset drawn to SF Symbol grid conventions).",
    "Raise body/caption text to at least 14pt; eyebrow/uppercase tracked-out labels may sit lower only at weight >=600 with letter-spacing.",
    "Use SwiftUI semantic text styles (.font(.body), .font(.headline), etc.) or UIFontMetrics-scaled fonts so text honors the user's Dynamic Type setting.",
    "Enlarge the hit area to at least 44x44pt (padding may extend beyond the visible control).",
    "Darken/lighten foreground or background (or switch to a semantic color token with a verified contrast pair) until every text/background pairing clears 4.5:1.",
    "Define semantic color tokens (e.g. Color(\"primaryText\") in an asset catalog) that resolve correctly in both light and dark, and verify both.",
    "Prefer system materials for chrome/overlay surfaces so the UI inherits platform vibrancy and stays visually current across OS releases."
  ]
}
```

## After: fixed and passing

The icons became SF Symbols (`magnifyingglass`, `plus.circle.fill`), captions moved to `.font(.caption)` (Dynamic-Type-scaled, resolves to 12pt+ and grows with the system setting — here spec'd at 15pt base), hit targets grew to 44x44pt via padding, a dark-appearance asset-catalog color set was added, and the bar's background moved to `.ultraThinMaterial`.

```bash
node scripts/native_design_audit.mjs --input examples/sample-input.json
```

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Design meets the native-design bar: SF Symbols, readable/Dynamic-Type text, 44pt targets, WCAG contrast, light/dark, safe areas. Ship it."
  ]
}
```
