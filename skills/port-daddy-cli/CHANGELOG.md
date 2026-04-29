# Port Daddy CLI Skill Changelog

## 2026-04-29

- Expanded Lookout/Documentarian release-surface ownership to include README, docs, website, Mac app/FleetBar documentation, SDK/CLI/MCP/OpenAPI references, and the agent skill.
- Documented project-agnostic fleet execution: `pd-fleet.yml` can live in arbitrary repos without requiring target-repo Port Daddy source files or `tsx`.
- Documented readable agent display names for `pd begin`, `pd agent`, `/sugar/begin`, `/spawn`, and fleet-triggered spawns while keeping technical IDs stable.
- Added Coordination Guard to the quick command table as the enforceable commit-time coordination path.

## 2026-04-26

- Added first-party skill metadata, license, allowed-tool declaration, and mirror locations.
- Added an explicit Navigator/Cartographer and Lookout actor workflow for roadmap, what-next, recovery-map, and skill/docs drift questions.
- Clarified that actor mailbox delivery is durable coordination evidence, not an immediate answer.
- Added ambient peer coordination guidance: agents should publish structured facts and escalate only material inconsistencies, not force constant peer chat.
- Added goal/invariant-level inconsistency guidance for security, auth, privacy, trust-boundary, API-shape, and product-direction drift.
- Added deterministic skill governance audit tooling and tests for repo-wide skill scanning.
- Recorded that skill edits must update the skill, references, tests, changelog, and installed/workgroup mirrors together.
