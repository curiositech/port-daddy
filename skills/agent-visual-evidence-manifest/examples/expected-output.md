# Example Output: Agent Visual Evidence Manifest

Scenario: an agent finishes a control-panel change, attaches two screenshots to the PR, and reuses a GIF from last week's branch for the "live active stream" state because recapturing felt slower than shipping. The receipt screenshot's manifest never got a `sourceLabel`, and the PR only demonstrates two of the seven required control-panel states. This is the "bad manifest set" `proof_manifest_audit.mjs` is designed to catch.

## Bad manifest set — input

```json
{
  "branchCommit": "a94b726bff0011223344556677889900aabbccd",
  "isControlPanelPr": true,
  "statesCovered": ["active", "historical"],
  "artifacts": [
    {
      "file": ".github/assets/661/control-panel-active-stream.gif",
      "manifest": {
        "daemonPort": 9887,
        "runId": "run_01hx3qz7f6",
        "transcriptHeadHash": "sha256:4fae1c9d2b7a0e5f",
        "agentNodeId": "node-codex-7a2",
        "commit": "e80f6c3e00ffeeddccbbaa998877665544332211",
        "sourceLabel": "real"
      }
    },
    {
      "file": ".github/assets/661/control-panel-receipt-sealed.png",
      "manifest": {
        "runId": "run_01hx3qz7fb",
        "transcriptHeadHash": "sha256:dd66ee77ff880011",
        "agentNodeId": "node-codex-7a2",
        "commit": "a94b726bff0011223344556677889900aabbccd"
      }
    }
  ]
}
```

## Bad manifest set — audit result

```json
{
  "pass": false,
  "score": 52,
  "findings": [
    {
      "severity": "critical",
      "id": "commit-mismatch",
      "message": "Artifact \".github/assets/661/control-panel-active-stream.gif\" manifest.commit (\"e80f6c3e00ffeeddccbbaa998877665544332211\") does not match the PR's branch commit (\"a94b726bff0011223344556677889900aabbccd\")."
    },
    {
      "severity": "critical",
      "id": "manifest-missing-provenance-field",
      "message": "Artifact \".github/assets/661/control-panel-receipt-sealed.png\" manifest is missing required provenance field(s): daemonPort, sourceLabel."
    },
    {
      "severity": "critical",
      "id": "undeclared-source-label",
      "message": "Artifact \".github/assets/661/control-panel-receipt-sealed.png\" does not declare whether its data is real, fixture, or mock."
    },
    {
      "severity": "critical",
      "id": "control-panel-state-coverage-incomplete",
      "message": "Control-panel PR is missing proof-artifact coverage for required state(s): blocked, stale, gate, interrupt, receipt."
    }
  ],
  "recommendations": [
    "Regenerate \".github/assets/661/control-panel-active-stream.gif\" against the current branch commit — a stale-commit artifact is reused proof, not fresh evidence.",
    "Fill in daemonPort, sourceLabel on \".github/assets/661/control-panel-receipt-sealed.png\"'s manifest before it can count as daemon-backed proof.",
    "Label every artifact manifest sourceLabel as \"real\", \"fixture\", or \"mock\" — an undeclared label is indistinguishable from a disguised mock.",
    "Capture and manifest at least one artifact for each of: blocked, stale, gate, interrupt, receipt."
  ]
}
```

## What fixing it actually looked like

