# Example Output: MCP Trust Broker

Scenario: `acme-widgets-mcp`, a third-party MCP server discovered via the
official registry, is being reviewed for admission into the fleet's tool
palette (Agent Harbor Platform Play #1, "MCP Port Authority").

## Weak Spec (First Pass — Rushed Admission)

The publisher asked for quarantine exit immediately, before review actually
happened:

```json
{
  "server": {
    "name": "acme-widgets-mcp",
    "manifestPresent": true,
    "provenance": "unsigned",
    "signatureVerified": false,
    "permissionScope": "broad",
    "sandboxSmokeTest": "not-run",
    "healthCheck": false,
    "hasDisableRepairUninstall": false,
    "usageTrace": false
  },
  "quarantine": { "exitRequested": true },
  "teamPolicy": "none",
  "writeToolsRouteThroughDaemonPolicy": false
}
```

```bash
node skills/mcp-trust-broker/scripts/mcp_admission_audit.mjs --input weak-spec.json
```

```json
{
  "pass": false,
  "score": 0,
  "findings": [
    { "severity": "high", "id": "no-health-check", "message": "Server 'acme-widgets-mcp' has no runtime health check wired up." },
    { "severity": "high", "id": "no-lifecycle-controls", "message": "Server 'acme-widgets-mcp' is missing disable/repair/uninstall lifecycle controls." },
    { "severity": "medium", "id": "no-usage-trace", "message": "Server 'acme-widgets-mcp' does not emit a usage trace." },
    { "severity": "high", "id": "no-team-admission-policy", "message": "No team admission policy (allow/approve/block) is set for 'acme-widgets-mcp'." },
    { "severity": "critical", "id": "write-tool-bypasses-daemon-policy", "message": "Server 'acme-widgets-mcp' has write tools that do not route through daemon policy." },
    { "severity": "critical", "id": "quarantine-exit-without-provenance", "message": "Quarantine exit was requested for 'acme-widgets-mcp' without proven provenance (signed AND signature-verified)." },
    { "severity": "critical", "id": "quarantine-exit-without-smoke-test", "message": "Quarantine exit was requested for 'acme-widgets-mcp' without a passed sandbox smoke test (status: 'not-run')." },
    { "severity": "critical", "id": "quarantine-exit-undeclared-scope", "message": "Quarantine exit was requested for 'acme-widgets-mcp' with a non-least-privilege permission scope ('broad')." }
  ],
  "recommendations": [
    "Wire acme-widgets-mcp into 'pd doctor' (or the equivalent runtime health probe) before admitting it.",
    "Add disable/repair/uninstall affordances for acme-widgets-mcp — the minimum MCP contract requires all three.",
    "Wire acme-widgets-mcp's invocations into the usage/failure trace so admins can see call volume and failures, not just install state.",
    "Set an explicit teamPolicy for acme-widgets-mcp — 'none' leaves admission ungoverned.",
    "Route every write-capable tool acme-widgets-mcp exposes through daemon policy before it is admitted at any scope.",
    "Do not exit quarantine until acme-widgets-mcp's provenance is 'signed' and signatureVerified is true.",
    "Run the sandbox smoke test for acme-widgets-mcp to completion and require 'passed' before exit.",
    "Require acme-widgets-mcp to declare and be scoped to least-privilege before exit; undeclared or broad scope must not exit quarantine."
  ]
}
```

Four critical findings and `score: 0` — this is not "almost ready," it is a
publisher asking to skip review entirely. Correct decision: keep quarantined,
send the finding list back to the publisher.

## Fixed Spec (After Remediation)

The publisher signs their release, wires health/lifecycle/usage-trace
affordances, scopes down to least-privilege, and the team sets an explicit
approval policy before re-requesting exit:

```json
{
  "server": {
    "name": "acme-widgets-mcp",
    "manifestPresent": true,
    "provenance": "signed",
    "signatureVerified": true,
    "permissionScope": "least-privilege",
    "sandboxSmokeTest": "passed",
    "healthCheck": true,
    "hasDisableRepairUninstall": true,
    "usageTrace": true
  },
  "quarantine": { "exitRequested": true },
  "teamPolicy": "approve",
  "writeToolsRouteThroughDaemonPolicy": true
}
```

```bash
node skills/mcp-trust-broker/scripts/mcp_admission_audit.mjs --input fixed-spec.json
```

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": []
}
```

## Decision

- Weak spec: **Keep Quarantined.** Four critical findings (`write-tool-bypasses-daemon-policy`,
  `quarantine-exit-without-provenance`, `quarantine-exit-without-smoke-test`,
  `quarantine-exit-undeclared-scope`) plus four minimum-contract gaps. Do not
  admit; do not let a rushed exit request override the gate.
- Fixed spec: **Admit at least-privilege scope**, `teamPolicy: 'approve'`
  reviewer of record noted, usage trace tracked in the fleet's MCP usage
  dashboard, re-audit on any binary or manifest change (a changed binary
  invalidates the proven signature, per `references/quarantine-and-provenance-verification.md`).
