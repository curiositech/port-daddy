/**
 * lib/concurrency-semaphore.ts — DAEMON-WIDE CONCURRENCY GATE.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHY THIS MODULE EXISTS
 * ════════════════════════════════════════════════════════════════════════
 * Today, every `FleetRunner` enforces its own `max_concurrent_spawns`. The
 * problem: a project can have multiple fleet configs (a primary fleet plus
 * sub-fleets, monorepo packages, worktree fleets). If three runners each cap
 * at 2, six spawns are running for the same project — six children fighting
 * over the same wallet, the same files, the same operator's attention.
 *
 * The fix is one daemon-wide semaphore PER PROJECT. Every runner asks the
 * daemon for a permit before delegating to the spawner. The cap configured
 * in the canonical fleet is the project's true ceiling, no matter how many
 * runners exist.
 *
 * Spec: docs/shipwright/FLEETCONTROL-HARDENING.md §5.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  INVARIANTS WE GUARD
 * ════════════════════════════════════════════════════════════════════════
 * 1. CAP RESPECTED. Under any acquire/release/resize trace where capacity
 *    is fixed or only grown, `inflight` never exceeds `capacity`. Shrinks
 *    grandfather existing holders (see RESIZE SEMANTICS below) — so after
 *    a shrink, `inflight > newCapacity` is allowed transiently until those
 *    holders drain; no new acquires are granted while inflight ≥ newCapacity.
 *    Verified by fast-check property tests.
 *
 * 2. FIFO FAIRNESS. When permits are scarce, waiters are granted in the
 *    order they called `acquire()`. No starvation, no priority inversions.
 *
 * 3. RELEASE IDEMPOTENCE. The release function returned by `acquire()`
 *    is safe to call multiple times. Second + later calls are no-ops.
 *    Without this, a careless `finally` block could double-release and
 *    leak a permit.
 *
 * 4. CANCELLATION SAFETY. If an acquire is rejected (e.g. shutdown), the
 *    waiter's slot in the FIFO queue is removed and downstream waiters
 *    advance. There are no zombie promises pinned to the queue.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  RESIZE SEMANTICS (SIGHUP-FRIENDLY)
 * ════════════════════════════════════════════════════════════════════════
 * GROW (capacity goes up): drain waiters in FIFO order until either the
 * queue is empty or `inflight === newCapacity`. Existing holders are
 * untouched.
 *
 * SHRINK (capacity goes down): existing holders keep their permits — we
 * never SIGTERM a running spawn just because the operator wanted a smaller
 * fleet. New acquires wait until `inflight < newCapacity`. This matches
 * how a Unix daemon should react to config reload: tighten the future
 * without disrupting the present.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  USAGE
 * ════════════════════════════════════════════════════════════════════════
 *    const sem = createSemaphore({ capacity: 3 });
 *
 *    // Async path:
 *    const release = await sem.acquire();
 *    try { await doWork(); } finally { release(); }
 *
 *    // Non-blocking try path:
 *    const maybe = sem.tryAcquire();
 *    if (maybe) {
 *      try { await doWork(); } finally { maybe(); }
 *    } else {
 *      // skip: no slots available right now
 *    }
 *
 *    // Operator resize (SIGHUP):
 *    sem.resize(5);   // grow — wakes up to 2 FIFO waiters immediately
 *    sem.resize(1);   // shrink — current holders unaffected
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SemaphoreOptions {
  /** Maximum permits available concurrently. Must be a non-negative integer. */
  capacity: number;
  /**
   * Optional name for diagnostics. Surfaces in error messages and broadcast
   * payloads so log readers can tell `port-daddy` from `daemon-heartbeat`.
   */
  name?: string;
}

/**
 * Release function returned by `acquire()` and `tryAcquire()`.
 * Calling it returns the permit to the pool. Idempotent: subsequent calls
 * after the first are no-ops, so `try/finally` is always safe.
 */
export type ReleaseFn = () => void;

export interface Semaphore {
  /** Block until a permit is available, then return its release function. */
  acquire(): Promise<ReleaseFn>;

  /**
   * Non-blocking attempt. Returns a release function if a permit was free,
   * or null if all permits are in flight. Does NOT enqueue a waiter.
   */
  tryAcquire(): ReleaseFn | null;

  /**
   * Change capacity at runtime. Grow drains waiters in FIFO; shrink keeps
   * current holders running. Throws on negative or non-integer input.
   */
  resize(newCapacity: number): void;

