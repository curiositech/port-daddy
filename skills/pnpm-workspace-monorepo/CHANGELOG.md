# Changelog — pnpm-workspace-monorepo

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/pnpm_workspace_monorepo_audit.mjs`), draft-07 schema
(`schemas/pnpm-workspace-monorepo-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: workspace layout with catalog protocol, --filter grammar (dot-ellipsis
direction), the .npmrc knobs that matter, packageExtensions for broken peers, Turborepo
wiring with declared inputs, TypeScript project references, CI install pattern with
--frozen-lockfile, anti-pattern catalog (implicit transitive deps, workspace:* leaks,
shamefully-hoist, turbo cache busts, catalog drift, lifecycle-script exposure), quality gates.
