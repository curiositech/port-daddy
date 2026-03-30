# Merge Infrastructure Plan

**Status:** Draft
**Author:** Port Daddy Core
**Date:** 2026-03-30
**Estimated effort:** 8-11 weeks across 4 phases

---

## Problem Statement

Port Daddy coordinates multi-agent development at the file and session level. But the final integration point -- merging branches -- remains uncoordinated. When three agents finish work on three branches, merging them is manual, serial, and blind to conflicts until `git merge` fails. The daemon has all the information needed to predict conflicts, order merges optimally, and enforce post-merge invariants. It just doesn't use it yet.

This plan adds three capabilities:

1. **Merge Queue** -- a priority queue for coordinating multi-agent merges with conflict prediction and atomic execution
2. **New Arbiter Invariants** -- four rules that enforce merge safety (test quality, symbol claim consistency, conflict thresholds, queue staleness)
3. **Tree-sitter Integration** -- AST-aware symbol extraction, symbol-level claims, and structural conflict prediction

---

## Existing Infrastructure (What We Build On)

| Component | Current State | Relevant to Merge |
|-----------|--------------|-------------------|
| `session_files` table | Whole-file and region claims with overlap detection | Extend to symbol-level claims |
| `lib/arbiter.ts` | 6 invariant rules, activity log subscription, test injection | Add 4 merge-related rules |
| `lib/worktree.ts` | Git worktree detection, branch info | Used by merge executor for repo context |
| `lib/agents.ts` | Agent registry with heartbeats, identity, status | Merge submitter must be a registered agent |
| `lib/locks.ts` | Distributed mutex locks | Merge execution acquires a lock per repo |
| `lib/pheromone.ts` | Stigmergic signals with time decay | Conflict surface as pheromone (heat fades) |
| `lib/activity.ts` | Activity log with pub/sub subscription | New activity types for merge events |
| `routes/index.ts` | Fastify plugin aggregator | Register merge and symbols plugins |

---

## Phase 1: Merge Queue (Weeks 1-3)

### 1.1 Data Model

New file: `lib/merge-queue.ts`

```sql
-- Created by createMergeQueue(db)
CREATE TABLE IF NOT EXISTS merge_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  branch TEXT NOT NULL,
  target_branch TEXT NOT NULL DEFAULT 'main',
  repository TEXT NOT NULL,           -- absolute path to repo root
  worktree_id TEXT,
  claims TEXT,                        -- JSON: [{file, symbol?, type}] touched by this merge
  conflict_surface REAL DEFAULT 0.0,  -- computed 0.0-1.0, updated on predict
  status TEXT NOT NULL DEFAULT 'pending',
  position INTEGER,                   -- merge ordering (lower = earlier)
  submitted_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  merge_sha TEXT,                     -- resulting commit SHA on success
  failure_reason TEXT,
  recovery_action TEXT,               -- revert | retry | manual | skip
  metadata TEXT                       -- JSON: arbitrary caller data
);

CREATE INDEX IF NOT EXISTS idx_mq_status ON merge_queue(status);
CREATE INDEX IF NOT EXISTS idx_mq_repo ON merge_queue(repository, status);
CREATE INDEX IF NOT EXISTS idx_mq_agent ON merge_queue(agent_id);
CREATE INDEX IF NOT EXISTS idx_mq_position ON merge_queue(position);

CREATE TABLE IF NOT EXISTS merge_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  merge_a INTEGER NOT NULL REFERENCES merge_queue(id) ON DELETE CASCADE,
  merge_b INTEGER NOT NULL REFERENCES merge_queue(id) ON DELETE CASCADE,
  conflict_type TEXT NOT NULL,        -- direct | dependency | transitive | signature
  severity TEXT NOT NULL,             -- blocking | warning | info
  files TEXT,                         -- JSON: [{path, symbolA?, symbolB?, reason}]
  details TEXT,                       -- human-readable explanation
  predicted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mc_merges ON merge_conflicts(merge_a, merge_b);
CREATE INDEX IF NOT EXISTS idx_mc_severity ON merge_conflicts(severity);
```

**Status lifecycle:**

```
pending -> executing -> completed
                    \-> failed -> (recovery_action decides next step)
                                  revert  -> reverted
                                  retry   -> pending (re-queued)
                                  manual  -> stalled (human picks up)
                                  skip    -> skipped
```

### 1.2 Module Interface

```typescript
// lib/merge-queue.ts

interface SubmitOptions {
  agentId: string;
  sessionId?: string;
  branch: string;
  targetBranch?: string;      // defaults to 'main'
  repository: string;
  worktreeId?: string;
  claims?: MergeClaim[];
  metadata?: Record<string, unknown>;
}

interface MergeClaim {
  file: string;
  symbol?: string;            // optional symbol path (Phase 3)
  type: 'modify' | 'add' | 'delete' | 'rename';
}

interface MergeResult {
  success: boolean;
  sha?: string;
  failureReason?: string;
  testsPassed?: boolean;
  arbiterClean?: boolean;
}

interface ConflictPrediction {
  mergeA: number;
  mergeB: number;
  conflictType: 'direct' | 'dependency' | 'transitive' | 'signature';
  severity: 'blocking' | 'warning' | 'info';
  files: Array<{
    path: string;
    symbolA?: string;
    symbolB?: string;
    reason: string;
  }>;
  details: string;
}

interface MergeQueueEntry {
  id: number;
  agentId: string;
  sessionId: string | null;
  branch: string;
  targetBranch: string;
  repository: string;
  worktreeId: string | null;
  claims: MergeClaim[];
  conflictSurface: number;
  status: string;
  position: number;
  submittedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  mergeSha: string | null;
  failureReason: string | null;
  recoveryAction: string | null;
  metadata: Record<string, unknown> | null;
}

export function createMergeQueue(db: Database.Database) {
  // Table creation (idempotent, as per project pattern)
  // Prepared statements (as per sessions.ts pattern)

  return {
    submit(opts: SubmitOptions): { success: boolean; id: number; position: number; conflicts: ConflictPrediction[] };
    list(opts?: { status?: string; repository?: string; limit?: number }): MergeQueueEntry[];
    get(id: number): MergeQueueEntry | null;
    cancel(id: number, agentId: string): { success: boolean };
    reorder(ids: number[]): { success: boolean };      // explicit position override
    predictConflicts(repository: string): ConflictPrediction[];
    getConflictsFor(mergeId: number): ConflictPrediction[];
    markExecuting(id: number): { success: boolean };
    markCompleted(id: number, sha: string): { success: boolean };
    markFailed(id: number, reason: string, recovery: string): { success: boolean };
    computeConflictSurface(mergeId: number): number;    // recalculate score
    cleanup(olderThan?: number): { deleted: number };
  };
}
```

### 1.3 Merge Executor

New file: `lib/merge-executor.ts`

The executor runs git commands via `execFileSync`/`execFile` (never `exec` -- shell injection protection). It is the only module in Port Daddy that runs git commands against external repos (besides `worktree.ts`). All git operations happen inside a per-repo lock to prevent concurrent merges on the same repository.

```typescript
// lib/merge-executor.ts

interface MergeExecutorDeps {
  locks: ReturnType<typeof createLocks>;
  mergeQueue: ReturnType<typeof createMergeQueue>;
  activityLog: ReturnType<typeof createActivityLog>;
}

interface ExecuteOptions {
  mergeId: number;
  runTests?: boolean;           // default true
  testCommand?: string;         // default 'npm test'
  dryRun?: boolean;             // simulate without committing
  autoRevert?: boolean;         // revert on test failure (default true)
}

interface MergeResult {
  success: boolean;
  sha?: string;
  failureReason?: string;
  testResult?: {
    passed: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  };
  changedFiles: string[];
  conflictFiles?: string[];     // only on failure
}

export function createMergeExecutor(deps: MergeExecutorDeps) {
  return {
    execute(opts: ExecuteOptions): Promise<MergeResult>;
    revert(sha: string, repository: string): Promise<{ success: boolean }>;
    getChangedFiles(branch: string, base: string, repo: string): Promise<string[]>;
    getDiff(branch: string, base: string, repo: string): Promise<string>;
    canFastForward(branch: string, base: string, repo: string): Promise<boolean>;
  };
}
```

