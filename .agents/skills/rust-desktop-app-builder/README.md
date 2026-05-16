# Rust Desktop App Builder

Skill bundle for building beautiful, high-performance, cross-platform Rust desktop applications.

The bundle is intentionally opinionated: it treats framework choice, desktop UX, security, performance, accessibility, release packaging, and updater trust as one product contract.

## Contents

- `SKILL.md`: activation, operating rules, decision tree, anti-patterns, and lazy reference map.
- `references/`: deep guidance for stack selection, visual design, architecture, security/release, and verification.
- `templates/`: planning, framework selection, and release checklists.
- `examples/`: concrete handoff and implementation slice examples.
- `scripts/preflight.sh`: read-only repo/environment preflight.
- `scripts/audit_rust_desktop_app.py`: static audit JSON for Rust desktop repo structure.

## Validation

```bash
python3 /Users/erichowens/coding/workgroup-ai/skills/skill-architect/scripts/validate_skill.py skills/rust-desktop-app-builder
python3 /Users/erichowens/coding/workgroup-ai/skills/skill-architect/scripts/check_self_contained.py skills/rust-desktop-app-builder
```
