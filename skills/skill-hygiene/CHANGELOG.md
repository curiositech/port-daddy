# Changelog

All notable changes to the skill-hygiene bundle.

## [0.2.0] — 2026-05-13

Tightened auditor; ready for library-wide use.

- **Markdown link parsing**: extract inline `[text](path)` and reference-style
  links from SKILL.md and INDEX.md files; resolve relative to the containing
  file; classify as ok / broken / external / anchor / outside.
- **Broken links**: new issue type. Reports `from`, `target`, `resolved`,
  plus fuzzy-matched typo suggestions ("did you mean `respawn.md`?").
- **Asset exemption**: `.svg`, `.png`, `.jpg`, fonts, video/audio, archives
  are no longer flagged as orphans. They're consumed by docs that reference
  them, not loaded directly.
- **Missing INDEX softened**: split into `missing_indexes_failure` (a doc
  in the directory is not named anywhere in SKILL.md → unreachable) and
  `missing_indexes_warning` (every doc is named in SKILL.md → works, but
  could be tidier). Only the failure variant blocks exit-0.
- **Codespan correctness**: backtick-quoted filename mentions in prose
  count toward the "referenced" set but are no longer treated as path
  assertions, so prose like ``the `agents/INDEX.md` pattern`` doesn't
  produce phantom broken links.
- Generator artifacts (`provenance.json`, `_book_identity.json`,
  `_raw_response.md`) are recognised and skipped.

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
