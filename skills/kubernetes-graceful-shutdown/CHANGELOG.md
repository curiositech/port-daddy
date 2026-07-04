# Changelog — kubernetes-graceful-shutdown

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/kubernetes_graceful_shutdown_audit.mjs`), draft-07
schema (`schemas/graceful-shutdown-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: the EndpointSlice removal race, the ordered pod-termination sequence,
the preStop sleep recipe (with the Kubernetes 1.29+ native sleep action), grace-period
budgeting, Node.js and Go drain skeletons, anti-patterns, and quality-gate checklist.
Grounded in kubernetes.io lifecycle/EndpointSlice docs and language runtime docs.
