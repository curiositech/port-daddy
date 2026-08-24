# Changelog — agentic-software-installation

All notable changes to this skill are documented here. This skill encodes
date- and vendor-versioned knowledge (CLI hook surfaces evolve), so the
changelog is load-bearing — temporal claims rot silently without it.

## [Unreleased]

### Added
- Initial skill: detect installed agent CLIs (`claude`, `codex`, `gemini`,
  `agy`) and wire the Giant Squid Harness tentacles into their **interactive**
  sessions through provider-appropriate project config or an exactly gated
  user-level compatibility block.
  Mermaid install decision flow; four anti-patterns (TIMELINE,
  FRAMEWORK-EVOLUTION, NOVICE×2); three expert-vs-novice worked examples; 8
  `Test:`-prefixed quality gates; per-CLI reference files.

### Changed
- Interactive wiring now documents the shipped two-hook budget: one turn-level
  prompt and one narrow synchronous pre-edit gate. PD PostToolUse/AfterTool
  registrations are removed across Claude, Codex, Gemini, and agy; the stable
  post-tool path is documented as a zero-work compatibility tombstone for
  already-running providers.
- Removed the raw-tentacle manual-copy fallback because it bypassed the project
  gate, one-second deadline, circuit breaker, and tombstone. Installation and
  repair now route only through `pd hooks install` and the FleetBar action.
- Codex guidance reflects current trusted project hook support while preserving
  exactly one user-level PD compatibility scope, preventing concurrent duplicate
  execution. Claude and Gemini references now use tracked, non-ignored filenames.

### Audited
- skill-architect `skill-auditor` pass (overall 6.7 → revised). Fixes:
  runbook now leads with `pd hooks install`; removed a
  citation to a non-existent selftest script; softened contested pd-adr-092
  references to name the Giant Squid Harness program directly; scoped
  `allowed-tools` Bash and dropped unused WebFetch; added a NOT-FOR exclusion
  for installing the `pd` daemon/CLI itself (was a `port-daddy`-skill collision).
- Governance audit now identifies the skill as first-party and validates its
  FSL license and provenance metadata.