**Execution algorithm (pseudocode):**

```
execute(opts):
  entry = mergeQueue.get(opts.mergeId)
  if entry.status != 'pending': return { success: false, reason: 'not pending' }

  // 1. Acquire repo lock (prevents concurrent merges)
  lock = locks.acquire("merge:<entry.repository>", {
    owner: "merge-executor",
    ttl: 300000  // 5 min max
  })
  if !lock.success: return { success: false, reason: 'repo locked' }

  try:
    mergeQueue.markExecuting(entry.id)

    // 2. Verify branch exists and is clean
    //    Uses execFileSync('git', ['rev-parse', '--verify', entry.branch], { cwd: repo })
    //    Uses execFileSync('git', ['status', '--porcelain'], { cwd: repo })

    // 3. Get changed files for post-merge validation
    changedFiles = getChangedFiles(entry.branch, entry.targetBranch, repo)

    // 4. Attempt merge
    //    Uses execFileSync('git', ['merge', entry.branch, '--no-edit'], { cwd: repo })
    //    On failure: parse conflict files from stderr, abort merge, mark failed
    //    Uses execFileSync('git', ['merge', '--abort'], { cwd: repo })

    // 5. Get merge SHA
    //    Uses execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo })

    // 6. Run tests (if requested)
    //    Uses execFile (async) with timeout (default 10 min)
    //    On failure + autoRevert: revert merge commit, mark failed

    // 7. Success: mark completed, log activity

  finally:
    locks.release("merge:<entry.repository>", { owner: 'merge-executor' })
```

**Important:** All git commands use `execFileSync('git', [...args], { cwd: repo })` or the async `execFile` variant. Never use `exec()` with string interpolation. The `cwd` option ensures git operates in the correct repository. Arguments are passed as arrays, not shell strings.

### 1.4 Conflict Prediction (File-Level, Phase 1)

Phase 1 conflict prediction works at the file level only. Tree-sitter upgrades it to symbol-level in Phase 3.

