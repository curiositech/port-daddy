# Changelog — dockerfile-build-cache-mastery

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with
frontmatter; added deterministic audit helper (`scripts/docker_build_audit.mjs`),
draft-07 schema (`schemas/docker-build-plan.schema.json`), verified sample
input (`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: layer-ordering thesis (invalidate as few layers as
possible), decision-diagram flowchart, BuildKit cache/secret mounts,
multi-stage + distroless-vs-alpine table, registry cache exporters, multi-arch
buildx, cosign signing, the 14-minute-CI worked example, anti-patterns, and
quality-gate checklist.
