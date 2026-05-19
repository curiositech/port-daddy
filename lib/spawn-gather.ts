/**
 * Spawn Gather Policies — coordination patterns for `pd spawn --parallel N`.
 *
 * Today's `pd spawn --parallel N` is effectively wait-all (`Promise.all`).
 * Real workflows want richer semantics — "first to succeed wins, kill the
 * rest" for redundant probes, "majority quorum" for consensus, "race to
 * settle" for failure-detection. This module ships those policies as a
 * standalone unit so the spawner can stay focused on launching one child.
 *
 * Each policy returns a uniform shape so the CLI can render a single
 * "winner + killed + all" summary regardless of which policy was used.
 *
 * Killing semantics:
 *   - Calls child.kill() once
 *   - Awaits the child's run promise (the launcher is expected to settle
 *     promptly after kill — the spawner uses SIGTERM then SIGKILL@5s)
 *   - The returned ChildResult will have status 'killed'
 *
 * Pure functions over promise-bearing children; no DB/network coupling.
 * That keeps the module trivially testable: fake children, real policies.
 */

export interface ChildResult {
  agentId: string;
  status: 'completed' | 'failed' | 'killed' | string;
  output: string | null;
  error: string | null;
  [extra: string]: unknown;
}

export interface ChildHandle {
  agentId: string;
  /**
   * Trigger the child's spawn lifecycle. Resolves with the final result.
   * MUST NOT throw — failures are returned via `{ status: 'failed', error }`.
   * If the caller invokes `kill()` mid-run, this promise should still settle.
   */
  run: () => Promise<ChildResult>;
  /**
   * Signal the launcher to terminate this child. Idempotent. Best-effort —
   * the launcher's own SIGTERM/SIGKILL machinery does the heavy lifting.
   */
  kill: () => void;
}

export type GatherPolicyName = 'all' | 'first' | 'majority' | 'race' | `quorum=${number}`;

export interface ParsedGatherPolicy {
  policy: 'all' | 'first' | 'majority' | 'quorum' | 'race';
  /** Only set when policy === 'quorum'. */
  k?: number;
}

export interface GatherResult {
  /** The result that satisfied the policy. For 'all', the first one finished. */
  winner: ChildResult;
  /** Children that were terminated because the policy was already satisfied. */
  killed: ChildResult[];
  /** All settled results in finish order, including winner + killed. */
  all: ChildResult[];
  gathered_at: number;
  policy: ParsedGatherPolicy;
}