```typescript
// Inside createMergeQueue

function predictConflicts(repository: string): ConflictPrediction[] {
  const pending = list({ status: 'pending', repository });
  const predictions: ConflictPrediction[] = [];

  for (let i = 0; i < pending.length; i++) {
    for (let j = i + 1; j < pending.length; j++) {
      const a = pending[i];
      const b = pending[j];

      // Compare file claims
      const aFiles = new Set((a.claims || []).map(c => c.file));
      const bFiles = new Set((b.claims || []).map(c => c.file));

      const overlapping = [...aFiles].filter(f => bFiles.has(f));

      if (overlapping.length > 0) {
        const aModifies = (a.claims || []).some(c => overlapping.includes(c.file) && c.type === 'modify');
        const bModifies = (b.claims || []).some(c => overlapping.includes(c.file) && c.type === 'modify');

        const severity = (aModifies && bModifies) ? 'blocking'
                       : (aModifies || bModifies) ? 'warning'
                       : 'info';

        predictions.push({
          mergeA: a.id,
          mergeB: b.id,
          conflictType: 'direct',
          severity,
          files: overlapping.map(path => ({
            path,
            reason: severity === 'blocking'
              ? 'Both merges modify this file'
              : 'One merge modifies, the other touches this file'
          })),
          details: `${overlapping.length} overlapping file(s) between merge #${a.id} and #${b.id}`
        });
      }
    }
  }

  // Store predictions in merge_conflicts table
  const now = Date.now();
  for (const pred of predictions) {
    db.prepare(`
      INSERT INTO merge_conflicts (merge_a, merge_b, conflict_type, severity, files, details, predicted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(pred.mergeA, pred.mergeB, pred.conflictType, pred.severity,
           JSON.stringify(pred.files), pred.details, now);
  }

  return predictions;
}
```

**Conflict surface formula (Phase 1, file-level):**

```
conflictSurface(merge) =
  let overlaps = count of other pending merges that touch at least one same file
  let totalPending = count of all other pending merges in same repo
  let modifyOverlaps = count of overlaps where both sides modify

  score = (modifyOverlaps * 1.0 + (overlaps - modifyOverlaps) * 0.3) / max(totalPending, 1)
  return clamp(score, 0.0, 1.0)
```

### 1.5 Merge Ordering

Default ordering: FIFO within a repository, but with conflict-aware promotion.

```typescript
function computeOptimalOrder(repository: string): number[] {
  const pending = list({ status: 'pending', repository });
  const predictions = predictConflicts(repository);

  // Score each merge: lower conflictSurface = merge earlier
  // Tie-break by submission time (FIFO)
  const scored = pending.map(m => ({
    id: m.id,
    score: m.conflictSurface,
    submittedAt: m.submittedAt
  }));

  scored.sort((a, b) => {
    // Primary: lower conflict surface first (cleanest merges go first)
    if (a.score !== b.score) return a.score - b.score;
    // Secondary: FIFO
    return a.submittedAt - b.submittedAt;
  });

  return scored.map(s => s.id);
}
```

The rationale: merge the branches with the least overlap first. This reduces the chance that later merges hit conflicts caused by earlier merge outputs.

### 1.6 API Endpoints

New file: `routes/merge.ts`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/merge/submit` | POST | Submit a branch to the merge queue |
| `/merge/queue` | GET | List queue entries (filter by status, repo) |
| `/merge/queue/:id` | GET | Get single entry with conflict predictions |
| `/merge/queue/:id` | DELETE | Cancel a pending merge |
| `/merge/execute/:id` | POST | Execute a merge (acquires repo lock) |
| `/merge/predict` | GET | Predict conflicts for a repository |
| `/merge/reorder` | POST | Explicitly set merge order |
| `/merge/inspect/:id` | POST | Post-merge inspection (Arbiter + tests) |
| `/merge/conflicts/:id` | GET | Get conflict predictions for a merge |

**Request/response examples:**

```bash
# Submit to queue
curl -X POST http://localhost:9876/merge/submit \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId": "agent-abc",
    "branch": "feature/auth-refactor",
    "targetBranch": "main",
    "repository": "/Users/dev/myapp",
    "claims": [
      {"file": "src/auth.ts", "type": "modify"},
      {"file": "src/middleware.ts", "type": "modify"},
      {"file": "src/types/auth.ts", "type": "add"}
    ]
  }'

# Response:
{
  "success": true,
  "id": 7,
  "position": 3,
  "conflictSurface": 0.42,
  "conflicts": [
    {
      "mergeA": 7,
      "mergeB": 5,
      "conflictType": "direct",
      "severity": "warning",
      "files": [{"path": "src/middleware.ts", "reason": "Both merges modify this file"}],
      "details": "1 overlapping file(s) between merge #7 and #5"
    }
  ]
}

# Execute merge
curl -X POST http://localhost:9876/merge/execute/7 \
  -d '{"runTests": true, "testCommand": "npm test", "autoRevert": true}'

# Predict conflicts for a repo
curl "http://localhost:9876/merge/predict?repository=/Users/dev/myapp"
```

### 1.7 CLI Commands

```bash
pd merge submit --branch feature/auth --repo /path/to/repo --agent my-agent
pd merge queue                                    # list pending
pd merge queue --repo /path/to/repo               # filter by repo
pd merge execute <id>                             # execute a merge
pd merge execute <id> --dry-run                   # simulate
pd merge execute <id> --no-tests                  # skip test runner
pd merge predict --repo /path/to/repo             # show conflict predictions
pd merge cancel <id>                              # cancel pending merge
pd merge inspect <id>                             # post-merge inspection
pd merge reorder 5 3 7                            # explicit ordering
```

### 1.8 Activity Types

Add to `lib/activity.ts`:

```typescript
// Merge operations
MERGE_SUBMIT: 'merge.submit',
MERGE_EXECUTE: 'merge.execute',
MERGE_COMPLETE: 'merge.complete',
MERGE_FAIL: 'merge.fail',
MERGE_REVERT: 'merge.revert',
MERGE_CANCEL: 'merge.cancel',
```

### 1.9 SDK Methods

Add to `lib/client.ts`:

```typescript
// Merge queue
mergeSubmit(opts: MergeSubmitOptions): Promise<MergeSubmitResponse>;
mergeQueue(opts?: { status?: string; repository?: string }): Promise<MergeQueueEntry[]>;
mergeExecute(id: number, opts?: MergeExecuteOptions): Promise<MergeResult>;
mergePredict(repository: string): Promise<ConflictPrediction[]>;
mergeCancel(id: number): Promise<{ success: boolean }>;
```

### 1.10 Testing Strategy (Phase 1)

**Unit tests** (`tests/unit/merge-queue.test.js`):

- Submit adds entry with correct position
- Submit auto-predicts conflicts
- Cancel only works on pending status
- Conflict prediction: no overlap = no prediction
- Conflict prediction: file overlap, both modify = blocking
- Conflict prediction: file overlap, one modify = warning
- Conflict prediction: no modify overlap = info
- Conflict surface computation matches formula
- Ordering: lower conflict surface first, FIFO tiebreak
- Reorder explicitly overrides position
- Status transitions: pending -> executing -> completed
- Status transitions: pending -> executing -> failed -> revert/retry/manual
- Cleanup removes old completed/failed entries
- Merge in non-existent repo returns error

**Integration tests** (`tests/integration/merge-queue.test.js`):

- Full flow: submit -> predict -> execute -> verify SHA
- Merge with test failure -> auto-revert
- Concurrent merge submissions get sequential positions
- Repo lock prevents concurrent execution
- CLI `pd merge submit` / `pd merge queue` round-trip

Estimated test count: 25-30 new tests.

---

## Phase 2: New Arbiter Invariants (Weeks 4-5)

### 2.1 Invariant: MERGE_QUALITY (critical)

**Purpose:** After any merge execution, verify the merge didn't degrade the codebase.

**Trigger:** Activity type `merge.complete`

**Check function:**

```typescript
function checkMergeQuality(entry: ActivityEntry) {
  const mergeId = entry.metadata?.mergeId;
  if (!mergeId) return;

  const merge = mergeQueue.get(mergeId);
  if (!merge) return;

  // Check 1: merge SHA exists
  if (!merge.mergeSha) {
    recordViolation('MERGE_QUALITY', 'critical',
      `Merge #${mergeId} marked complete but has no merge SHA`,
      merge.agentId, { mergeId });
    return;
  }

  // Check 2: no new Arbiter violations since merge started
  const recentViolations = violations.filter(v =>
    v.timestamp >= (merge.startedAt || 0) &&
    v.timestamp <= (merge.completedAt || Date.now()) &&
    v.rule !== 'MERGE_QUALITY'  // prevent recursion
  );

  if (recentViolations.length > 0) {
    recordViolation('MERGE_QUALITY', 'warning',
      `Merge #${mergeId} introduced ${recentViolations.length} Arbiter violation(s)`,
      merge.agentId, { mergeId, violations: recentViolations.map(v => v.rule) });
  }
}
```

**Data read:** `merge_queue` table (via mergeQueue.get), in-memory violations array.

**Severity:** `critical` for missing SHA, `warning` for new violations.

**Remediation:** Re-run tests. If tests pass but Arbiter flagged, investigate the specific violations. If SHA is missing, the merge executor has a bug -- file a bug.

**Test injection:**

```typescript
case 'MERGE_QUALITY':
  recordViolation('MERGE_QUALITY', 'critical',
    'TEST: Simulated merge quality failure', 'test-agent',
    { test: true, mergeId: 0 });
  break;
```

### 2.2 Invariant: SYMBOL_CLAIM_CONSISTENCY (violation)

**Purpose:** No two active agents should claim overlapping AST symbols. This extends the existing file claim overlap detection to symbol granularity.

**Trigger:** Activity type `file.claim` (reuses existing type; in Phase 3, symbol claims fire this same activity type with symbol metadata).

**Check function:**

```typescript
function checkSymbolClaimConsistency(entry: ActivityEntry) {
  const { targetId, metadata, agentId } = entry;
  if (!metadata?.symbol || !metadata?.filePath) return;

  const symbol = metadata.symbol as string;
  const filePath = metadata.filePath as string;
  const sessionId = metadata.sessionId as string;

  // Query for active claims on the same symbol from OTHER sessions
  const overlapping = db.prepare(`
    SELECT sf.session_id, sf.symbol, s.agent_id, s.purpose
    FROM session_files sf
    JOIN sessions s ON s.id = sf.session_id
    WHERE sf.file_path = ?
      AND sf.symbol = ?
      AND sf.released_at IS NULL
      AND s.status = 'active'
      AND sf.session_id != ?
  `).all(filePath, symbol, sessionId);

  if (overlapping.length > 0) {
    const otherAgents = overlapping.map((o: any) => o.agent_id).join(', ');
    recordViolation('SYMBOL_CLAIM_CONSISTENCY', 'violation',
      `Symbol ${symbol} in ${filePath} claimed by ${agentId} conflicts with claim by ${otherAgents}`,
      agentId, { filePath, symbol, sessionId, conflictingSessions: overlapping });
  }
}
```

**Data read:** `session_files` + `sessions` tables.

**Severity:** `violation` (not critical, because claims are advisory).

**Remediation:** The conflicting agent should coordinate with the original claimant. The Arbiter logs the conflict but does not block the claim (advisory system). In strict mode, the claim could be rejected.

**Test injection:**

```typescript
case 'SYMBOL_CLAIM_CONSISTENCY':
  recordViolation('SYMBOL_CLAIM_CONSISTENCY', 'violation',
    'TEST: Simulated symbol claim conflict', 'test-agent',
    { test: true, filePath: 'test.ts', symbol: 'testFunction' });
  break;
```

### 2.3 Invariant: CONFLICT_SURFACE_THRESHOLD (warning)

**Purpose:** When a merge submission has a high conflict surface, warn or flag for human review.

**Trigger:** Activity type `merge.submit`

**Check function:**

```typescript
const CONFLICT_WARN_THRESHOLD = 0.7;
const CONFLICT_CRITICAL_THRESHOLD = 0.9;

function checkConflictSurfaceThreshold(entry: ActivityEntry) {
  const mergeId = entry.metadata?.mergeId;
  if (!mergeId) return;

  const merge = mergeQueue.get(mergeId);
  if (!merge) return;

  if (merge.conflictSurface >= CONFLICT_CRITICAL_THRESHOLD) {
    recordViolation('CONFLICT_SURFACE_THRESHOLD', 'critical',
      `Merge #${mergeId} has conflict surface ${merge.conflictSurface.toFixed(2)} (>= ${CONFLICT_CRITICAL_THRESHOLD}) -- requires human review`,
      merge.agentId, { mergeId, conflictSurface: merge.conflictSurface });
  } else if (merge.conflictSurface >= CONFLICT_WARN_THRESHOLD) {
    recordViolation('CONFLICT_SURFACE_THRESHOLD', 'warning',
      `Merge #${mergeId} has conflict surface ${merge.conflictSurface.toFixed(2)} (>= ${CONFLICT_WARN_THRESHOLD}) -- high conflict risk`,
      merge.agentId, { mergeId, conflictSurface: merge.conflictSurface });
  }
}
```

**Data read:** `merge_queue` table (via mergeQueue.get).

**Severity:** `warning` at 0.7, `critical` at 0.9.

**Remediation:** For warnings, proceed with caution. For critical, pause the merge and notify the human operator via pub/sub channel `arbiter:merge-review`.

**Test injection:**

```typescript
case 'CONFLICT_SURFACE_THRESHOLD':
  recordViolation('CONFLICT_SURFACE_THRESHOLD', 'warning',
    'TEST: Simulated high conflict surface', 'test-agent',
    { test: true, mergeId: 0, conflictSurface: 0.85 });
  break;
```

### 2.4 Invariant: MERGE_QUEUE_STALENESS (warning)

**Purpose:** Detect stalled merge queues. If merges sit pending for too long, something is wrong -- the executor might be stuck, or agents might have abandoned their work.

**Trigger:** Periodic sweep (60-second interval timer, same pattern as pheromone evaporation).

**Check function:**

```typescript
const MERGE_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function checkMergeQueueStaleness() {
  const now = Date.now();
  const stale = db.prepare(`
    SELECT id, agent_id, branch, submitted_at
    FROM merge_queue
    WHERE status = 'pending' AND submitted_at < ?
  `).all(now - MERGE_STALE_THRESHOLD_MS);

  for (const entry of stale) {
    const ageMinutes = Math.round((now - (entry as any).submitted_at) / 60000);
    recordViolation('MERGE_QUEUE_STALENESS', 'warning',
      `Merge #${(entry as any).id} (branch: ${(entry as any).branch}) has been pending for ${ageMinutes} minutes`,
      (entry as any).agent_id, { mergeId: (entry as any).id, ageMs: now - (entry as any).submitted_at });
  }
}

// Start periodic sweep
const staleSweepInterval = setInterval(checkMergeQueueStaleness, 60000);
```

**Data read:** `merge_queue` table.

**Severity:** `warning` (never critical -- staleness alone doesn't break anything).

**Remediation:** Check if the submitting agent is still alive (heartbeat check). If dead, consider auto-cancelling the merge or moving it to the salvage queue.

**Test injection:**

```typescript
case 'MERGE_QUEUE_STALENESS':
  recordViolation('MERGE_QUEUE_STALENESS', 'warning',
    'TEST: Simulated stale merge queue', 'test-agent',
    { test: true, mergeId: 0, ageMs: 3600000 });
  break;
```

### 2.5 Arbiter Integration Changes

Update `lib/arbiter.ts`:

1. Add `mergeQueue` to `ArbiterDeps` (optional, for backwards compatibility):

```typescript
export interface ArbiterDeps {
  activityLog: ReturnType<typeof createActivityLog>;
  agents: ReturnType<typeof createAgents>;
  sessions: ReturnType<typeof createSessions>;
  locks: ReturnType<typeof createLocks>;
  resurrection?: ReturnType<typeof createResurrection>;
  mergeQueue?: ReturnType<typeof createMergeQueue>;    // NEW
}
```

2. Extend `RULES` array:

```typescript
const RULES = [
  'PID_SQUATTING',
  'CAP_ESCALATION',
  'NOTE_MONOTONICITY',
  'ESCROW_POSITIVE',
  'LOCK_OWNER_VALID',
  'HEARTBEAT_FRESHNESS',
  'MERGE_QUALITY',                    // NEW
  'SYMBOL_CLAIM_CONSISTENCY',         // NEW
  'CONFLICT_SURFACE_THRESHOLD',       // NEW
  'MERGE_QUEUE_STALENESS',            // NEW
] as const;
```

3. Add new activity type subscriptions in the `stopWatching` callback:

```typescript
case 'merge.complete':
  checkMergeQuality(entry);
  break;

case 'merge.submit':
  checkConflictSurfaceThreshold(entry);
  break;

case 'file.claim':
  checkSymbolClaimConsistency(entry);
  break;
```

4. Start/stop the staleness sweep timer. The `stop()` method must call `clearInterval(staleSweepInterval)`.

### 2.6 Testing Strategy (Phase 2)

**Unit tests** (`tests/unit/arbiter-merge.test.js`):

- MERGE_QUALITY: triggers on merge.complete with no SHA
- MERGE_QUALITY: triggers on merge.complete with new violations
- MERGE_QUALITY: does not trigger when merge is clean
- SYMBOL_CLAIM_CONSISTENCY: triggers when two sessions claim same symbol
- SYMBOL_CLAIM_CONSISTENCY: does not trigger for different symbols in same file
- SYMBOL_CLAIM_CONSISTENCY: does not trigger for same session
- CONFLICT_SURFACE_THRESHOLD: warning at 0.7
- CONFLICT_SURFACE_THRESHOLD: critical at 0.9
- CONFLICT_SURFACE_THRESHOLD: no violation below 0.7
- MERGE_QUEUE_STALENESS: triggers for entries older than 30 min
- MERGE_QUEUE_STALENESS: does not trigger for fresh entries
- MERGE_QUEUE_STALENESS: only checks pending entries
- All 4 new rules have working test injection
- Backwards compatibility: Arbiter works without mergeQueue dep

Estimated test count: 15-18 new tests.

---

## Phase 3: Tree-sitter Integration (Weeks 6-9)

### 3.1 Package Selection

```json
{
  "dependencies": {
    "tree-sitter": "^0.22.0",
    "tree-sitter-typescript": "^0.23.0",
    "tree-sitter-javascript": "^0.23.0",
    "tree-sitter-python": "^0.23.0"
  }
}
```

**Why native tree-sitter (not WASM):**
- We run on the daemon (server-side only), so native bindings are fine
- Native is 5-10x faster than WASM for parsing
- macOS ARM (M4 Max) is the primary target; tree-sitter has excellent ARM support
- WASM would only matter if we needed browser parsing (we don't)

**Risk mitigation:** If tree-sitter native bindings fail on the target Node.js version, fall back to `web-tree-sitter` (WASM). The parsing interface is identical; only the initialization differs. The module should abstract this behind a factory function.

### 3.2 Data Model

```sql
-- Created by createSymbolIndex(db)
CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  repository TEXT NOT NULL,
  symbol_name TEXT NOT NULL,
  symbol_type TEXT NOT NULL,           -- function | class | method | variable | interface | type | enum
  symbol_path TEXT NOT NULL,           -- dot-separated: "ClassName.methodName" or just "functionName"
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  start_col INTEGER,
  end_col INTEGER,
  parent_symbol TEXT,                  -- symbol_path of containing symbol (null for top-level)
  signature TEXT,                      -- e.g., "(db: Database, opts?: Options) => MergeQueue"
  body_hash TEXT,                      -- SHA-256 of symbol body text (change detection)
  file_hash TEXT,                      -- SHA-256 of entire file (staleness detection)
  parsed_at INTEGER NOT NULL,
  metadata TEXT                        -- JSON: exports, modifiers, decorators
);

