# WS-0 Database Consolidation — End-to-End Verification Checklist

**Status:** Verification Harness for `scripts/db-consolidate.ts` and related ADR-0090 Phase 1 infrastructure  
**Last Updated:** 2026-06-29  
**Scope:** Operator and agent runbooks for safe, durable DB consolidation post-WS-0

---

## Overview

The consolidation workflow resolves **Port Daddy's DB fragmentation bug** (ADR-0090): 7+ scattered database files across `~/.port-daddy/`, `/opt/homebrew/Cellar/`, `~/coding/port-daddy/`, and per-profile `instances/` directories that become stale, inconsistent, or lost on brew upgrades.

**Single Source of Truth After Consolidation:**
- **Canonical path:** `~/.port-daddy/port-registry.db`
- **Daemon always reads from:** canonical path via `CANONICAL_DB_PATH` env variable (future fix)
- **Backups:** `~/.port-daddy/backups/_pre-consolidation-<timestamp>/` (durable, operator-accessible)

---

## Pseudocode Simulation: How the Workflow Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    WS-0 DB Consolidation Workflow                        │
└─────────────────────────────────────────────────────────────────────────┘

PHASE 0: Pre-Flight Checks (operator or script)
  ├─ pd status                          # Confirm daemon is accessible
  ├─ pd doctor                          # Run startup diagnostics
  │  └─ Checks: stale sockets, zombie processes, port conflicts
  ├─ Check guard status                 # pd guard status (should be enforce/warn)
  ├─ Verify Git HEAD                    # git status --branch
  └─ Record: daemon version, PID, port, active claims

