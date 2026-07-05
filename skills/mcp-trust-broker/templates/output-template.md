# MCP Admission Audit: [Server Name]

## Install Card

- Manifest present: [yes/no]
- Provenance: [signed/unsigned/unknown] — signature verified: [yes/no]
- Permission scope: [least-privilege/broad/undeclared]
- Sandbox smoke test: [passed/failed/not-run]
- Health check wired: [yes/no]
- Disable/repair/uninstall: [yes/no]
- Usage trace: [yes/no]

## Quarantine State

- Exit requested: [yes/no]
- Team policy: [allow/approve/block/none]
- Write tools route through daemon policy: [yes/no]

## Admission Request (spec)

```json
{
  "server": {
    "name": "[server-name]",
    "manifestPresent": true,
    "provenance": "[signed/unsigned/unknown]",
    "signatureVerified": false,
    "permissionScope": "[least-privilege/broad/undeclared]",
    "sandboxSmokeTest": "[passed/failed/not-run]",
    "healthCheck": false,
    "hasDisableRepairUninstall": false,
    "usageTrace": false
  },
  "quarantine": { "exitRequested": false },
  "teamPolicy": "[allow/approve/block/none]",
  "writeToolsRouteThroughDaemonPolicy": false
}
```

Run:

```bash
node skills/mcp-trust-broker/scripts/mcp_admission_audit.mjs --input admission-request.json
```

## Admission Audit Result

Paste the `mcp_admission_audit.mjs` output here: `pass`, `score`, `findings`,
`recommendations`.

## Decision

- Admit / Keep Quarantined / Block: [decision]
- If keeping quarantined: [which findings must clear before the next review]
- If admitted: [scope granted, who signed off, where usage trace is tracked]