CREATE INDEX IF NOT EXISTS idx_sym_file ON symbols(file_path);
CREATE INDEX IF NOT EXISTS idx_sym_repo ON symbols(repository);
CREATE INDEX IF NOT EXISTS idx_sym_name ON symbols(symbol_name);
CREATE INDEX IF NOT EXISTS idx_sym_path ON symbols(symbol_path);
CREATE INDEX IF NOT EXISTS idx_sym_type ON symbols(symbol_type);
CREATE INDEX IF NOT EXISTS idx_sym_parent ON symbols(parent_symbol);
CREATE INDEX IF NOT EXISTS idx_sym_file_hash ON symbols(file_path, file_hash);

CREATE TABLE IF NOT EXISTS symbol_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file TEXT NOT NULL,
  source_symbol TEXT NOT NULL,         -- symbol_path
  target_file TEXT NOT NULL,
  target_symbol TEXT NOT NULL,         -- symbol_path (or '*' for wildcard imports)
  dependency_type TEXT NOT NULL,       -- imports | calls | references | extends | implements
  confidence REAL DEFAULT 1.0,        -- 1.0 for imports, lower for inferred references
  parsed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sdep_source ON symbol_dependencies(source_file, source_symbol);
CREATE INDEX IF NOT EXISTS idx_sdep_target ON symbol_dependencies(target_file, target_symbol);
CREATE INDEX IF NOT EXISTS idx_sdep_type ON symbol_dependencies(dependency_type);
```

### 3.3 Symbol Extraction Module

New file: `lib/symbol-index.ts`

```typescript
// lib/symbol-index.ts

interface ExtractedSymbol {
  name: string;
  type: 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type' | 'enum';
  path: string;            // dot-joined: "MyClass.myMethod"
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
  parent: string | null;
  signature: string | null;
  bodyHash: string;
}

interface ExtractedDependency {
  sourceSymbol: string;
  targetFile: string;
  targetSymbol: string;
  type: 'imports' | 'calls' | 'references' | 'extends' | 'implements';
  confidence: number;
}

interface ParseResult {
  symbols: ExtractedSymbol[];
  dependencies: ExtractedDependency[];
  fileHash: string;
  parseTimeMs: number;
}

