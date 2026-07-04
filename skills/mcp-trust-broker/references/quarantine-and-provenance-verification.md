# Quarantine And Provenance Verification

Use this when a specific MCP server is requesting to exit quarantine and run
for real — the moment where "still under review" becomes "live in the
fleet's tool palette."

## Quarantine-until-reviewed is the default state

A newly discovered MCP server starts quarantined: its manifest may exist, but
nothing about it has been proven yet. While quarantined, an unset permission
scope or a not-yet-run smoke test is expected, not a defect — that's what
"under review" means. The auditor tracks these as medium findings
(`undeclared-permission-scope`, `broad-permission-scope`,
`sandbox-smoke-test-not-run`) precisely so they are not silently forgotten,
but they do not fail the audit on their own while `quarantine.exitRequested`
is `false`.

Everything changes the moment exit is requested.

## The four-legged exit gate

Quarantine exit is safe only when **all four** of the following are positively
proven — never when the record merely lacks an explicit failure signal. Each
leg maps to one critical finding in `scripts/mcp_admission_audit.mjs`:

| Leg | Positive proof required | Finding if missing |
| --- | --- | --- |
| Provenance | `provenance === 'signed'` AND `signatureVerified === true` | `quarantine-exit-without-provenance` |
| Sandbox smoke test | `sandboxSmokeTest === 'passed'` | `quarantine-exit-without-smoke-test` |
| Permission scope | `permissionScope === 'least-privilege'` | `quarantine-exit-undeclared-scope` |
| Team policy | `teamPolicy !== 'block'` | `team-policy-blocks-exit` |

Note the asymmetry: `unsigned`, `unknown`, `failed`, `not-run`, `broad`, and
`undeclared` are all treated identically at the exit gate — as "not proven."
This is deliberate. A server that failed its smoke test and a server that
never ran one are equally unsafe to admit; the gate does not partial-credit
"at least it's not a known failure."

## Why "signed" alone is not provenance

`provenance: 'signed'` with `signatureVerified: false` means someone read a
signature block and never checked it against a trusted key. That is a label,
not a proof. The auditor fires `signature-unverified` (high, unconditional —
not gated on quarantine exit) the moment those two fields disagree, and
folds the same condition into `quarantine-exit-without-provenance` at the
exit gate, where it becomes critical.

## Sandbox smoke test is a gate input, not a formality

The smoke test referenced here is the admission-time check that a server
starts, responds to its own manifested tool calls, and does not immediately
attempt something outside its declared scope. It is a lighter-weight,
narrower check than a full containment proof — for exhaustively adversarial
containment testing of a sandbox boundary itself (SSRF, path traversal,
resource exhaustion, secret exfiltration), that is a different skill's job;
see the pairs-with entry for `sandboxed-adversarial-test-harness`.

## Fail-closed discipline

Treat every one of the four legs as fail-closed:

- An unrecognized or malformed `provenance`/`permissionScope`/
  `sandboxSmokeTest` value should never be interpreted as "probably fine" —
  the schema enum constrains these to a closed set for exactly this reason.
- `teamPolicy: 'none'` is not equivalent to `'allow'`. Absence of a decision
  is not permission.
- A server can be admitted with a broad or undeclared scope *while still
  quarantined and not requesting exit* — that's the point of quarantine. The
  moment exit is requested, the bar becomes least-privilege only.
