<!-- Authored by a 19-agent adversarial multi-perspective review (principal engineer,
     architect, red team, blue team, white team, PM, EM, detail auditor, UX designer,
     researcher) commissioned by the operator to eliminate matrix.env. Grounded in
     direct source reads, not assumption — see §2.1 for citations. -->

# Eliminate `~/.port-daddy/matrix.env` (the "Ink Cloud"): Achingly Detailed Migration Plan

**Status:** Ready to execute. **Owner:** engineer or agent assigned this ticket. **Scope:** Full replacement of the flat-file coordination store with SQLite, across code, tests, docs, skills, and the website. **Authorization:** Operator has explicitly authorized heavy resource use; this document is dense by design and assumes no further clarification round before execution begins — all genuinely open decisions are isolated in §11.

All line-number citations below were re-verified against `/Users/erichowens/coding/port-daddy/.claude/worktrees/fix-pd-hook-prompt-timeout` on 2026-08-19, not taken on faith from the source brief. This revision additionally incorporates a completeness-critic pass (2026-08-19) that found 19 gaps across blast-radius coverage, debate-flagged risks left unclosed, prose-only claims lacking tests, and internal inconsistencies — every one of those 19 items is closed in this version, cross-indexed in §12.

---

## 1. Executive Summary

**What's broken.** `~/.port-daddy/matrix.env` is a single flat `KEY="value"` file that four vendor-CLI hook scripts (`bin/pd-hook-prompt`, `bin/pd-hook-pre-tool`, `bin/pd-hook-post-tool`, `bin/pd-statusline`) and one daemon module (`lib/fleet-daemon.ts`) all read and write, coordinating locks, steering alerts, and pheromone traces across a live multi-agent fleet. It grew to 3,164 lines / 938KB, and `pd-hook-prompt` — which fires synchronously on every `UserPromptSubmit` for every agent turn — was taking 20–30+ seconds per invocation, well past its own 10-second hard-kill timeout (`lib/squid/hook-shape.ts`, `timeout = 10` on every hook registration, confirmed for both the Claude JSON hook config and the Codex TOML block). PR #7474 shipped a tactical band-aid (a `grep -F` project-root prefilter plus `SCAN_CAP=60` in `pd-hook-prompt`, tail-based compaction in `pd-hook-post-tool`) that reduces symptoms without touching the root cause: an unindexed, linearly-scanned, append-mostly text file with no schema and no enforced retention.

**Why it's broken, precisely.** `docs/adr/0091-giant-squid-harness.md` designed this file as an explicit **hot cache**, not a source of truth, with a numeric performance spec in its own SMART success-criteria table: **G5 — "grep read latency <5ms over a 1k-entry matrix."** At 3,164 entries, measured latency was 20–30 seconds. That is **not a 6x miss or a 60x miss — it is roughly a 6,000x miss against the ADR's own stated bound**, and it went undetected in production for approximately two months because no test exercised the matrix at realistic scale; the test suite (`tests/unit/squid-harness.test.ts`) exercises correctness (do the right lines get appended, does the lock block) but never volume. This is the load-bearing lesson this plan is built around: **every SMART criterion in §9 below ships with a named, currently-passing test file and function — no criterion is asserted in prose alone**, because that is precisely the failure mode that let G5 rot silently.

**The second, deeper failure.** `lib/squid/matrix.ts` (lines 357–366, verified verbatim) carries a standing comment block titled `RECONCILE TODO (daemon)`, describing a daemon-side loop that was supposed to drain pheromone appends into `lib/pheromone.ts`'s decay-aware store, project locks/alerts back out, and garbage-collect faded entries — explicitly marked **"NOT built in this vertical slice."** That loop was never built, ever, in the ~2 months since ADR-0091 landed (2026-06-24). Because nothing ever pruned it, the file could only grow. This is not a performance bug that happened to a well-architected system; it is the predictable outcome of shipping an unindexed append-only file with a promised-but-never-delivered garbage collector as its only planned bound. **This plan does not repeat that pattern**: pruning is either query-time (decay math in the `SELECT`, needs no daemon loop to be *correct*, only to be *bounded*) or an already-existing daemon tick loop (`lib/fleet-daemon.ts`'s existing interval, not a new loop invented and never wired up), and its liveness is itself monitored by `pd doctor` (§6.4) rather than assumed — and this revision goes further: **all four** named maintenance jobs (not just `wal_checkpoint`) are shown as concrete code in §3.5, each individually monitored, because "described in prose, never wired, never monitored" is the exact failure mode this plan exists to close and a partial fix that reproduces it for 3 of 4 jobs is not acceptable.

**Independently verified, not assumed:** this repo already has a live instance of the exact failure mode this migration exists to prevent. `~/.port-daddy/port-registry.db` on the operator's own machine is 937MB with `PRAGMA auto_vacuum` reading `0` (NONE) — confirmed live via `sqlite3 ~/.port-daddy/port-registry.db "PRAGMA auto_vacuum;"` → `0` — meaning `lib/db.ts`'s own documented fix for this exact anti-pattern (the code comment at `lib/db.ts:~697` explicitly calling out "the root cause of a 231MB registry DB that stayed 231MB after pruning") has not actually taken effect on this file, because that pragma is a no-op on an already-populated database until a one-time `VACUUM` runs. **This plan will not add coordination tables to that file without first fixing that precondition, and will not run that irreversible rewrite without a backup taken first** (§4, Step 0).

---

## 2. Current State

### 2.1 What exists today, read directly from source

**The four hook consumers**, each independently parsing/scanning the same flat file:

| File | Lines | Role | Current mechanism (verified) |
|---|---|---|---|
| `bin/pd-hook-prompt` | 150 | `UserPromptSubmit` — injects steering context | `grep -E '^PD_ALERT_...' \| tail -n "$SCAN_CAP"` and `grep -E '^PD_PHEROMONE_...' \| grep -F -- "$PROJECT_ROOT" \| tail -n "$SCAN_CAP"` (lines 68–69), then a `sed`/per-line shell loop (lines 74–113) to strip quoting and parse timestamps for freshness |
| `bin/pd-hook-pre-tool` | 307 | `PreToolUse` — **the one enforced gate** | Per-candidate-path loop (line 244) doing `grep -E "^${LOCK_KEY}=" "$MATRIX" \| head -n1` (line 247) — one `grep` fork per candidate path per tool call |
| `bin/pd-hook-post-tool` | 187 | `PostToolUse` — pheromone writer | `mkdir`-based atomic lock fallback on macOS (lines 129–164, since `flock(1)` doesn't exist there), `printf ... >> "$MATRIX"` append (line 148), then a `tail -n "$COMPACT_KEEP"` compaction pass (line 121) that rewrites the whole file |
| `bin/pd-statusline` | 83 | Claude Code statusline render, fires on **every** render | `grep -c` counts over the same file for the `◆ PD` badge — **missing from the original brief's consumer list**, confirmed present and unaddressed by PR #7474 |

**Three independent parsers of the same text format**, a triplication problem orthogonal to the flat-file problem itself:
1. `lib/squid/matrix.ts` — the canonical engine (`parseMatrix`/`serializeMatrix`/`readMatrix`/`setKey`/`deleteKey`/`appendPheromone`/`readPheromones`/`setLock`/`releaseLock`/`readLocks`/`readAlerts`/`setAlert`), plus the never-built RECONCILE TODO.
2. `lib/squid/identity.ts::readMatrixSnapshot()` — re-regexes the raw file independently, consumed by `cli/commands/squid.ts` (`pd squid status`) and `tests/unit/squid-identity.test.ts`.
3. `lib/local-citizen/ink-cloud.ts` — a third independent parser/writer building the "LIVE COORDINATION STATE" injection block for headless (non-hook) agents.

**One real production daemon writer**, not just the shell hooks: `lib/fleet-daemon.ts`'s `syncApprovalAlert()` mirrors pending-HITL-approval counts into `PD_ALERT_FLEET_APPROVALS` via `setKey`/`deleteKey`, firing on every approval-stream state change. This is the concrete, already-live instance of "multi-process, multi-language access to the same store" (long-lived Node/Bun daemon connection vs. per-invocation `sqlite3` CLI subprocess) — not a hypothetical risk to be introduced by this migration, a risk that already exists today in flat-file form and must be handled correctly in the sqlite form, **and is now itself a named concurrency-test participant, not just a design consideration — see §6.7.**

**`lib/squid/hook-shape.ts` — the file the whole plan's timing budget is calibrated against.** This is the single source of truth for the `timeout = 10` figure cited throughout §1–§3 and is directly exercised by the new G11 vendor-parity test (§6.5). It defines the per-vendor hook registration shape (Claude JSON block, Codex TOML block, and — per §6.5 — the Gemini and Antigravity/agy adapter skeletons) but contains **no matrix-file I/O of its own**; it does not read or write `matrix.env`, `coord_pheromones`, `coord_alerts`, or `locks`. **Disposition: no code change in this migration.** It appears in §5's disposition table (row 45) purely for completeness/audit — it is the file every hook-shape timing assumption in this plan is checked against, so its absence from the table was itself a gap, even though its correct disposition is "no change."

### 2.2 Fail-open invariant (must be preserved exactly)

Every tentacle degrades to "no context injected / allow the tool" on any error — confirmed as a hard, repeated invariant in every tentacle's docstring and in `ADR-0091`. The daemon-liveness gate that already wraps every hook invocation is `cli/commands/hooks-install.ts`'s `gateWrapperScript()` (lines ~80–106, verified verbatim): it checks a heartbeat file's mtime against `SQUID_DAEMON_HEARTBEAT_STALE_SECONDS = 30` via `stat`, **not** `kill -0`/`ps` (explicitly forbidden in a code comment because Codex's macOS Seatbelt profile denies both against the Homebrew daemon), and `exit 0`s before the real tentacle body ever runs if the daemon is down. **This is the single most important architectural fact this plan leans on**: the daemon-down case is already a hard precondition failure for every hook today, so routing new writes through the daemon via RPC introduces no new liveness dependency — it formalizes one that already exists. **What it does NOT do**: it says nothing about whether the daemon, once confirmed live, is actually listening on the specific transport (Unix domain socket) this plan's write path assumes. That is a separate, previously-unverified assumption — closed in §3.7.

### 2.3 Timeout budget (hard number, verified)

Both the Claude JSON hook config and the Codex TOML block (`lib/squid/hook-shape.ts`) register every tentacle with **`timeout = 10`** (seconds). `pd-hook-prompt`'s measured 20–30s cost blew this budget by 2–3x, which is why prompts were observed to time out, not merely feel slow.

### 2.4 Blast radius (grounded, deduplicated, false positives struck)

A full-repo re-grep for `matrix\.env|PD_MATRIX_FILE|Ink Cloud|ADR-0091|PD_ALERT_|PD_PHEROMONE_|PD_LOCK_` (plus a targeted check for `PD_INBOX_`/`PD_CLAIM_`/`PD_RECON_HEARTBEAT` and case-insensitive `ink[ -]?cloud`) found **34 real consumers** across hooks, core lib, CLI, demos, release scripts, skills, prompts, the website, tests, and ADR/roadmap docs, **plus two comment-only/context-only references caught in a completeness re-pass** (`tests/unit/spawn-routes-preflight.test.js`, `lib/squid/hook-shape.ts` — see §2.1 and §5 rows 44–45) — full disposition in §5. Three files from the original consumer inventory (`lib/idea-intake.ts`, `tests/unit/adr-matrix.test.js`, `tests/unit/symbol-index.test.ts`) are **confirmed false positives** — they reference an unrelated `lib/adr-matrix.ts` (ADR→roadmap linkage) or an unrelated `lib/symbol-conflict-matrix.ts` (file-conflict semantics), verified by reading each file; they require no action and are dropped from the checklist.

**Two independently verified facts that correct the source brief:**
- The `uiConsumerWarning` (a "Binnacle/Quartermaster" UI reading live matrix state) resolves to a **non-issue**: the only hits for either term anywhere in the repo are inside `docs/adr/0091-giant-squid-harness.md` itself (Step 5 and success criterion G8), deferring the work to `adr-0089-binnacle-quartermaster-ui` — a number that today belongs to an unrelated ADR (`0089-durable-security-forensics-journal.md`). Nothing in `pd-console` or `FleetBar` reads matrix-derived state for a UI panel. No functional work required beyond dropping the dangling citation during the ADR cleanup (§10).
- The `adrDuplicateWarning`'s cited number is stale: **ADR-0051 is a dead, already-redirected stub** (`docs/adr/0051-port-daddy-harness.md`, one line: "renumbered to 0108"). The live, unreconciled duplicate is **ADR-0091 vs. ADR-0108** (verified: `docs/adr/0108-port-daddy-harness.md` line 167 reads *"No ADR-0091 exists on disk... This ADR-0051 is the harness ADR..."* — false today, and additionally the file refers to **itself** as "ADR-0051" in its own prose despite being numbered 0108 on disk, a second, previously-unflagged self-reference bug caught during this verification pass). Two prior attempts to close this exact TODO (a 2026-07-06 work packet, and a roadmap-snapshot item on branch `claude/reconcile-adr-0091-0051`) were logged and never executed. Any new ADR from this plan must reconcile against **0108**, never the dead 0051, and must also fix 0108's internal self-numbering bug while there.

### 2.5 Environment-portability scope (named, not assumed)

