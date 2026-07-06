# Example Output: Legible Roadmap With Sidequests

Scenario: a two-week window on a port-daddy-shaped project. One phase item
shipped, one CLI sidequest happened on an energy burst, and a "fix the DB
fragmentation" task got done half-tracked. Reconciliation is due.

## Before: Sidequest Sprawl (illegible)

State fed to the audit (`~/coding/tmp/sprawl-window.json`):

```json
{
  "canonicalRoadmaps": 3,
  "reconciliationCadenceDays": null,
  "policy": { "linkOrOptOutRequired": true, "maxReconciliationCadenceDays": 14 },
  "workUnits": [
    { "id": "phase3-visibility-item", "kind": "planned", "roadmapLink": "phase3-visibility-item", "progressEvidence": [], "status": "done" },
    { "id": "random-cli-tweak", "kind": "sidequest", "spawnedItems": 3, "spawnedItemsCaptured": 0, "progressEvidence": ["commit:abc123"], "status": "in-progress" },
    { "id": "db-fragmentation-fix", "kind": "sidequest", "roadmapLink": "db-fragmentation-fix", "optOutReason": "also opting out", "progressEvidence": ["commit:def456"], "status": "in-progress" },
    { "id": "mystery-cleanup", "kind": "sidequest", "progressEvidence": [], "status": "todo" }
  ]
}
```

Run: `node scripts/roadmap_legibility.mjs --input sprawl-window.json`

```json
{
  "pass": false,
  "legibilityScore": 0.25,
  "findings": [
    { "id": "roadmap-fragmentation", "severity": "critical", "message": "canonicalRoadmaps is 3 — multiple competing roadmaps fragment the through-line and make \"linked\" ambiguous." },
    { "id": "status-without-evidence", "severity": "critical", "message": "Work unit \"phase3-visibility-item\" reports status \"done\" with zero progressEvidence entries — this is a claim, not a fact.", "workUnitId": "phase3-visibility-item" },
    { "id": "untracked-work", "severity": "critical", "message": "Work unit \"random-cli-tweak\" (sidequest) has neither roadmapLink nor optOutReason — it runs untracked.", "workUnitId": "random-cli-tweak" },
    { "id": "spawn-not-captured", "severity": "high", "message": "Work unit \"random-cli-tweak\" spawned 3 new item(s) but captured 0 back into the roadmap — spawned work is being lost.", "workUnitId": "random-cli-tweak" },
    { "id": "link-and-opt-out-conflict", "severity": "medium", "message": "Work unit \"db-fragmentation-fix\" carries both a roadmapLink and an optOutReason — these are mutually exclusive.", "workUnitId": "db-fragmentation-fix" },
    { "id": "untracked-work", "severity": "critical", "message": "Work unit \"mystery-cleanup\" (sidequest) has neither roadmapLink nor optOutReason — it runs untracked.", "workUnitId": "mystery-cleanup" },
    { "id": "reconciliation-cadence-missing", "severity": "high", "message": "No reconciliationCadenceDays set — nothing forces sidequest/burst work to periodically fold back into the roadmap." }
  ],
  "recommendations": [
    "Consolidate into exactly one canonical roadmap; demote or archive the rest to history/ADRs.",
    "Attach at least one commit/PR/receipt reference to \"phase3-visibility-item\" before trusting its \"done\" status.",
    "Add a Roadmap-Item link for \"random-cli-tweak\", or an explicit opt-out reason if it genuinely doesn't advance the roadmap.",
    "Create roadmap items (or explicit opt-outs) for the 3 thing(s) \"random-cli-tweak\" spawned, same as a Roadmap-Spawns trailer would require for a planning doc.",
    "Pick one: either \"db-fragmentation-fix\" links to a roadmap item, or it explicitly opts out. Not both.",
    "Add a Roadmap-Item link for \"mystery-cleanup\", or an explicit opt-out reason if it genuinely doesn't advance the roadmap.",
    "Set a reconciliation cadence of 14 days or less and actually run it."
  ]
}
```

Reading this: three competing roadmaps (a stale wishlist doc, the daemon's
real items, and someone's private notes) mean nothing can be verified as
"linked" with confidence. `phase3-visibility-item` is marked `done` on
nothing but its author's word. `random-cli-tweak` spawned three follow-on
tasks that evaporated. `mystery-cleanup` has no name for why it happened at
all. This is what an ignored-wishlist / status-theater failure looks like in
one JSON blob.

## Reconciliation Applied

- Archived the two competing roadmap docs; the daemon-backed snapshot is now
  the only canonical source (`canonicalRoadmaps: 1`).
- Attached the merge commit that actually shipped `phase3-visibility-item`.
- Fast-linked `random-cli-tweak` to a new roadmap item created for it, and
  created two more roadmap items (with commits) for two of its three spawned
  follow-ons; the third was explicitly killed as a duplicate (opt-out with
  reason, not silently dropped).
- Resolved the `db-fragmentation-fix` link/opt-out conflict by keeping the
  link (it does advance a real item) and dropping the leftover opt-out text.
- `mystery-cleanup` turned out to be a real, useful chore; gave it an
  explicit opt-out reason rather than forcing a roadmap item onto a
  one-off.
- Set `reconciliationCadenceDays: 7` going forward — this sprawl accumulated
  in under two weeks, so weekly reconciliation is the right cadence here.

## After: Reconciled (legible)

```json
{
  "canonicalRoadmaps": 1,
  "reconciliationCadenceDays": 7,
  "policy": { "linkOrOptOutRequired": true, "maxReconciliationCadenceDays": 14 },
  "workUnits": [
    { "id": "phase3-visibility-item", "kind": "planned", "roadmapLink": "phase3-visibility-item", "progressEvidence": ["commit:9f31aa2", "pr:601"], "status": "done" },
    { "id": "random-cli-tweak", "kind": "sidequest", "roadmapLink": "cli-tweak-followups", "spawnedItems": 3, "spawnedItemsCaptured": 3, "progressEvidence": ["commit:abc123"], "status": "in-progress" },
    { "id": "db-fragmentation-fix", "kind": "sidequest", "roadmapLink": "db-fragmentation-fix", "progressEvidence": ["commit:def456"], "status": "in-progress" },
    { "id": "mystery-cleanup", "kind": "sidequest", "optOutReason": "one-off lint config chore, not roadmap-worthy", "progressEvidence": ["commit:aa11bb2"], "status": "done" }
  ]
}
```

Run: `node scripts/roadmap_legibility.mjs --input reconciled-window.json`

```json
{
  "pass": true,
  "legibilityScore": 1,
  "findings": [],
  "recommendations": [
    "Roadmap is legible: one canonical source, every work unit traceable, spawns captured, status evidenced, reconciliation cadenced. Keep it that way — re-run this audit at every reconciliation."
  ]
}
```

Nothing about the *sidequests themselves* changed — the same energy-driven
work happened either way. What changed is that every unit now carries a
one-line link/opt-out, every spawned item was captured or explicitly killed,
and every "done"/"in-progress" claim points at a real commit or PR. That's
the entire cost of legibility, paid once, and it's what makes the next
reconciliation pass trustworthy instead of another audit of vibes.