PHASE 1: Scan All Database Fragments (db-consolidate.ts)
  ├─ Enumerate known paths:
  │  ├─ ~/.port-daddy/port-registry.db              (canonical)
  │  ├─ ~/.port-daddy/instances/<profile>/*.db      (per-profile instances)
  │  ├─ ~/coding/port-daddy/port-registry.db        (dev checkout)
  │  ├─ ~/coding/port-daddy/dist/*.db               (compiled dist/)
  │  └─ /opt/homebrew/Cellar/port-daddy/*/bin/*.db  (installed binary)
  │
  ├─ For each path, collect metadata:
  │  ├─ size
  │  ├─ mtime (file last modified)
  │  ├─ tableCount (number of tables)
  │  ├─ lastSeen (MAX(updated_at, created_at, last_seen) from tables)
  │  ├─ integrity (PRAGMA integrity_check)
  │  └─ error (if any)
  │
  └─ Classify:
     ├─ VALID   = exists, size > 0, integrity OK        [candidates for source]
     ├─ EMPTY   = exists, size = 0                       [archive only]
     ├─ CORRUPT = exists, size > 0, integrity FAIL       [archive with warning]
     └─ MISSING = does not exist                         [skip]

PHASE 2: Detect Live Truth (db-consolidate.ts)
  ├─ Try daemon detection:
  │  ├─ Read ~/.port-daddy/daemon.port
  │  ├─ lsof -i :<port> to find listening PID
  │  └─ lsof -p <pid> to find open .db files
  │
  ├─ Fallback: pick by max(last_seen, mtime)
  │  └─ Reasoning: if daemon is down, freshest DB is likely truth
  │
  └─ Result: identify SOURCE database
     (the one we will VACUUM into canonical path)

PHASE 3: Show Diffs & Wait for Approval (db-consolidate.ts)
  ├─ Print table row-count comparison across all VALID databases
  │  └─ Helps operator verify picking the right source
  │
  ├─ Print summary:
  │  ├─ Source DB path, size, table count
  │  ├─ Number of other fragments to consolidate
  │  └─ Archive destination directory
  │
  └─ Prompt for approval (unless --force)
     └─ User must confirm: "Proceed with consolidation? [y/N]"

PHASE 4: Perform Consolidation (db-consolidate.ts)
  ├─ Create archive directory: ~/.port-daddy/backups/_pre-consolidation-<ISO-timestamp>/
  │
  ├─ VACUUM source → canonical:
  │  ├─ Open source DB read-write
  │  ├─ Run: PRAGMA wal_checkpoint(TRUNCATE)    # Close WAL files
  │  ├─ Run: VACUUM INTO '~/.port-daddy/port-registry.db'
  │  └─ Verify new file exists and is non-zero
  │
  ├─ Verify consolidated DB:
  │  └─ PRAGMA integrity_check → must return "ok"
  │
  ├─ Archive all other fragments:
  │  ├─ For each OTHER valid DB: mv → backups/_pre-consolidation-<ts>/
  │  ├─ For each empty DB:        mv → backups/_pre-consolidation-<ts>/
  │  ├─ For each corrupt DB:      mv → backups/_pre-consolidation-<ts>/ (tagged)
  │  └─ Print success: "Archived <path>"
  │
  └─ Cleanup (operator must do):
     └─ rm -rf ~/.port-daddy/backups/_pre-consolidation-<ts>/

PHASE 5: Post-Consolidation Continuity (doctor guard + manual checks)
  ├─ Daemon restart:
  │  ├─ launchctl stop homebrew.mxcl.port-daddy
  │  ├─ launchctl start homebrew.mxcl.port-daddy
  │  └─ Verify: curl -sS "$(cat ~/.port-daddy/daemon.port | sed 's#^#http://localhost:#')/fleet"
  │
  ├─ Continuity check (doctor/guard):
  │  ├─ pd doctor                           # Should show no blockers
  │  ├─ pd sitrep                           # Verify sessions, claims, locks are readable
  │  ├─ pd guard check --staged             # No violations
  │  └─ pd backup list                      # Verify manifest points to canonical path
  │
  ├─ File ownership verification:
  │  ├─ lsof -p $(pgrep -f "port-daddy.*server") | grep port-registry.db
  │  └─ Must show: ~/.port-daddy/port-registry.db (NOT old scatter paths)
  │
  └─ Data validation:
     ├─ Query canonical DB for expected tables (services, sessions, roadmap_items, etc.)
     └─ Spot-check row counts against archived fragment counts

PHASE 6: Operator Sign-Off
  ├─ Confirm daemon is stable (uptime > 30s)
  ├─ Confirm no zombie processes
  ├─ Confirm fleet status is healthy (FleetBar or dashboard)
  ├─ Cleanup: rm -rf ~/.port-daddy/backups/_pre-consolidation-<ts>/
  └─ Update CLAUDE.md memory: consolidation complete, canonical path confirmed
```

---

## Pre-Consolidation Checklist

Run BEFORE executing `scripts/db-consolidate.ts`:

### Database Fragment Inventory
- [ ] Operator has visibility into all DB paths that will be scanned:
  ```bash
  ls -lh ~/.port-daddy/port-registry.db
  ls -lh ~/.port-daddy/instances/*/port-daddy.db 2>/dev/null || echo "(none)"
  ls -lh ~/coding/port-daddy/port-registry.db 2>/dev/null || echo "(none)"
  ls -lh ~/coding/port-daddy/dist/port-registry.db 2>/dev/null || echo "(none)"
  find /opt/homebrew/Cellar/port-daddy -name "*.db" 2>/dev/null || echo "(none)"
  ```

### Daemon State
- [ ] Daemon is running: `pd status` outputs a valid port/socket
- [ ] Daemon has a valid PID: `ps aux | grep "port-daddy.*server"`
- [ ] Port is reachable: `curl -s "$(cat ~/.port-daddy/daemon.port | sed 's#^#http://localhost:#')/fleet"` returns JSON
- [ ] No zombie processes: `ps aux | grep "Z" | grep port-daddy` returns nothing

### Git State
- [ ] Worktree is clean: `git status --short` shows no uncommitted changes
- [ ] Branch is up to date with remote: `git fetch origin && git log --oneline -1` vs `git log --oneline origin/main -1`
- [ ] No active edits to critical paths (daemon routes, DB code): `pd sessions --all-worktrees` shows no conflicting claims

### Coordination State
- [ ] Guard is configured: `pd guard status` shows current mode (enforce/warn/off)
- [ ] Active session exists: `pd whoami` returns valid `sessionId` and `agentId`
- [ ] No active file claims on DB paths: `pd files | grep port-registry` returns nothing
- [ ] No active locks: `pd locks list` is empty or safe

### Backup Readiness
- [ ] Archive directory does not exist yet: `ls -la ~/.port-daddy/backups/_pre-consolidation-*` returns nothing
- [ ] Backups directory is writable: `touch ~/.port-daddy/backups/.test && rm $_`

---

## Consolidation Execution

### Run the Consolidation Script

**Option A: Interactive Mode (Operator Reviews Each Step)**
```bash
cd ~/coding/port-daddy
npx tsx ./.claude/worktrees/ws0-db-consolidation/scripts/db-consolidate.ts
# Script will prompt for approval before destructive ops
```

**Option B: Force Mode (Unattended, Requires Prior Approval)**
```bash
cd ~/coding/port-daddy
npx tsx ./.claude/worktrees/ws0-db-consolidation/scripts/db-consolidate.ts --force
```

**Option C: Explicit Source (Pre-Determined Truth)**
```bash
cd ~/coding/port-daddy
npx tsx ./.claude/worktrees/ws0-db-consolidation/scripts/db-consolidate.ts \
  --force \
  --source "/Users/erichowens/.port-daddy/instances/default/port-daddy.db"
