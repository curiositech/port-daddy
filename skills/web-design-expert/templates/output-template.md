# Web Design Plan Template

[One-sentence description of the product/page this design plan covers.]

```json
{
  "primaryActionObviousWithin3s": false,
  "textContrastMinRatio": 0,
  "worksAt320pxNoHscroll": false,
  "touchTargetsMinPx": 0,
  "brandColorsConsistent": false,
  "fontWeightsCount": 0,
  "fontSizesCount": 0,
  "loadInteractiveSeconds": 0,
  "navMatchesMentalModel": false,
  "lightAndDark": false,
  "interactiveStatesDefined": false,
  "buttonStylesCount": 0,
  "unjustifiedAnimationsCount": 0
}
```

Field notes:

- `primaryActionObviousWithin3s` — true only if a fresh viewer could name the
  primary CTA within 3 seconds of first paint.
- `textContrastMinRatio` — the *worst* text/background contrast ratio in the
  design, not the average. Must be >= 4.5 to pass.
- `worksAt320pxNoHscroll` — verify by actually rendering at 320px, not by
  assuming a responsive framework handles it.
- `touchTargetsMinPx` — the smallest tappable target's shorter dimension.
  Must be >= 44.
- `fontWeightsCount` / `fontSizesCount` — count distinct values used across
  the whole design, not per page.
- `loadInteractiveSeconds` — measured or estimated time-to-interactive on a
  throttled 3G profile.
- `navMatchesMentalModel` — true only if backed by a task-completion rate
  above 80%, not a subjective opinion that the nav "feels right."
- `buttonStylesCount` / `unjustifiedAnimationsCount` — optional; omit if not
  tracked, but including them lets the auditor catch design-by-committee and
  decoration-over-function directly.

Validate with `node scripts/design_audit.mjs --input <this-plan-as-json>.json`
before treating a design as ready to build — the auditor will flag any
Quality Gate or named failure mode (design-by-committee,
decoration-over-function, mobile-afterthought, low-contrast, IA collapse)
that a value here violates.
