# Binder Architect Of Record — Run Template

Fill in every section before closing a run. Validate the underlying claims
with `node scripts/binder_coverage_audit.mjs --input <this-run-as-spec>.json`
before writing the ledger entry.

```markdown
## Contradiction List

- <kind: term|authority|schema|shipped-vs-target> — <chapters involved> — resolved: <yes/no> — <source link>

## Coverage Matrix Update

### Customer / deployment axis
| Customer or deployment type | Owner | Status | Gate | Failure mode | Recovery path | Source |
| --- | --- | --- | --- | --- | --- | --- |
| <e.g. Solo local operator> | | | | | | |

### Technical contingency axis
| Contingency | Owner | Status | Gate | Failure mode | Recovery path | Source |
| --- | --- | --- | --- | --- | --- | --- |
| <e.g. Daemon down> | | | | | | |

### Architecture consistency axis
| Axis | Owner | Status | Gate | Failure mode | Recovery path | Source |
| --- | --- | --- | --- | --- | --- | --- |
| <e.g. Terms> | | | | | | |

## Ambition Archaeology Table

| Ambition family | Classification | Source (file:line) | Proposed destination | Rationale |
| --- | --- | --- | --- | --- |
| <name> | absorbed / superseded / deferred / contradicted / orphaned / rejected | | | |

## Proof Gates Changed

- <gate name> — <added/removed/reassigned> — <why>

## Operator Decisions Requested

- <decision framed as a clear fork with tradeoffs> — <why an agent cannot decide this>

## Mandatory Ledger Entry

pd note "binder-aor-log: <ISO timestamp> | window <start>..<end> |
chapters scanned: <list> |
source corpus scanned: <list> |
ambitions classified: <absorbed/superseded/deferred/contradicted/orphaned/rejected counts> |
contradictions: <count or NONE> |
coverage gaps: <count or NONE> |
proof gates changed: <list or NONE> |
operator decisions: <list or NONE> |
confidence: <0..1 plus reason> |
handover: <what next run should inspect first>"
```

## Checklist before closing the run

- [ ] Every claimed capability touched this run has an owner, a testable gate, and an evidence link (`references/raci-authority-and-escalation.md` for who owns what).
- [ ] Every contradiction found is either resolved with a source-linked fix or explicitly tiered and recorded, never silently dropped.
- [ ] Every ambition-corpus entry touched this run has one of the six classifications, never left `null`.
- [ ] All three coverage-matrix axes are re-checked, not just the one that prompted the run.
- [ ] The `binder-aor-log:` ledger entry is written even if the run found nothing (ALL QUIET is still an entry).
- [ ] No product tradeoff was decided silently — anything Tier 3 is phrased as an explicit operator decision request.