export class GatherPolicyError extends Error {
  readonly code = 'SPAWN_GATHER_POLICY';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Parse a CLI gather string into a structured policy.
 *
 *   "all" | "first" | "majority" | "race" | "quorum=K"
 *
 * Throws GatherPolicyError on anything else so the CLI can print a useful
 * usage hint instead of silently degrading to one of the defaults.
 */
export function parseGatherPolicy(raw: string): ParsedGatherPolicy {
  if (!raw || typeof raw !== 'string') {
    throw new GatherPolicyError(
      `gather policy is required. Use one of: all, first, majority, race, quorum=K`,
    );
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'all') return { policy: 'all' };
  if (trimmed === 'first') return { policy: 'first' };
  if (trimmed === 'majority') return { policy: 'majority' };
  if (trimmed === 'race') return { policy: 'race' };
  const m = /^quorum=(\d+)$/.exec(trimmed);
  if (m) {
    const k = parseInt(m[1] ?? '0', 10);
    if (!Number.isFinite(k) || k <= 0) {
      throw new GatherPolicyError(`quorum K must be a positive integer (got '${m[1]}')`);
    }
    return { policy: 'quorum', k };
  }
  throw new GatherPolicyError(
    `unknown gather policy '${raw}'. Use: all, first, majority, race, quorum=K`,
  );
}

interface SettleRecord {
  index: number;
  agentId: string;
  result: ChildResult;
  /** ms epoch when the child settled — used to sort `all` deterministically. */
  settledAt: number;
}

/**
 * Internal: kick off all children, return their settle records as they
 * arrive, plus a function to kill any not-yet-settled subset by index.
 */
function startAll(children: ChildHandle[]): {
  /** A promise per child that resolves to its SettleRecord. */
  settled: Promise<SettleRecord>[];
  killAllExcept: (winnerIndices: Set<number>, settledAlready: Set<number>) => void;
} {
  const settled: Promise<SettleRecord>[] = children.map((child, index) =>
    child.run()
      .catch((err): ChildResult => ({
        // run() is documented as never-throwing, but defend in depth.
        agentId: child.agentId,
        status: 'failed',
        output: null,
        error: (err as Error)?.message || String(err),
      }))
      .then((result): SettleRecord => ({
        index,
        agentId: child.agentId,
        result,
        settledAt: Date.now(),
      })),
  );

  const killAllExcept = (winnerIndices: Set<number>, settledAlready: Set<number>): void => {
    children.forEach((child, idx) => {
      if (winnerIndices.has(idx)) return;
      if (settledAlready.has(idx)) return;
      try { child.kill(); } catch { /* idempotent */ }
    });
  };

  return { settled, killAllExcept };
}

/** Wait for all N to settle. Winner = first to settle. */
export async function gatherAll(children: ChildHandle[]): Promise<GatherResult> {
  if (children.length === 0) {
    throw new GatherPolicyError('gatherAll requires at least one child');
  }
  const { settled } = startAll(children);
  const records = await Promise.all(settled);
  records.sort((a, b) => a.settledAt - b.settledAt);
  return {
    winner: records[0]!.result,
    killed: [],
    all: records.map((r) => r.result),
    gathered_at: Date.now(),
    policy: { policy: 'all' },
  };
}

/**
 * Wait for first SUCCESS (status === 'completed'). Kill the rest.
 * If every child fails, returns the last failure as the winner so the caller
 * sees a real result rather than a vague "no success" error.
 */
export async function gatherFirst(children: ChildHandle[]): Promise<GatherResult> {
  if (children.length === 0) {
    throw new GatherPolicyError('gatherFirst requires at least one child');
  }
  const { settled, killAllExcept } = startAll(children);
  const settledRecords: SettleRecord[] = [];
  const settledIndices = new Set<number>();
  const winnerHolder: { value: SettleRecord | null } = { value: null };

  // Race manually: settle promises into the buffer until one succeeds, then
  // kill the rest and await the killed children's settle promises.
  await new Promise<void>((resolve) => {
    let resolved = false;
    settled.forEach((p) => {
      void p.then((rec) => {
        if (resolved) {
          settledRecords.push(rec);
          settledIndices.add(rec.index);
          return;
        }
        settledRecords.push(rec);
        settledIndices.add(rec.index);
        if (rec.result.status === 'completed') {
          winnerHolder.value = rec;
          resolved = true;
          resolve();
        } else if (settledRecords.length === settled.length) {
          // All settled and none succeeded — pick the last one as winner.
          resolved = true;
          resolve();
        }
      });
    });
  });

  let winner = winnerHolder.value;
  if (!winner) {
    // No success; surface the last failure so the caller sees the actual error.
    winner = settledRecords[settledRecords.length - 1] ?? null;
  }
  if (!winner) {
    throw new GatherPolicyError('gatherFirst: no children settled');
  }

  // Snapshot which indices were unsettled when the policy was satisfied —
  // those are the ones we actually kill.
  const killedIndices = new Set<number>();
  for (let i = 0; i < settled.length; i++) {
    if (!settledIndices.has(i)) killedIndices.add(i);
  }
  const winnerIdx = new Set<number>([winner.index]);
  killAllExcept(winnerIdx, settledIndices);

  // Wait for everyone (winners' siblings + late arrivals) to fully settle.
  // The forEach loop above keeps pushing into settledRecords as more promises
  // resolve, so awaiting all of them gives us the full picture.
  await Promise.all(settled);
  // Deduplicate by index in case the void-then pushed the same record twice.
  const byIndex = new Map<number, SettleRecord>();
  for (const rec of settledRecords) {
    if (!byIndex.has(rec.index)) byIndex.set(rec.index, rec);
  }
  const allRecords = [...byIndex.values()].sort((a, b) => a.settledAt - b.settledAt);
  const killedResults = allRecords
    .filter((r) => killedIndices.has(r.index))
    .map((r) => r.result);

  return {
    winner: winner.result,
    killed: killedResults,
    all: allRecords.map((r) => r.result),
    gathered_at: Date.now(),
    policy: { policy: 'first' },
  };
}

/**
 * Generic quorum: wait for K successes. Kill the rest. If all settle and
 * fewer than K succeeded, returns the last success (if any) or the last
 * failure as winner — the GatherResult.all carries the full picture for
 * the caller to decide if the quorum was met.
 */
async function gatherQuorumInternal(
  children: ChildHandle[],
  k: number,
  policyTag: 'majority' | 'quorum',
): Promise<GatherResult> {
  if (children.length === 0) {
    throw new GatherPolicyError(`${policyTag} requires at least one child`);
  }
  if (k <= 0) {
    throw new GatherPolicyError(`${policyTag} requires k > 0 (got ${k})`);
  }
  if (k > children.length) {
    throw new GatherPolicyError(
      `${policyTag} requires k=${k} <= children.length=${children.length}`,
    );
  }

  const { settled, killAllExcept } = startAll(children);
  const successes: SettleRecord[] = [];
  const allSettled: SettleRecord[] = [];
  const settledIndices = new Set<number>();

  await new Promise<void>((resolve) => {
    let resolved = false;
    settled.forEach((p) => {
      void p.then((rec) => {
        allSettled.push(rec);
        settledIndices.add(rec.index);
        if (rec.result.status === 'completed') successes.push(rec);
        if (resolved) return;
        if (successes.length >= k) {
          resolved = true;
          resolve();
        } else if (allSettled.length === settled.length) {
          resolved = true;
          resolve();
        }
      });
    });
  });

  // Winner = last success (most recent quorum-completing child). If no
  // successes at all, fall back to the last settled record.
  const winnerRec = successes[successes.length - 1] ?? allSettled[allSettled.length - 1] ?? null;
  const winnerIdx = new Set<number>();
  if (winnerRec) winnerIdx.add(winnerRec.index);

  const killedIndices = new Set<number>();
  for (let i = 0; i < settled.length; i++) {
    if (!settledIndices.has(i)) killedIndices.add(i);
  }
  killAllExcept(winnerIdx, settledIndices);

  // Drain all settles before reporting.
  await Promise.all(settled);
  const byIndex = new Map<number, SettleRecord>();
  for (const rec of allSettled) {
    if (!byIndex.has(rec.index)) byIndex.set(rec.index, rec);
  }
  const allRecords = [...byIndex.values()].sort((a, b) => a.settledAt - b.settledAt);
  const killedResults = allRecords
    .filter((r) => killedIndices.has(r.index))
    .map((r) => r.result);

  return {
    winner: winnerRec!.result,
    killed: killedResults,
    all: allRecords.map((r) => r.result),
    gathered_at: Date.now(),
    policy: policyTag === 'majority'
      ? { policy: 'majority' }
      : { policy: 'quorum', k },
  };
}

/** Wait for ceil(N/2)+1 successes (i.e., strict majority). */
export function gatherMajority(children: ChildHandle[]): Promise<GatherResult> {
  const k = Math.floor(children.length / 2) + 1;
  return gatherQuorumInternal(children, k, 'majority');
}

/** Wait for exactly K successes. */
export function gatherQuorum(children: ChildHandle[], k: number): Promise<GatherResult> {
  return gatherQuorumInternal(children, k, 'quorum');
}

/** Wait for the first child to settle either way. Kill the rest. */
export async function gatherRace(children: ChildHandle[]): Promise<GatherResult> {
  if (children.length === 0) {
    throw new GatherPolicyError('gatherRace requires at least one child');
  }
  const { settled, killAllExcept } = startAll(children);
  const settledRecords: SettleRecord[] = [];
  const settledIndices = new Set<number>();
  const winnerHolder: { value: SettleRecord | null } = { value: null };

  await new Promise<void>((resolve) => {
    let resolved = false;
    settled.forEach((p) => {
      void p.then((rec) => {
        settledRecords.push(rec);
        settledIndices.add(rec.index);
        if (resolved) return;
        winnerHolder.value = rec;
        resolved = true;
        resolve();
      });
    });
  });

  const winner = winnerHolder.value;
  if (!winner) {
    // Defensive — settled has at least one entry per startAll's contract.
    throw new GatherPolicyError('gatherRace: no children settled');
  }
  const winnerIdx = new Set<number>([winner.index]);

  const killedIndices = new Set<number>();
  for (let i = 0; i < settled.length; i++) {
    if (!settledIndices.has(i)) killedIndices.add(i);
  }
  killAllExcept(winnerIdx, settledIndices);

  await Promise.all(settled);
  const byIndex = new Map<number, SettleRecord>();
  for (const rec of settledRecords) {
    if (!byIndex.has(rec.index)) byIndex.set(rec.index, rec);
  }
  const allRecords = [...byIndex.values()].sort((a, b) => a.settledAt - b.settledAt);
  const killedResults = allRecords
    .filter((r) => killedIndices.has(r.index))
    .map((r) => r.result);

  return {
    winner: winner.result,
    killed: killedResults,
    all: allRecords.map((r) => r.result),
    gathered_at: Date.now(),
    policy: { policy: 'race' },
  };
}

/**
 * Dispatch a parsed policy against children. Centralizes the policy switch
 * so callers (CLI, route) don't have to repeat it.
 */
export function gatherByPolicy(
  children: ChildHandle[],
  policy: ParsedGatherPolicy,
): Promise<GatherResult> {
  switch (policy.policy) {
    case 'all': return gatherAll(children);
    case 'first': return gatherFirst(children);
    case 'majority': return gatherMajority(children);
    case 'race': return gatherRace(children);
    case 'quorum': return gatherQuorum(children, policy.k ?? 1);
    default: {
      // Exhaustive guard — TS should already prevent this, but JS callers
      // shouldn't get a silent fallback.
      const exhaustive: never = policy.policy;
      throw new GatherPolicyError(`unknown gather policy: ${String(exhaustive)}`);
    }
  }
}
