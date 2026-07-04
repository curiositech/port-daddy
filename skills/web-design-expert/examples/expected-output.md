# Example Output: Web Design Plan Audit

Scenario: a SaaS marketing site redesign has been specified as a structured
design plan (matching `schemas/design-plan.schema.json`) and is being audited
before build sign-off, the way a reviewer would check it against this skill's
Quality Gates instead of eyeballing a mockup.

## Passing plan

```json
{
  "primaryActionObviousWithin3s": true,
  "textContrastMinRatio": 7.2,
  "worksAt320pxNoHscroll": true,
  "touchTargetsMinPx": 48,
  "brandColorsConsistent": true,
  "fontWeightsCount": 2,
  "fontSizesCount": 4,
  "loadInteractiveSeconds": 2.1,
  "navMatchesMentalModel": true,
  "lightAndDark": true,
  "interactiveStatesDefined": true,
  "buttonStylesCount": 2,
  "unjustifiedAnimationsCount": 0
}
```

Running it through the auditor confirms every Quality Gate clears:

```
$ node scripts/design_audit.mjs --input examples/sample-input.json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Design plan clears all Quality Gates and named failure modes. Spot-check the real build against this plan before shipping — the audit trusts the numbers it was given."
  ]
}
```

## Failing plan (for contrast)

The same site, before the redesign, described honestly:

```json
{
  "primaryActionObviousWithin3s": true,
  "textContrastMinRatio": 3.1,
  "worksAt320pxNoHscroll": false,
  "touchTargetsMinPx": 32,
  "brandColorsConsistent": true,
  "fontWeightsCount": 5,
  "fontSizesCount": 6,
  "loadInteractiveSeconds": 2.4,
  "navMatchesMentalModel": true,
  "lightAndDark": true,
  "interactiveStatesDefined": true
}
```

```
$ node scripts/design_audit.mjs --input failing-plan.json
{
  "pass": false,
  "score": 52,
  "findings": [
    {
      "id": "low-contrast",
      "severity": "critical",
      "message": "textContrastMinRatio is 3.1:1, below the WCAG AA minimum of 4.5:1."
    },
    {
      "id": "mobile-afterthought-hscroll",
      "severity": "high",
      "message": "Layout requires horizontal scrolling at 320px width."
    },
    {
      "id": "mobile-afterthought-touch-target",
      "severity": "high",
      "message": "touchTargetsMinPx is 32px, below the 44px minimum."
    },
    {
      "id": "design-by-committee-font-weights",
      "severity": "medium",
      "message": "fontWeightsCount is 5, above the maximum of 3."
    },
    {
      "id": "design-by-committee-font-sizes",
      "severity": "medium",
      "message": "fontSizesCount is 6, above the maximum of 4."
    }
  ],
  "recommendations": [
    "Darken text or lighten the background until the ratio meets 4.5:1 (3:1 for large text); re-check with a contrast tool, not by eye.",
    "Rebuild the layout mobile-first; fixed-width elements wider than 320px are the usual cause.",
    "Increase interactive element hit areas to at least 44x44px, even if the visible glyph stays smaller.",
    "Failure mode: mobile-afterthought detected. Test the real layout at 320px width on an actual device before shipping.",
    "Collapse to at most 3 font weights across the whole design.",
    "Collapse to at most 4 font sizes across the whole design.",
    "Failure mode: design-by-committee detected. Establish a single design-principles document as the source of truth."
  ]
}
```

The `critical` finding on `low-contrast` alone forces `pass: false` regardless
of score — a low-contrast text failure is never something the audit lets a
high score paper over.