This plan is authored and verified against macOS (operator's daily machine) and GitHub Actions `ubuntu-latest`/`macos-latest` CI legs — the two environments this repo actually runs in today. It makes no claim about, and has not verified, behavior on: Alpine/musl containers (no glibc, different default `sqlite3` package build flags), WSL, or locked-down corporate Linux with restricted Unix-socket or `curl`-to-loopback egress policies. This is carried forward as an explicit open question rather than a silent assumption — §11 item 6.

---

## 3. Proposed Architecture

### 3.1 Schema — exact DDL

New migration, following the existing numbered convention (`086_booty.sql` confirmed as the latest file on disk at plan-authoring time): **`migrations/087_squid_coordination.sql`**. **This number must be re-verified, not assumed, at PR2 execution time** — run `ls migrations/ | sort -V | tail -3` immediately before authoring the migration file and take the next-available integer, exactly the same discipline this plan already applies to ADR numbers (§2.4, §10). This repo has already produced one live numbering collision on the ADR side (the `adr-0089` finding); the SQL migration namespace is not exempt from the same risk just because it wasn't the one that already collided.

Lives in the **existing consolidated `PORT_DADDY_DB`** file — never a new `.db`. This is not a style preference; it is required by the already-known "DB fragmentation" anti-pattern in this repo (five `.db` files present in `~/.port-daddy/` at plan-authoring time, four of them zero-byte stale fragments, one 937MB with `auto_vacuum=0` — verified live, §4 Step 0 fixes this before any new table is added to it).

```sql
-- migrations/087_squid_coordination.sql  (re-verify "087" is next-available at execution time — see above)
-- Replaces ~/.port-daddy/matrix.env (the "Ink Cloud") with indexed SQLite tables.
-- Lives in the SAME consolidated PORT_DADDY_DB file — see scripts/db-consolidate.ts.
-- Supersedes the data-store sections of docs/adr/0091-giant-squid-harness.md.

-- ── Pheromones: decaying, advisory, high-frequency (fires on every file mutation) ──
CREATE TABLE IF NOT EXISTS coord_pheromones (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject      TEXT NOT NULL,            -- topic key, matches today's PD_PHEROMONE_<SUBJECT>
  project_root TEXT NOT NULL,            -- absolute project root; pd-hook-prompt filters on this
  note         TEXT NOT NULL DEFAULT '', -- capped at 500 bytes at the write boundary (§3.3)
  intensity    REAL NOT NULL DEFAULT 1.0,
  actor        TEXT NOT NULL DEFAULT '', -- REQUIRED, non-empty, capped at 200 bytes (§3.3) — provenance
  fleet        TEXT NOT NULL DEFAULT 'default',  -- reserved column, non-goal (§5 footer)
  created_at   INTEGER NOT NULL          -- unix ms
);
CREATE INDEX IF NOT EXISTS idx_pher_project_created
  ON coord_pheromones(project_root, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pher_created
  ON coord_pheromones(created_at);        -- for the prune sweep

-- ── Alerts: steering signals, low-frequency, key-addressable (replaces PD_ALERT_<subject>) ──
CREATE TABLE IF NOT EXISTS coord_alerts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key    TEXT NOT NULL,            -- e.g. "FLEET_APPROVALS", "RELEASE_SMOKE"
  project_root TEXT NOT NULL DEFAULT '', -- '' = fleet-wide (matches today's global alerts)
  message      TEXT NOT NULL,
  actor        TEXT NOT NULL DEFAULT '', -- REQUIRED, non-empty, capped at 200 bytes (§3.3)
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER,                  -- NULL = no explicit expiry; hard row-count backstop still applies (§3.6: cap 2000, prune to 1500)
  UNIQUE(alert_key, project_root)
);
CREATE INDEX IF NOT EXISTS idx_alerts_project_expiry
  ON coord_alerts(project_root, expires_at);
CREATE INDEX IF NOT EXISTS idx_alerts_created
  ON coord_alerts(created_at);            -- for the prune sweep

-- ── Maintenance ledger: makes the prune/checkpoint cadence OBSERVABLE, per job.
--    This table is the direct, testable fix for "the reconcile loop silently
--    never ran for two months" — pd doctor reads it PER ROW (§3.5, §6.4), not
--    as a single aggregate, because a partial failure (3 of 4 jobs healthy,
--    1 silently dead) must be as visible as a total one. ──
CREATE TABLE IF NOT EXISTS coord_maintenance (
  job            TEXT PRIMARY KEY,       -- 'prune_pheromones' | 'prune_alerts' | 'wal_checkpoint' | 'reap_expired_locks'
  last_run_at    INTEGER NOT NULL,
  rows_affected  INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT                    -- non-NULL if the last run threw
);
-- Seed all four job rows at migration time so a NEVER-RUN job is distinguishable
-- (last_run_at = 0, immediately stale) from a NOT-YET-CREATED job (row absent,
-- which would otherwise let a typo'd job name silently vanish from monitoring).
INSERT OR IGNORE INTO coord_maintenance (job, last_run_at, rows_affected) VALUES
  ('prune_pheromones', 0, 0),
  ('prune_alerts', 0, 0),
  ('wal_checkpoint', 0, 0),
  ('reap_expired_locks', 0, 0);

-- ── Dropped-write counter: visible instead of silent (§3.4). One row, upserted. ──
CREATE TABLE IF NOT EXISTS coord_dropped_writes (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  count          INTEGER NOT NULL DEFAULT 0,
  last_dropped_at INTEGER
);
INSERT OR IGNORE INTO coord_dropped_writes (id, count) VALUES (1, 0);
```

**Locks are NOT new schema.** `lib/locks.ts`'s existing `locks` table — verified verbatim, `CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, owner, pid, acquired_at, expires_at, metadata)` with `idx_locks_expires` already present, plus already-implemented `acquire`/`release`/`releaseIfOwner`/`releaseExpired`/`extend`/`list`/`listByOwner` — is reused directly, namespaced: `PD_LOCK_<path>` becomes lock name `squid:file:<sha256-or-suffix(path)>`. **This is new-feature work riding an existing, better-built primitive, not a live migration**: a repo-wide grep confirms `setLock`/lock-table writes have zero production callers today (only tests call `setLock`) — the "lock enforcement" path in production today is entirely the shell hooks' own `grep`-the-flat-file logic, not `lib/locks.ts`. This changes the risk profile of the lock-path rewrite: it is real new functionality requiring correctness review, not a live-traffic cutover (§8 Risk Register item R-4 recalibrates this explicitly), and because `acquire()` is genuinely new production-traffic code it gets a dedicated concurrent-acquire correctness test — §6.1a.

**Rejected alternative, stated explicitly:** one generic `coordination_kv(key, value)` table replicating `matrix.env`'s flat namespace with `WHERE key LIKE 'PD_ALERT_%'` was considered and rejected — it is SQL-syntax matrix.env, not a fix. Three typed, indexed tables is the actual point of this migration.

### 3.2 Tentacle rewrite — exact before/after, sqlite3 CLI replacing grep/sed/mkdir

**New shared shell library, sourced by all four tentacles: `bin/pd-squid-lib.sh`**

```sh
#!/bin/sh
# bin/pd-squid-lib.sh — shared by pd-hook-prompt, pd-hook-pre-tool, pd-hook-post-tool, pd-statusline.
# Sourced, not executed. Every function fails safe (empty stdout / non-zero exit means "caller must fail open").

squid_sqlite_bin() {
  command -v sqlite3 >/dev/null 2>&1 && { command -v sqlite3; return 0; }
  [ -x /usr/bin/sqlite3 ] && { echo /usr/bin/sqlite3; return 0; }   # defensive: don't trust $PATH ordering alone
  return 1
}

squid_sql_escape() {
  # SQL string-literal escaping: double every embedded single quote.
  # REQUIRED, not defensive paranoia — an ordinary note like "don't merge yet"
  # breaks an unescaped INSERT/SELECT string literal today. Verified empirically.
  printf '%s' "$1" | sed "s/'/''/g"
}

squid_db_path() {
  [ -n "${PORT_DADDY_DB:-}" ] && { echo "$PORT_DADDY_DB"; return 0; }
  echo "${HOME}/.port-daddy/port-registry.db"   # MUST match scripts/db-consolidate.ts's resolved default — re-verify at PR2 time (§3.1), do not assume
}

squid_socket_path() {
  echo "${PD_HOME:-$HOME/.port-daddy}/port-daddy.sock"
}
```

**Note on `PRAGMA busy_timeout` vs. spin-retry patterns.** Every shell-side read below uses `PRAGMA busy_timeout=N` and nothing else — no retry loop, no `sleep`-then-retry, no CPU-spin polling for lock release. This is a deliberate rejection of the anti-pattern surfaced during Red Team review of an earlier draft (a `sleepBusy()` CPU-spin loop that retried on a tight interval waiting for a lock to clear). `busy_timeout` delegates the wait to SQLite's own internal backoff, which is correct and free; a hand-rolled retry loop is neither. Documented here explicitly, alongside the spool-file-fallback rejection (§3.4), so a future editor has the same "considered and rejected" signal for both anti-patterns instead of only one.

**`bin/pd-hook-prompt` — BEFORE (current, verified lines 68–113):**

```sh
# current: two greps over the whole file, tail-capped, then a per-line sed/date shell loop
ALERTS="$(grep -E '^PD_ALERT_[A-Za-z0-9_]+=' "$MATRIX" 2>/dev/null | tail -n "$SCAN_CAP" || true)"
PHER="$(grep -E '^PD_PHEROMONE_[A-Za-z0-9_]+=' "$MATRIX" 2>/dev/null | grep -F -- "$PROJECT_ROOT" | tail -n "$SCAN_CAP" || true)"
# ... then, PER LINE, a sed strip + a second sed to extract `ts:` + a date-arithmetic freshness check ...
while IFS= read -r line; do
  val="$(printf '%s\n' "$line" | sed -E 's/^[A-Za-z0-9_]+="?//; s/"$//')"
  ts="$(printf '%s\n' "$line" | sed -nE 's/.*\| ts:([^ |]+).*/\1/p')"
  # ... fork per line for date comparison ...
done <<EOF
$ALERTS
EOF
```
This is O(file size) per hook call regardless of `SCAN_CAP` (the `grep` itself still scans every line before the `tail` cap applies), plus one-to-several process forks per matched line for the `sed`/date freshness parse. This is the exact mechanism that produced 20–30s at 3,164 lines.

**`bin/pd-hook-prompt` — AFTER (indexed SQL query, decay computed in the query, no per-line shell loop):**

```sh
. "$(dirname "$0")/pd-squid-lib.sh"

SQLITE="$(squid_sqlite_bin)" || exit 0
DB="$(squid_db_path)"
[ -f "$DB" ] || exit 0
PROJECT_ESC="$(squid_sql_escape "$PROJECT_ROOT")"

RESULT=$("$SQLITE" -readonly -cmd "PRAGMA busy_timeout=400;" "$DB" "
  SELECT subject, note, actor,
         intensity * exp(-0.0000005776 * (strftime('%s','now')*1000 - created_at)) AS eff_intensity
  FROM coord_pheromones
  WHERE project_root = '${PROJECT_ESC}'
    AND created_at > (strftime('%s','now')*1000 - 3600000)
  ORDER BY created_at DESC
  LIMIT 20;
" 2>/dev/null) || exit 0

ALERTS=$("$SQLITE" -readonly -cmd "PRAGMA busy_timeout=400;" "$DB" "
  SELECT alert_key, message, actor FROM coord_alerts
  WHERE (project_root = '${PROJECT_ESC}' OR project_root = '')
    AND (expires_at IS NULL OR expires_at > strftime('%s','now')*1000)
  ORDER BY created_at DESC LIMIT 20;
" 2>/dev/null) || exit 0

[ -z "$RESULT" ] && [ -z "$ALERTS" ] && exit 0
# format $RESULT / $ALERTS into hookSpecificOutput.additionalContext, WITH actor provenance tags
# (e.g. "[from: agent_alpha] don't touch auth.ts, mid-refactor") — see §3.3 provenance requirement.
```
One process fork (`sqlite3`), one indexed query per source, decay computed by SQLite's own `exp()` in the `SELECT`, `LIMIT` bounding result size regardless of table growth, `-readonly` as a cheap safety property. **This query's use of `exp()` is the exact reason PR2 CI carries a math-function capability check, not just a `sqlite3 --version` presence check — see §3.7b.**

**`bin/pd-hook-pre-tool` — BEFORE (current, verified lines 244–247):**

```sh
# current: one grep FORK PER CANDIDATE PATH, no index, full-file scan each time
while IFS= read -r LOCK_CAND; do
  [ -n "$LOCK_CAND" ] || continue
  LOCK_KEY="PD_LOCK_$(suffix "$LOCK_CAND")"
  LINE="$(grep -E "^${LOCK_KEY}=" "$MATRIX" 2>/dev/null | head -n1 || true)"
  # ...
done <<EOF
$CANDIDATES
EOF
```

**`bin/pd-hook-pre-tool` — AFTER (single indexed query against the existing `locks` table, no per-candidate fork):**

```sh
. "$(dirname "$0")/pd-squid-lib.sh"
SQLITE="$(squid_sqlite_bin)" || exit 0
DB="$(squid_db_path)"
[ -f "$DB" ] || exit 0

# Build a single "name IN (...)" set instead of one query per candidate path.
IN_CLAUSE=""
while IFS= read -r LOCK_CAND; do
  [ -n "$LOCK_CAND" ] || continue
  NAME_ESC="$(squid_sql_escape "squid:file:$(suffix "$LOCK_CAND")")"
  IN_CLAUSE="${IN_CLAUSE}${IN_CLAUSE:+,}'${NAME_ESC}'"
done <<EOF
$CANDIDATES
EOF
[ -n "$IN_CLAUSE" ] || exit 0

ROW=$("$SQLITE" -readonly -cmd "PRAGMA busy_timeout=400;" "$DB" \
  "SELECT name, owner FROM locks WHERE name IN (${IN_CLAUSE}) AND (expires_at IS NULL OR expires_at > strftime('%s','now')*1000) LIMIT 1;" \
  2>/dev/null) || exit 0   # sqlite unreachable → fail OPEN, unchanged posture from today

[ -z "$ROW" ] && exit 0
LOCK_OWNER="${ROW#*|}"
[ "$LOCK_OWNER" = "$PD_ACTOR" ] && exit 0
# ... existing BLOCK_TARGET/BLOCK_OWNER/REASON formatting unchanged, exit 2 unchanged ...
exit 2
```

**`bin/pd-hook-post-tool` — BEFORE (current, verified lines 129–164, 121):**

```sh
# current: mkdir-based atomic lock (macOS has no flock(1)), append, then periodically
# rewrite the ENTIRE FILE via tail -n "$COMPACT_KEEP" to bound growth — the exact
# "growth only ever bounded by a rewrite pass that competes with every other writer" pattern.
if command -v flock >/dev/null 2>&1; then
  ( flock 9; append_line ) 9>"${MATRIX}.flock" 2>/dev/null || append_line
else
  # mkdir-atomic lock, retry briefly, break if stale
  while ...; do
    if mkdir "$LOCKDIR" 2>/dev/null; then append_line; break; fi
  done
fi
```

**`bin/pd-hook-post-tool` — AFTER (fire-and-forget RPC to the daemon; no shell-side locking code at all — see §3.4 for why writes route through the daemon, not direct CLI `INSERT`, and §3.7 for the UDS listener this depends on):**

```sh
. "$(dirname "$0")/pd-squid-lib.sh"
SOCK="$(squid_socket_path)"
SUBJECT_ESC="$(printf '%s' "$SUBJECT" | sed 's/"/\\"/g')"
NOTE_ESC="$(printf '%s' "$NOTE" | sed 's/"/\\"/g')"
curl -s --max-time 0.5 --unix-socket "$SOCK" \
  -X POST http://localhost/squid/pheromone \
  -H 'Content-Type: application/json' \
  -d "{\"subject\":\"${SUBJECT_ESC}\",\"project_root\":\"${PROJECT_ESC}\",\"note\":\"${NOTE_ESC}\",\"intensity\":1.0,\"actor\":\"${PD_ACTOR}\"}" \
  >/dev/null 2>&1
exit 0   # ALWAYS exit 0 — write success/failure never blocks the tool call (§3.4)
```
No lock directory, no `flock`/`mkdir` fallback branching, no `tail`-based file rewrite competing with concurrent writers. The daemon owns write serialization via its single long-lived `better-sqlite3` connection.

**`bin/pd-statusline` — AFTER (same read pattern as `pd-hook-prompt`, `SELECT COUNT(*)` instead of full lines):**

```sh
. "$(dirname "$0")/pd-squid-lib.sh"
SQLITE="$(squid_sqlite_bin)" || exit 0
DB="$(squid_db_path)"
[ -f "$DB" ] || { echo ""; exit 0; }
COUNTS=$("$SQLITE" -readonly -cmd "PRAGMA busy_timeout=200;" "$DB" "
  SELECT
    (SELECT COUNT(*) FROM coord_alerts WHERE expires_at IS NULL OR expires_at > strftime('%s','now')*1000),
    (SELECT COUNT(*) FROM coord_pheromones WHERE created_at > (strftime('%s','now')*1000 - 3600000)),
    (SELECT COUNT(*) FROM locks WHERE name LIKE 'squid:file:%' AND (expires_at IS NULL OR expires_at > strftime('%s','now')*1000));
" 2>/dev/null) || { echo ""; exit 0; }
# format $COUNTS into the "◆ PD" badge
```
A 200ms `busy_timeout` here (shorter than the 400ms used elsewhere) because statusline renders are the highest-frequency, lowest-value read — cheap to skip entirely under contention, and unlike `pd-hook-prompt` a missed statusline render has essentially zero cost to the agent's actual work.

### 3.3 Write validation, provenance, and field caps (daemon-side, `lib/squid/coordination.ts`, new file)

```ts
// lib/squid/coordination.ts — the ONE shared read/write module (collapses the
// three-independent-parser problem in §2.1 item 2 — identity.ts and ink-cloud.ts
// both call THIS instead of re-parsing anything, per PR1/PR5 in §4).
import type { Database } from 'better-sqlite3';

export interface PherInput {
  subject: string;
  project_root: string;
  note: string;
  intensity: number;
  actor: string;
}

export interface AlertInput {
  alert_key: string;
  project_root: string;
  message: string;
  actor: string;
  expires_at: number | null;
}

const NOTE_MAX_BYTES = 500;
const ACTOR_MAX_BYTES = 200;    // R-7 fix: actor is rendered into trusted agent context
                                 // as "[from: <actor>]" — an unbounded actor string is
                                 // itself a prompt-injection vector (§3.3 below), so it
                                 // gets the same cap-and-validate treatment as `note`.
const SUBJECT_MAX_BYTES = 200;  // same rendering path, same reasoning

class ValidationError extends Error {}

function assertActor(actor: string): void {
  if (!actor || actor.trim().length === 0) {
    throw new ValidationError('actor is required — every pheromone/alert MUST carry provenance (§3.3)');
  }
  const bytes = Buffer.byteLength(actor, 'utf8');
  if (bytes > ACTOR_MAX_BYTES) {
    throw new ValidationError(`actor exceeds ${ACTOR_MAX_BYTES} bytes (${bytes})`);
  }
  // Reject control characters and bracket sequences that could forge a second
  // "[from: ...]" tag or a role-break marker inside the rendered context string —
  // the concrete R-7 injection vector this cap exists to close.
  if (/[\r\n\x00-\x1f]|\[from:/i.test(actor)) {
    throw new ValidationError('actor contains disallowed control characters or a forged provenance tag');
  }
}

function assertSubject(subject: string): void {
  if (!subject) throw new ValidationError('subject is required');
  const bytes = Buffer.byteLength(subject, 'utf8');
  if (bytes > SUBJECT_MAX_BYTES) {
    throw new ValidationError(`subject exceeds ${SUBJECT_MAX_BYTES} bytes (${bytes})`);
  }
}

export function makeCoordination(db: Database) {
  const insertPheromone = db.prepare(`
    INSERT INTO coord_pheromones (subject, project_root, note, intensity, actor, created_at)
    VALUES (@subject, @project_root, @note, @intensity, @actor, @created_at)
  `);
  const upsertAlertStmt = db.prepare(`
    INSERT INTO coord_alerts (alert_key, project_root, message, actor, created_at, expires_at)
    VALUES (@alert_key, @project_root, @message, @actor, @created_at, @expires_at)
    ON CONFLICT(alert_key, project_root) DO UPDATE SET
      message = excluded.message, actor = excluded.actor,
      created_at = excluded.created_at, expires_at = excluded.expires_at
  `);
  const bumpDropped = db.prepare(`
    UPDATE coord_dropped_writes SET count = count + 1, last_dropped_at = @now WHERE id = 1
  `);

  return {
    spray(input: PherInput): void {
      assertActor(input.actor);
      assertSubject(input.subject);
      const noteBytes = Buffer.byteLength(input.note, 'utf8');
      if (noteBytes > NOTE_MAX_BYTES) {
        throw new ValidationError(`note exceeds ${NOTE_MAX_BYTES} bytes (${noteBytes})`);
      }
      insertPheromone.run({ ...input, created_at: Date.now() });
    },
    upsertAlert(input: AlertInput): void {
      // Same invariant as spray(): alerts are ALSO injected into agent-trusted
      // context (G8 covers both tables) — an alert with an empty/forged actor
      // is exactly as much of a provenance gap as an unattributed pheromone.
      // This check did not exist in the original draft; it is not optional.
      assertActor(input.actor);
      if (!input.alert_key) throw new ValidationError('alert_key is required');
      upsertAlertStmt.run({ ...input, created_at: Date.now() });
    },
    recordDroppedWrite(): void {
      bumpDropped.run({ now: Date.now() });
    },
  };
}
```

**Provenance is mandatory, not optional — and now enforced symmetrically on both write paths.** Every value injected into `hookSpecificOutput.additionalContext` today is unqualified, unattributed text that Claude Code's own hook contract treats as **trusted** context for the next turn (that's the entire mechanism of the "Suggestibility Envelope" — confirmed at `bin/pd-hook-prompt` line 136–145). Any writer — buggy, adversarial, or an agent relaying scraped file content into a pheromone note — currently becomes a first-class trusted instruction with zero attribution. The `actor` column already exists in schema (§3.1); this migration is the natural forcing point to require it be non-empty, bounded, and control-character-free at write time, and surfaced in the injected text as `[from: <actor>] <note>`, not silently dropped as cosmetic metadata. **The original draft only validated `actor` in `spray()`; `upsertAlert()` had no equivalent check despite alerts also being agent-trusted content — that asymmetry is fixed above.**