  /**
   * Reject every queued waiter with the given reason. Already-acquired
   * permits are NOT released — this is for clean daemon shutdown where
   * holders are expected to drain naturally on their own. After this call,
   * future `acquire()` calls also reject immediately.
   */
  drain(reason: string): void;

  /** Current capacity. Mirrors the last `resize()` (or initial). */
  readonly capacity: number;

  /** Number of permits currently held (not waiting). */
  readonly inflight: number;

  /** Number of pending acquire() calls waiting for a permit. */
  readonly waiters: number;
}

// ─── Internal waiter shape ────────────────────────────────────────────────────

interface Waiter {
  resolve(release: ReleaseFn): void;
  reject(err: Error): void;
}

// ─── Module factory ───────────────────────────────────────────────────────────

/**
 * Construct a semaphore. The returned object is plain — no class — so it
 * inter-ops cleanly with structuredClone, JSON, or test harness mocks that
 * dislike prototypes.
 *
 * @example
 *   const sem = createSemaphore({ capacity: 2, name: 'port-daddy:fleet' });
 *   const r1 = await sem.acquire(); // inflight=1
 *   const r2 = await sem.acquire(); // inflight=2
 *   const p3 = sem.acquire();        // queued; resolves after r1() or r2()
 *   r1();                            // wakes p3
 *   await p3;                        // inflight stays at 2
 */
