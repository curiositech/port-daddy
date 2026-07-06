# Changelog — agentic-software-installation

All notable changes to this skill are documented here. This skill encodes
date- and vendor-versioned knowledge (CLI hook surfaces evolve), so the
changelog is load-bearing — temporal claims rot silently without it.

## [Unreleased]

### Added
- Initial skill: detect installed agent CLIs (`claude`, `codex`, `gemini`,
  `agy`) and wire the Giant Squid Harness tentacles into their **interactive**
  sessions via user-level config, so coordination fires in every directory.
  Mermaid install decision flow; four anti-patterns (TIMELINE,
  FRAMEWORK-EVOLUTION, NOVICE×2); three expert-vs-novice worked examples; 8
  `Test:`-prefixed quality gates; per-CLI reference files.

### Audited
- skill-architect `skill-auditor` pass (overall 6.7 → revised). Fixes:
  runbook now leads with `pd hooks install` and the manual fallback fails loud
  with the canonical tentacle location (was a broken `install` path); removed a
  citation to a non-existent selftest script; softened contested pd-adr-092
  references to name the Giant Squid Harness program directly; scoped
  `allowed-tools` Bash and dropped unused WebFetch; added a NOT-FOR exclusion
  for installing the `pd` daemon/CLI itself (was a `port-daddy`-skill collision).

### Known caveat
- The tentacle scripts (`bin/pd-hook-*`) ship with the Giant Squid Harness
  program, which at authoring time was unmerged WIP. Until it lands,
  `pd hooks install` stages nothing and prints guidance rather than wiring a
  hook at a missing path.
