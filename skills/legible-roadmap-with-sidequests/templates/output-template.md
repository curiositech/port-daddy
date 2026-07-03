# Roadmap Legibility Reconciliation — [Window: <start date> to <end date>]

[One sentence naming the product and the reconciliation window this covers.]

## Canonical Roadmap

- Source: [path/URL of the one canonical roadmap]
- Count of competing roadmaps found: [0 expected — name and kill any others]

## Work Units In Window

| id | kind | link / opt-out | spawned → captured | evidence | status |
| --- | --- | --- | --- | --- | --- |
| [id] | planned/sidequest | [`slug` or opt-out reason] | [N → M] | [commit/pr/receipt refs] | [status] |

## Audit Result

Run: `node scripts/roadmap_legibility.mjs --input <this-window>.json`

```json
{
  "pass": <bool>,
  "legibilityScore": <0-1>,
  "findings": [ /* paste findings array */ ],
  "recommendations": [ /* paste recommendations array */ ]
}
```

## Remediation Log

For each `critical`/`high` finding above, one line on what was fixed and how:

- [finding id] → [fix applied, e.g. "added Roadmap-Item link to phase-3-x"]

## Emerging Track Candidates

[Note any sidequest theme that has recurred 3+ times — a candidate for a
named roadmap phase rather than another one-off opt-out.]

## Next Reconciliation

- Date: [date, ≤ policy.maxReconciliationCadenceDays from today]
- Carry-forward debt: [any finding not yet fixed, and why]