export function createSemaphore(opts: SemaphoreOptions): Semaphore {
  const name = opts.name ?? 'semaphore';
  let capacity = validateCapacity(opts.capacity, name);
  let inflight = 0;
  let drained: string | null = null;
  const queue: Waiter[] = [];

  /**
   * Build the release function for a granted permit. Wrapped in a closure so
   * we can capture the "released?" flag privately (idempotence) and resume
   * one queued waiter on first release. Closures here are intentional: each
   * permit needs its own one-shot semantics.
   */
  function makeRelease(): ReleaseFn {
    let released = false;
    return function release(): void {
      if (released) return;       // idempotent: second call is a no-op
      released = true;
      inflight = Math.max(0, inflight - 1);
      // Wake the FIFO head if a waiter is queued AND we still respect the cap.
      // Note: if capacity was shrunk below inflight while this permit was held,
      // we may stay above the new cap until enough holders release. That's
      // intentional — see "SHRINK" semantics in the module docstring.
      pump();
    };
  }

  /**
   * Drain queued waiters until either the queue is empty or we hit the cap.
   * Idempotent and re-entrancy-safe: each grant decrements the queue head and
   * increments inflight atomically before resolving the waiter's promise.
   */
  function pump(): void {
    while (queue.length > 0 && inflight < capacity) {
      const next = queue.shift()!;
      inflight++;
      next.resolve(makeRelease());
    }
  }

  function acquire(): Promise<ReleaseFn> {
    if (drained) {
      return Promise.reject(new Error(`${name}: drained (${drained})`));
    }
    if (inflight < capacity) {
      // Fast path: a permit is free right now.
      inflight++;
      return Promise.resolve(makeRelease());
    }
    // Slow path: queue and wait. We expose no priority knob — first come,
    // first served. Callers wanting priority should layer their own scheduler
    // on top of this primitive.
    return new Promise<ReleaseFn>((resolve, reject) => {
      queue.push({ resolve, reject });
    });
  }

  function tryAcquire(): ReleaseFn | null {
    if (drained) return null;
    if (inflight >= capacity) return null;
    inflight++;
    return makeRelease();
  }

  function resize(newCapacity: number): void {
    const next = validateCapacity(newCapacity, name);
    capacity = next;
    // Grow: pump may now be able to wake some queued waiters.
    // Shrink: pump is a no-op (inflight already >= capacity), and we let
    // running holders finish naturally.
    pump();
  }

  function drain(reason: string): void {
    if (drained) return;
    drained = reason;
    const pending = queue.splice(0, queue.length);
    const err = new Error(`${name}: drained (${reason})`);
    for (const w of pending) {
      try { w.reject(err); } catch { /* swallow — drain is best-effort */ }
    }
  }

  return {
    acquire,
    tryAcquire,
    resize,
    drain,
    get capacity() { return capacity; },
    get inflight() { return inflight; },
    get waiters() { return queue.length; },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateCapacity(n: number, name: string): number {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name}: capacity must be a non-negative integer, got ${n}`);
  }
  return n;
}

// ─── Project semaphore registry ───────────────────────────────────────────────

/**
 * Daemon-side helper: hold one Semaphore per project, keyed by project
 * name. The fleet-daemon constructs this once and hands `acquirePermit`
 * callbacks to each FleetRunner. Centralizing the registry means `pd fleet
 * resize-cap <project> <n>` (future) updates ALL runners for that project
 * with a single call.
 *
 * Capacity = `Number.POSITIVE_INFINITY` is the rest-of-system default for
 * "no limit configured." We map it to a very large finite cap (1_000_000)
 * inside the semaphore so the math stays in integer-land — Infinity in
 * inflight comparisons works in V8 but trips weird Number.isInteger guards
 * if anyone reads it. The registry tracks "unlimited" as an explicit per-
 * project flag (NOT a sentinel value) so a real configured cap of exactly
 * 1,000,000 reports honestly as 1_000_000 instead of being misread as
 * Infinity in diagnostics.
 */
const UNLIMITED_INTERNAL_CAP = 1_000_000;

export interface ProjectSemaphoreRegistry {
  /**
   * Get-or-create the semaphore for a project. Idempotent: same project
   * name returns the same instance across calls.
   */
  for(project: string, capacity?: number): Semaphore;

  /** Resize an existing project's semaphore. No-op if project unknown. */
  resize(project: string, newCapacity: number): void;

  /** Drain and remove a project's semaphore (e.g. fleet stopped). */
  remove(project: string, reason: string): void;

  /** Drain every semaphore (daemon shutdown). */
  drainAll(reason: string): void;

  /** Read-only snapshot for diagnostics + dashboard. */
  snapshot(): Array<{ project: string; capacity: number; inflight: number; waiters: number }>;
}

/**
 * Build a project semaphore registry. The factory exists so tests can
 * instantiate one without touching the daemon, and so the daemon can
 * inject it for `pd fleet status`-style observability.
 *
 * @example
 *   const reg = createProjectSemaphoreRegistry();
 *   const portDaddy = reg.for('port-daddy', 3);  // cap=3
 *   const release = await portDaddy.acquire();
 *   try { await spawn(); } finally { release(); }
 *   reg.resize('port-daddy', 5);                 // SIGHUP grew the cap
 */
export function createProjectSemaphoreRegistry(): ProjectSemaphoreRegistry {
  const registry = new Map<string, Semaphore>();
  // Tracks projects whose capacity is logically "unlimited" — kept separate
  // from the semaphore's internal numeric cap so a real configured cap of
  // 1,000,000 doesn't get misreported as Infinity in snapshot().
  const unlimited = new Set<string>();

  function isUnlimited(capacity: number | undefined): boolean {
    return capacity === undefined || !Number.isFinite(capacity) || capacity < 0;
  }

  function forProject(project: string, capacity?: number): Semaphore {
    let sem = registry.get(project);
    if (!sem) {
      const willBeUnlimited = isUnlimited(capacity);
      const cap = willBeUnlimited ? UNLIMITED_INTERNAL_CAP : Math.floor(capacity!);
      sem = createSemaphore({ capacity: cap, name: `fleet:${project}` });
      registry.set(project, sem);
      if (willBeUnlimited) unlimited.add(project);
      return sem;
    }
    // Existing semaphore: only update capacity if caller provided one. Avoids
    // the "creator wins" bug where the first registrant pins the cap forever.
    if (capacity !== undefined && Number.isFinite(capacity) && capacity >= 0) {
      sem.resize(Math.floor(capacity));
      unlimited.delete(project);
    }
    return sem;
  }

  function resize(project: string, newCapacity: number): void {
    const sem = registry.get(project);
    if (!sem) return;
    if (isUnlimited(newCapacity)) {
      sem.resize(UNLIMITED_INTERNAL_CAP);
      unlimited.add(project);
    } else {
      sem.resize(Math.floor(newCapacity));
      unlimited.delete(project);
    }
  }

  function remove(project: string, reason: string): void {
    const sem = registry.get(project);
    if (!sem) return;
    sem.drain(reason);
    registry.delete(project);
    unlimited.delete(project);
  }

  function drainAll(reason: string): void {
    for (const [project, sem] of registry) {
      sem.drain(reason);
      registry.delete(project);
    }
    unlimited.clear();
  }

  function snapshot(): Array<{ project: string; capacity: number; inflight: number; waiters: number }> {
    const out: Array<{ project: string; capacity: number; inflight: number; waiters: number }> = [];
    for (const [project, sem] of registry) {
      out.push({
        project,
        capacity: unlimited.has(project) ? Number.POSITIVE_INFINITY : sem.capacity,
        inflight: sem.inflight,
        waiters: sem.waiters,
      });
    }
    return out;
  }

  return { for: forProject, resize, remove, drainAll, snapshot };
}
