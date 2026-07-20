# db-retention-and-compaction — Changelog

## v1.0.0 (2026-07-20)

- Initial skill: retention & compaction for embedded SQLite in long-lived services.
- Core 6-step process: audit → classify → register → coverage-guard → compact → pre-aggregate.
- Four anti-patterns (reaper-index-no-reaper, 231 MB never-shrank, permanence-no-ceiling,
  scattered-cleanup) in Novice/Expert/Timeline shibboleth form.
- `scripts/db_retention_audit.py`: stdlib, read-only (immutable=1) live-file auditor — reports
  freelist waste, auto_vacuum mode, per-table footprint, and UNBOUNDED tables; exit 1 on findings.
- References: `policy-patterns.md` (3 shapes, unified registry, coverage guard, multi-tenant quota),
  `compaction-and-wal.md` (why DELETE doesn't shrink, auto_vacuum/VACUUM, WAL tuning, pre-aggregation).
