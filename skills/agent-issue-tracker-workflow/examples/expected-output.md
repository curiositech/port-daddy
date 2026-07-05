# Example Output: Agent Issue Tracker Workflow

Scenario: an agent closes out two Jira-style items in one session — `PROJ-501`
("fix flaky upload retry") and `PROJ-502`, filed independently by a second
agent working the same area without checking first. Below is the weak plan as
originally reported, the audit that catches it, and the fixed plan that passes.

## Before: weak tracker hygiene

```json
{
  "items": [
    {
      "id": "PROJ-501",
      "title": "Fix flaky upload retry",
      "status": "done",
      "hasAcceptanceCriteria": false,
      "dedupeSearched": false,
      "linkedArtifacts": [],
      "evidenceOnDone": null,
      "spawnedItemsCaptured": false
    },
    {
      "id": "PROJ-502",
      "title": "Fix flaky upload retry (dup)",
      "status": "in-progress",
      "hasAcceptanceCriteria": true,
      "dedupeSearched": false,
      "linkedArtifacts": [],
      "evidenceOnDone": null,
      "spawnedItemsCaptured": null
    }
  ]
}
```

```
$ node scripts/issue_hygiene.mjs --input weak-plan.json
{
  "pass": false,
  "legibilityScore": 0,
  "findings": [
    { "id": "missing-acceptance-criteria", "itemId": "PROJ-501", "severity": "critical",
      "message": "PROJ-501 has no acceptance criteria; there is nothing explicit a reviewer can check the work against." },
    { "id": "orphan-work", "itemId": "PROJ-501", "severity": "critical",
      "message": "PROJ-501 is \"done\" but has no linked branch, PR, or commit; the work is not traceable item -> diff." },
    { "id": "status-theater", "itemId": "PROJ-501", "severity": "critical",
      "message": "PROJ-501 is marked \"done\" but evidenceOnDone is missing or unvalidated; a status transition to done must reflect observed, checked work, not optimism." },
    { "id": "no-dedupe-search", "itemId": "PROJ-501", "severity": "high",
      "message": "\"Fix flaky upload retry\" (PROJ-501) was not confirmed searched against the existing tracker before filing/starting; a duplicate may already exist." },
    { "id": "no-dedupe-search", "itemId": "PROJ-502", "severity": "high",
      "message": "\"Fix flaky upload retry (dup)\" (PROJ-502) was not confirmed searched against the existing tracker before filing/starting; a duplicate may already exist." },
    { "id": "orphan-work", "itemId": "PROJ-502", "severity": "high",
      "message": "PROJ-502 is \"in-progress\" but has no linked branch, PR, or commit; the work is not traceable item -> diff." },
    { "id": "uncaptured-spawned-work", "itemId": "PROJ-501", "severity": "medium",
      "message": "PROJ-501 surfaced new work mid-task that was not captured as new tracker items; this risks silent scope creep on the current item." }
  ],
  "recommendations": [
    "Search the tracker for \"Fix flaky upload retry\" before continuing PROJ-501; if a match exists, close this one as a duplicate and link it instead.",
    "Add explicit, checkable acceptance criteria to PROJ-501 before marking it further along than todo.",
    "Link PROJ-501 to its branch/PR/commit (e.g. a Roadmap-Item/issue-key trailer or PR reference) so the item traces to its diff.",
    "Do not move PROJ-501 to done until you have a validated evidence.ref (PR/commit/artifact) that a reviewer can open and check.",
    "File the newly-discovered work under PROJ-501 as its own item(s) instead of folding it into this one's scope.",
    "Search the tracker for \"Fix flaky upload retry (dup)\" before continuing PROJ-502; if a match exists, close this one as a duplicate and link it instead.",
    "Link PROJ-502 to its branch/PR/commit (e.g. a Roadmap-Item/issue-key trailer or PR reference) so the item traces to its diff."
  ]
}
```

This is a textbook duplicate-issue spray plus status theater: `PROJ-502` is a
near-duplicate of `PROJ-501` that a five-second search would have caught,
`PROJ-501` was marked `done` on narration alone (no PR, no diff), and the
retry-hardening tweak discovered mid-task vanished into `PROJ-501`'s diff
instead of becoming its own item.

## After: fixed

`PROJ-502` is closed as a duplicate and linked back to `PROJ-501`. `PROJ-501`
is reopened, given real acceptance criteria, done properly with a linked PR,
and the discovered retry-hardening work is filed as its own item.

```json
{
  "items": [
    {
      "id": "PROJ-501",
      "title": "Fix flaky upload retry: retry with backoff on transient 503 from S3",
      "status": "done",
      "hasAcceptanceCriteria": true,
      "dedupeSearched": true,
      "linkedArtifacts": ["PR #918", "commit:7c2e9a1"],
      "evidenceOnDone": { "type": "pr", "ref": "PR #918", "validated": true },
      "spawnedItemsCaptured": true
    }
  ]
}
```

```
$ node scripts/issue_hygiene.mjs --input fixed-plan.json
{
  "pass": true,
  "legibilityScore": 1,
  "findings": [],
  "recommendations": [
    "Plan is legible: every active item is searched, actionable, linked, and (if done) evidenced. Spot-check that a linked artifact actually matches the item before trusting the score."
  ]
}
```

What changed: `dedupeSearched` is now honestly `true` (and `PROJ-502` no
longer exists as an independent item — it's closed with a "duplicate of
PROJ-501" link, which is why it drops out of this plan entirely),
`hasAcceptanceCriteria` states a checkable condition in the title itself,
`linkedArtifacts` traces the item to a real PR and commit, `evidenceOnDone`
points at a `validated: true` reference a reviewer can open, and the
retry-hardening follow-up is filed and tracked separately instead of
inflating `PROJ-501`'s scope.