```

### Monitor Consolidation Output

Expected progress:
1. "Scanning database fragments..." → Enumeration of all paths
2. Inventory summary → counts of valid/empty/corrupted/missing
3. Selection of source → "Detected live daemon using:" or "Using freshest by timestamp:"
4. Table comparison → row-count diff across candidates
5. Approval prompt → "[y/N]" if not --force
6. VACUUM progress → "VACUUM-ing source into ~/.port-daddy/port-registry.db..."
7. Integrity check → "Integrity check passed"
8. Archive progress → "Archived: <path>"
9. Success banner → "Consolidation complete!"

---

## Post-Consolidation Checklist

Run AFTER `scripts/db-consolidate.ts` exits with success (exit code 0):

### Immediate (First 2 Minutes)

- [ ] Archive directory exists: `ls -la ~/.port-daddy/backups/_pre-consolidation-*/`
- [ ] Canonical DB exists and is non-zero: `ls -lh ~/.port-daddy/port-registry.db`
- [ ] Canonical DB is readable: `sqlite3 ~/.port-daddy/port-registry.db "PRAGMA integrity_check;"`
  - Expected output: `ok`

### Daemon Restart & Validation (2–10 Minutes)

- [ ] Stop daemon:
  ```bash
  launchctl stop homebrew.mxcl.port-daddy
  sleep 2
  ```

- [ ] Verify daemon is stopped:
  ```bash
  ps aux | grep "port-daddy.*server" | grep -v grep
  # Should return nothing
  ```

- [ ] Remove stale socket (if it exists):
  ```bash
  rm -f /tmp/port-daddy-*.sock 2>/dev/null || true
  rm -f ~/.port-daddy/*.sock 2>/dev/null || true
  ```

- [ ] Start daemon:
  ```bash
  launchctl start homebrew.mxcl.port-daddy
  sleep 3
  ```

- [ ] Verify daemon started:
  ```bash
  pd status
  # Expected: "Port Daddy daemon running on http://localhost:<port>"
  ```

- [ ] Daemon is listening on canonical DB:
  ```bash
  lsof -p $(pgrep -f "port-daddy.*server") | grep "port-registry.db"
  # Expected: single line showing ~/.port-daddy/port-registry.db
  ```

### Coordination Continuity (10–20 Minutes)

- [ ] Doctor passes:
  ```bash
  pd doctor
  # Expected: no critical issues, or only advisory warnings
  ```

- [ ] Guard status is consistent:
  ```bash
  pd guard status
  # Expected: Coordination Guard mode matches pre-consolidation state
  ```

- [ ] Active session still exists:
  ```bash
  pd whoami
  # Expected: valid sessionId and agentId (same as before consolidation)
  ```

- [ ] Claims are visible:
  ```bash
  pd files list
  # Expected: shows any active claims from this session
  ```

- [ ] No new violations on staged files:
  ```bash
  git status --short
  pd guard check --staged
  # Expected: passed (or no staged changes)
  ```

- [ ] Sitrep is healthy:
  ```bash
  pd sitrep
  # Expected: shows sessions, claims, roadmap items, and integrity metrics
  ```

### Data Validation (20–30 Minutes)

- [ ] Canonical DB has expected schema:
  ```bash
  sqlite3 ~/.port-daddy/port-registry.db ".tables"
  # Expected: at least: services, sessions, roadmap_items, messages, claims, locks, ...
  ```

- [ ] Spot-check table row counts match archived fragments:
  ```bash
  sqlite3 ~/.port-daddy/port-registry.db "SELECT 'services', COUNT(*) FROM services;"
  sqlite3 ~/.port-daddy/port-registry.db "SELECT 'sessions', COUNT(*) FROM sessions;"
  # Compare against archived DBs (optional manual check)
  ```

- [ ] Backup manifest points to canonical path:
  ```bash
  pd backup manifest
  # Expected: sourcePath = "~/.port-daddy/port-registry.db"
  ```

- [ ] Backup restore would work:
  ```bash
  pd backup list
  # Expected: shows one or more backup snapshots
  ```

### Fleet Stability (30–60 Minutes)

- [ ] No daemon restarts since consolidation:
  ```bash
  launchctl print gui/501/homebrew.mxcl.port-daddy | grep "Last exit code"
  # Expected: no entry, or code 0
  ```

- [ ] No zombie processes:
  ```bash
  ps aux | grep "Z" | grep -v grep
  # Expected: nothing
  ```

- [ ] FleetBar/Dashboard is responsive:
  ```bash
  curl -s "$(cat ~/.port-daddy/daemon.port | sed 's#^#http://localhost:#')/fleet" | jq .status
  # Expected: JSON response, not timeout/error
  ```

- [ ] Active agents can coordinate:
  ```bash
  pd sessions list
  # Expected: shows active sessions with updated_at timestamps
  ```

---

## Cleaning Up Old Fragments (Post-Validation)

Once continuity checks pass and daemon has been stable for 30+ minutes:

### Archive Retention (Recommended)
- **Keep** `~/.port-daddy/backups/_pre-consolidation-<ts>/` for 7+ days as a safety rollback
- **Document** the timestamp in a note: `pd note "DB consolidation complete. Backup at <path>."`

### Safe Deletion
```bash
# Only after 7 days and operator confirmation:
rm -rf ~/.port-daddy/backups/_pre-consolidation-<oldest-ts>/
```

### Verify Deletion Did Not Break Anything
```bash
pd sitrep
pd guard check --staged
# Expected: still healthy
```

---

## Risk Assessment & Gaps Left for WS-1

### Assumptions This Workflow Makes

1. **Daemon is down-restartable:** The consolidation assumes stopping and restarting the daemon is safe (true for this repo, may not be for always-on fleets)
2. **Single-machine operation:** No support for remote/federated harbors (future: ADR-0049 relay path)
3. **Operator is present:** No automated rollback if validation fails
4. **No concurrent writes:** Script assumes no other process is writing to DBs during consolidation
5. **Canonical path is always `~/.port-daddy/port-registry.db`:** Future work may support env-variable override

### Known Limitations (WS-0)

| Issue | Impact | Mitigation | WS-1 Responsibility |
|-------|--------|------------|---------------------|
| `require()` not defined in instances scan | Cannot enumerate per-profile DBs | Falls back to hardcoded path list | Fix ESM/CJS mismatch in scanner |
| No automatic env var pinning | Daemon may revert to old paths after restart | Manual verification of `lsof` output | Add `CANONICAL_DB_PATH` env export to launchd plist |
| Archive directory is not encrypted | Backup metadata is plaintext-readable | Operator must ensure `~/.port-daddy/` permissions are 0700 | Evaluate encrypted backup storage |
| No automatic schema evolution | If canonical DB schema diverges from source | Manual `ALTER TABLE` if corruption suspected | Add migration validation check |
| Guard continuity not verified post-restart | Coordination state may be stale | Re-run `pd guard check --staged` after daemon restart | Build guard state recovery into daemon boot |
| No metrics on consolidation success | Cannot measure if consolidation helped | Operator must observe daemon memory/CPU over hours | Add telemetry to consolidation script |

### Gaps WS-1 Must Close

1. **Automatic Path Pinning:** Embed `CANONICAL_DB_PATH` in launchd plist so daemon always reads canonical path, not env-dependent
2. **Schema Validation:** Add `POST /consolidation/validate` that compares source and canonical schemas before VACUUM
3. **Rollback Support:** If daemon crashes post-consolidation, auto-restore from archive without manual intervention
4. **Replication:** For multi-machine setups (future fleet work), synchronize canonical DB across machines via relay fabric
5. **Operator Notification:** When consolidation completes or fails, surface status in FleetBar/dashboard, not just CLI
6. **Automated Metrics:** Track consolidation outcome (success/failure, table counts, restore time, recovery overhead)

---

## Operator Runbook: "My Consolidation Failed, What Now?"

### Scenario A: Consolidation Aborted Before VACUUM
**Symptom:** Script exited with prompt rejection (user said "N")  
**Action:** No destructive ops performed. Safe to retry:
```bash
npx tsx scripts/db-consolidate.ts --force
```

### Scenario B: VACUUM Failed (Canonical DB Does Not Exist)
**Symptom:** `VACUUM failed: <error>` or `VACUUM INTO did not produce ~/.port-daddy/port-registry.db`  
**Action:**
1. Restore from archive:
   ```bash
   ls ~/.port-daddy/backups/_pre-consolidation-*/
   cp ~/.port-daddy/backups/_pre-consolidation-<ts>/port-registry.db \
      ~/.port-daddy/port-registry.db.recovery
   ```
2. Verify integrity:
   ```bash
   sqlite3 ~/.port-daddy/port-registry.db.recovery "PRAGMA integrity_check;"
   ```
3. If OK, swap:
   ```bash
   mv ~/.port-daddy/port-registry.db.recovery ~/.port-daddy/port-registry.db
   launchctl restart homebrew.mxcl.port-daddy
   ```

### Scenario C: Daemon Won't Restart After Consolidation
**Symptom:** `launchctl start homebrew.mxcl.port-daddy` exits silently, daemon doesn't appear  
**Action:**
1. Check logs:
   ```bash
   tail -50 /var/log/system.log | grep port-daddy
   ```
2. Verify canonical DB exists:
   ```bash
   ls -lh ~/.port-daddy/port-registry.db
   sqlite3 ~/.port-daddy/port-registry.db "PRAGMA integrity_check;"
   ```
3. If DB is corrupt, restore from archive:
   ```bash
   # (see Scenario B)
   ```
4. If DB is OK but daemon won't start, suspect env or socket issue:
   ```bash
   rm -f ~/.port-daddy/*.sock
   launchctl start homebrew.mxcl.port-daddy
   sleep 3
   pd status
   ```

### Scenario D: Daemon Crashes Repeatedly After Consolidation
**Symptom:** Daemon starts, then crashes within seconds; repeats  
**Action:**
1. Stop repeated crashes:
   ```bash
   launchctl stop homebrew.mxcl.port-daddy
   ```
2. Check daemon logs:
   ```bash
   log stream --predicate 'process=="port-daddy"' --level debug
   ```
3. Suspect migration or schema issue:
   ```bash
   sqlite3 ~/.port-daddy/port-registry.db "PRAGMA integrity_check;"
   sqlite3 ~/.port-daddy/port-registry.db ".schema services" | head -20
   ```
4. If schema is broken, restore and retry with explicit source:
   ```bash
   # Use an archived fragment that daemon was known to work with
   npx tsx scripts/db-consolidate.ts --force --source /path/to/backup
   ```

---

## Verification Checklist (One-Pager for Operator)

Print this and check off as you go:

```
PRE-CONSOLIDATION
 ☐ daemon running (pd status)
 ☐ git clean (git status --short)
 ☐ no claims on DB files (pd files list)
 ☐ guard status known (pd guard status)
 ☐ backup dir is writable (touch ~/.port-daddy/backups/.test)

EXECUTION
 ☐ ran consolidation script (db-consolidate.ts)
 ☐ reviewed table comparison before proceeding
 ☐ script exited with code 0 (success)
 ☐ archive directory created (ls ~/.port-daddy/backups/_pre-consolidation-*/)

