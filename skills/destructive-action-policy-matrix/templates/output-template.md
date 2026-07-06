# Destructive Action Policy Matrix Template

Fill in one row per destructive/gated action before running the audit. Validate with `node scripts/policy_matrix_audit.mjs --input <this-as-json>.json` before treating the matrix as ready to gate a real tool surface.

```markdown
## Policy Matrix: <surface name, e.g. "Agent Harbor C5 governance gate">

| Action | Category | Tier | Pre-tool gate | Denial receipt | Transcript event | Safe alternative | Side-effect-free-on-block proven |
| --- | --- | --- | --- | --- | --- | --- | --- |
| <action name> | git\|filesystem\|network\|shell\|github | block\|approve\|allow | yes/no | yes/no | yes/no | <text, block-tier only> | yes/no |

## Containment claim (only if this report also asserts a body is sandboxed)

- Body: <identifier>
- Isolation boundary: <named mechanism, or "none — same UID">
- sameUidBodyMarkedContained: <true/false — must be false unless a real isolation boundary exists>
```

## Checklist before treating the matrix as gate-ready

- [ ] Every destructive/gated action the tool surface exposes has a row — no silent `allow`-by-default for a new tool.
- [ ] Every `block`-tier row has a negative fixture proving zero side effects, backing `sideEffectFreeOnBlockFixture: true`.
- [ ] Every `block`/`approve` row has a denial receipt and a transcript event.
- [ ] Every `block`-tier row names a concrete, runnable safe alternative.
- [ ] No same-UID or unmanaged body is marked `contained` anywhere in the report.
- [ ] `node scripts/policy_matrix_audit.mjs --input <matrix>.json` returns `pass: true`.
