# MCP Trust Broker

Procedural guidance for vetting a third-party MCP server before it can run —
install cards, provenance/signature verification, least-privilege capability
mapping, a sandbox smoke test, quarantine-until-reviewed, and team
allow/approve/block policy.

Use this skill when a new MCP server has been discovered or proposed for the
fleet's tool palette and someone needs to decide: admit it, keep it
quarantined pending more evidence, or block it outright.

## Quick Start

1. Read `SKILL.md`.
2. Load `references/mcp-minimum-contract.md` for the six required install-card
   fields (manifest, provenance, permission label, health check,
   disable/repair/uninstall, usage trace) and why `teamPolicy: 'none'` is not
   a safe default.
3. Load `references/quarantine-and-provenance-verification.md` for the
   four-legged quarantine-exit gate and why each leg must be positively
   proven, not merely "not failing."
4. Build an admission-request spec covering the server's install-card state,
   whether quarantine exit is being requested, team policy, and whether write
   tools route through daemon policy.
5. Run `node scripts/mcp_admission_audit.mjs --input admission-request.json`.
6. Gate quarantine exit on `pass: true`; a non-passing result is a blocker,
   not an FYI.

The audit is a static check of the evidence on file — it does not itself run
the sandbox smoke test or verify a signature. A passing result means the
admission record is complete enough, and every quarantine-exit leg proven
enough, to let the server run for real.
