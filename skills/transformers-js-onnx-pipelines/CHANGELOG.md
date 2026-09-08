# Changelog — transformers-js-onnx-pipelines

## [0.3.0] — 2026-09-01

Supplanted the locally derived embedding-space identity with the canonical registry's
complete v2 profile. The schema, sample, auditor, and skill now require exact model and
model-config, tokenizer, and tokenizer-config artifacts and digests; preprocessing,
coordinate, transport, and storage coordinates; degraded/declarative bindings; and
loader/profile alignment while keeping loader weight dtype separate. Declarative-only
vectors are restricted to ephemeral-uncompared or quarantined-uncompared disposition;
they cannot enter an ordinary index, similarity comparison, or mint ResourceScope
compatibility. The auditor rejects legacy v1 declarations and never reimplements the
registry hash or invents producer-attestation authority.

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/transformers_js_onnx_pipelines_audit.mjs`),
draft-07 schema (`schemas/transformers-js-onnx-pipelines-plan.schema.json`), verified sample
input (`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: bi-encoder embeddings, the cross-encoder softmax-over-1 bypass, lazy
loading and CI cache strategy, offline corpus builds, browser-side inference, anti-patterns,
and quality gates.
