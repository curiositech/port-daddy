# Compliance Ladder Freeze Decision

Fill in every section before letting any C-badge or T-fidelity label ship. Validate the underlying claims with `node scripts/conformance_audit.mjs --input <this-audit-as-json>.json` before calling it frozen.

```markdown
## Ladders Audited

- <ladder name, e.g. "compliance-ladder"> — levels <lowest id> through <highest id>.
- <ladder name, e.g. "transcript-fidelity-ladder"> — levels <lowest id> through <highest id>.

## Surface Agreement

- doc: <source file/path> — <identical to canonical | drift found, see finding ids>
- schema: <source file/path> — <identical to canonical | drift found, see finding ids>
- ui: <component/pane name> — <identical to canonical | drift found, see finding ids>
- probe: <CLI/API entrypoint> — <identical to canonical | drift found, see finding ids>

## Adapter Conformance Matrix

| Adapter | Ladder | Claimed level | forged-level | direct-mcp-bypass | disabled-hook-after-launch | forged-heartbeat | observed-to-controlled |
| --- | --- | --- | --- | --- | --- | --- | --- |
| <name> | <ladder> | <level id> | <present+downgraded?> | <present+downgraded?> | <present+downgraded?> | <present+downgraded?> | <present+downgraded?> |

## Audit Result

- `pass`: <true/false>
- `score`: <0-100>
- Critical findings: <count, or "none">
```

## Checklist before calling a ladder frozen

- [ ] Every ladder in scope has a `doc`, `schema`, `ui`, and `probe` surface declaring it.
- [ ] Every surface's levels match the canonical ladder's id, order, name, and `requiredPredicates` exactly — not "close enough."
- [ ] Every adapter fixture (Codex, Claude Code, Cloudflare, Ollama/LM Studio, custom) has all five negative probes wired and `present: true`.
- [ ] Every fired probe is `downgraded: true` — a probe that ran and didn't catch the attack is worse than not testing it.
- [ ] Every non-base level (`order > 0`) on every ladder has at least one adapter backing it with a witnessed, correctly-downgrading probe.
- [ ] `node scripts/conformance_audit.mjs --input <audit>.json` reports `pass: true` with zero critical findings.
- [ ] UI copy uses capability predicates (transcripted/governed/controllable/resumable/cooperative), not a bare numeric badge, until this exact audit has run clean in CI — not just once, locally.
