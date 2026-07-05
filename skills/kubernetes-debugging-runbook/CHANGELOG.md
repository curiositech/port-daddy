# Changelog — kubernetes-debugging-runbook

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/kubernetes_debugging_runbook_audit.mjs`), draft-07
schema (`schemas/k8s-triage-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: the triage sequence (describe → --previous logs → events), the pod-status
decoding table, playbooks for CrashLoopBackOff / OOMKilled / ImagePullBackOff / Pending /
no-endpoints / in-cluster networking / HPA / evictions, six anti-patterns, and the
quality-gate checklist.
