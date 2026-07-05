# Example Output: Architecture Binder Of Record

Scenario: a binder run claims a chapter's headline capability ("Work Intent is
the sole launch primitive") with an owner but no acceptance gate and no
evidence link, lists a whole chapter with zero enumerated capabilities, leaves
an authority contradiction between two chapters unresolved, drops an ambition
into the corpus with no classification, and marks the architecture coverage
axis complete when a row is actually still open. This is the "incomplete
binder" `binder_coverage_audit.mjs` is designed to catch.

## Weak binder — input

```json
{
  "documents": [
    {
      "name": "01-product-and-surfaces.md",
      "claimedCapabilities": [
        { "name": "Work Intent is the sole launch primitive", "owner": "Harbor Architect of Record", "gate": null, "evidenceLink": "" }
      ]
    },
    {
      "name": "13-platform-plays-and-runtime-surface-review.md",
      "claimedCapabilities": []
    }
  ],
  "contradictions": [
    { "kind": "authority", "resolved": false },
    { "kind": "term", "resolved": true }
  ],
  "ambitionCorpus": [
    { "name": "Harbor Economy / Trust-as-a-Service", "classification": null },
    { "name": "Publisher SDKs", "classification": "absorbed" }
  ],
  "coverageMatrix": {
    "customerAxisComplete": true,
    "contingencyAxisComplete": true,
    "architectureAxisComplete": false
  }
}
```

## Weak binder — audit result

```json
{
  "pass": false,
  "score": 48,
  "findings": [
    { "severity": "critical", "id": "capability-without-owner-gate-evidence", "message": "Capability \"Work Intent is the sole launch primitive\" in \"01-product-and-surfaces.md\" is missing gate, evidenceLink — a claim without a proof." },
    { "severity": "medium", "id": "document-without-capabilities", "message": "Document \"13-platform-plays-and-runtime-surface-review.md\" lists zero claimed capabilities — nothing in it is covered or falsifiable yet." },
    { "severity": "critical", "id": "unresolved-contradiction", "message": "Unresolved authority contradiction (contradictions[0]) — two chapters disagree and no fix has landed." },
    { "severity": "critical", "id": "ambition-unclassified", "message": "Ambition \"Harbor Economy / Trust-as-a-Service\" has no classification — accidental amnesia, not a decision." },
    { "severity": "critical", "id": "coverage-axis-incomplete", "message": "Coverage axis \"architectureAxisComplete\" is not complete." }
  ],
  "recommendations": [
    "Assign an accountable owner, a testable acceptance gate, and a link to real evidence for \"Work Intent is the sole launch primitive\" before citing it as covered.",
    "Enumerate \"13-platform-plays-and-runtime-surface-review.md\"'s claimed capabilities explicitly, or note it as narrative-only if it makes no capability claims.",
    "Resolve the authority contradiction with a source-linked fix, or mark the affected section \"blocked pending synthesis\" until it is.",
    "Classify \"Harbor Economy / Trust-as-a-Service\" as absorbed, superseded, deferred, contradicted, orphaned, or rejected, with a rationale and a destination.",
    "Fill every row of the \"architectureAxisComplete\" coverage matrix (owner, status, gate, failure mode, recovery path, source) before calling the binder complete.",
    "binder-aor-log: <ISO timestamp> | window <last-entry>..now | documents scanned: 2 | capabilities: 0/1 owner+gate+evidence complete | contradictions: 1/2 resolved | ambitions classified: 1/2 | coverage axes: 2/3 complete | confidence: 48/100 | handover: start with capability-without-owner-gate-evidence (Capability \"Work Intent is the sole launch primitive\" in \"01-product-and-surfaces.md\" is missing gate, evidenceLink — a claim without a proof.)"
  ]
}
```

## What fixing it actually looked like

1. **Gave the Work Intent capability real proof.** Added `gate: "acceptance test: work-intent-conformance-suite"` and `evidenceLink` pointing at the PR that shipped and tested it, instead of leaving owner-only prose.
2. **Enumerated the empty chapter's capabilities.** `13-platform-plays-and-runtime-surface-review.md` got its actual claimed capability ("pd-console is the sanctioned desktop operator surface") written down with the same owner/gate/evidence triple.
3. **Resolved the authority contradiction.** The two chapters that disagreed about which surface is authoritative were reconciled with a source-linked fix (surface-consolidation PR), and the contradiction's `resolved` flag flipped to `true`.
4. **Classified the ambition.** "Harbor Economy / Trust-as-a-Service" was not dropped or ignored — it was explicitly marked `deferred` with named prerequisites, giving it a destination instead of accidental amnesia.
5. **Closed the architecture coverage gap.** The missing row in the architecture-consistency matrix got an owner, status, gate, failure mode, recovery path, and source before `architectureAxisComplete` flipped to `true`.

## Fixed binder — input

This is `examples/sample-input.json`, unmodified:

```json
{
  "documents": [
    {
      "name": "01-product-and-surfaces.md",
      "claimedCapabilities": [
        {
          "name": "Work Intent is the sole launch primitive",
          "owner": "Harbor Architect of Record",
          "gate": "acceptance test: work-intent-conformance-suite",
          "evidenceLink": "https://github.com/port-daddy/port-daddy/pull/632"
        }
      ]
    },
    {
      "name": "13-platform-plays-and-runtime-surface-review.md",
      "claimedCapabilities": [
        {
          "name": "pd-console is the sanctioned desktop operator surface",
          "owner": "Harbor Architect of Record",
          "gate": "surface-consolidation acceptance checklist",
          "evidenceLink": "https://github.com/port-daddy/port-daddy/pull/652"
        }
      ]
    }
  ],
  "contradictions": [
    { "kind": "authority", "resolved": true },
    { "kind": "term", "resolved": true }
  ],
  "ambitionCorpus": [
    { "name": "Harbor Economy / Trust-as-a-Service", "classification": "deferred" },
    { "name": "Publisher SDKs", "classification": "absorbed" }
  ],
  "coverageMatrix": {
    "customerAxisComplete": true,
    "contingencyAxisComplete": true,
    "architectureAxisComplete": true
  }
}
```

## Fixed binder — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Binder meets the completeness bar: every capability proven, every contradiction resolved, every ambition classified, all three coverage axes complete.",
    "binder-aor-log: <ISO timestamp> | window <last-entry>..now | documents scanned: 2 | capabilities: 2/2 owner+gate+evidence complete | contradictions: 2/2 resolved | ambitions classified: 2/2 | coverage axes: 3/3 complete | confidence: 100/100 | handover: no critical findings; re-verify evidence links still resolve and continue the ambition sweep for newly added corpus sources."
  ]
}
```

Note the mandatory `binder-aor-log:` line is emitted on both the failing and
passing run — the ledger is written every time, including a run that finds
nothing wrong. The `<ISO timestamp>` and `<last-entry>..now` placeholders are
filled in by whoever writes the actual `pd note`, not by the deterministic
scorer, so the same input always produces the same score and findings.
