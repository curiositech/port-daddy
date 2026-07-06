# Containment Audit: [Sandbox/Surface Name]

## Isolation Boundary

- Filesystem: [jail root path] — [allowlist/denylist mode]
- Network: [default deny/allow] — [allowlisted hosts, if any]
- Secrets: [fake-credentials / redacted / real] exposed to sandbox: [yes/no]
- Process/resources: [pids.max / RLIMIT_NPROC / timeout mechanism]

## Adversary Goals

| Threat class | Concrete goal in this context | In scope? |
| --- | --- | --- |
| ssrf | [e.g. reach the agent's cloud metadata service via a webhook output sink] | [yes/no] |
| path-traversal | [e.g. write outside the ephemeral worktree via a file output sink] | [yes/no] |
| secret-exfil | [e.g. exfiltrate a fake API key via DNS or an allowlisted-looking redirect] | [yes/no] |
| resource-exhaustion | [e.g. fork bomb from a spawned agent's shell tool] | [yes/no] |
| side-effect-write | [e.g. write to ~/.ssh or a git hook from sandboxed code] | [yes/no] |

## Harness Spec

```json
{
  "name": "[surface-name]",
  "isolationDimensions": ["filesystem", "network", "secrets", "process", "resources"],
  "egressPolicy": { "mode": "allowlist", "default": "deny", "allow": [] },
  "pathPolicy": { "mode": "allowlist", "jailRoot": "[path]", "realpathChecked": true },
  "secretHandling": { "mode": "fake-credentials", "exposedToSandbox": true },
  "adversarialCases": [
    { "id": "[id]", "invariant": "[what must hold]", "threatClass": "[class]", "expected": "contained", "failMode": "fail-closed" }
  ],
  "failMode": "fail-closed"
}
```

Run:

```bash
node skills/sandboxed-adversarial-test-harness/scripts/containment_audit.mjs --input harness-spec.json
```

## Containment Report

Paste the `containment_audit.mjs` output here: `pass`, `coverageByThreatClass`,
`findings`, `recommendations`.

## Residual Risks (Not Yet Closed)

- [Named risk] — [why it's not yet defeated] — [what would close it]

## Gating Decision

- Pass / Block: [decision]
- If blocked: [which findings must clear before re-running]
- If passed with residuals: [who signs off, and where the residuals are tracked]
