# Worked Example: Security Audit DAG with a TENTATIVE Remediation Wave

## Scenario

An agent is executing a 3-wave DAG to audit and remediate a Python service's dependencies. Wave 1 scans for CVEs. Wave 2 (TENTATIVE) patches them — tentative because the patch count and conflict risk are unknown until wave 1 completes. Wave 3 runs integration tests. The premortem returned `ACCEPT_WITH_MONITORING` due to medium-severity risk of breaking API contracts during patching.

---

## Step-by-Step Execution

### After Wave 1 completes

Wave 1 produced these outputs:

```
waveOutputs = {
  "scan-deps":  { cve_count: 3, affected: ["requests==2.28", "cryptography==38"] },
  "scan-code":  { findings: ["hardcoded secret in config.py"] },
}
```

The executor reaches the parley checkpoint before Wave 2.

### `shouldParley` check

```python
upcomingWave.nodes = [
  { id: "patch-deps",   commitment_level: "TENTATIVE" },
  { id: "patch-secret", commitment_level: "COMMITTED" },
]

premortem.recommendation = "ACCEPT_WITH_MONITORING"

# hasUncertain = True  ("patch-deps" is TENTATIVE)
# requiresByPremortem = True  (ACCEPT_WITH_MONITORING)
# => shouldParley returns True
```

Parley fires.

### Risk re-evaluation (Step 2 inside `parley`)

The premortem had one medium-severity risk:

```
risk = {
  description: "Patch may break requests API surface used in auth module",
  severity: "medium",
  affected_nodes: ["scan-deps", "patch-deps"]
}
```

`scan-deps` is in `completedWaveOutputs`, so `hasEvidence = True`. `reassessRisk` calls the LLM with the CVE list and the affected API surface. Result:

```
updated.severity = "low"   # requests bump is 2.28→2.31, no breaking changes
resolvedRisks = ["Patch may break requests API surface used in auth module"]
escalatedRisks = []
```

### Node commitment decision (Step 3)

`evaluateNodeCommitment` is called for `patch-deps` with the scan output as evidence:

```python
# Evidence: 3 CVEs, 2 packages, patch paths are straightforward
decision = {
  action: "promote",
  new_commitment_level: "COMMITTED",
  rationale: "CVE count is small, no version conflict detected by scan"
}
mutations = [decision]
```

### Parley result

```python
{ action: "proceed", mutations: [promote patch-deps → COMMITTED],
  resolvedRisks: ["Patch may break..."], escalatedRisks: [] }
```

`applyMutations` updates Wave 2. Both nodes are now COMMITTED. Wave 2 launches.

---

## Expected Output

Wave 3 (integration tests) runs against a patched, secret-free service. The parley took one LLM call (risk reassessment) plus one (node evaluation) — roughly 2–4 seconds. No human gate was needed because all escalated risks resolved to low.

---

## Failure Modes

**1. Risk escalates instead of resolves.**
If `scan-deps` had found 40 CVEs with major version jumps, `reassessRisk` would return `severity: "high"`. Combined with `ACCEPT_WITH_MONITORING`, parley would push the risk into `escalatedRisks`. Since `recommendation` is not `ESCALATE_TO_HUMAN`, execution still proceeds — but `patch-deps` would likely be demoted to `EXPLORATORY` and pushed out of Wave 2, preventing a risky bulk patch from running blind. Recovery: the executor schedules an additional parley-only wave to re-evaluate after a targeted manual patch.

**2. Parley called mid-wave by mistake.**
If someone triggers `parley()` while Wave 1 agents are still running, `completedWaveOutputs` is incomplete — `scan-code` may be missing, so risks keyed to it are silently skipped and `patch-secret` runs without its dependency evidence. Guard: the executor must only call `parley` after the `Promise.all` (or equivalent) for the current wave resolves. Never call it on partial output.