export function createSymbolIndex(db: Database.Database) {
  // Table creation (idempotent)

  return {
    /**
     * Parse a single file and store its symbols.
     * Skips if file_hash hasn't changed (incremental).
     */
    parseFile(filePath: string, repository: string, opts?: { force?: boolean }): ParseResult;

    /**
     * Parse all files in a directory (recursive).
     * Respects .gitignore. Skips unchanged files.
     */
    parseDirectory(dirPath: string, repository: string, opts?: {
      extensions?: string[];    // default: ['.ts', '.tsx', '.js', '.jsx', '.py']
      exclude?: string[];       // glob patterns to skip
      maxFiles?: number;        // safety limit, default 5000
    }): { parsed: number; skipped: number; errors: string[]; durationMs: number };

    /**
     * Get symbols for a file.
     */
    getSymbols(filePath: string): ExtractedSymbol[];

    /**
     * Find a symbol by name (substring match across all parsed files).
     */
    findSymbol(name: string, opts?: {
      type?: string;
      repository?: string;
      limit?: number;
    }): Array<ExtractedSymbol & { filePath: string }>;

    /**
     * Get the dependency graph for a symbol.
     */
    getDependencies(filePath: string, symbolPath: string, opts?: {
      direction?: 'outgoing' | 'incoming' | 'both';
      depth?: number;           // max traversal depth, default 1
    }): ExtractedDependency[];

    /**
     * Check if a file's symbols are stale (file has changed since last parse).
     */
    isStale(filePath: string): boolean;

    /**
     * Remove all symbols for a file (e.g., when file is deleted).
     */
    removeFile(filePath: string): { removed: number };

    /**
     * Get parsing statistics.
     */
    stats(): {
      totalFiles: number;
      totalSymbols: number;
      totalDependencies: number;
      staleFiles: number;
    };
  };
}
```

### 3.4 Tree-sitter Parsing Implementation

The core parsing logic for TypeScript/JavaScript. This is the most complex part of the system.

```typescript
// lib/parsers/typescript-parser.ts

import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import { createHash } from 'node:crypto';

const parser = new Parser();
// tree-sitter-typescript exports { typescript, tsx }
parser.setLanguage(TypeScript.typescript);

const tsxParser = new Parser();
tsxParser.setLanguage(TypeScript.tsx);

/**
 * Node types that constitute "symbols" in TypeScript.
 */
const SYMBOL_NODE_TYPES = new Set([
  // Functions
  'function_declaration',
  'arrow_function',                 // only when assigned to a variable
  'method_definition',
  'method_signature',

  // Classes & interfaces
  'class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',

  // Variables (only exported or top-level const/let)
  'variable_declarator',           // inside variable_declaration
]);

/**
 * Extract symbols from a TypeScript AST.
 */
function extractSymbols(tree: Parser.Tree, sourceCode: string): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  function visit(node: Parser.SyntaxNode, parentPath: string | null) {
    const type = node.type;

    if (type === 'function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = nameNode.text;
        const path = parentPath ? `${parentPath}.${name}` : name;
        symbols.push({
          name,
          type: 'function',
          path,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startCol: node.startPosition.column,
          endCol: node.endPosition.column,
          parent: parentPath,
          signature: extractFunctionSignature(node, sourceCode),
          bodyHash: hashNodeText(node, sourceCode),
        });
        // Visit children for nested functions
        for (const child of node.children) {
          visit(child, path);
        }
        return; // don't double-visit children
      }
    }

    if (type === 'class_declaration' || type === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = nameNode.text;
        const symType = type === 'class_declaration' ? 'class' : 'interface';
        const path = parentPath ? `${parentPath}.${name}` : name;
        symbols.push({
          name,
          type: symType,
          path,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startCol: node.startPosition.column,
          endCol: node.endPosition.column,
          parent: parentPath,
          signature: null,
          bodyHash: hashNodeText(node, sourceCode),
        });
        // Visit body for methods
        for (const child of node.children) {
          visit(child, path);
        }
        return;
      }
    }

    if (type === 'method_definition' || type === 'method_signature') {
      const nameNode = node.childForFieldName('name');
      if (nameNode && parentPath) {
        const name = nameNode.text;
        const path = `${parentPath}.${name}`;
        symbols.push({
          name,
          type: 'method',
          path,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startCol: node.startPosition.column,
          endCol: node.endPosition.column,
          parent: parentPath,
          signature: extractFunctionSignature(node, sourceCode),
          bodyHash: hashNodeText(node, sourceCode),
        });
      }
    }

    if (type === 'type_alias_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = nameNode.text;
        const path = parentPath ? `${parentPath}.${name}` : name;
        symbols.push({
          name,
          type: 'type',
          path,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startCol: node.startPosition.column,
          endCol: node.endPosition.column,
          parent: parentPath,
          signature: null,
          bodyHash: hashNodeText(node, sourceCode),
        });
      }
    }

    if (type === 'enum_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = nameNode.text;
        const path = parentPath ? `${parentPath}.${name}` : name;
        symbols.push({
          name,
          type: 'enum',
          path,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startCol: node.startPosition.column,
          endCol: node.endPosition.column,
          parent: parentPath,
          signature: null,
          bodyHash: hashNodeText(node, sourceCode),
        });
      }
    }

    // Variable declarations: only top-level arrow functions assigned to const
    if (type === 'variable_declarator' && !parentPath) {
      const nameNode = node.childForFieldName('name');
      const valueNode = node.childForFieldName('value');
      if (nameNode) {
        const name = nameNode.text;
        const isArrow = valueNode?.type === 'arrow_function';
        symbols.push({
          name,
          type: isArrow ? 'function' : 'variable',
          path: name,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          startCol: node.startPosition.column,
          endCol: node.endPosition.column,
          parent: null,
          signature: isArrow ? extractFunctionSignature(valueNode!, sourceCode) : null,
          bodyHash: hashNodeText(node, sourceCode),
        });
        if (isArrow) {
          for (const child of valueNode!.children) {
            visit(child, name);
          }
          return;
        }
      }
    }

    // Default: visit all children
    for (const child of node.children) {
      visit(child, parentPath);
    }
  }

  visit(tree.rootNode, null);
  return symbols;
}

function extractFunctionSignature(node: Parser.SyntaxNode, source: string): string {
  const params = node.childForFieldName('parameters');
  const returnType = node.childForFieldName('return_type');
  if (params) {
    const endIndex = returnType ? returnType.endIndex : params.endIndex;
    return source.substring(params.startIndex, endIndex).trim();
  }
  return '';
}

function hashNodeText(node: Parser.SyntaxNode, source: string): string {
  const text = source.substring(node.startIndex, node.endIndex);
  return createHash('sha256').update(text).digest('hex').substring(0, 16);
}
```

### 3.5 Dependency Extraction

```typescript
// lib/parsers/dependency-extractor.ts

/**
 * Extract import dependencies from a TypeScript file's AST.
 */
