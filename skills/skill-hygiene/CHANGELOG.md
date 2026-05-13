# Changelog

All notable changes to the skill-hygiene bundle.

## [0.1.0] — 2026-05-09

Initial release.

- `scripts/audit_skill_bundle.py` — generic auditor for any progressive-disclosure
  skill bundle. Detects orphaned files, INDEX drift (missing entries and ghost
  entries), and missing INDEX.md. Outputs human or JSON, exits 0/1/2.
- `references/progressive-disclosure.md` — the SKILL.md → INDEX.md → leaf doc
  pattern, with authoring guidance and "what NOT to do."
- `references/drift-prevention.md` — pre-commit hook, CI integration, and
  authoring convention to keep the auditor passing forever.
- Companion fix in the same release: `port-daddy-agent-skill` SKILL.md
  surfaced its full bundled-asset map, three drifted INDEX.md files were
  resynced, and `scripts/INDEX.md` + `templates/INDEX.md` were added.
