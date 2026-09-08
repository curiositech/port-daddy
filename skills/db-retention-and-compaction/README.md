# db-retention-and-compaction

Agent Skill: keep an embedded SQLite datastore in a long-lived service from growing forever — a unified
retention registry (one declared policy per table), TTL / absolute-age / row-count-cap policies, a
fail-loud coverage guard, WAL/checkpoint tuning, and `auto_vacuum`/`incremental_vacuum` so pruning
actually shrinks the file.

> Runtime note: this README is for humans browsing the repo. The runtime bundle inventory the agent
> uses lives in the **Bundle Contents** table inside `SKILL.md`.

## Structure

```
db-retention-and-compaction/
├── SKILL.md                          # Core process, policy shapes, anti-patterns (<500 lines)
├── CHANGELOG.md                      # Version history
├── README.md                         # This file
├── references/
│   ├── policy-patterns.md            # 3 policy shapes, registry, coverage guard, multi-tenant
│   └── compaction-and-wal.md         # Why DELETE doesn't shrink; VACUUM/auto_vacuum; WAL tuning
└── scripts/
    └── db_retention_audit.py         # Stdlib, read-only auditor for a live SQLite file
```

## Quick Start

1. Read `SKILL.md` for the 6-step process and anti-patterns.
2. Audit a live DB (read-only, safe on a running service):
   ```bash
   python3 scripts/db_retention_audit.py /path/to/app.db --registered t1,t2,t3 --reclaim-warn-mb 20
   ```
   Exit code `1` means findings (unbounded tables, reclaimable waste, or `auto_vacuum` misconfig) — use
   it as a CI gate.
3. Consult `references/` for policy code and compaction deep dives.
