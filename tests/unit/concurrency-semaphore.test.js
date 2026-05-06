/**
 * concurrency-semaphore.test.js — invariants and behavior for the
 * daemon-wide concurrency gate.
 *
 * Spec: docs/shipwright/FLEETCONTROL-HARDENING.md §5, §6.1, §6.3
 *
 * Coverage:
 *   - basic acquire/release, FIFO ordering
 *   - tryAcquire is non-blocking
 *   - resize: grow drains waiters; shrink keeps holders
 *   - drain: rejects waiters, future acquires reject
 *   - release idempotence
 *   - PROPERTY: cap respected under random traces (fast-check, 2k+ ops)
 *   - registry: get-or-create, resize, remove, drainAll
 */

import { describe, test, expect } from '@jest/globals';
import fc from 'fast-check';

import {
  createSemaphore,
  createProjectSemaphoreRegistry,
} from '../../lib/concurrency-semaphore.js';

// ─── createSemaphore ─────────────────────────────────────────────────────────

describe('createSemaphore', () => {
  test('rejects negative or non-integer capacity at construction', () => {
    expect(() => createSemaphore({ capacity: -1 })).toThrow(/capacity/);
    expect(() => createSemaphore({ capacity: 1.5 })).toThrow(/capacity/);
    expect(() => createSemaphore({ capacity: NaN })).toThrow(/capacity/);
  });

  test('acquires up to capacity without blocking', async () => {
    const sem = createSemaphore({ capacity: 3 });
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    const r3 = await sem.acquire();
    expect(sem.inflight).toBe(3);
    expect(sem.waiters).toBe(0);
    r1(); r2(); r3();
    expect(sem.inflight).toBe(0);
  });

  test('FIFO ordering survives many waiters', async () => {
    const sem = createSemaphore({ capacity: 1 });
    const initialRelease = await sem.acquire();

    const order = [];
    const releases = [];
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        sem.acquire().then((release) => {
          order.push(i);
          releases.push(release);
        }),
      );
    }
    expect(sem.waiters).toBe(10);

    initialRelease();
    // Drain waiters one at a time by releasing each as it wakes.
    for (let i = 0; i < 10; i++) {
      // Wait for the i-th to wake, then release so i+1 can wake.
      await promises[i];
      releases[i]();
    }
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(sem.inflight).toBe(0);
    expect(sem.waiters).toBe(0);
  });

  test('release is idempotent — second call is a no-op', async () => {
    const sem = createSemaphore({ capacity: 1 });
    const release = await sem.acquire();
    release();
    release(); // should not under-flow inflight or wake a phantom waiter
    expect(sem.inflight).toBe(0);

    // A subsequent acquire must succeed (only one permit really released).
    const r2 = await sem.acquire();
    expect(sem.inflight).toBe(1);
    r2();
  });

  test('tryAcquire returns null when at capacity, does not enqueue', async () => {
    const sem = createSemaphore({ capacity: 1 });
    const r1 = await sem.acquire();
    const result = sem.tryAcquire();
    expect(result).toBeNull();
    expect(sem.waiters).toBe(0);
    r1();
    const r2 = sem.tryAcquire();
    expect(r2).not.toBeNull();
    r2?.();
  });

  test('tryAcquire returns a release fn when a permit is free', () => {
    const sem = createSemaphore({ capacity: 2 });
    const r1 = sem.tryAcquire();
    const r2 = sem.tryAcquire();
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(sem.tryAcquire()).toBeNull();
    r1?.(); r2?.();
  });

  test('resize grow wakes FIFO waiters until queue drains or new cap met', async () => {
    const sem = createSemaphore({ capacity: 1 });
    const r1 = await sem.acquire();
    const wakes = [];
    const releases = [];
    const promises = [];
    for (let i = 0; i < 4; i++) {
      promises.push(
        sem.acquire().then((release) => {
          wakes.push(i);
          releases.push(release);
        }),
      );
    }
    expect(sem.waiters).toBe(4);

    // Grow to 3 — TWO waiters wake (we already have 1 inflight, cap is now 3).
    sem.resize(3);
    await Promise.all([promises[0], promises[1]]);
    expect(wakes).toEqual([0, 1]);
    expect(sem.inflight).toBe(3);
    expect(sem.waiters).toBe(2);

    // Release the original holder → waker 2 wakes.
    r1();
    await promises[2];
    expect(wakes).toEqual([0, 1, 2]);

    // Cleanup
    releases.forEach((r) => r());
  });

  test('resize shrink does not SIGTERM existing holders', async () => {
    const sem = createSemaphore({ capacity: 5 });
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    const r3 = await sem.acquire();
    expect(sem.inflight).toBe(3);

    sem.resize(1);
    expect(sem.capacity).toBe(1);
    expect(sem.inflight).toBe(3); // existing holders untouched

    // New acquires queue until inflight drops below the new cap.
    let woke = false;
    const p4 = sem.acquire().then((rel) => { woke = true; return rel; });
    expect(sem.waiters).toBe(1);
    expect(woke).toBe(false);

    r1(); // inflight: 2 → still > new cap 1, so waiter stays queued
    await Promise.resolve(); await Promise.resolve();
    expect(woke).toBe(false);

    r2(); // inflight: 1 → equal to cap, still no wake
    await Promise.resolve(); await Promise.resolve();
    expect(woke).toBe(false);

    r3(); // inflight: 0 → cap=1, room for one — wake
    const r4 = await p4;
    expect(woke).toBe(true);
    r4();
  });

  test('drain rejects all queued waiters with the given reason', async () => {
    const sem = createSemaphore({ capacity: 0, name: 'test' });
    const errs = [];
    const promises = [
      sem.acquire().catch((e) => errs.push(e.message)),
      sem.acquire().catch((e) => errs.push(e.message)),
    ];
    sem.drain('shutdown');
    await Promise.all(promises);
    expect(errs).toHaveLength(2);
    expect(errs[0]).toContain('drained');
    expect(errs[0]).toContain('shutdown');
  });

  test('after drain, future acquires reject immediately', async () => {
    const sem = createSemaphore({ capacity: 5 });
    sem.drain('test');
    await expect(sem.acquire()).rejects.toThrow(/drained/);
    expect(sem.tryAcquire()).toBeNull();
  });

  test('drain is idempotent (second call is a no-op)', () => {
    const sem = createSemaphore({ capacity: 1 });
    sem.drain('first');
    sem.drain('second'); // must not throw or leak waiters
    expect(sem.waiters).toBe(0);
  });
});