**Call-site verification required at PR4 execution time:** `lib/fleet-daemon.ts::syncApprovalAlert()` is the one production call site that will invoke `upsertAlert()` today. Before PR4 lands, confirm its actual call supplies a real, non-empty actor string — it does not today (it currently calls `setKey`/`deleteKey` directly with no actor concept at all, since the flat-file schema has no actor field). The recommended literal value is `actor: 'system:fleet-daemon'` — descriptive, stable, greppable, and immediately distinguishable from a human/agent actor tag in rendered context. This is a one-line addition at that call site, tracked as a PR4 subtask, not assumed to already exist.

### 3.4 Daemon-side write path (RPC, not direct CLI INSERT)

```ts
// routes/squid-coordination.ts — mirrors the existing routes/attention.ts pattern,
// one more route among the daemon's ~40 existing route files (precedented, not novel).
// Mounted on the UDS listener built/verified in §3.7 — NOT assumed to already exist.
router.post('/squid/pheromone', (req, res) => {
  try {
    coordination.spray(req.body);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post('/squid/lock/acquire', (req, res) => {
  const { name, owner, ttl } = req.body;
  const result = locks.acquire(`squid:file:${name}`, { owner, ttl: ttl ?? 300_000 });
  res.status(result.success ? 200 : 409).json(result);
});
```

**Why RPC, not direct-CLI `sqlite3 db "INSERT ..."` from the tentacle.** Reads stay direct-CLI (§3.2) because that is the actual measured bottleneck and gains nothing from a daemon round-trip. Writes route through the daemon because: (a) the heartbeat gate (§2.2) already makes "daemon down" a hard precondition failure for every hook today, so RPC adds zero *new* liveness dependency **once the transport it rides on is confirmed to exist — §3.7**; (b) it eliminates the entire class of SQL-string-escaping bugs on the write path — bind parameters via `better-sqlite3`'s prepared statements are safe by construction, whereas every shell-side `INSERT` would need the same `squid_sql_escape()` discipline as reads, with a much higher cost of a missed case (a dropped write vs. a dropped read); (c) it collapses K≥8 concurrent shell-subprocess writers competing for SQLite's single write-transaction lock into K≥8 HTTP/socket clients queueing at one request handler — a better-understood, easier-to-load-test contention model, now explicitly tested together with the daemon's own concurrent connection, not in isolation from it (§6.7); (d) it centralizes validation (§3.3's `actor`/`subject`/`note` requirements) in one TypeScript module instead of duplicating logic across four POSIX shell scripts.

**`lib/fleet-daemon.ts`'s `syncApprovalAlert()`** already runs inside the daemon's own process — it calls `coordination.upsertAlert()` **in-process**, no RPC hop, no `curl`. It stops importing `lib/squid/matrix.ts`. Per §3.3, its call site must be updated in the same PR4 commit to pass `actor: 'system:fleet-daemon'`.

**Fail-open shape for writes, exact:**
```sh
curl -s --max-time 0.5 --unix-socket "$SOCK" -X POST ... -d "..." >/dev/null 2>&1
exit 0   # unconditional — a failed write is never allowed to affect exit status
```
**No spool-file fallback.** A local "write to a spool file, drain on next daemon-write success" fallback was considered and explicitly rejected: it is structurally the same never-drained-append-only-file bug this migration exists to kill, just relocated. A dropped write is dropped — `exit 0`, and the daemon-side counter (`coord_dropped_writes`, §3.1) makes the gap **visible** via `pd doctor`/`pd sitrep` instead of silently accumulating, which is the actual fix for "the reconcile loop silently stopped and nobody noticed for two months," applied to the write path instead of building a second thing to silently stop.

### 3.5 Locking / WAL configuration — exact PRAGMAs, and all four maintenance jobs shown as real code

**Daemon connection — reuse `lib/db.ts`'s existing block verbatim (lines ~682–715, confirmed live), add nothing new here:**
```ts
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('wal_autocheckpoint = 200');
db.pragma('auto_vacuum = INCREMENTAL');   // see §4 Step 0 — no-op on an already-populated file without a prior VACUUM
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
```

**All four `coord_maintenance` jobs, wired to the daemon's existing tick loop (do not invent a new `setInterval`; piggyback on `lib/fleet-daemon.ts`'s existing one). This is the direct fix for the RECONCILE TODO's actual failure mode: the original draft only showed `wal_checkpoint` in code and left the other three as prose — that is the exact "described, never wired, never monitored" pattern this migration exists to end, reproduced for 3 of 4 jobs. All four are shown below as real code, each independently monitored:**

```ts
function recordMaintenance(job: string, rowsAffected: number, error?: string) {
  db.prepare(`
    UPDATE coord_maintenance
    SET last_run_at = @now, rows_affected = @rows, last_error = @error
    WHERE job = @job
  `).run({ job, now: Date.now(), rows: rowsAffected, error: error ?? null });
}

const PHEROMONE_MAX_AGE_MS = 24 * 60 * 60 * 1000;   // 24h
const PHEROMONE_ROW_CAP = 5000;                     // hard backstop, independent of age
const PHEROMONE_PRUNE_TO = 4000;                    // delete oldest down to this count when over cap

const ALERT_ROW_CAP = 2000;                         // alerts are lower-volume than pheromones by design
const ALERT_PRUNE_TO = 1500;                        // (UNIQUE(alert_key, project_root) bounds *known*
                                                     //  keys, but not novel dynamically-named ones — the
                                                     //  backstop exists for the unbounded tail, not the norm)

function prunePheromones() {
  try {
    let affected = 0;
    // Age-window delete (correctness backstop for the read-time decay math).
    affected += db.prepare(
      `DELETE FROM coord_pheromones WHERE created_at < ?`
    ).run(Date.now() - PHEROMONE_MAX_AGE_MS).changes;
    // Hard row-count backstop, independent of the age window — exists specifically
    // so a bug in the decay math or the age constant cannot reproduce the original
    // unbounded-growth failure under a different name (§3.6).
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM coord_pheromones`).get() as { n: number };
    if (n > PHEROMONE_ROW_CAP) {
      const toDelete = n - PHEROMONE_PRUNE_TO;
      affected += db.prepare(`
        DELETE FROM coord_pheromones WHERE id IN (
          SELECT id FROM coord_pheromones ORDER BY created_at ASC LIMIT ?
        )
      `).run(toDelete).changes;
    }
    recordMaintenance('prune_pheromones', affected);
  } catch (e) {
    recordMaintenance('prune_pheromones', 0, String(e));
  }
}