POST-CONSOLIDATION (First 2 min)
 ☐ canonical DB exists (ls -lh ~/.port-daddy/port-registry.db)
 ☐ canonical DB passes integrity check (sqlite3 ... PRAGMA integrity_check;)

DAEMON RESTART (2–10 min)
 ☐ daemon stopped (launchctl stop ...)
 ☐ old sockets removed (rm ~/.port-daddy/*.sock)
 ☐ daemon restarted (launchctl start ...)
 ☐ daemon is running (ps aux | grep port-daddy.*server)
 ☐ daemon listening on canonical path (lsof -p ... | grep port-registry.db)

CONTINUITY (10–30 min)
 ☐ doctor passes (pd doctor)
 ☐ guard status unchanged (pd guard status)
 ☐ active session exists (pd whoami)
 ☐ no guard violations (pd guard check --staged)
 ☐ sitrep is healthy (pd sitrep)

DATA VALIDATION (20–30 min)
 ☐ canonical DB has schema (sqlite3 ... .tables)
 ☐ table row counts look reasonable
 ☐ backup manifest correct (pd backup manifest)
 ☐ backup restore tested (pd backup list)

FLEET STABILITY (30–60 min)
 ☐ daemon uptime > 30s (launchctl print ... | grep "Started")
 ☐ no zombie processes (ps aux | grep Z)
 ☐ FleetBar/dashboard responsive
 ☐ agents can coordinate (pd sessions list)

CLEANUP
 ☐ archive saved for 7+ days as rollback
 ☐ consolidation documented in CLAUDE.md
 ☐ when safe, delete oldest archives
```

---

## References

- **ADR-0090 (Draft):** Database Consolidation & Path Pinning
- **Source:** `scripts/db-consolidate.ts` (WS-0 worktree)
- **Doctor Guard:** `cli/utils/startup-doctor.ts` (continuity checks)
- **Guard Command:** `cli/commands/guard.ts` (coordination verification)
- **Operations:** `docs/operations/daemon-and-supervision.md`
- **Memory:** `AGENTS.md` § Canonical Runtime
