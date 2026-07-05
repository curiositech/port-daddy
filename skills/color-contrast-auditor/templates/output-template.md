# Contrast Audit Report Template

Fill in every section before handing this back to a designer or reviewer. Validate the underlying numbers with `node scripts/contrast_audit.mjs --input <this-audit-as-json>.json` before publishing them.

```markdown
## Summary

- Pairs audited: <N>
- Passing (WCAG floor): <N>
- Failing: <N>
- Color-only signals flagged: <N>

## Failures

| Pair | Foreground | Background | Usage | Computed Ratio | Required | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| <name> | <#hex> | <#hex> | body-text / large-text / ui-component | <X.XX:1> | <4.5:1 / 3:1> | <#hex from references/safe-color-pairs.md> |

## Invalid Colors

| Pair | Field | Declared Value | Issue |
| --- | --- | --- | --- |
| <name> | foreground/background | <value> | Not a parseable #RGB/#RRGGBB hex |

## Color-Only Signals

| Signal | Issue | Fix |
| --- | --- | --- |
| <name> | Conveyed by color alone (WCAG 1.4.1) | Add icon/text/pattern: <specific recommendation> |

## Verdict

`pass: <true/false>`, `score: <0-100>` — <one-line rationale, e.g. "1 critical contrast-below-threshold finding on the hero tagline blocks pass.">
```

## Checklist before publishing

- [ ] Every pair's ratio is the real computed value from `contrast_audit.mjs`, not an estimate.
- [ ] Every failing pair has a specific replacement hex, ideally from `references/safe-color-pairs.md`.
- [ ] Decorative pairs are labeled as exempt, not silently omitted.
- [ ] Every semantic signal (error/success/required/etc.) is declared and checked for a color-only dependency.
- [ ] `node scripts/contrast_audit.mjs --input <audit>.json` reproduces the `pass`/`score` stated above.