function pruneAlerts() {
  try {
    let affected = 0;
    // Explicit-expiry delete.
    affected += db.prepare(
      `DELETE FROM coord_alerts WHERE expires_at IS NOT NULL AND expires_at < ?`
    ).run(Date.now()).changes;
    // Same row-count-backstop shape as pheromones, numbers stated explicitly (§3.6).
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM coord_alerts`).get() as { n: number };
    if (n > ALERT_ROW_CAP) {
      const toDelete = n - ALERT_PRUNE_TO;
      affected += db.prepare(`
        DELETE FROM coord_alerts WHERE id IN (
          SELECT id FROM coord_alerts ORDER BY created_at ASC LIMIT ?
        )
      `).run(toDelete).changes;
    }
    recordMaintenance('prune_alerts', affected);
  } catch (e) {
    recordMaintenance('prune_alerts', 0, String(e));
  }
}

function reapExpiredLocks() {
  try {
    // Reuses lib/locks.ts's already-implemented releaseExpired() — no new lock-expiry
    // logic invented here, per §3.1's "riding an existing primitive" framing.
    const result = locksModule.releaseExpired();
    recordMaintenance('reap_expired_locks', result.count);
  } catch (e) {
    recordMaintenance('reap_expired_locks', 0, String(e));
  }
}

function checkpointWal() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('incremental_vacuum');
    recordMaintenance('wal_checkpoint', 0);
  } catch (e) {
    recordMaintenance('wal_checkpoint', 0, String(e));
  }
}

// Wired into the daemon's EXISTING tick interval — not a new setInterval.
function onDaemonTick() {
  prunePheromones();
  pruneAlerts();
  reapExpiredLocks();
  checkpointWal();
}
```
This is not optional insurance — passive checkpoints (what `wal_autocheckpoint` alone triggers) are documented by SQLite itself to no-op while any reader holds an open snapshot, and the daemon's own long-lived connection is exactly that reader. Without an active `TRUNCATE` checkpoint on a timer, the `-wal` file can grow unbounded even with `wal_autocheckpoint` configured — the identical failure shape (unbounded file growth from an unmonitored maintenance assumption) this migration exists to kill.

**Every shell CLI invocation, unconditionally, as the first statement:** `PRAGMA busy_timeout=400;` (or `200` for the statusline's lower-value reads). Pragmas are per-connection, not per-file — the daemon's `busy_timeout=5000` does not apply to a fresh `sqlite3` subprocess. 400ms is chosen deliberately: short enough to stay well inside the 10s hook-kill budget even under contention, long enough to absorb a normal single-row daemon commit (sub-millisecond in practice).

**Hard precondition, verified live and NOT yet true on this operator's machine — see §4 Step 0:** `PRAGMA auto_vacuum` on `~/.port-daddy/port-registry.db` currently reads `0` (NONE), confirmed via direct query. `auto_vacuum = INCREMENTAL` is a no-op on an already-populated file until a one-time `VACUUM` rewrites it. Coordination tables must not be added to this file until that one-time `VACUUM` has actually run, been verified, and — per the operator's own standing backup rule — been preceded by a backup (§4 Step 0).

### 3.6 TTL / decay / pruning strategy (numbers now explicit and code-backed, §3.5)

- **Pheromones** decay at **read time** via `intensity * exp(-λt)` in every `SELECT` (§3.2) — correctness requires no background job. **Bounding storage** is the daemon tick's `prunePheromones()` (§3.5): a 24h age-window delete, **plus a hard row-count backstop independent of the time window: cap 5000 rows, prune down to 4000 when exceeded.** This backstop exists specifically so a bug in the decay math or the age-window constant cannot reproduce the original unbounded-growth failure under a different name. Correctness of this exact deletion is asserted by a dedicated unit test — §6.8.
- **Alerts** carry an explicit `expires_at` set by the caller at write time (e.g. 24h for one-shot release-smoke alerts, `NULL` + the same shape of row-count backstop for persistent ones like `FLEET_APPROVALS`, which is re-upserted on every state change anyway via the `UNIQUE(alert_key, project_root)` upsert). **The backstop numbers, stated explicitly (previously missing): cap 2000 rows, prune down to 1500 when exceeded** — lower than pheromones' 5000/4000 because alerts are steering signals, not high-frequency traces, and `UNIQUE(alert_key, project_root)` already bounds the *known*-key population; the backstop exists for the unbounded tail of dynamically-named alert keys, not the expected steady state. Asserted by a dedicated unit test — §6.9.
- **Locks** use `lib/locks.ts`'s already-implemented `releaseExpired()`, called on the same daemon tick via `reapExpiredLocks()` (§3.5). Default TTL 5 minutes, matching `lib/locks.ts`'s own existing default. **Explicitly deferred, stated not silently dropped:** PID-liveness-tied lock expiry (Chubby/ZooKeeper-style) is not built in v1 — since locks have zero production callers today, there is no real usage data yet to design liveness-tied expiry against; revisit once the new lock-acquire path (§4 PR4) has real traffic.
- **Every prune/checkpoint run writes to `coord_maintenance`, per job** (`last_run_at`, `rows_affected`, `last_error`), all four rows seeded at migration time (§3.1) so a never-run job is immediately visible as stale rather than silently absent from the table. This, plus `pd doctor` checking each row individually (§6.4), is the concrete, testable version of "the reconcile loop must never silently stop again" — the direct answer to the RECONCILE TODO's actual failure mode, closed for all four jobs, not just `wal_checkpoint`.

### 3.7 Unix-domain-socket RPC transport — verification and build task (closes a previously-unverified prerequisite)

§3.4's entire write path assumes the daemon accepts HTTP requests over a Unix domain socket at `${PD_HOME}/port-daddy.sock`. **This was asserted, not confirmed, in the original draft** — `squid_socket_path()`'s own comment admitted the path was "reserved," and the memory notes cited elsewhere in this repo ("socket+TCP takeover guard," PR #675) describe a *daemon-liveness* mechanism (detecting and recovering from a split-brain daemon), not necessarily an HTTP-over-UDS *request-serving* listener. These are different things and must not be conflated.

**Step 0.5 — verification, sequenced immediately after Step 0 and before PR2's RPC routes are scoped as "just wire routes":**

1. Inspect the daemon's actual listener setup (`lib/daemon-server.ts` or equivalent entry point — locate via `grep -rn "createServer\|listen(" lib/ routes/` at execution time) and confirm whether it already binds a UDS in addition to its TCP `:9886` listener.
2. If a UDS HTTP listener already exists: confirm its exact path matches (or update `squid_socket_path()` to match) and confirm it serves the same Express/router stack the new `/squid/*` routes will mount onto.
3. **If no UDS listener exists** (the more likely case, given the "reserved" comment), this is a build task, scoped explicitly as part of PR2, not assumed free:

```ts
// lib/daemon-server.ts — additive change, existing TCP listener untouched.
import { createServer } from 'node:http';
import { unlinkSync, existsSync } from 'node:fs';

const socketPath = `${PD_HOME}/port-daddy.sock`;
if (existsSync(socketPath)) unlinkSync(socketPath);   // stale socket file from a prior crashed daemon

const udsServer = createServer(app);   // `app` = the SAME Express app the TCP listener already serves
udsServer.listen(socketPath, () => {
  chmodSync(socketPath, 0o600);        // local-machine-only, matches the daemon's existing trust boundary
});
udsServer.on('error', (e) => {
  logger.error('UDS listener failed to bind — /squid/* RPC writes will fail open, no daemon crash', e);
});
```
4. Regardless of which branch applies, add a smoke-test step to PR2: `curl -s --unix-socket "$SOCK" http://localhost/health` (or an equivalent already-existing health route) must return 200 before any `/squid/*` route is considered wired. This is the concrete "verification step (or a build task)" the completeness pass required — PR4 cannot be scoped as "just wire RPC routes" until this returns green.

**Done when:** the UDS smoke-test curl above succeeds against a locally-running dev daemon, checked into a PR2 CI step (or a documented manual verification step if CI cannot easily run a live daemon — flagged for the executing engineer to resolve concretely, not silently skipped).

### 3.7b SQLite `exp()` capability — verified, not assumed (companion to §3.7's transport verification)

The decay query in §3.2 depends on SQLite's math-functions extension (`exp()`, used to compute `intensity * exp(-λt)`). This is **not universally compiled into every `sqlite3` binary**, even recent ones — it requires the `SQLITE_ENABLE_MATH_FUNCTIONS` compile flag. The stock `sqlite3` CLI amalgamation has shipped with this flag on by default since SQLite 3.35.0 (2021-03-12), but that does not automatically extend to (a) every OS package manager's build of the `sqlite3` CLI, or (b) the separately-compiled SQLite bundled inside the `better-sqlite3` npm package the daemon links against — these are two different compiled artifacts and must both be checked, not just the CLI `sqlite3 --version` presence check G6 originally specified.

**Minimum-version/build-flag requirement, stated explicitly (previously absent from the plan):** SQLite ≥ 3.35.0, compiled with `SQLITE_ENABLE_MATH_FUNCTIONS`. **Capability check, not just version check** — added to both PR2 CI and `pd doctor`:

```sh
# Shell-side (CLI) capability check — bin/pd-squid-lib.sh addition, called once at PR2 CI time
# and by `pd doctor`, NOT on every hook invocation (too expensive per-call).
squid_check_math_functions() {
  SQLITE="$(squid_sqlite_bin)" || return 1
  RESULT=$("$SQLITE" ":memory:" "SELECT exp(1.0);" 2>&1)
  case "$RESULT" in
    2.71828*) return 0 ;;
    *) echo "sqlite3 CLI lacks math functions (exp()): $RESULT" >&2; return 1 ;;
  esac
}
```
```ts
// Daemon-side (better-sqlite3) capability check — cli/utils/startup-doctor.ts addition.
function checkSqliteMathFunctions(db: Database): { ok: boolean; detail?: string } {
  try {
    const row = db.prepare(`SELECT exp(1.0) AS e`).get() as { e: number };
    return Math.abs(row.e - Math.E) < 0.001
      ? { ok: true }
      : { ok: false, detail: `unexpected exp(1.0) result: ${row.e}` };
  } catch (e) {
    return { ok: false, detail: `better-sqlite3 build lacks math functions: ${String(e)}` };
  }
}
```

Both checks are added to PR2's CI step (§4 PR2 item 5) and `pd doctor` (§4 PR2 item 6, extended). **If either check fails on a target environment, the decay query cannot ship as written for that environment** — the fallback (documented, not silently applied) is to compute effective intensity in the application layer (fetch raw `intensity`/`created_at`, apply `Math.exp()` in TypeScript for the daemon-RPC path, or drop `LIMIT`-bounded decay filtering entirely for the read-only shell path and accept slightly less precise freshness ordering) rather than assume the SQL function is always available. This is the same class of "unverified environment assumption" the whole migration exists to fix, and it is closed here rather than left as a debate-round finding that never made it into the final document.

---

## 4. Migration Plan — numbered, sequenced

Five small, individually mergeable, individually revertible PRs behind **one env var kill switch** (`PD_MATRIX_BACKEND=flatfile|sqlite`, default `flatfile` until PR5). **Not** a multi-week dual-write/dual-read burn-in across a canary population — there is no canary population: hooks are copy-installed to one shared staged location per machine (`cli/commands/hooks-install.ts`'s `tentacleBinDir()`), so a reinstall flips 100% of hook invocations on that machine instantly. That fact argues for a fast, verified kill switch, not a slow phased rollout sized for infrastructure that doesn't exist here. **Not** a single big-bang PR either — that recreates the "one giant unmergeable proposal" shape that let the RECONCILE TODO sit uncompleted for two months.

### Step 0 — Precondition fix (before PR1, standalone, not gated by the flag)

Run against `PORT_DADDY_DB` (resolve the actual path via `scripts/db-consolidate.ts`'s resolution logic, do not assume `~/.port-daddy/port-registry.db` without checking `PORT_DADDY_DB` env var first — see the `squid_db_path()` comment in §3.2):

1. `sqlite3 "$DB" "PRAGMA auto_vacuum;"` — confirm current value (verified `0`/NONE on the operator's machine at plan-authoring time).
2. **Backup before any destructive rewrite (previously missing — closed here per the operator's own standing rule that irreversible operations get backed up first, not just post-hoc integrity-checked):**
   ```sh
   cp "$DB" "${DB}.bak-pre-vacuum-$(date +%Y%m%d-%H%M%S)"
   sqlite3 "${DB}.bak-pre-vacuum-$(date +%Y%m%d-%H%M%S)" "PRAGMA integrity_check;"   # verify the backup itself is readable, not just copied
   ```
   Keep this backup until Step 0's own done-when criteria (below) are fully satisfied and at least one subsequent daemon restart has confirmed the live file is healthy; do not auto-delete it as part of this step.
3. If `auto_vacuum` reads `0`: `sqlite3 "$DB" "PRAGMA auto_vacuum = INCREMENTAL; VACUUM;"` — this rewrites the file once; **budget real wall-clock time for a 937MB file** and run it when the daemon can be briefly stopped (VACUUM needs exclusive access).
4. Verify post-VACUUM: `PRAGMA auto_vacuum;` reads `2` (INCREMENTAL), and `PRAGMA integrity_check;` reads `ok`.
5. Also address the other four zero-byte `.db` fragments (`daemon.db`, `pd.db`, `port-daddy.db`, `registry.db`) per the existing (already-shipped) `scripts/db-consolidate.ts` tooling — confirm they're genuinely dead (zero-byte, unreferenced by any live `PORT_DADDY_DB` pointer) before deleting; do not hand-delete without running the consolidation script's own dry-run first.

**Done when:** a pre-VACUUM backup exists and has passed its own `integrity_check`; `PRAGMA auto_vacuum` on the consolidated DB reads `2`; `integrity_check` reads `ok`; file size is not materially larger after the VACUUM than before (a shrink or no-change is expected; growth indicates something went wrong and must be investigated before proceeding).

### Step 0.5 — UDS transport verification/build (before PR2's RPC routes are scoped as complete)

Per §3.7: confirm or build the Unix-domain-socket HTTP listener the write path depends on. **Done when:** §3.7's smoke-test curl against `/health` (or equivalent) over the UDS returns 200.

### PR1 — Parser consolidation, zero behavior change

Collapse `lib/squid/identity.ts::readMatrixSnapshot()` and `lib/local-citizen/ink-cloud.ts` to call `lib/squid/matrix.ts`'s existing public API instead of independently re-parsing the raw file. **No schema change, no hook change.** Existing tests (`tests/unit/squid-identity.test.ts`) must pass **unmodified** — this is the proof the refactor is behaviorally inert. De-risks every subsequent PR by making "read the matrix" one call site instead of three, before any of those call sites' underlying storage changes.

**Done when:** `tests/unit/squid-identity.test.ts` passes with zero test-file edits; `grep -rn "readFileSync.*matrix\|MATRIX.*readFileSync"` outside `lib/squid/matrix.ts` returns nothing in `lib/squid/identity.ts` or `lib/local-citizen/ink-cloud.ts`.

### PR2 — Schema + daemon RPC routes + concurrency/perf tests, dark (zero operator-visible change)

1. Re-verify the next-available migration number (§3.1 — do not assume `087` without re-checking `migrations/` at execution time) and land `migrations/08X_squid_coordination.sql` (§3.1).
2. Land `lib/squid/coordination.ts` (§3.3) and `routes/squid-coordination.ts` (§3.4), mounted on the UDS listener confirmed/built in Step 0.5.
3. Port the existing real K=8 concurrency test — confirmed present today at `tests/unit/squid-harness.test.ts:611`, `'K=8 concurrent post-tool appends produce 8 intact pheromone lines (Jamie Madrox)'`, using `Promise.all` over spawned processes — to assert against the new sqlite path instead of the flat file. **Do not write this test from scratch; port the existing one**, since it already encodes the right concurrency shape. **Extend it to K=9 by adding the daemon's own long-lived connection as a concurrent participant, not just 8 independent `sqlite3` subprocesses** — this is Debate Verdict 1's "one genuinely novel risk this migration introduces" and is closed as a first-class test, not left as a design note (§6.7).
4. Add the **component-level** realistic-scale stress test (§6.2a) — a direct `db.prepare().all()` benchmark with no process-spawn overhead and no dependency on any hook understanding the sqlite backend. This is the direct, mandatory fix for G5's silent violation at the query layer and must exist before any hook is cut over. **The full hook-level end-to-end benchmark (invoking `runHook('pd-hook-prompt', ...)`) is explicitly NOT a PR2 gate** — it depends on `pd-hook-prompt` already speaking the sqlite backend, which is PR3's deliverable. It is scoped as a PR3 merge gate instead (§4 PR3, §6.2b). This resolves the sequencing contradiction in the original draft, which stated both "PR2 is dark, zero hook change" and "PR2 must contain a test that exercises the rewritten hook" — those cannot both be true, and the component/E2E split is the resolution, not a combined-PR2+PR3 unit.
5. Add `.github/workflows/ci.yml` step: explicit `apt-get install -y sqlite3` (Linux) + `sqlite3 --version` verification **plus the `exp()` math-function capability check from §3.7b** on both `ubuntu-latest` and `macos-latest` matrix legs. Currently absent — `sqlite3` has been an implicit, unverified assumption in this repo's CI. GitHub's `actions/runner-images#11279` (Dec 2024) documents a real historical stretch where `sqlite3` was silently absent from `ubuntu-24.04` runners; treat this as a permanent tripwire, not one-time insurance. The math-function check is not optional insurance either — it is the same class of previously-unverified assumption, closed for the same reason.
6. Add `sqlite3`/`curl` presence+version checks **and the daemon-side `checkSqliteMathFunctions()` check (§3.7b)** to `cli/utils/startup-doctor.ts`, plus a `coord_maintenance` staleness check that reads **all four job rows individually** (reads `last_run_at` per job, fails loudly — not warn — if `now - last_run_at > 2x expected_interval`, for *any* of the four, named individually in the failure message).

**No hook touches this code yet.** Fully reviewable and revertible in isolation; zero operator-visible behavior change.

**Done when:** all PR2 tests pass in CI on both OS legs, including the K=9 concurrency test and the component-level stress test; `pd doctor` reports the new checks (sqlite/curl presence, math-function capability, per-job maintenance staleness — even though the staleness check will correctly report "never run" until PR3/PR4 land, since all four rows are seeded at `last_run_at=0`); `coord_maintenance` table exists, is queryable, and contains all four seeded rows; UDS smoke test passes.

### PR3 — Read-path cutover (`pd-hook-prompt`, `pd-statusline`)

1. Rewrite `bin/pd-hook-prompt` and `bin/pd-statusline` per §3.2's AFTER pseudocode, gated behind `PD_MATRIX_BACKEND` (default remains `flatfile`).
2. Land `bin/pd-squid-lib.sh`.
3. **Mandatory merge gate, new in this revision:** the full hook-level end-to-end stress test (§6.2b) — `runHook('pd-hook-prompt', { env: { PD_MATRIX_BACKEND: 'sqlite' }, ... })` against 5,000+ seeded rows, asserting wall-clock latency under the stated bound. This is where that test correctly belongs (it depends on the rewritten hook, which is this PR's deliverable), not PR2.
4. Worst-case bug surface: stale or missing injected context — never wrong tool enforcement, since neither of these two hooks can `exit 2`.
5. Operator flips `PD_MATRIX_BACKEND=sqlite` manually after local smoke testing (`pd squid tap` against a seeded sqlite fixture). Flipping back is a one-line env edit — no redeploy, no rebuild, no hook reinstall.

**Done when:** with the flag flipped, `pd-hook-prompt` and `pd-statusline` produce output content-equivalent to the flat-file path against the same seeded state (differential test, §6.3); the hook-level E2E stress test (§6.2b) passes with measured latency at 3,000+ seeded rows under 200ms wall-clock (§9 G1).

### PR4 — Lock-check + write-path cutover (highest-stakes PR)

1. `bin/pd-hook-pre-tool` rewritten to read locks from `lib/locks.ts`'s table (§3.2 AFTER). Still fail-open on any sqlite/daemon-unreachable error.
2. **The lock-*acquire* feature is built for the first time in production** — since nothing writes `PD_LOCK_*` via `lib/locks.ts` today, this is genuinely new functionality and must be reviewed as such (not treated with the extreme migration-caution appropriate to live-traffic cutover, since there is no live traffic on this path yet — see §8 R-4).
3. `bin/pd-hook-post-tool` rewritten to write pheromones/alerts via daemon RPC (§3.2 AFTER, §3.4), routed through the UDS listener confirmed/built in Step 0.5.
4. `lib/fleet-daemon.ts::syncApprovalAlert()` ported to call `coordination.upsertAlert()` in-process (§3.4), **updated in this same commit to pass `actor: 'system:fleet-daemon'`** (§3.3) so it does not immediately start throwing once the actor-check lands.
5. **Mandatory merge gate — adversarial fail-open test suite** (§6.1) covering: daemon down, db file missing, db file corrupted, `sqlite3` binary missing, `curl` binary missing, lock held past `busy_timeout`, **and the new concurrent-acquire TOCTOU scenario (§6.1a)**. Every case must be asserted to degrade to allow/no-op — never hang, never a nonzero exit for any reason other than a genuine, correctly-detected lock conflict. This suite is a hard blocker on this PR, not a follow-up.
6. **New mandatory merge gate:** the field-cap unit tests (§6.10 — oversized `note`/`actor`/`subject` all throw `ValidationError`) and the maintenance-job tests (§6.4, §6.8, §6.9 — all four jobs individually wired and asserted, backstop deletion actually verified to drop row counts to the stated targets).

**Done when:** the adversarial suite (§6.1, including §6.1a) passes in full; a real end-to-end run with two concurrent agent sessions on the same machine demonstrates lock enforcement (agent B blocked editing a file agent A holds) and pheromone propagation (agent B sees agent A's note in its next `pd-hook-prompt` context, correctly actor-tagged) under `PD_MATRIX_BACKEND=sqlite`; all §6.8/§6.9/§6.10 tests pass.

### PR5 — Delete + document (ships only after real organic bake time under PR4's flag)

Bake criterion: the operator's own real daily usage exercising `PD_MATRIX_BACKEND=sqlite` without incident — a single-operator machine has no canary population to size a calendar-duration bake against, so this is usage-gated, not date-gated.

1. Flip default to `sqlite`.
2. Stop writing `matrix.env` anywhere; `lib/squid/matrix.ts`'s flat-file internals replaced by calls into `lib/squid/coordination.ts`, **keeping the same exported function names** (`setKey`/`appendPheromone`/`setLock`/etc.) to minimize churn at remaining call sites that import from `matrix.ts`.
3. **`PD_MATRIX_BACKEND` flag disposition, stated explicitly (previously ambiguous):** the flag's "verified to actually restore identical hook behavior" property (§9 G12) applies **only through PR4** — that is the last state where both a working flatfile implementation and a working sqlite implementation coexist behind the flag. PR5 deletes the flat-file internals entirely (step 2 above), so the flag can no longer restore flatfile behavior by definition. **This PR removes `PD_MATRIX_BACKEND` as a functioning dual-mode switch and either (a) deletes all references to it as dead code, or (b) freezes it as a sqlite-only no-op that logs a deprecation warning if set to `flatfile` and proceeds on sqlite anyway** — option (b) is preferred, to avoid a silent behavior change for any external script that still sets the env var out of habit. Whichever is chosen, it is a stated decision in this PR's description and in the new ADR (§10), not left as ambiguous "the flag still exists but nobody's sure what it does" dead code.
4. Full file-by-file disposition per §5 executed: rewrite demos/release scripts/skills/prompts/website copy, update ADR statuses, add the CHANGELOG entry, fix `docs/roadmap/roadmap.snapshot.json` via normal tooling (patch-append-only, no hand-edit).
5. Each of PR1–PR5 is its own tracked roadmap item from the start, not one mega-issue filed at the end — this is the direct structural fix for the RECONCILE TODO's actual failure mode (an unscheduled code comment, not a tracked gated unit of work).

**Done when:** `grep -rn "matrix\.env\|PD_MATRIX_FILE" --include='*.ts' --include='*.sh' .` (excluding historical CHANGELOG entries and ADR bodies marked Superseded) returns zero hits; `matrix.env` itself is deleted from `~/.port-daddy/` after a final confirmed read of its content (nothing irreplaceable — it's a hot cache by design, confirmed in §2.2); all four hooks + statusline run exclusively against sqlite; `pd squid status` shows the new backend; `PD_MATRIX_BACKEND`'s post-PR5 disposition (deleted or frozen sqlite-only-with-deprecation-warning, per step 3 above) is documented in the CHANGELOG entry and the new ADR.

---

## 5. File-by-File Disposition Table

| # | File | Current role | Action | Done-when | PR |
|---|---|---|---|---|---|
| 1 | `bin/pd-hook-prompt` | Reads matrix, injects context | REWRITE | §3.2 AFTER lands; differential test (§6.3) passes; hook-level stress test (§6.2b) passes | PR3 |
| 2 | `bin/pd-statusline` | Statusline badge counts (missed by original brief) | REWRITE | §3.2 AFTER lands; badge renders correctly at 3k+ seeded rows | PR3 |
| 3 | `bin/pd-hook-pre-tool` | Enforced lock gate, `exit 2` | REWRITE | Adversarial suite §6.1 (incl. §6.1a TOCTOU) passes | PR4 |
| 4 | `bin/pd-hook-post-tool` | Pheromone writer, mkdir-lock fallback | REWRITE | Fail-open suite passes; no `mkdir`/`flock` code remains | PR4 |
| 5 | `bin/pd-squid-lib.sh` | — | NEW (shared shell helper) | Sourced by all 4 hooks above, zero duplication of `squid_sql_escape`/`squid_db_path`/`squid_check_math_functions` | PR3 |
| 6 | `lib/squid/matrix.ts` | Flat-file engine + RECONCILE TODO | REPLACE internals, keep exported names | Zero `node:fs` matrix-file I/O remains; RECONCILE TODO comment deleted (superseded by §3.6) | PR5 |
| 7 | `lib/squid/identity.ts` (`readMatrixSnapshot`) | 2nd independent parser | REWRITE — call shared module | `tests/unit/squid-identity.test.ts` passes unmodified after PR1 | PR1 |
| 8 | `lib/local-citizen/ink-cloud.ts` | 3rd independent parser/writer | REWRITE — call shared module | No independent regex parsing remains | PR1 |
| 9 | `lib/local-citizen/runner.ts` | Thin consumer of #8 | No independent work | Follows #8 automatically | PR1 |
| 10 | `lib/local-citizen/README.md` | Documents #8's lock-key algorithm | REWRITE | Reflects sqlite-backed lock naming (`squid:file:<suffix>`) | PR5 |
| 11 | `lib/fleet-daemon.ts` (`syncApprovalAlert`) | Real production daemon writer | REWRITE — in-process `coordination.upsertAlert`, actor set to `'system:fleet-daemon'` (§3.3) | No `matrix.ts` import remains in this file; call site passes non-empty actor | PR4 |
| 12 | `lib/squid/coordination.ts` | — | NEW — shared read/write module | Exports `spray`/`upsertAlert`/`recordDroppedWrite`, unit-tested incl. field-cap tests (§6.10) | PR2 |
| 13 | `routes/squid-coordination.ts` | — | NEW — daemon RPC routes | `POST /squid/pheromone`, `POST /squid/lock/acquire` respond correctly, mounted on UDS listener (#46) | PR2 |
| 14 | `migrations/08X_squid_coordination.sql` | — | NEW (number re-verified at PR2 execution time, §3.1) | Applies cleanly against a fresh DB and against the operator's real (post-VACUUM) DB | PR2 |
| 15 | `lib/spawner.ts` | Comment-only ADR-0091 reference | Citation update only | No functional change; ADR number corrected | PR5 |
| 16 | `routes/spawn.ts` | Same as #15 | Citation update only | Same | PR5 |
| 17 | `lib/squid/adapter.ts` | Injects hook events into vendor configs | No matrix logic here; citation update | No functional change | PR5 |
| 18 | `lib/squid/terminal.ts` | Color tokens, ADR header ref only | No change | — | — |
| 19 | `cli/commands/squid.ts` (`status`) | 4th independent reader (`readMatrixSnapshot`) | REWRITE — source from #7's updated API | `pd squid status` reports sqlite-backed state | PR5 |
| 20 | `cli/commands/squid.ts` (`tap`) | Runs the real staged tentacle binary | No change | Unaffected — it execs the real hook, which is rewritten elsewhere | — |
| 21 | `cli/commands/hooks-install.ts` | Installs hooks, heartbeat gate | No change | Heartbeat-gate logic is correct as-is and is load-bearing for the RPC-write decision (§3.4) | — |
| 22 | `demos/harness/gen-tapes.sh` | `echo`'s a raw line into matrix.env for a marketing GIF | REWRITE | Swaps raw file append for `coordination.spray()` call or equivalent seed script | PR5 |
| 23 | `scripts/smoke-squid-release.mjs` | Release smoke test, writes then asserts surfacing | REWRITE | Asserts against sqlite fixture | PR5 |
| 24 | `scripts/squid-selftest.sh` | Comprehensive conformance script, heaviest shell lift | REWRITE (largest single file rewrite in this migration) | Every seed/assert step converted to sqlite equivalent; all scenarios (Codex `apply_patch`, lock enforcement) still pass | PR5 |
| 25 | `skills/agentic-software-installation/SKILL.md` | Documents hook contract + manual `PD_MATRIX_FILE` seed snippet | REWRITE | No stale `echo >> matrix.env` snippet remains | PR5 |
| 26 | `skills/port-daddy-internal-dev/examples/02-codex-squid-hook-conformance.md` | Walks through seeding via matrix.env | REWRITE | Same | PR5 |
| 27 | `prompts/port-daddy-citizen.md` | Live agent-facing system prompt, "The Ink Cloud" section | REWRITE, high priority | Section teaches sqlite-backed semantics; this is live-behavior-shaping content, verify by reading the injected prompt for a spawned test agent | PR5 |
| 28 | `website-v2/src/pages/HarnessPage.tsx` | Public marketing copy + embedded terminal recording | REWRITE copy; regenerate recording (sourced from #22) | Copy no longer describes a flat-file mechanism; "Ink Cloud" retained only as a UX metaphor (explicit decision, §5 footer) | PR5 |
| 29 | `CHANGELOG.md` | Historical entries, immutable | No edit to history; new entry added | New entry describes the sqlite cutover, including `PD_MATRIX_BACKEND`'s post-PR5 disposition (§4 PR5 step 3) | PR5 |
| 30 | `docs/adr/0091-giant-squid-harness.md` | Original design, Status: Proposed | Status → Superseded (data-store sections only; hook-wiring sections stay live) | §10 | PR5 |
| 31 | `docs/adr/0108-port-daddy-harness.md` | Status: Proposed, stale "No ADR-0091 exists" + self-numbering bug (line 167) | REWRITE — fix both bugs, reconcile against new ADR | §10 | PR5 |
| 32 | `docs/adr/0051-port-daddy-harness.md` | Already a correct redirect stub → 0108 | No change | Already resolved | — |
| 33 | `docs/architecture/.../2026-07-06-next-gen-reconciliation.md` | Historical work packet, flagged this exact TODO, never completed | No edit (historical); its TODO is closed by this plan | §10 | — |
| 34 | `docs/proposals/articles-of-agreement-harness-roadmap.md` | Lists the dead-0051 reference as pending | Update reference to 0108 or the new ADR number | No dangling 0051 citation remains | PR5 |
| 35 | `docs/roadmap/roadmap.snapshot.json` | Machine-managed, patch-append-only | No hand-edit; new item entered via normal tooling | Roadmap reflects PR1–PR5 as tracked items | Step 0 / ongoing |
| 36 | `docs/proposals/squid-harness-v2-grown-up-harness.md` | Orthogonal (agent-context/compaction axis) | No change; cite for numbering consistency | — | — |
| 37 | `tests/unit/squid-harness.test.ts` | Load-bearing suite, real K=8 test at line 611 | REWRITE | Perf-at-scale (§6.2a/§6.2b) + adversarial fail-open (§6.1, §6.1a) + K=9 concurrency (§6.7) tests added | PR2/PR3/PR4 |
| 38 | `tests/unit/squid-identity.test.ts` | Tests `readMatrixSnapshot()` against a flat fixture | REWRITE alongside #7 | Passes against sqlite fixture | PR1 (unmodified) → PR5 (fixture swap) |
| 39 | `tests/unit/fleet-daemon.test.js` | Mocks `node:fs` because importing `fleet-daemon.ts` transitively pulls in `matrix.ts` | REWRITE mock surface — swap for a `better-sqlite3` in-memory fixture | Passes headlessly with no `node:fs` matrix mocks; asserts `syncApprovalAlert()` passes `actor: 'system:fleet-daemon'` | PR5 |
| 40 | `tests/unit/squid-codex-bridge.test.ts` | Calls `setLock` | REWRITE | Asserts against `lib/locks.ts` table | PR4 |
| 41 | `lib/idea-intake.ts`, `tests/unit/adr-matrix.test.js`, `tests/unit/symbol-index.test.ts` | Unrelated "matrix" concept | **No change — confirmed false positives** | — | — |
| 42 | `.github/workflows/ci.yml` | No `sqlite3` install step today | ADD explicit `apt-get install -y sqlite3` + version verify + `exp()` math-function capability check (§3.7b) (Linux leg) | Both OS legs pass with the verification step present | PR2 |
| 43 | `cli/utils/startup-doctor.ts` | No coordination-store checks today | ADD `sqlite3`/`curl` presence+version checks, `checkSqliteMathFunctions()` (§3.7b), `coord_maintenance` per-job staleness check | `pd doctor` fails loudly (not warn) on any single stale maintenance job, named individually | PR2/PR4 |
| 44 | `apps/fleet-executor/src/execute.ts`, `apps/fleet-executor/tests/map-chunk-scope.test.ts` | Reference `ink-cloud.ts` only as an example file path in an unrelated regression fixture | No functional change; one-line path follow-up only if `ink-cloud.ts` is ever renamed (it isn't in this plan) | — | — |
| 45 | `tests/unit/spawn-routes-preflight.test.js` | Comment-only ADR-0091 reference, no matrix-file I/O | **No change — comment-only citation** | ADR number corrected if the comment cites 0091's data-store sections specifically; otherwise untouched | PR5 (citation sweep only, if applicable) |
| 46 | `lib/squid/hook-shape.ts` | Defines the `timeout=10` budget this whole plan is calibrated against (§1, §2.1, §2.3); exercised by G11's vendor-parity test (§6.5) | **No change — referenced for context, not modified.** Contains no matrix-file I/O; the timeout figure and vendor-adapter shape it defines are load-bearing inputs to this plan's design, not migration targets | Confirmed via source read: zero `matrix.env`/`coord_*`/`locks` references in this file | — |
| 47 | `lib/daemon-server.ts` (or equivalent daemon entry point) | Existing TCP `:9886` listener; UDS listener status unconfirmed prior to this revision | VERIFY (§3.7 Step 0.5); BUILD the additive UDS listener if absent | §3.7's `/health` UDS smoke-test curl returns 200 | Step 0.5 / PR2 |

**Explicit non-goal, stated here and repeated in the new ADR (§10):** this store is single-machine only. Cross-machine coordination is Seam A (Harbors) territory per `PORT-DADDY-COARSENED-ARCHITECTURE.md`, entirely out of scope. `INTEGER PRIMARY KEY AUTOINCREMENT` is used, not ULIDs — the cross-host-merge concern that would justify ULIDs doesn't apply to a store explicitly declared non-syncing. **"Ink Cloud" survives as a UX/marketing metaphor** on the website (item 28) even though the mechanism becomes sqlite — a naming decision made explicitly here, not left to drift.

---

## 6. Test Plan

### 6.1 Adversarial fail-open suite (new, mandatory merge gate for PR4)

New test file or a new `describe` block in `tests/unit/squid-harness.test.ts`. Each case asserts: (a) exit code 0 (or the correct `exit 2` only for genuine lock conflicts), (b) no hang beyond a bounded timeout (assert wall-clock < 1s per invocation), (c) no stderr noise that would pollute agent context.

| Scenario | Setup | Assertion |
|---|---|---|
| Daemon down | Heartbeat file stale/absent | Hook exits 0, no context injected, no crash |
| DB file missing | `PORT_DADDY_DB` points at nonexistent path | Hook exits 0 |
| DB file corrupted | Truncate/garbage-fill the sqlite file | Hook exits 0, `PRAGMA integrity_check` failure does not propagate as a crash |
| `sqlite3` binary missing | `PATH` stripped of `sqlite3`, `/usr/bin/sqlite3` also stubbed absent | Hook exits 0 |
| `curl` binary missing | `PATH` stripped of `curl` | Write hook (`pd-hook-post-tool`) exits 0; `coord_dropped_writes` unaffected (no write attempted, not a drop) |
| Lock held past `busy_timeout` | Hold an exclusive write transaction open on the DB for >400ms in a separate process, then invoke the lock-check hook | Hook exits 0 (fails open on the read timeout — does not falsely report "locked" or hang) |
| Malformed pheromone note (embedded single quote, semicolon, `--`) | `note = "don't merge; DROP TABLE coord_pheromones; --"` | Write succeeds as literal text (escaped correctly), table still exists afterward, `integrity_check` = `ok` |
| UDS socket unreachable (stale/missing socket file, or daemon bound to a different path) | Delete or point `PD_HOME` at a directory with no live socket | Write hook exits 0 (§3.4's unconditional `exit 0`); `coord_dropped_writes` does NOT increment (no daemon received the request to count it — this is a client-side drop, distinct from a daemon-side validation drop) |

### 6.1a Concurrent lock-acquire correctness (TOCTOU) — new, mandatory merge gate for PR4

Debate Verdict 1 frames this explicitly as "a real requirement for whenever lock-writing actually gets built," and R-4 recalibrates the lock-acquire path as genuinely new code requiring scrutiny distinct from a migration-of-something-already-live. §6.1's adversarial suite only tests the read side (lock held past timeout); this closes the write-side correctness gap.

```ts
test('two simultaneous POST /squid/lock/acquire for the same name — exactly one must win', async () => {
  const name = 'squid:file:concurrent-toctou-target.ts';
  const [resultA, resultB] = await Promise.all([
    postAcquire(sock, { name, owner: 'agent-a', ttl: 300_000 }),
    postAcquire(sock, { name, owner: 'agent-b', ttl: 300_000 }),
  ]);
  const winners = [resultA, resultB].filter(r => r.status === 200);
  const losers = [resultA, resultB].filter(r => r.status === 409);
  expect(winners.length).toBe(1);
  expect(losers.length).toBe(1);
  // Confirm the row itself is single-owner, not a torn write from two racing INSERTs.
  const row = db.prepare(`SELECT owner FROM locks WHERE name = ?`).get(name);
  expect(row.owner).toBe(winners[0] === resultA ? 'agent-a' : 'agent-b');
});
```
Relies on `lib/locks.ts::acquire()`'s existing `INSERT ... ON CONFLICT DO NOTHING`-style atomicity (or equivalent single-statement compare-and-set) being correct under real concurrent HTTP requests to the daemon, not just correct in a single-threaded unit test — the daemon's Node event loop serializes the actual SQLite calls, but the *request handling* around them (parsing, validation) must not introduce a window where both requests read "unlocked" before either writes. This test exercises the full RPC round-trip, not a direct `db.prepare()` call, specifically to catch that class of bug.

### 6.2a Component-level realistic-scale stress test — PR2 gate, no hook dependency

New test in `tests/unit/squid-harness.test.ts`, named explicitly so its intent survives future refactors: `'coord_pheromones query latency stays bounded at realistic fleet scale, component-level (regression guard for ADR-0091 G5)'`. **This is the PR2-appropriate half of the original single stress test** — it exercises `db.prepare().all()` directly, with no dependency on `pd-hook-prompt` understanding the sqlite backend, resolving the PR2/PR3 sequencing contradiction flagged in review (the original single test depended on PR3's rewritten hook while being scoped as a PR2 gate).

```ts
test('coord_pheromones query latency stays bounded at realistic fleet scale, component-level (regression guard for ADR-0091 G5)', () => {
  const db = openTestDb();
  applyMigration(db, '08X_squid_coordination.sql');
  const coordination = makeCoordination(db);

  for (let i = 0; i < 5000; i++) {
    coordination.spray({
      subject: `file-${i % 200}.ts`,
      project_root: '/Users/erichowens/coding/port-daddy',
      note: `synthetic pheromone note number ${i}`,
      intensity: Math.random(),
      actor: `agent-${i % 8}`,
    });
  }

  const start = Date.now();
  const rows = db.prepare(`
    SELECT subject, note, actor,
           intensity * exp(-0.0000005776 * (strftime('%s','now')*1000 - created_at)) AS eff_intensity
    FROM coord_pheromones
    WHERE project_root = ? AND created_at > (strftime('%s','now')*1000 - 3600000)
    ORDER BY created_at DESC LIMIT 20
  `).all('/Users/erichowens/coding/port-daddy');
  const elapsedMs = Date.now() - start;

  expect(rows.length).toBeGreaterThan(0);
  expect(elapsedMs).toBeLessThan(5); // the literal original G5 number, preserved at the query layer
});
```

### 6.2b Hook-level end-to-end stress test — PR3 gate, depends on the rewritten hook

**This is the other half of the original single test, correctly re-scoped to the PR where its dependency (a sqlite-aware `pd-hook-prompt`) actually exists.** New test, same file, distinctly named: `'pd-hook-prompt end-to-end latency stays bounded at realistic fleet scale, including process-spawn overhead (regression guard for ADR-0091 G5)'`.

```ts
test('pd-hook-prompt end-to-end latency stays bounded at realistic fleet scale, including process-spawn overhead (regression guard for ADR-0091 G5)', async () => {
  const db = openTestDb();
  applyMigration(db, '08X_squid_coordination.sql');
  const coordination = makeCoordination(db);
  for (let i = 0; i < 5000; i++) {
    coordination.spray({
      subject: `file-${i % 200}.ts`, project_root: '/Users/erichowens/coding/port-daddy',
      note: `synthetic pheromone note number ${i}`, intensity: Math.random(), actor: `agent-${i % 8}`,
    });
  }

  // Measure via the ACTUAL shell tentacle, not a direct db.prepare() call —
  // must include process-spawn overhead, exactly like production. This is the
  // ONLY layer where PD_MATRIX_BACKEND=sqlite is a valid dependency, because
  // PR3 has already landed a sqlite-aware pd-hook-prompt by the time this test runs.
  const start = Date.now();
  const { stdout, code } = await runHook('pd-hook-prompt', {
    env: { PORT_DADDY_DB: db.name, PD_MATRIX_BACKEND: 'sqlite' },
    stdin: JSON.stringify({ cwd: '/Users/erichowens/coding/port-daddy' }),
  });
  const elapsedMs = Date.now() - start;

  expect(code).toBe(0);
  expect(elapsedMs).toBeLessThan(200); // hard bound, NOT a soft/prose assertion
  // ^ 200ms chosen: 25x margin under the 10s hook-kill budget, generous enough to
  //   not be flaky in CI, tight enough that a regression back toward "seconds" fails loudly.
});
```

**Explicit lesson applied:** ADR-0091's G5 said `<5ms` in prose and the only test that existed asserted `elapsedMs < 5_000` — silently redefining the bar by 1000x with nobody noticing, because the assertion drifted from the spec without anyone treating that drift as a red flag. Both numbers in this plan (the `<5ms` component-level bound in §6.2a, the `<200ms` hook-level bound here) are deliberate, comment-documented choices with rationale inline, not bare numbers — so a future editor changing either threshold has to consciously override a stated rationale, not just fix a broken CI run by loosening a magic number.

### 6.3 Differential test (flat-file output vs. sqlite output, PR3 merge gate)

Seed identical logical state into both backends (same pheromones/alerts, same timestamps), run `pd-hook-prompt` against each via `PD_MATRIX_BACKEND=flatfile` and `PD_MATRIX_BACKEND=sqlite`, assert the injected `additionalContext` is content-equivalent (same subjects/notes/actors present, differences only in incidental formatting) modulo the new actor-provenance tags (§3.3), which are expected new content, not a discrepancy.

### 6.4 `pd doctor` per-job staleness test

Extended from a single aggregate check to assert **each of the four `coord_maintenance` jobs individually** — this is the direct fix for the failure mode where 3 of 4 jobs could silently die while a generic "maintenance is stale" check only ever exercised the one job (`wal_checkpoint`) that had code behind it.

```ts
describe('pd doctor: coord_maintenance staleness, per job', () => {
  for (const job of ['prune_pheromones', 'prune_alerts', 'wal_checkpoint', 'reap_expired_locks']) {
    test(`flags ${job} individually when stale`, () => {
      seedMaintenanceRow(db, job, { last_run_at: Date.now() - 20 * 60 * 1000 }); // 20 min, > 2x 5-min interval
      const result = runDoctorCheck(db);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain(job);
    });
    test(`passes cleanly when ${job} is fresh`, () => {
      seedMaintenanceRow(db, job, { last_run_at: Date.now() });
      const result = runDoctorCheck(db);
      expect(result.output).not.toContain(`${job} stale`);
    });
  }
  test('a never-run job (last_run_at = 0, from migration seed) is flagged immediately, not silently absent', () => {
    // Confirms the migration-time seed (§3.1) does its job: an un-wired job is
    // indistinguishable from an absent one UNLESS it's pre-seeded at 0.
    const result = runDoctorCheck(freshlyMigratedDb());
    expect(result.exitCode).not.toBe(0);
  });
});
```

### 6.5 4-vendor hook-shape parity test — caveated on adapter verification status

The original ADR-0091 test coverage only exercised 3 vendors; this repo's own `lib/squid/hook-shape.ts` supports 4 (Claude, Codex, Gemini, Antigravity/agy). Add or confirm a parity test asserting the rewritten tentacles produce vendor-correct block/exit-code contracts (`exit 2` + stderr for Claude/Codex per the verified block-contract comments in `bin/pd-hook-pre-tool` lines 10–17) across all 4, not silently re-covering only the 3 already tested.

**Caveat, previously missing:** ADR-0108 marks `CodexSquidAdapter` and `GeminiSquidAdapter` as `verified: false`. Parity-testing the rewritten tentacles against an adapter whose own contract is not yet verified upstream produces a test that can pass while asserting parity with an unverified target — a false sense of coverage. This test is therefore split into two tiers, not one blanket assertion:
- **Tier 1 (hard gate, all 4 vendors):** the tentacle's own exit-code/stderr shape is correct per `hook-shape.ts`'s registered contract for each vendor — this is testable and meaningful regardless of adapter verification status, since it only depends on this plan's own code.
- **Tier 2 (soft gate, gated on adapter verification):** end-to-end parity against a live/simulated Codex or Gemini CLI invocation is only asserted for adapters where `verified: true`. For `CodexSquidAdapter`/`GeminiSquidAdapter` (currently `false`), Tier 2 is skipped with an explicit `test.skip()` annotation citing ADR-0108's verification status, not silently omitted — so the gap is visible in test output rather than invisible.

### 6.6 Migration-application test

`migrations/08X_squid_coordination.sql` applies cleanly to (a) a fresh empty DB, and (b) a copy of the operator's real post-VACUUM `port-registry.db` (a snapshot copy, never the live file) — confirming no naming collision with any prior migration's tables (re-verified count at execution time, §3.1) and that `CREATE TABLE IF NOT EXISTS` semantics make the migration idempotent under a double-apply.

### 6.7 K=9 concurrency test — daemon's own connection as a participant, not just 8 subprocess writers

Debate Verdict 1 explicitly calls the daemon's long-lived connection racing against independent CLI subprocess writers "the one genuinely novel risk this migration introduces." The ported K=8 test (§4 PR2 item 3) only proves 8 independent `sqlite3` CLI subprocesses don't corrupt each other — it says nothing about a live daemon process holding its own WAL connection open *at the same time* those 8 subprocesses write, which is the actual production topology (§2.1's `syncApprovalAlert()` writer runs inside the daemon while shell hooks write independently).

```ts
test('K=9: 8 independent sqlite3 CLI writers + 1 live daemon connection produce zero corruption, zero lost writes', async () => {
  const dbPath = testDbPath();
  applyMigrationToPath(dbPath, '08X_squid_coordination.sql');

  // Start a real (or faithfully stubbed) daemon process holding its own
  // long-lived better-sqlite3 connection with the SAME pragma block as
  // production (§3.5), issuing its own writes on a tight interval — not
  // just idling. This is the "9th writer."
  const daemon = spawnTestDaemon({ dbPath, writeIntervalMs: 20, writeCount: 50 });

  // 8 independent CLI subprocess writers, same shape as the existing K=8 test.
  const cliWrites = Array.from({ length: 8 }, (_, i) =>
    spawnCliWriter(dbPath, { actor: `agent-${i}`, count: 50 })
  );

  await Promise.all([daemon.done(), ...cliWrites.map(w => w.done())]);

  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM coord_pheromones`).get() as { n: number };
  expect(n).toBe(9 * 50); // 8 CLI writers + 1 daemon writer, 50 rows each, none lost
  const integrity = db.prepare(`PRAGMA integrity_check`).get();
  expect(integrity).toEqual({ integrity_check: 'ok' });
  await daemon.stop();
});
```
This is a new test, not a relabeling of the existing K=8 test — it is additive to §4 PR2 item 3's ported/extended test, exercising the specific topology (long-lived daemon connection + independent subprocess writers, concurrently) that the original K=8 test's all-subprocess design cannot exercise on its own.

### 6.8 Row-count backstop deletion — explicit test (previously prose-only)

The original draft stated the 5000→4000 pheromone backstop in prose and stress-tested "stays fast" at 5,000 rows, but never asserted the DELETE actually drops the count or that it removes the *oldest* rows specifically. Closed here, against the concrete code in §3.5:

```ts
test('prunePheromones() drops row count from 5000 to 4000, removing the oldest rows first', () => {
  const db = openTestDb();
  applyMigration(db, '08X_squid_coordination.sql');
  const coordination = makeCoordination(db);
  const now = Date.now();
  for (let i = 0; i < 5000; i++) {
    coordination.spray({
      subject: `f${i}`, project_root: '/p', note: `n${i}`, intensity: 1, actor: 'test',
    });
    // Force distinct, monotonically increasing created_at so "oldest" is unambiguous.
    db.prepare(`UPDATE coord_pheromones SET created_at = ? WHERE id = (SELECT MAX(id) FROM coord_pheromones)`)
      .run(now - (5000 - i) * 1000);
  }
  const before = db.prepare(`SELECT COUNT(*) AS n FROM coord_pheromones`).get() as { n: number };
  expect(before.n).toBe(5000);

  prunePheromones(); // the real §3.5 function, imported directly

  const after = db.prepare(`SELECT COUNT(*) AS n FROM coord_pheromones`).get() as { n: number };
  expect(after.n).toBe(4000);
  const oldestRemaining = db.prepare(`SELECT MIN(created_at) AS t FROM coord_pheromones`).get() as { t: number };
  // The 1000 oldest rows (subjects f0..f999) must be gone — oldestRemaining should
  // correspond to roughly the 1001st-oldest row's timestamp, not an arbitrary one.
  expect(oldestRemaining.t).toBeGreaterThanOrEqual(now - 4000 * 1000);

  const maint = db.prepare(`SELECT rows_affected, last_error FROM coord_maintenance WHERE job = 'prune_pheromones'`).get();
  expect(maint.last_error).toBeNull();
  expect(maint.rows_affected).toBeGreaterThanOrEqual(1000);
});
```

### 6.9 Alert row-count backstop — explicit numbers and test

Same shape as §6.8, against `pruneAlerts()` and the 2000→1500 numbers stated explicitly in §3.6:

```ts
test('pruneAlerts() drops row count from 2000 to 1500 when over the cap, oldest first', () => {
  // Seed 2000 alerts with distinct alert_key values (so UNIQUE(alert_key, project_root)
  // doesn't collapse them) and monotonic created_at, same pattern as §6.8.
  // ... assert before=2000, after pruneAlerts() -> 1500, oldest removed, coord_maintenance
  // row for 'prune_alerts' shows last_error=null and rows_affected>=500.
});
```

### 6.10 Field-cap enforcement tests (note, actor, subject) — previously only note's escaping was tested, not any size limit

```ts
describe('coordination.ts write-boundary validation', () => {
  test('spray() throws ValidationError on a note exceeding 500 bytes', () => {
    const oversized = 'x'.repeat(501);
    expect(() => coordination.spray({ subject: 's', project_root: '/p', note: oversized, intensity: 1, actor: 'a' }))
      .toThrow(/exceeds 500 bytes/);
  });
  test('spray() throws ValidationError on an empty or missing actor', () => {
    expect(() => coordination.spray({ subject: 's', project_root: '/p', note: 'n', intensity: 1, actor: '' }))
      .toThrow(/actor is required/);
  });
  test('spray() throws ValidationError on an actor exceeding 200 bytes', () => {
    expect(() => coordination.spray({ subject: 's', project_root: '/p', note: 'n', intensity: 1, actor: 'a'.repeat(201) }))
      .toThrow(/actor exceeds 200 bytes/);
  });
  test('spray() throws ValidationError on an actor containing a forged "[from:" tag', () => {
    expect(() => coordination.spray({ subject: 's', project_root: '/p', note: 'n', intensity: 1, actor: 'real[from: fake]' }))
      .toThrow(/disallowed control characters or a forged provenance tag/);
  });
  test('spray() throws ValidationError on a subject exceeding 200 bytes', () => {
    expect(() => coordination.spray({ subject: 's'.repeat(201), project_root: '/p', note: 'n', intensity: 1, actor: 'a' }))
      .toThrow(/subject exceeds 200 bytes/);
  });
  test('upsertAlert() throws ValidationError on an empty or missing actor (parity with spray())', () => {
    expect(() => coordination.upsertAlert({ alert_key: 'K', project_root: '', message: 'm', actor: '', expires_at: null }))
      .toThrow(/actor is required/);
  });
});
```

### 6.11 `exp()` math-function capability test (both CLI and daemon layers)

```sh
# Shell-side, run in PR2 CI on both OS legs.
squid_check_math_functions || { echo "FAIL: sqlite3 CLI lacks math functions"; exit 1; }
```
```ts
// Daemon-side, run in PR2 CI and as a pd doctor check.
test('better-sqlite3 build supports exp()', () => {
  const result = checkSqliteMathFunctions(db);
  expect(result.ok).toBe(true);
});
```

---

## 7. Rollback Plan

- **PR1:** standard `git revert` — inert refactor, zero risk surface.
- **PR2:** standard `git revert` — dark code, no hook touches it yet.
- **PR3/PR4 (behind `PD_MATRIX_BACKEND`):** rollback is `PD_MATRIX_BACKEND=flatfile`, a single env var edit, live, no rebuild, no hook reinstall required. This is the real safety net, given the zero-canary, single-shared-staged-location hook install architecture (§4 preamble) — the kill switch, not a slow rollout calendar, is what protects against the instant-100%-blast-radius reality of this install mechanism. **This guarantee holds specifically through PR4** — see below.
- **PR5 (post-deletion):** rollback is `git revert` of the deletion commit — acceptable *specifically because* PR5 is gated on real organic bake time under PR4's flag, not shipped speculatively. **State loss on rollback is explicitly accepted**: any locks/pheromones/alerts written under sqlite between PR5 landing and a hypothetical revert are lost. This is deliberate: the store's job is live coordination signal, not an audit log; losing a few minutes of pheromones on a rare rollback is an acceptable tradeoff against building bidirectional flatfile↔sqlite sync machinery that nobody needs. **`PD_MATRIX_BACKEND`'s rollback-restoration guarantee (§9 G12) is explicitly scoped to PR1–PR4 only.** The moment PR5's flat-file-internals deletion lands, setting the flag to `flatfile` no longer restores flatfile behavior — there is no flatfile implementation left to restore. §4 PR5 step 3 states the flag's post-PR5 disposition (removed as dead code, or frozen as a sqlite-only no-op with a deprecation warning); `git revert` of the deletion commit, not the flag, is PR5's actual rollback mechanism.
- **Not built, stated explicitly:** no backward data migration (sqlite → flat file) exists or is planned. Losing in-flight coordination state on rollback is acceptable; losing lock *enforcement* mid-tool-call is not — which is exactly why PR4 (the lock path) carries the adversarial fail-open suite (§6.1, §6.1a) as a hard merge gate, while PR3 (read-only) does not need the same bar.

---

## 8. Risk Register

| ID | Risk | Source | Mitigation |
|---|---|---|---|
| R-1 | SQL injection via unescaped shell string interpolation (ordinary text like `"don't merge yet"` breaks an unescaped `INSERT`) | Debate verdict #1, empirically reproduced | `squid_sql_escape()` (§3.2) applied to every interpolated value on every read path; writes bypass this entirely by routing through daemon-side bind parameters (§3.4) instead of shell-side string building |
| R-2 | `sqlite3` CLI silently absent on a CI runner or a stripped-down operator environment | Debate verdict #2, sourced from `actions/runner-images#11279` (Dec 2024, real historical absence on `ubuntu-24.04`) | Explicit CI install + version-verify step (§4 PR2); `pd doctor` presence check (§4 PR2/PR4); tentacles fail open on absence regardless (§3.2) |
| R-3 | `SQLITE_BUSY` under K≥8 concurrent writers if `busy_timeout` is omitted on any CLI invocation | Debate verdict #1, empirically reproduced (5/8 writers failed without `busy_timeout`, 8/8 clean with it) | `PRAGMA busy_timeout=400;` as the literal first statement in every shell CLI call, no exceptions (§3.2, §3.5); write path avoids this class entirely by routing through the daemon's single connection (§3.4) |
| R-4 | Lock-*acquire* is new functionality (zero production callers of `lib/locks.ts` today) but could be under-reviewed if treated as "just a migration" of something already live | Debate verdict #3 + Meticulous Auditor finding | §4 PR4 explicitly calls this out as new-functionality-grade review, not migration-grade caution; the adversarial suite (§6.1) plus the dedicated TOCTOU concurrent-acquire test (§6.1a) are scoped to catch correctness bugs in genuinely new code, not just regressions in something that used to work |
| R-5 | WAL file grows unbounded because passive `wal_autocheckpoint` no-ops while the daemon's long-lived connection holds an open reader snapshot | SQLite's own documented `PASSIVE`-checkpoint behavior, applied to this repo's specific topology | Active `wal_checkpoint(TRUNCATE)` on the daemon's existing 5-min tick (§3.5), not reliance on passive autocheckpoint alone; the K=9 concurrency test (§6.7) exercises this topology directly, with the daemon's own connection as a live participant |
| R-6 | New coordination tables get added to the consolidated DB while it's still exhibiting the exact unbounded-growth bug (937MB, `auto_vacuum=0`, verified live) this migration exists to prevent | Direct live verification during plan authoring, not assumption | §4 Step 0 is a hard precondition, sequenced before PR1, with a mandatory pre-VACUUM backup and its own done-when criteria |
| R-7 | Actor-unattributed pheromone/alert text is trusted context injected into the next agent turn with zero provenance — an existing gap independent of the flat-file problem, surfaced by this migration; **and an unbounded/unescaped `actor` string is itself a second injection vector via a forged `[from: ...]` tag** | Red Team's concern #2 (original), extended by completeness-critic finding #14 | `actor` column mandatory, capped at 200 bytes, and control-character/forged-tag-filtered at write time in **both** `spray()` and `upsertAlert()` (§3.3, throws `ValidationError` on violation), surfaced as `[from: <actor>]` in every injected context string (§3.2 AFTER pseudocode); `subject` gets the same byte cap for the same reason |
| R-8 | Dropped writes (daemon down, `curl` missing, UDS socket unreachable) accumulate silently, same failure shape as the original RECONCILE TODO, just on the write side instead of the GC side | Direct application of this plan's own stated lesson | `coord_dropped_writes` counter (§3.1), surfaced via `pd doctor`/`pd sitrep`; explicitly no spool-file fallback (§3.4), which was considered and rejected for reproducing the same bug |
| R-9 | `docs/adr/0108-port-daddy-harness.md` has a second, previously unflagged bug — it refers to *itself* as "ADR-0051" in its own prose despite being numbered 0108 on disk — that a rushed ADR-cleanup pass could miss if only chasing the "No ADR-0091 exists" line | Found during this plan's own verification pass, not present in the source brief | §10 explicitly calls out both bugs in 0108 as one fix, not two separate follow-ups |
| R-10 | `VACUUM` on a 937MB file (Step 0) requires exclusive DB access and real wall-clock time; running it carelessly mid-operator-session could cause a visible daemon stall, and it is an irreversible rewrite with no prior backup | Direct consequence of Step 0's own requirement; backup gap flagged by completeness-critic finding #16 | Step 0 explicitly scheduled for a moment the daemon can be briefly stopped, with a mandatory pre-VACUUM backup (verified readable via its own `integrity_check`) plus post-VACUUM `integrity_check` and size verification as done-when criteria |
| R-11 | The write path's UDS RPC transport is assumed to exist but was never independently verified against the daemon's actual listener configuration — PR4 could be scoped as "just wire routes" against a transport that doesn't exist | Completeness-critic finding #3 | §3.7 / Step 0.5: explicit verification-or-build task with a `/health` smoke-test curl as a hard precondition before PR2's RPC routes are considered complete |
| R-12 | The decay query's `exp()` call depends on a SQLite math-functions build flag that is not universally present across CLI binaries and the separately-compiled `better-sqlite3` bundle; G6's binary-presence check does not catch this | Debate verdict #2, completeness-critic finding #4 | §3.7b: explicit `SELECT exp(1.0)` capability check on both the shell CLI and the daemon's `better-sqlite3` connection, wired into PR2 CI and `pd doctor`; documented fallback (application-layer decay math) if the check fails on a target environment |
| R-13 | Non-macOS/non-CI operator environments (Alpine/musl containers, WSL, locked-down corporate Linux) have never been verified against this plan's assumptions about `sqlite3` builds, UDS support, or `curl`-to-loopback egress policy | Debate verdict #2 | Named explicitly as an open question, §11 item 6, rather than silently assumed out of scope |
| R-14 | Three of four `coord_maintenance` job types could ship as prose-only descriptions with no code behind them, reproducing the RECONCILE TODO's exact failure mode for 75% of the maintenance surface | Completeness-critic finding #9 | §3.5 shows all four jobs (`prunePheromones`, `pruneAlerts`, `reapExpiredLocks`, `checkpointWal`) as concrete code, each independently recording to `coord_maintenance`; §6.4's staleness test asserts each job individually, not generically |

---

## 9. SMART Success Criteria

Every criterion below names the exact test/artifact that proves it — no criterion ships asserted in prose alone, per the explicit lesson from ADR-0091's G5 (§1).

| ID | Criterion | Test/artifact that proves it |
|---|---|---|
| G1 | `pd-hook-prompt` end-to-end latency stays under 200ms at 5,000+ seeded pheromone rows (25x margin under the 10s hook-kill budget) | `tests/unit/squid-harness.test.ts` — `'pd-hook-prompt end-to-end latency stays bounded at realistic fleet scale, including process-spawn overhead'` (§6.2b), CI-gated as a PR3 merge gate |
| G2 | The underlying indexed query itself (no process-spawn overhead) completes in <5ms — the literal original G5 number, preserved as a component-level check | `'coord_pheromones query latency stays bounded at realistic fleet scale, component-level'` (§6.2a), CI-gated as a PR2 merge gate, no hook dependency |
| G3 | K≥8 independent CLI writers, **plus the daemon's own long-lived connection as a 9th concurrent participant**, produce zero corrupted/torn writes and zero lost writes given correct `busy_timeout` | Ported+extended `'K=9: 8 independent sqlite3 CLI writers + 1 live daemon connection...'` test (§6.7, extending the original `'K=8...Jamie Madrox'` test from `tests/unit/squid-harness.test.ts:611`) |
| G4 | Every hook degrades to allow/no-op under 8 distinct failure-injection scenarios (daemon down, missing db, corrupt db, missing `sqlite3`, missing `curl`, lock timeout, malformed input, unreachable UDS socket) — never hangs, never crashes the vendor CLI | Adversarial fail-open suite (§6.1), mandatory PR4 merge gate |
| G5 | SQL-string interpolation is safe against ordinary text containing apostrophes/semicolons/SQL comment syntax | The malformed-note case in §6.1's adversarial suite, using the exact reproducer string from the debate verdict (`"don't merge; DROP TABLE coord_pheromones; --"`) |
| G6 | `sqlite3` and `curl` are verified-present (not assumed), **and SQLite's math-function extension (`exp()`) is verified functional, not just the binary present**, on both CI OS legs and flagged loudly by `pd doctor` if absent locally | `.github/workflows/ci.yml` install+verify+math-capability step (§4 PR2, §6.11); `cli/utils/startup-doctor.ts` presence + `checkSqliteMathFunctions()` check |
| G7 | The maintenance cadence (prune pheromones, prune alerts, checkpoint WAL, reap expired locks — all four, individually) is observable and each one's silent failure is independently detectable — the direct fix for the RECONCILE TODO never being noticed as unbuilt for 2 months, closed for all four jobs, not just one | `coord_maintenance` table with all four jobs seeded and wired to real code (§3.5) + `pd doctor` per-job staleness test (§6.4) |
| G8 | Every value injected into agent-trusted `additionalContext` carries visible, bounded, non-forgeable actor provenance | Grep-based CI check on `bin/pd-hook-prompt`'s output-formatting code path asserting `[from: ` appears in the format string; plus a runtime assertion in the differential test (§6.3) that every injected line contains an actor tag; plus the field-cap/forged-tag tests (§6.10) on both `spray()` and `upsertAlert()` |
| G9 | Dropped writes are counted and surfaced, never silently absorbed | `coord_dropped_writes` unit test: simulate daemon-down write attempt, assert counter increments and `pd sitrep` surfaces it |
| G10 | The consolidated DB does not repeat the 937MB/`auto_vacuum=0` anti-pattern after this migration adds tables to it | Step 0's own done-when criteria (§4): pre-VACUUM backup taken and verified, `PRAGMA auto_vacuum` = `2`, `integrity_check` = `ok`, verified before PR1 lands |
| G11 | All 4 vendor hook shapes (Claude, Codex, Gemini, Antigravity/agy) get correct block/exit-code contracts from the rewritten tentacles at the tentacle-contract level (Tier 1); full end-to-end parity is asserted only for adapters ADR-0108 marks `verified: true` (Tier 2), with unverified adapters explicitly skip-annotated rather than silently passing on an unmeaningful assertion | §6.5 two-tier parity test |
| G12 | Rollback from sqlite to flatfile is a single env var flip with no rebuild, verified to actually restore identical hook behavior — **this guarantee is scoped to PR1 through PR4 only**; PR5 removes or freezes the flag, documented explicitly, not left as ambiguous dead-flag behavior | A CI test that flips `PD_MATRIX_BACKEND` mid-suite and re-runs the differential test (§6.3) against the flatfile path, confirming the flag genuinely branches behavior rather than being dead code — run through PR4; PR5's flag-disposition (§4 PR5 step 3) is itself asserted (either the flag is grep-absent, or setting it to `flatfile` post-PR5 logs a deprecation warning and proceeds on sqlite) |
| G13 | `matrix.env` and all direct references to it are gone from code (excluding immutable CHANGELOG history and Superseded-marked ADR bodies) | `grep -rn "matrix\.env\|PD_MATRIX_FILE" --include='*.ts' --include='*.sh' .` returns zero hits outside the excluded set, checked as a CI lint step added in PR5 |
| G14 | The pheromone (5000→4000) and alert (2000→1500) row-count backstops actually delete down to the stated target counts, removing the oldest rows first, not just "stay fast" under load | `'prunePheromones() drops row count from 5000 to 4000...'` (§6.8) and the equivalent alert test (§6.9) |
| G15 | Oversized `note` (>500 bytes), empty/oversized/forged `actor` (>200 bytes or containing a forged `[from:` tag), and oversized `subject` (>200 bytes) are all rejected with a `ValidationError` at the write boundary, on both `spray()` and `upsertAlert()` | §6.10's full field-cap test block |
| G16 | The Unix-domain-socket RPC transport the write path depends on is confirmed to exist (or is built) before PR4 is scoped as "wire routes only" | §3.7's `/health` smoke-test curl, checked in Step 0.5 / PR2 CI |

---

## 10. ADR Disposition

- **New ADR** (resolve the actual next-free ADR number at write time by scanning `docs/adr/`, do not guess a number in advance — this repo has already collided ADR numbers once, per the `adr-0089-binnacle-quartermaster-ui` citation resolving to an unrelated file, §2.4), titled **"Squid Coordination Store: SQLite Replaces the Ink Cloud Flat File."**
- **Explicitly supersedes ADR-0091's data-store sections only**: the matrix.env format, the mkdir-based locking, the never-built RECONCILE TODO, and success criterion G5 (replaced by G1/G2 above). ADR-0091's hook-event-wiring and vendor-adapter design (`hook-shape.ts` matchers, `ClaudeCliSquidAdapter`/`CodexSquidAdapter`/`GeminiSquidAdapter`) is **unaffected and stays live** — only the storage layer underneath it changes. Set `docs/adr/0091-giant-squid-harness.md`'s Status header to **Superseded**, with a pointer to the new ADR, in PR5.
- **Reconciles against ADR-0108, not the dead ADR-0051.** `docs/adr/0108-port-daddy-harness.md` gets two fixes in the same PR5 commit, not two separate follow-ups: (1) its stale line 167 claim *"No ADR-0091 exists on disk"* is corrected — 0091 exists, is Superseded by the new ADR, not absent; (2) its own internal self-reference bug — the file is numbered 0108 on disk but refers to itself as "ADR-0051" in its own prose (found during this plan's verification pass, not previously flagged) — is corrected to consistently say 0108. This closes a TODO two prior attempts (`docs/architecture/.../2026-07-06-next-gen-reconciliation.md` and a roadmap-snapshot item on branch `claude/reconcile-adr-0091-0051`) logged and failed to execute — the third attempt must not cite the same dead number (0051) the first two did.
- **New ADR's own success-criteria table** is the table in §9 above, verbatim — every row already names its proving test, satisfying its own requirement rather than repeating ADR-0091's mistake of a spec with no corresponding realistic-scale test.
- **New ADR must also state the environment-portability scope explicitly** (§2.5, §11 item 6): verified on macOS + GitHub Actions `ubuntu-latest`/`macos-latest`; Alpine/musl, WSL, and locked-down corporate Linux are named as unverified, not silently assumed compatible.
- **Does not touch** `docs/proposals/squid-harness-v2-grown-up-harness.md` — confirmed orthogonal (durable agent-context/compaction axis, cited for numbering-convention consistency only, §5 item 36) — and does not touch `docs/roadmap/roadmap.snapshot.json` directly (patch-append-only; enter as a normal roadmap item through existing tooling per §4).

---

## 11. Open Questions for the Operator

Only items genuinely undecidable without operator input — every other decision in this plan is closed (see §0 of the source architecture doc, carried forward as settled here).

1. **Exact `PORT_DADDY_DB` resolved path on this machine, confirmed.** Verified live during this plan's authoring: `~/.port-daddy/port-registry.db`, 937MB, `auto_vacuum=0`. **Confirm this is in fact the file `scripts/db-consolidate.ts` resolves as canonical** before Step 0's `VACUUM` runs against it — running a `VACUUM` against the wrong file wastes time; running it against a file something else is mid-write to could corrupt state. A one-command dry-run (`db-consolidate.ts --dry-run`, already exists and defaults to dry-run) should be run and its output read by a human before Step 0 proceeds destructively.
2. **Timing of Step 0's `VACUUM` against a 937MB live file.** This requires briefly stopping the daemon. Does the operator want this scheduled for a specific low-activity window, or is "next available moment, with the daemon's current fleet-session state checked for anything mid-flight first" acceptable? This is a real, if brief, availability interruption and the operator may have fleet activity in progress that shouldn't be paused arbitrarily.
3. **Bake-time judgment call for PR5.** §4/§7 define the bake gate as "real organic usage under PR4's flag without incident" rather than a calendar duration, because there's no canary population to size a duration against. This is inherently a judgment call about how much organic usage is "enough" — the operator may want to set an explicit minimum (e.g., "at least N real multi-agent sessions exercising lock contention") rather than leaving it to the executing engineer's discretion.
4. **"Ink Cloud" as a surviving UX/marketing term.** §5's footer states this as a decision (mechanism becomes sqlite, the name "Ink Cloud" survives on the website and possibly in `prompts/port-daddy-citizen.md`'s agent-facing copy as a friendly metaphor) rather than asking — but this is genuinely a taste/brand call, not an engineering one, and the operator may prefer the term retired entirely alongside the mechanism rather than kept as flavor text. Flagging explicitly in case the plan's default (keep it as metaphor) isn't wanted.
5. **New ADR number.** Deliberately left unresolved in §10 pending a fresh scan of `docs/adr/` at execution time (to avoid repeating the exact number-collision class of bug found during this plan's own verification, §2.4's `adr-0089` finding) — the executing engineer should confirm the chosen number doesn't collide with any ADR merged between this plan's authoring and PR5 landing, which given the pace of this repo's ADR output is a real possibility worth an operator sanity-check before publishing.
6. **Non-macOS/non-CI operator environments — named explicitly, previously absent from this list.** This plan is verified only against macOS (operator's daily machine) and GitHub Actions `ubuntu-latest`/`macos-latest` (§2.5). It has not been verified against Alpine/musl containers, WSL, or locked-down corporate Linux environments where `sqlite3`'s build flags, Unix-domain-socket support, or `curl`-to-loopback egress policy may differ from what this plan assumes. **Does the operator run, or plan to run, any hook/daemon combination on such an environment?** If yes, that environment needs its own verification pass (repeating §3.7's UDS check and §3.7b's math-function check against it) before this migration can be considered complete there; if no, this plan's scope is correctly limited to the two environments actually in use today, and this item can be closed as "out of scope, confirmed."

---

## 12. Critique Closure Index

Cross-reference from each numbered finding in the completeness-critic pass to the section that closes it, for audit purposes.

| # | Finding (short) | Closed in |
|---|---|---|
| 1 | `spawn-routes-preflight.test.js` missing from §5 | §5 row 45 |
| 2 | `hook-shape.ts` missing from §5 | §2.1 (new paragraph) + §5 row 46 |
| 3 | UDS socket existence never verified | §3.7, §4 Step 0.5, §6 (smoke test), §8 R-11, §9 G16 |
| 4 | `exp()` capability never verified | §3.7b, §4 PR2 items 5–6, §6.11, §8 R-12, §9 G6 |
| 5 | Non-macOS/non-CI environments not an open question | §2.5, §11 item 6 |
| 6 | Concurrent-acquire TOCTOU test missing | §6.1a, §4 PR4 item 5, §9 G4 (scenario count updated) |
| 7 | Daemon's own connection missing from concurrency test | §6.7 (K=9), §4 PR2 item 3, §8 R-5/R-14, §9 G3 |
| 8 | Backstop deletion has no test / no DELETE SQL shown | §3.5 (`prunePheromones`/`pruneAlerts` code), §6.8, §6.9, §9 G14 |
| 9 | 3 of 4 maintenance jobs never wired in code | §3.5 (all four jobs as code), §6.4 (per-job test), §9 G7 |
| 10 | Alert pruning threshold unspecified | §3.1 (schema comment), §3.6 (2000/1500 stated), §6.9 |
| 11 | `note` byte-cap has no test | §6.10 |
| 12 | PR2/PR3 sequencing contradiction (stress test dependency) | §4 PR2 item 4 + PR3 item 3, §6.2a/§6.2b split |
| 13 | `upsertAlert()` missing actor check; `syncApprovalAlert()` call site unverified | §3.3 (`upsertAlert` code + `assertActor`), §3.3 call-site note, §4 PR4 item 4, §5 row 11 |
| 14 | Unbounded `actor` is itself an injection vector | §3.3 (`ACTOR_MAX_BYTES`, `assertActor` forged-tag check), §6.10, §8 R-7 |
| 15 | Migration-number re-verification not required | §3.1 (opening paragraph), §4 PR2 item 1 |
| 16 | No backup before Step 0's `VACUUM` | §4 Step 0 item 2 |
| 17 | `PD_MATRIX_BACKEND` post-PR5 disposition undocumented | §4 PR5 item 3, §7 (rollback), §9 G12 |
| 18 | `sleepBusy()` anti-pattern not explicitly called out | §3.2 (new paragraph before the tentacle rewrites) |
| 19 | G11 parity test doesn't caveat unverified adapters | §6.5 (two-tier split), §9 G11 |