# Changelog — content-security-policy-headers

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with
frontmatter; added deterministic audit helper (`scripts/csp_policy_audit.mjs`),
draft-07 schema (`schemas/csp-policy-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: strict-CSP baseline (nonce/hash + strict-dynamic, object-src
'none', base-uri 'none'), hash-based CSP for static apps, report-only rollout,
report-to vs report-uri, anti-patterns, and quality-gate checklist, grounded in
web.dev, OWASP, and the W3C CSP3 spec.
