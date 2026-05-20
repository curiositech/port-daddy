# Scripts

| Script | When to run |
|---|---|
| `audit_skill_bundle.py` | You want to know whether a single skill bundle has drift. Default invocation; outputs a punch list, exit 0 if clean. |
| `heal_skill_bundle.py` | The auditor flagged drift you want fixed in bulk. Dispatches to `claude` CLI (haiku or sonnet) to rewrite SKILL.md, generate INDEX.md hubs, and propose renames for files with illegal characters. Defaults to dry-run; use `--apply` to mutate. |
| `audit_skill_library.py` | You want to audit every skill in one or more roots and persist the run to a SQLite history. Atomic per-run transaction, WAL mode, and an optional JSON snapshot for downstream consumers (webpage, CI dashboards). |