function extractDependencies(
  tree: Parser.Tree,
  sourceCode: string,
  filePath: string
): ExtractedDependency[] {
  const deps: ExtractedDependency[] = [];

  function visit(node: Parser.SyntaxNode) {
    // import { Foo } from './bar'
    if (node.type === 'import_statement') {
      const source = node.childForFieldName('source');
      if (!source) return;

      const importPath = source.text.replace(/['"]/g, '');
      const resolvedPath = resolveImportPath(importPath, filePath);

      const importClause = node.children.find(c => c.type === 'import_clause');
      if (importClause) {
        // Named imports: import { Foo, Bar } from './bar'
        const namedImports = importClause.descendantsOfType('import_specifier');
        for (const spec of namedImports) {
          const name = spec.childForFieldName('name')?.text || spec.text;
          deps.push({
            sourceSymbol: name,
            targetFile: resolvedPath,
            targetSymbol: name,
            type: 'imports',
            confidence: 1.0,
          });
        }

        // Default import: import Foo from './bar'
        const defaultImport = importClause.children.find(c => c.type === 'identifier');
        if (defaultImport) {
          deps.push({
            sourceSymbol: defaultImport.text,
            targetFile: resolvedPath,
            targetSymbol: 'default',
            type: 'imports',
            confidence: 1.0,
          });
        }

        // Namespace import: import * as Foo from './bar'
        const namespaceImport = importClause.children.find(c => c.type === 'namespace_import');
        if (namespaceImport) {
          const alias = namespaceImport.childForFieldName('name')?.text;
          deps.push({
            sourceSymbol: alias || '*',
            targetFile: resolvedPath,
            targetSymbol: '*',
            type: 'imports',
            confidence: 1.0,
          });
        }
      }
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(tree.rootNode);
  return deps;
}

/**
 * Resolve a relative import path to an absolute file path.
 * Handles .ts/.tsx/.js/.jsx extensions and index files.
 */
function resolveImportPath(importPath: string, fromFile: string): string {
  if (!importPath.startsWith('.')) {
    return importPath; // node_modules -- store as-is
  }

  const dir = dirname(fromFile);
  const resolved = join(dir, importPath);

  // Strip .js extension that TypeScript uses for ESM imports
  // (e.g., import './foo.js' actually refers to './foo.ts')
  const stripped = resolved.replace(/\.js$/, '');

  // Try extensions in priority order
  const extensions = ['.ts', '.tsx', '.js', '.jsx'];
  for (const ext of extensions) {
    const candidate = stripped + ext;
    // Existence check deferred to query time; store best guess
  }

  return stripped; // canonical form without extension
}
```

### 3.6 Symbol Claims

Extend the session file claims system. This reuses the existing `session_files` table with the `symbol` column, but adds richer semantics.

```typescript
// Extension to lib/sessions.ts

interface SymbolClaimOptions {
  sessionId: string;
  filePath: string;
  symbolPath: string;           // e.g., "createSessions.addNote"
  claimType: 'modify' | 'read' | 'add-sibling' | 'add-child' | 'delete' | 'rename';
  force?: boolean;              // override existing claims
}

interface SymbolConflict {
  filePath: string;
  symbolPath: string;
  sessionId: string;
  agentId: string;
  purpose: string;
  claimType: string;
}

// New methods added to the sessions module return object:

/**
 * Claim a specific symbol within a file.
 * Uses the existing session_files table with the symbol column.
 * Looks up the symbol's line range from the symbols table (if parsed).
 */
claimSymbol(opts: SymbolClaimOptions): {
  success: boolean;
  conflicts: SymbolConflict[];
  claimId: number;
};

/**
 * Release a symbol claim.
 */
releaseSymbol(sessionId: string, filePath: string, symbolPath: string): {
  success: boolean;
};

/**
 * Get all active symbol claims for a file.
 */
getSymbolClaims(filePath: string): Array<{
  sessionId: string;
  agentId: string;
  symbolPath: string;
  claimType: string;
  startLine: number | null;
  endLine: number | null;
  claimedAt: number;
}>;
```

**How symbol claims map to session_files:**

When an agent claims `createSessions.addNote` in `lib/sessions.ts`:

1. Look up the symbol in the `symbols` table to get its line range (e.g., lines 420-480)
2. Insert into `session_files` with `symbol = 'createSessions.addNote'`, `start_line = 420`, `end_line = 480`
3. Check for overlapping claims using the existing `getOverlappingClaims` prepared statement
4. Fire `file.claim` activity with `metadata: { symbol: 'createSessions.addNote' }` so the Arbiter's SYMBOL_CLAIM_CONSISTENCY rule can check it

This means symbol claims are backwards-compatible with file claims. An agent with a whole-file claim on `lib/sessions.ts` will be detected as overlapping with a symbol claim on the same file (because whole-file claims have `start_line IS NULL`, which the overlap query treats as "entire file").

### 3.7 Symbol-Aware Conflict Prediction

Upgrade Phase 1's file-level prediction to symbol-level when symbol data is available.

```typescript
// Enhanced predictConflicts in lib/merge-queue.ts

function predictConflictsWithSymbols(
  repository: string,
  symbolIndex: ReturnType<typeof createSymbolIndex>
): ConflictPrediction[] {
  const pending = list({ status: 'pending', repository });
  const predictions: ConflictPrediction[] = [];

  for (let i = 0; i < pending.length; i++) {
    for (let j = i + 1; j < pending.length; j++) {
      const a = pending[i];
      const b = pending[j];

      const aClaims = a.claims || [];
      const bClaims = b.claims || [];

      for (const claimA of aClaims) {
        for (const claimB of bClaims) {
          if (claimA.file !== claimB.file) continue;

          // Both have symbols: check symbol-level overlap
          if (claimA.symbol && claimB.symbol) {
            if (claimA.symbol === claimB.symbol) {
              // Same symbol, both modify = blocking
              if (claimA.type === 'modify' && claimB.type === 'modify') {
                predictions.push({
                  mergeA: a.id, mergeB: b.id,
                  conflictType: 'direct',
                  severity: 'blocking',
                  files: [{
                    path: claimA.file,
                    symbolA: claimA.symbol,
                    symbolB: claimB.symbol,
                    reason: `Both merges modify symbol ${claimA.symbol}`
                  }],
                  details: `Direct symbol conflict: ${claimA.symbol} in ${claimA.file}`
                });
              }
            } else {
              // Different symbols in same file: check dependency graph
              checkDependencyConflict(a, b, claimA, claimB, symbolIndex, predictions);
            }
          } else {
            // Fall back to file-level prediction (Phase 1 logic)
            predictions.push(/* ...Phase 1 file-level prediction... */);
          }
        }
      }
    }
  }

  return predictions;
}

function checkDependencyConflict(
  mergeA: MergeQueueEntry,
  mergeB: MergeQueueEntry,
  claimA: MergeClaim,
  claimB: MergeClaim,
  symbolIndex: ReturnType<typeof createSymbolIndex>,
  predictions: ConflictPrediction[]
) {
  if (!claimA.symbol || !claimB.symbol) return;

  // Check if symbol A depends on symbol B or vice versa
  const depsA = symbolIndex.getDependencies(claimA.file, claimA.symbol, {
    direction: 'outgoing', depth: 1
  });
  const depsB = symbolIndex.getDependencies(claimB.file, claimB.symbol, {
    direction: 'outgoing', depth: 1
  });

  const aUsesB = depsA.some(d =>
    d.targetSymbol === claimB.symbol && d.targetFile === claimB.file
  );
  const bUsesA = depsB.some(d =>
    d.targetSymbol === claimA.symbol && d.targetFile === claimA.file
  );

  if (aUsesB || bUsesA) {
    const depender = aUsesB ? claimA : claimB;
    const dependee = aUsesB ? claimB : claimA;
    const dependerMerge = aUsesB ? mergeA : mergeB;
    const dependeeMerge = aUsesB ? mergeB : mergeA;

    if (dependee.type === 'modify') {
      predictions.push({
        mergeA: dependerMerge.id,
        mergeB: dependeeMerge.id,
        conflictType: 'signature',
        severity: 'warning',
        files: [{
          path: dependee.file,
          symbolA: depender.symbol,
          symbolB: dependee.symbol,
          reason: `${depender.symbol} depends on ${dependee.symbol}, which is being modified`
        }],
        details: `Dependency conflict: ${depender.symbol} -> ${dependee.symbol}`
      });
    }
  }

  // Transitive conflicts: check 2-hop dependencies
  // Confidence decays: 0.7 ^ dependency_distance
  const TRANSITIVE_THRESHOLD = 0.49; // 0.7^2
  const deepDepsA = symbolIndex.getDependencies(claimA.file, claimA.symbol, {
    direction: 'outgoing', depth: 2
  });
  for (const dep of deepDepsA) {
    if (dep.targetSymbol === claimB.symbol && dep.targetFile === claimB.file) {
      const confidence = dep.confidence * 0.7; // decay for each hop
      if (confidence >= TRANSITIVE_THRESHOLD) {
        predictions.push({
          mergeA: mergeA.id,
          mergeB: mergeB.id,
          conflictType: 'transitive',
          severity: 'info',
          files: [{
            path: claimB.file,
            symbolA: claimA.symbol,
            symbolB: claimB.symbol,
            reason: `Transitive dependency (confidence: ${confidence.toFixed(2)})`
          }],
          details: `Transitive conflict via dependency chain (confidence: ${confidence.toFixed(2)})`
        });
      }
    }
  }
}
```

**Confidence formula:** `confidence = base_confidence * (0.7 ^ dependency_distance)`

| Distance | Confidence | Severity |
|----------|-----------|----------|
| 0 (same symbol) | 1.0 | blocking |
| 1 (direct dep) | 0.7 | warning |
| 2 (transitive) | 0.49 | info |
| 3+ | < 0.343 | below threshold, ignored |

### 3.8 API Endpoints (Symbols)

New file: `routes/symbols.ts`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/symbols/parse` | POST | Parse file(s) and store symbols |
| `/symbols/parse-dir` | POST | Parse a directory recursively |
| `/symbols/:file` | GET | List symbols in a file (URL-encoded path) |
| `/symbols/find` | GET | Search symbols by name |
| `/symbols/dependencies` | GET | Query dependency graph |
| `/symbols/stats` | GET | Parsing statistics |
| `/sessions/:id/symbols` | POST | Claim symbols (extension of file claims) |
| `/sessions/:id/symbols` | DELETE | Release symbol claims |
| `/merge/predict-symbols` | GET | Symbol-aware conflict prediction |

**Request/response examples:**

```bash
# Parse a file
curl -X POST http://localhost:9876/symbols/parse \
  -d '{"filePath": "/path/to/lib/sessions.ts", "repository": "/path/to/repo"}'

# Response:
{
  "success": true,
  "symbols": 42,
  "dependencies": 18,
  "parseTimeMs": 3,
  "fileHash": "a1b2c3d4"
}

# List symbols in a file
curl "http://localhost:9876/symbols/%2Fpath%2Fto%2Flib%2Fsessions.ts"

# Response:
{
  "symbols": [
    {
      "name": "createSessions",
      "type": "function",
      "path": "createSessions",
      "startLine": 139,
      "endLine": 820,
      "signature": "(db: Database.Database, noteEncryption?: NoteEncryption, options?: ...)"
    },
    {
      "name": "start",
      "type": "function",
      "path": "createSessions.start",
      "startLine": 420,
      "endLine": 465,
      "parent": "createSessions",
      "signature": "(purpose: string, opts?: StartOptions)"
    }
  ]
}

# Claim a symbol
curl -X POST http://localhost:9876/sessions/sess-abc/symbols \
  -d '{
    "filePath": "lib/sessions.ts",
    "symbolPath": "createSessions.addNote",
    "claimType": "modify"
  }'

# Symbol-aware conflict prediction
curl "http://localhost:9876/merge/predict-symbols?repository=/path/to/repo"
```

### 3.9 CLI Commands (Symbols)

```bash
pd symbols parse lib/sessions.ts                    # parse single file
pd symbols parse-dir lib/ --ext .ts                  # parse directory
pd symbols list lib/sessions.ts                      # list symbols
pd symbols find createSessions                       # search by name
pd symbols deps lib/sessions.ts createSessions       # show dependencies
pd symbols stats                                     # parsing stats
pd session files claim <session-id> \
  --symbol createSessions.addNote \
  --type modify lib/sessions.ts                      # symbol claim
```

### 3.10 Incremental Parsing Strategy

Parsing is lazy and incremental:

1. **On demand:** Files are parsed when first claimed, queried, or when a merge is submitted
2. **Staleness check:** Before returning cached symbols, compare stored `file_hash` with current file hash. Re-parse if stale. The hash uses `createHash('sha256')` on the file contents.
3. **Batch on merge submit:** When a merge is submitted with file claims, auto-parse all claimed files to populate symbols for conflict prediction
4. **tree-sitter incremental:** For re-parses, use tree-sitter's `edit()` + `parse(oldTree)` if we have the old tree in memory. This brings re-parse time from ~3ms to ~0.3ms per file. Store parsed trees in an LRU cache (max 200 entries).

```typescript
// In-memory LRU cache for parsed trees
const treeCache = new Map<string, { tree: Parser.Tree; hash: string }>();
const MAX_TREE_CACHE = 200;

function parseFileIncremental(
  filePath: string,
  sourceCode: string,
  fileHash: string
): Parser.Tree {
  const cached = treeCache.get(filePath);

  if (cached && cached.hash === fileHash) {
    return cached.tree; // unchanged
  }

  const p = filePath.endsWith('.tsx') ? tsxParser : parser;
  const tree = p.parse(sourceCode, cached?.tree); // pass old tree for incremental

  // LRU eviction
  if (treeCache.size >= MAX_TREE_CACHE) {
    const oldest = treeCache.keys().next().value;
    if (oldest) treeCache.delete(oldest);
  }

  treeCache.set(filePath, { tree, hash: fileHash });
  return tree;
}
```

### 3.11 Testing Strategy (Phase 3)

**Unit tests** (`tests/unit/symbol-index.test.js`):

- Parse TypeScript file: extracts functions, classes, methods, interfaces, types, enums
- Parse TypeScript file: extracts arrow functions assigned to const
- Parse TypeScript file: nested symbols have correct parent paths
- Parse TypeScript file: signatures extracted for functions and methods
- Parse TypeScript file: body hashes change when body changes
- Dependency extraction: named imports
- Dependency extraction: default imports
- Dependency extraction: namespace imports
- Dependency extraction: relative path resolution
- Incremental parsing: unchanged file skipped
- Incremental parsing: changed file re-parsed
- Symbol search by name (findSymbol)
- Dependency graph traversal (getDependencies, depth 1 and 2)
- Staleness detection (isStale)
- Statistics (stats)

**Unit tests** (`tests/unit/symbol-conflicts.test.js`):

- Same symbol, both modify = blocking
- Same symbol, one modify one read = warning
- Different symbols, dependency exists, modify = signature warning
- Different symbols, no dependency = no conflict
- Transitive dependency with confidence decay
- Confidence below threshold = no prediction
- File-level fallback when symbols unavailable
- Mixed: some claims have symbols, some don't

**Integration tests** (`tests/integration/symbol-parse.test.js`):

- Parse real Port Daddy source files (e.g., `lib/sessions.ts`)
- Verify extracted symbol count matches expectations
- Verify import dependencies between modules
- CLI `pd symbols parse` / `pd symbols list` round-trip

Estimated test count: 30-35 new tests.

---

## Phase 4: Integration and Polish (Weeks 10-11)

### 4.1 Wiring

1. **server.ts:** Create `mergeQueue`, `mergeExecutor`, `symbolIndex` modules. Pass `mergeQueue` to Arbiter deps.
2. **routes/index.ts:** Register `mergePlugin` and `symbolsPlugin` in `registerAllRoutes()`.
3. **Merge queue calls tree-sitter:** On `submit()`, auto-parse claimed files if not already parsed. On `predictConflicts()`, use symbol-aware prediction if symbol data exists, file-level fallback otherwise.
4. **Pheromone integration:** After conflict prediction, spray pheromones on conflicting files:

```typescript
// In merge-queue.ts, after conflict prediction
for (const pred of predictions) {
  for (const file of pred.files) {
    pheromoneMgr.spray('session_files', file.path, 'conflict_heat', pred.severity === 'blocking' ? 1.0 : 0.5);
  }
}
```

This lets other agents passively sense conflict hotspots via the pheromone API. The heat decays over time per the pheromone evaporation cycle.

### 4.2 Dashboard Panel

Add to `public/index.html`:

- **Merge Queue panel** (new panel in sidebar): Shows pending/executing/completed merges, conflict predictions, conflict surface heat map
- Auto-refreshes every 15 seconds (same pattern as other panels)
- Color coding: green (clean, surface < 0.3), yellow (warning, 0.3-0.7), red (blocking, > 0.7)
- Click a merge to see its conflict predictions and file claims
- "Execute" button for pending merges (confirmation dialog)
- "Cancel" button for pending merges

### 4.3 CLI Command Summary

```
pd merge submit     Submit a branch to the merge queue
pd merge queue      List queue entries
pd merge execute    Execute a pending merge
pd merge predict    Predict conflicts
pd merge cancel     Cancel a pending merge
pd merge inspect    Post-merge inspection
pd merge reorder    Explicitly set merge order
pd symbols parse    Parse file(s) for symbols
pd symbols list     List symbols in a file
pd symbols find     Search symbols by name
pd symbols deps     Query dependency graph
pd symbols stats    Parsing statistics
```

### 4.4 MCP Tools

Add to `mcp/server.ts`:

| Tool | Description |
|------|-------------|
| `merge_submit` | Submit a branch to the merge queue |
| `merge_queue` | List pending merges with conflict predictions |
| `merge_predict` | Predict conflicts for a repository |
| `merge_execute` | Execute a pending merge |
| `symbols_parse` | Parse file(s) and store symbols |
| `symbols_find` | Search for a symbol by name |
| `symbols_deps` | Get dependency graph for a symbol |
| `symbol_claim` | Claim a symbol in a session |

### 4.5 SDK Methods

Add to `lib/client.ts`:

```typescript
// Merge queue
mergeSubmit(opts: MergeSubmitOptions): Promise<MergeSubmitResponse>;
mergeQueue(opts?: MergeQueueListOptions): Promise<MergeQueueEntry[]>;
mergeExecute(id: number, opts?: MergeExecuteOptions): Promise<MergeResult>;
mergePredict(repository: string): Promise<ConflictPrediction[]>;
mergeCancel(id: number): Promise<{ success: boolean }>;

// Symbols
symbolsParse(filePath: string, repository: string): Promise<ParseResult>;
symbolsParseDir(dirPath: string, repository: string, opts?: ParseDirOptions): Promise<ParseDirResult>;
symbolsList(filePath: string): Promise<ExtractedSymbol[]>;
symbolsFind(name: string, opts?: SymbolFindOptions): Promise<SymbolSearchResult[]>;
symbolsDeps(filePath: string, symbolPath: string, opts?: DepsOptions): Promise<ExtractedDependency[]>;
symbolClaim(sessionId: string, filePath: string, symbolPath: string, claimType: string): Promise<ClaimResult>;
```

### 4.6 Shell Completions

Update all three completion files:

**Bash** (`completions/port-daddy.bash`):
```bash
merge) COMPREPLY=($(compgen -W "submit queue execute predict cancel inspect reorder" -- "$cur"));;
symbols) COMPREPLY=($(compgen -W "parse parse-dir list find deps stats" -- "$cur"));;
```

**Zsh** (`completions/port-daddy.zsh`):
```zsh
merge)
  _values 'merge commands' submit queue execute predict cancel inspect reorder
  ;;
symbols)
  _values 'symbol commands' parse parse-dir list find deps stats
  ;;
```

**Fish** (`completions/port-daddy.fish`):
```fish
complete -c pd -n "__fish_seen_subcommand_from merge" -a "submit queue execute predict cancel inspect reorder"
complete -c pd -n "__fish_seen_subcommand_from symbols" -a "parse parse-dir list find deps stats"
```

---

## Dependencies and Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| tree-sitter native bindings fail on Node 20+/ARM | Low | Fall back to web-tree-sitter (WASM). Abstract behind factory function. |
| tree-sitter grammar version mismatch | Medium | Pin exact versions in package.json. Test in CI. |
| Git operations from daemon: permission issues | Medium | Merge executor validates repo access before attempting merge. Document that the daemon user needs write access to repos. |
| Symbol extraction accuracy for complex TS patterns | Medium | Start with the 80% case (named functions, classes, methods). Add edge cases iteratively. File-level fallback is always available. |
| Large repos: parsing thousands of files | Low | Incremental parsing + LRU cache. Max file limit on parseDirectory. Parse only claimed files by default. |
| Merge executor hangs on long-running tests | Medium | Enforce timeout (default 10 min). Kill test process on timeout via AbortSignal. |
| Race condition: two agents submit to queue simultaneously | Low | SQLite WAL + busy_timeout handles this. Position assignment uses `COALESCE(MAX(position), 0) + 1` in a transaction. |
| Merge executor modifies working tree of active repo | High | Document that merge execution should target a dedicated integration branch/worktree. Consider auto-creating a temporary worktree for the merge. |

### Risk: Merge on Active Working Tree

The biggest operational risk is running `git merge` on a repository where an agent is actively working. The merge executor should:

1. **Verify no active agents** have the repository as their worktree (check via agents registry)
2. **Prefer a dedicated merge worktree:** Create a temporary worktree (`git worktree add /tmp/merge-<id> <target-branch>`), run the merge there, then update the main branch via fast-forward
3. **Fall back to direct merge** only if the working tree is clean and no agents are active

This is an implementation detail for Phase 1 that should be resolved during development. The schema and API design above are agnostic to the merge strategy.

---

## File Inventory (New Files)

```
lib/
  merge-queue.ts              # Merge queue data model + operations
  merge-executor.ts           # Git merge execution
  symbol-index.ts             # Tree-sitter parsing + symbol storage
  parsers/
    typescript-parser.ts      # TypeScript/JavaScript symbol extraction
    dependency-extractor.ts   # Import/dependency graph extraction
    python-parser.ts          # Python symbol extraction (stretch goal)
routes/
  merge.ts                    # Merge queue HTTP endpoints
  symbols.ts                  # Symbol index HTTP endpoints
tests/
  unit/
    merge-queue.test.js       # Merge queue unit tests (25-30)
    arbiter-merge.test.js     # New Arbiter invariant tests (15-18)
    symbol-index.test.js      # Symbol parsing tests (15-20)
    symbol-conflicts.test.js  # Symbol-aware conflict tests (8-10)
  integration/
    merge-queue.test.js       # Full merge flow integration tests
    symbol-parse.test.js      # Real file parsing integration tests
```

**Modified files:**

```
lib/arbiter.ts                # 4 new rules, mergeQueue dep
lib/sessions.ts               # claimSymbol, releaseSymbol, getSymbolClaims
lib/activity.ts               # New activity types for merge events
lib/client.ts                 # SDK methods for merge + symbols
routes/index.ts               # Register merge + symbols plugins
server.ts                     # Create merge/symbol modules, wire deps
public/index.html             # Merge Queue dashboard panel
bin/port-daddy-cli.ts         # pd merge + pd symbols commands
completions/port-daddy.bash   # merge + symbols completions
completions/port-daddy.zsh    # merge + symbols completions
completions/port-daddy.fish   # merge + symbols completions
mcp/server.ts                 # MCP tools for merge + symbols
tests/setup-unit.js           # merge_queue + symbols tables in test schema
CLAUDE.md                     # Document new modules + API endpoints
CHANGELOG.md                  # Merge infrastructure changelog entry
README.md                     # Merge queue + symbols documentation
package.json                  # tree-sitter dependencies
```

---

## Milestone Checklist

### Phase 1 Complete When:
- [ ] `lib/merge-queue.ts` passes all unit tests
- [ ] `lib/merge-executor.ts` can merge branches in a test repo
- [ ] `routes/merge.ts` all endpoints respond correctly
- [ ] `pd merge submit/queue/execute/predict/cancel` all work
- [ ] SDK methods for merge queue work
- [ ] File-level conflict prediction is accurate
- [ ] Merge execution acquires and releases repo lock
- [ ] Activity types logged for all merge operations

### Phase 2 Complete When:
- [ ] 4 new Arbiter rules all fire correctly
- [ ] All 4 have working test injection
- [ ] MERGE_QUEUE_STALENESS sweep timer starts/stops cleanly
- [ ] Arbiter works without mergeQueue dep (backwards compatible)
- [ ] 15+ new tests pass

### Phase 3 Complete When:
- [ ] tree-sitter parses TypeScript/JavaScript/Python files
- [ ] Symbols stored in SQLite with correct paths and signatures
- [ ] Import dependencies extracted and stored
- [ ] Incremental parsing works (unchanged files skipped)
- [ ] Symbol claims integrate with session_files
- [ ] Symbol-aware conflict prediction works
- [ ] `/symbols/*` endpoints all respond correctly
- [ ] `pd symbols parse/list/find/deps` all work
- [ ] 30+ new tests pass

### Phase 4 Complete When:
- [ ] Merge queue wired to symbol index for predictions
- [ ] Dashboard has Merge Queue panel
- [ ] MCP tools for merge + symbols work
- [ ] SDK methods for symbols work
- [ ] Shell completions updated in all 3 shells
- [ ] CLAUDE.md, README.md, CHANGELOG.md updated
- [ ] Pheromone integration sprays conflict heat
- [ ] All parity checklist items satisfied
- [ ] `npm test` passes with 0 failures
- [ ] Promoted to stable branch

---

## Estimated Totals

| Metric | Count |
|--------|-------|
| New tests | 85-95 |
| New files | 8-10 |
| Modified files | 15-17 |
| New API endpoints | 17 |
| New CLI commands | 12 |
| New Arbiter rules | 4 |
| New SDK methods | 10 |
| New MCP tools | 8 |
| npm dependencies | 4 (tree-sitter + 3 grammars) |
