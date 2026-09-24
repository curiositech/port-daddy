# Diagnosing And Consolidating An Already-Fragmented Multi-DB Mess

Use this when the damage is already done: several `.db` files exist, different tools report different counts for "the same" data, and nobody is sure which file is authoritative. This is the recovery playbook for the port-daddy 7-.db incident (ADR-0090/0044) generalized to any daemon with the same shape.

## Recognizing The Symptom

The tell is **divergent counts for the same logical entity across different entry points**, e.g.:

| Entry point | Path it resolved | Item count seen |
| --- | --- | --- |
| CLI (`pd list`) | `~/.port-daddy/registry.db` | 7 |
| Snapshot export | `~/Library/Application Support/port-daddy/snapshot.db` | 48 |
| Web/API export | `/opt/homebrew/Cellar/port-daddy/3.2.0/var/db.sqlite3` | 89 |

None of these numbers is "wrong" in isolation — each tool faithfully read the file it resolved. The bug is that three tools resolved three different files for what the user experiences as one database. Upserts issued through one entry point are invisible to the others; a caller "loses" data that was in fact written, just to the wrong file.

## Step 1 — Inventory Every Real DB File

Do not trust config or docs; find every `.db`/`.sqlite3`/`.sqlite` file plus their `-wal`/`-shm` siblings that the product's binaries could plausibly have opened:

```bash
# Common locations: dotfile home, app support, Cellar, repo dirs, tmp
find ~ "$HOME/Library/Application Support" /opt/homebrew/Cellar /usr/local/Cellar \
  -maxdepth 6 \( -name '*.db' -o -name '*.sqlite3' -o -name '*.sqlite' \) 2>/dev/null \
  | grep -vi node_modules
```

For each hit, record: mtime, size, and `sqlite3 <file> '.tables'` output. A file with a stale mtime and a subset schema is a fossil from an old default path; a file with a recent mtime matching an active daemon's PID is a live writer.

## Step 2 — Establish Ground Truth Per Table

For each candidate file and each table of interest, pull the same count and a content hash-ish fingerprint (max rowid + a checksum column) so you can tell "same data, different file" apart from "genuinely different data":

```bash
for f in "${candidates[@]}"; do
  echo "== $f =="
  sqlite3 "$f" "SELECT count(*), max(id), max(updated_at) FROM items;" 2>&1
done
```

Build a small table of `file -> {count, max_id, max_updated_at}` before writing any consolidation code. Do this by hand or with a throwaway script under `~/coding/tmp/`, never by guessing which file "looks right" from its path name alone — that instinct is what caused the fragmentation in the first place (a Cellar path "looked" internal/authoritative).

## Step 3 — Pick The Canonical Target, Not The Newest File

The canonical target is the tier-1 path from `references/durable-path-and-wal-discipline.md` (`~/.port-daddy/registry.db`, env-pinned), **regardless of which existing file currently has the most rows**. Do not canonicalize onto whichever fossil happens to be biggest — that file may itself be sitting in a Cellar/version path that will vanish on the next upgrade. Create the canonical file fresh at the correct path if it doesn't already exist there.

## Step 4 — Merge With A Conflict Policy, Not A Blind Copy

Merging N SQLite files into one needs an explicit conflict policy per table, because the same logical row may exist in more than one fossil with different `updated_at` values:

1. **Last-write-wins by `updated_at`** — safe default when rows carry a reliable timestamp and clock skew across machines is not a concern.
2. **Union with id remapping** — when the fossils used independent autoincrement sequences and rows are genuinely distinct (e.g. different sessions), remap IDs on import rather than overwrite.
3. **Manual review queue** — when a row exists in two fossils with materially different content and no timestamp to arbitrate; do not auto-resolve, surface it.

```sql
-- Example: attach a fossil and pull only rows newer than what canonical already has
ATTACH DATABASE '/path/to/fossil.db' AS fossil;
INSERT INTO main.items (id, name, status, updated_at)
SELECT f.id, f.name, f.status, f.updated_at
FROM fossil.items f
LEFT JOIN main.items m ON m.id = f.id
WHERE m.id IS NULL OR f.updated_at > m.updated_at;
DETACH DATABASE fossil;
```

## Step 5 — Verify Against Ground Truth, Not Against The Merge Script's Own Exit Code

After merging, re-run the Step 2 fingerprint query against the canonical file and compare row-for-row against the union of what the fossils actually contained (accounting for intentional dedup). A merge script exiting 0 proves the SQL ran, not that the result is complete — the same "trust the state, not the report" discipline as migration verification.

## Step 6 — Cut Over Every Entry Point Atomically

1. Land the env-pin fix (`PORT_DADDY_DB` resolved identically everywhere) in the same change as the consolidation tool, not as a followup — a partial rollout re-creates fragmentation immediately.
2. Quarantine (rename, don't delete yet) every fossil path: `mv old.db old.db.fossil-2026-07-03`. Keep fossils for at least one release cycle in case the merge missed a table nobody thought to check.
3. Add a startup assertion in the daemon: refuse to boot if `PORT_DADDY_DB` is unset, rather than silently defaulting.
4. Add a periodic doctor/health check (e.g. `pd doctor`-style) that globs for stray `.db` files outside the canonical path and flags them — this is what catches the *next* fragmentation early instead of 85 days later.

## Failure Semantics To Design For

- **Backup jobs targeting the wrong path silently "succeed."** A cron backup that tars a Cellar-relative path will keep exiting 0 forever, even after the real data has moved — because "the backup ran" and "the backup captured the right file" are different claims. Verify backups by restoring into a scratch dir and running the Step 2 fingerprint against the restore, not by checking the backup job's exit code.
- **A crash-loop during consolidation is worse than doing nothing.** Run the merge against a copy of every fossil first (`cp fossil.db fossil.db.working`), never the live files, until the merge script has passed a dry run.
- **Silence is not consensus.** If two fossils show the same count, that's mild evidence they're copies of the same source, not proof — hash a sample of rows before assuming they're identical.
