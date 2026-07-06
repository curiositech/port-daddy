# Tracker Item Plan Template

[One-sentence description of the batch of tracker work this plan covers.]

```json
{
  "policy": {
    "requireAcceptanceCriteria": true,
    "requireDedupeSearch": true,
    "requireLinkedArtifactForActiveWork": true,
    "requireEvidenceForDone": true,
    "minLegibilityScore": 0.75
  },
  "items": [
    {
      "id": "[tracker issue key or slug, e.g. PROJ-123 or a-descriptive-slug]",
      "title": "[short, specific title — not a vague area of the codebase]",
      "status": "[todo|in-progress|done]",
      "hasAcceptanceCriteria": false,
      "dedupeSearched": false,
      "linkedArtifacts": ["[branch:... | PR #... | commit:...]"],
      "evidenceOnDone": null,
      "spawnedItemsCaptured": null
    }
  ]
}
```

Fill in one object per item you handled in this session. Leave `evidenceOnDone`
as `null` unless `status` is `"done"`, in which case it must be
`{ "type": "pr"|"commit"|"artifact"|"other", "ref": "[what a reviewer opens]", "validated": true }`.
Leave `spawnedItemsCaptured` as `null` unless this item surfaced new work
mid-task; set it to `true` only after that work is actually filed as its own
item(s).

Validate with `node scripts/issue_hygiene.mjs --input <this-file-as-json>.json`
before treating the batch as clean — the audit will catch a `done` item with
no validated evidence, an unsearched item, or an item with nothing linking it
to a diff.
