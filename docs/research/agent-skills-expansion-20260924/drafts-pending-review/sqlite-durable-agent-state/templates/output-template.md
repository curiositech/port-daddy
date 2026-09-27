# SQLite Durable State Review — [db name]

## Canonical Path

- Env pin: `[ENV_VAR_NAME]`
- Canonical path: `[path]`
- Non-canonical/fossil paths found: `[path list, or none]`

## Journal / Concurrency Settings

| Setting | Value | Rationale |
| --- | --- | --- |
| journal_mode | [wal / delete / truncate] | [why this mode fits the writer/reader shape] |
| busy_timeout | [ms] | [why this value] |
| writerTopology.strategy | [single-writer / queue / serialized] | [how writes are actually serialized] |

## Migrations

| ID | Description | postVerify probe | Verified live? |
| --- | --- | --- | --- |
| [id] | [description] | [table/column/probeSql] | [yes/no, with query output] |

## Audit Run

```bash
node skills/sqlite-durable-agent-state/scripts/db_path_audit.mjs --input plan.json
```

Paste the JSON report here, including every finding and recommendation. Do not omit warnings.

## Blocker Resolution

| Code | Finding | Fix Applied |
| --- | --- | --- |
| [e.g. CELLAR_PATH_STORAGE] | [message] | [what changed] |

## Consolidation Notes (if fragmentation existed)

- Fossil files found and their row counts: [table]
- Merge conflict policy used: [last-write-wins by updated_at / union with id remap / manual review]
- Fossils quarantined at: [paths, with quarantine date]
- Doctor/health check added to catch future stray `.db` files: [command or none yet]

A report with any `blocker`-severity finding is not shippable. Re-run the audit after each fix until `pass: true`.
