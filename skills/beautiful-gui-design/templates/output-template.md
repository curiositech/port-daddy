# Visual Design System & Layout Brief

Fill in every section before handing this off for implementation. Validate the measured
claims with `node scripts/gui_design_audit.mjs --input <this-as-json>.json` before marking
it ready — see `schemas/gui-spec.schema.json` for the exact fields.

```markdown
## Tokens

- Primitive ramp: <e.g. an OKLCH lightness ramp per hue>
- Semantic tokens: <color-primary, color-surface, color-text, color-focus-ring, ...>
- Spacing scale: <8pt | 4pt> base, values used: <list>
- Type scale: <N steps>, base <Xpx/rem>, ratio <e.g. 1.25>
- Font weights in use: <list, ideally <=3>

## Layout

- Grid / breakpoints (or container queries) and rationale.
- Focal point and hierarchy strategy (size/weight/position — never color alone).
- Density vs. whitespace decision for this surface.

## Component States

For each interactive element: default / hover / active / focus-visible / disabled
(+ loading where async). Note the token each state pulls from.

## Accessibility Pass

- Contrast: worst-case text ratio measured = <X:1> (target >=4.5:1).
- Touch targets: smallest hit-area = <Xpx> (target >=44px).
- Keyboard: full operability, visible focus on every stop, modal focus-trap + restore.
- Screen reader: semantic elements/labels used; ARIA only where necessary.

## Motion

- Durations/easing tokens used; `prefers-reduced-motion` path confirmed.

## Platform Notes

- Web / Electron-Tauri / iOS-macOS / Android: which native idioms this ships with.
- Token flow: how the same semantic tokens reach every target (CSS vars, Swift, Kotlin).

## Validation

- `node scripts/gui_design_audit.mjs --input <spec>.json` → pass/fail, findings, recommendations.
```

## Checklist before marking ready

- [ ] Spacing is on a single 8pt (or 4pt) grid — no magic numbers in components.
- [ ] Color is semantic tokens; light AND dark both designed and contrast-verified (4.5:1 text, 3:1 UI).
- [ ] Type is `rem`-based, body >=14px, on a modular scale (~6-8 sizes, <=3 weights).
- [ ] Every interactive element defines its full state machine, including focus-visible.
- [ ] Touch targets >=44x44pt (iOS) / 48dp (Android), adequately spaced.
- [ ] Motion is transform/opacity only, tokenized, and honors `prefers-reduced-motion`.
- [ ] Icons come from an icon system (SF Symbols/Lucide/Heroicons), never emoji.
- [ ] `gui_design_audit.mjs` reports `pass: true` against the measured spec.
