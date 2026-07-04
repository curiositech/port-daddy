# Example Output: Color Contrast Auditor

Scenario: a design brief eyeballs `#777777` gray body text over a white card because it "reads fine on the design file" — the classic gray-text-syndrome failure this skill exists to catch, plus an unrelated typo'd hex value and a status dot that conveys "error" through red alone.

## Weak spec — input

```json
{
  "pairs": [
    { "name": "hero-tagline", "foreground": "#777777", "background": "#FFFFFF", "usage": "body-text" },
    { "name": "helper-text", "foreground": "#ccc", "background": "#FFFFFF", "usage": "body-text" },
    { "name": "brand-mark", "foreground": "#F5F2E, "background": "#111111", "usage": "decorative" }
  ],
  "semanticSignals": [
    { "name": "form-error-dot", "conveyedByColorOnly": true }
  ]
}
```

Note the malformed `"#F5F2E,` value — a real copy/paste defect, not a contrived example. `contrast_audit.mjs` never assumes a value it can't parse is safe.

## Weak spec — audit result

```json
{
  "pass": false,
  "score": 56,
  "findings": [
    { "severity": "critical", "id": "contrast-below-threshold", "message": "Pair \"hero-tagline\" (body-text): computed ratio 4.48:1 is below the required 4.5:1 (foreground #777777 on background #FFFFFF)." },
    { "severity": "critical", "id": "contrast-below-threshold", "message": "Pair \"helper-text\" (body-text): computed ratio 1.61:1 is below the required 4.5:1 (foreground #ccc on background #FFFFFF)." },
    { "severity": "critical", "id": "invalid-color", "message": "Pair \"brand-mark\": foreground \"#F5F2E,\" is not a parseable #RGB or #RRGGBB hex color." },
    { "severity": "high", "id": "color-only-signal", "message": "Semantic signal \"form-error-dot\" is conveyed by color alone, with no icon/text/pattern backup — fails WCAG 1.4.1 (Use of Color) regardless of contrast ratio." }
  ],
  "recommendations": [
    "Darken \"hero-tagline\"'s foreground or lighten/darken its background until the computed ratio reaches 4.5:1 — see references/safe-color-pairs.md for pre-verified alternatives.",
    "Darken \"helper-text\"'s foreground or lighten/darken its background until the computed ratio reaches 4.5:1 — see references/safe-color-pairs.md for pre-verified alternatives.",
    "Fix the foreground value on \"brand-mark\" to a valid hex color before this pair can be verified — an unparseable color cannot be assumed safe.",
    "Add a non-color indicator (icon, label, pattern, or underline) alongside \"form-error-dot\" so the meaning survives color-blindness and grayscale rendering."
  ]
}
```

`hero-tagline` is the case worth internalizing: `#777777` on white *looks* like it should clear 4.5:1 — "777 is basically half gray" — but the real relative-luminance ratio is **4.48:1**, just under the floor. This is exactly the gap between eyeballing a hex value and computing it; see `references/safe-color-pairs.md` for the nearest pre-verified fix (`#767676` clears it at 4.5:1 flat; `#595959` gives headroom at 7.0:1).

## What fixing it actually looked like

1. **Darkened `hero-tagline`** from `#777777` to `#595959` (AAA-level 7.0:1, pulled straight from `references/safe-color-pairs.md` rather than re-guessed).
2. **Darkened `helper-text`** from `#ccc` to `#757575` (4.6:1 — the documented minimum-readable placeholder gray).
3. **Fixed the typo** on `brand-mark`'s foreground to `#F5F2E8`, then reclassified it as `decorative` (it's a background texture, not text) — the pair is now exempt from a contrast requirement, but its color is at least parseable.
4. **Added a non-color indicator** to `form-error-dot`: an inline icon plus a text label ("Error: …") next to the red dot, and re-declared `conveyedByColorOnly: false` since red is no longer the only signal.

## Fixed spec — input

```json
{
  "pairs": [
    { "name": "hero-tagline", "foreground": "#595959", "background": "#FFFFFF", "usage": "body-text" },
    { "name": "helper-text", "foreground": "#757575", "background": "#FFFFFF", "usage": "body-text" },
    { "name": "brand-mark", "foreground": "#F5F2E8", "background": "#111111", "usage": "decorative" }
  ],
  "semanticSignals": [
    { "name": "form-error-dot", "conveyedByColorOnly": false }
  ]
}
```

## Fixed spec — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "All pairs meet their WCAG 2.x contrast floor and no semantic signal relies on color alone."
  ]
}
```