// ─── PROPERTY TESTS (fast-check) ─────────────────────────────────────────────

describe('createSemaphore — invariants', () => {
  test('inflight never exceeds capacity under random acquire/release traces (fixed cap)', async () => {
    // Property: under any acquire/release/tryAcquire interleaving with a fixed
    // capacity, inflight never exceeds capacity. Resize is excluded here on
    // purpose — shrink intentionally grandfathers existing holders, so the
    // global "inflight ≤ cap" property doesn't hold across a shrink-below-
    // inflight. Resize semantics are exercised by the deterministic unit
    // tests above (`resize grow wakes...`, `resize shrink does not...`).
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            { weight: 5, arbitrary: fc.constant({ kind: 'acq' }) },
            { weight: 5, arbitrary: fc.constant({ kind: 'rel' }) },
            { weight: 3, arbitrary: fc.constant({ kind: 'try' }) },
          ),
          { minLength: 50, maxLength: 400 },
        ),
        fc.integer({ min: 1, max: 5 }),
        async (ops, cap) => {
          const sem = createSemaphore({ capacity: cap });
          const releases = [];
          const pendingAcquires = [];

          for (const op of ops) {
            // Invariant must hold continuously when cap is fixed.
            expect(sem.inflight).toBeLessThanOrEqual(cap);

            if (op.kind === 'acq') {
              pendingAcquires.push(sem.acquire());
            } else if (op.kind === 'try') {
              const r = sem.tryAcquire();
              if (r) releases.push(r);
            } else if (op.kind === 'rel') {
              if (releases.length > 0) {
                const r = releases.pop();
                r();
              }
              // Releasing may have woken a queued acquirer. Drain at most one
              // resolved acquire per 'rel' op so the trace stays deterministic.
              if (pendingAcquires.length > 0) {
                const next = pendingAcquires.shift();
                const r = await next;
                releases.push(r);
              }
            }
          }

          expect(sem.inflight).toBeLessThanOrEqual(cap);

          // Cleanup: drain so any unresolved acquires reject without leaking.
          sem.drain('end-of-trace');
          await Promise.allSettled(pendingAcquires);
        },
      ),
      { numRuns: 50 },
    );
  });

  test('total grants never exceed cap-driven supply (no double-grant)', async () => {
    // For a fixed cap of N, after K ops, the count of LIVE permits (held - released)
    // must always be ≤ N. fast-check small-cases this aggressively.
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.array(fc.boolean(), { minLength: 20, maxLength: 100 }), // true=acq, false=rel
        async (cap, ops) => {
          const sem = createSemaphore({ capacity: cap });
          const releases = [];
          let live = 0;
          for (const isAcq of ops) {
            if (isAcq) {
              const r = sem.tryAcquire();
              if (r) {
                releases.push(r);
                live++;
                expect(live).toBeLessThanOrEqual(cap);
              }
            } else if (releases.length > 0) {
              const r = releases.pop();
              r();
              live--;
            }
          }
          // sanity
          expect(live).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── createProjectSemaphoreRegistry ─────────────────────────────────────────

describe('createProjectSemaphoreRegistry', () => {
  test('for() is idempotent — same project name returns same instance', () => {
    const reg = createProjectSemaphoreRegistry();
    const a = reg.for('port-daddy', 3);
    const b = reg.for('port-daddy');
    expect(a).toBe(b);
    expect(a.capacity).toBe(3);
  });

  test('for() with new capacity on existing project resizes in place', async () => {
    const reg = createProjectSemaphoreRegistry();
    const sem = reg.for('p', 2);
    expect(sem.capacity).toBe(2);
    reg.for('p', 5);
    expect(sem.capacity).toBe(5);
  });

  test('for() defaults to a very large cap when no capacity given', () => {
    const reg = createProjectSemaphoreRegistry();
    const sem = reg.for('p');
    // Treats unset as effectively unlimited
    expect(sem.capacity).toBeGreaterThan(1000);
  });

  test('resize() on unknown project is a no-op', () => {
    const reg = createProjectSemaphoreRegistry();
    expect(() => reg.resize('ghost', 4)).not.toThrow();
  });

  test('remove() drains the project semaphore', async () => {
    const reg = createProjectSemaphoreRegistry();
    const sem = reg.for('p', 0);
    const p = sem.acquire().catch((e) => e);
    reg.remove('p', 'fleet stopped');
    const err = await p;
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toMatch(/drained/);
  });

  test('drainAll() drains every registered project', async () => {
    const reg = createProjectSemaphoreRegistry();
    const a = reg.for('a', 0);
    const b = reg.for('b', 0);
    const pa = a.acquire().catch((e) => e);
    const pb = b.acquire().catch((e) => e);
    reg.drainAll('shutdown');
    const [erra, errb] = await Promise.all([pa, pb]);
    expect(String(erra.message)).toMatch(/drained/);
    expect(String(errb.message)).toMatch(/drained/);
  });

  test('snapshot returns one row per project with cap/inflight/waiters', async () => {
    const reg = createProjectSemaphoreRegistry();
    const a = reg.for('a', 2);
    const b = reg.for('b', 1);
    const r1 = await a.acquire();
    const r2 = await a.acquire();
    const r3 = await b.acquire();
    const queued = b.acquire(); // queued waiter

    const snap = reg.snapshot();
    const byProject = Object.fromEntries(snap.map((s) => [s.project, s]));
    expect(byProject.a.capacity).toBe(2);
    expect(byProject.a.inflight).toBe(2);
    expect(byProject.a.waiters).toBe(0);
    expect(byProject.b.capacity).toBe(1);
    expect(byProject.b.inflight).toBe(1);
    expect(byProject.b.waiters).toBe(1);

    r1(); r2(); r3();
    const r4 = await queued;
    r4();
  });
});
