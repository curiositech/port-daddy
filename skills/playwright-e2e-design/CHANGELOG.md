# Changelog — playwright-e2e-design

## [0.2.0] — 2026-07-04

Brought to the agentic-family standard: added io-contract/provenance/pairs-with frontmatter;
added deterministic audit helper (`scripts/playwright_e2e_design_audit.mjs`), draft-07 schema
(`schemas/playwright-e2e-design-plan.schema.json`), verified sample input
(`examples/sample-input.json`); added Quality Gates.

## [0.1.0]

Initial authoring: locator tier table (getByRole first, CSS last), web-first vs snapshot-read
assertions, replacing sleeps with auto-waiting, storageState auth reuse via a setup project,
test isolation, page.route() network mocking, trace-on-first-retry, parallelism and sharding,
lightweight page objects, soft assertions, anti-pattern catalog, quality gates, grounded in
the official Playwright best-practices/actionability/assertions docs.