1. **Recaptured the active-stream GIF** against the current branch commit instead of reusing last week's — the daemon port, run id, and transcript head hash all changed because the flow itself changed.
2. **Filled in the receipt screenshot's manifest**: added `daemonPort` and, critically, `sourceLabel: "real"` — the sealed-receipt screenshot really was captured against a live daemon run, but the manifest never said so.
3. **Captured the five missing states**: blocked launch, stale-agent remediation, the approve/deny gate, an interrupt acknowledgement, and the historical replay — each with its own manifest bound to the same branch commit.
4. **Kept one artifact honestly labeled `"fixture"`** (an empty-state screenshot that doesn't need a live daemon) instead of forcing every artifact to claim `"real"` — the gate only requires the label be present and honest, not that every artifact be a live capture.

## Fixed manifest set — input

This is `examples/sample-input.json`, unmodified (all seven required states plus the empty-state fixture, every artifact's `commit` matching `branchCommit`):

```json
{
  "branchCommit": "a94b726bff0011223344556677889900aabbccd",
  "isControlPanelPr": true,
  "statesCovered": ["active", "historical", "blocked", "stale", "gate", "interrupt", "receipt"],
  "artifacts": [
    { "file": ".github/assets/661/control-panel-active-stream.gif", "manifest": { "daemonPort": 9887, "runId": "run_01hx3qz7f6", "transcriptHeadHash": "sha256:4fae1c9d2b7a0e5f", "agentNodeId": "node-codex-7a2", "commit": "a94b726bff0011223344556677889900aabbccd", "sourceLabel": "real" } },
    { "file": ".github/assets/661/control-panel-historical-replay.png", "manifest": { "daemonPort": 9887, "runId": "run_01hx3qz7f6", "transcriptHeadHash": "sha256:9be21a3f7c001de4", "agentNodeId": "node-codex-7a2", "commit": "a94b726bff0011223344556677889900aabbccd", "sourceLabel": "real" } },
    { "file": ".github/assets/661/control-panel-blocked-launch.png", "manifest": { "daemonPort": 9887, "runId": "run_01hx3qz7f7", "transcriptHeadHash": "sha256:0c88df51aa22bb33", "agentNodeId": "node-codex-7a2", "commit": "a94b726bff0011223344556677889900aabbccd", "sourceLabel": "real" } },
    { "file": ".github/assets/661/control-panel-stale-remediation.png", "manifest": { "daemonPort": 9887, "runId": "run_01hx3qz7f8", "transcriptHeadHash": "sha256:77aa11cc99dd22ee", "agentNodeId": "node-codex-7a2", "commit": "a94b726bff0011223344556677889900aabbccd", "sourceLabel": "real" } },
    { "file": ".github/assets/661/control-panel-approve-deny-gate.png", "manifest": { "daemonPort": 9887, "runId": "run_01hx3qz7f9", "transcriptHeadHash": "sha256:33ff00aa11bb22cc", "agentNodeId": "node-codex-7a2", "commit": "a94b726bff0011223344556677889900aabbccd", "sourceLabel": "real" } },
    { "file": ".github/assets/661/control-panel-interrupt-ack.gif", "manifest": { "daemonPort": 9887, "runId": "run_01hx3qz7fa", "transcriptHeadHash": "sha256:aa22bb33cc44dd55", "agentNodeId": "node-codex-7a2", "commit": "a94b726bff0011223344556677889900aabbccd", "sourceLabel": "real" } },
    { "file": ".github/assets/661/control-panel-receipt-sealed.png", "manifest": { "daemonPort": 9887, "runId": "run_01hx3qz7fb", "transcriptHeadHash": "sha256:dd66ee77ff880011", "agentNodeId": "node-codex-7a2", "commit": "a94b726bff0011223344556677889900aabbccd", "sourceLabel": "real" } },
    { "file": ".github/assets/661/control-panel-fixture-empty-state.png", "manifest": { "daemonPort": 9887, "runId": "run_01hx3qz7fc", "transcriptHeadHash": "sha256:1122334455667788", "agentNodeId": "node-codex-7a2", "commit": "a94b726bff0011223344556677889900aabbccd", "sourceLabel": "fixture" } }
  ]
}
```

## Fixed manifest set — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Proof-manifest gate satisfied: every artifact carries a full, branch-bound provenance manifest with an honest source label, and required state coverage is complete."
  ]
}
```

Note the one `sourceLabel: "fixture"` artifact: it does not block `pass:true`. The gate never demands every artifact be a live capture — it demands every artifact honestly say what it is, and that a control-panel PR's *state coverage* (not its label mix) be complete.
