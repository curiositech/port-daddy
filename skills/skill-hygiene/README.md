# Skill Hygiene

Audit and maintain a skill bundle so every bundled file is reachable from
SKILL.md or its directory's INDEX.md.

## Quick start

```bash
python3 skills/skill-hygiene/scripts/audit_skill_bundle.py path/to/skill-bundle
```

Exit code `0` if clean, `1` if drift, `2` if the bundle is malformed.

## What this skill catches

1. Orphaned files (bundled but no INDEX or SKILL.md mentions them).
2. INDEX drift (entries vs. files on disk).
3. Missing INDEX in non-trivial subdirectories.

See `SKILL.md` for the full procedure and doctrine.

## Pairs with

- `skill-architect` — creates skills.
- `skill-grader` — grades skill quality.
- This skill — keeps existing skills clean.

## License

Apache-2.0.
