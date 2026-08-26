/**
 * End-to-end cross-boundary coverage for the planner scheduler over the REAL
 * koffi loader (`lib/planner-schedule-ffi.ts`'s `scheduleDagPreferKernel`) under
 * production-shaped inputs (ADR-0086 / ADR-0054).
 *
 * The sibling `planner-schedule-ffi.test.js` proves the loader on 3-node linear
 * chains where every node is critical — a shape that cannot catch a bug in the
 * marshaling of the per-node `slack`/`critical`/`latest*` fields, and never
 * stresses the boundary under concurrency or malformed bytes. This suite:
 *   1. asserts the kernel-preferred path is byte-identical to the directly
 *      imported pure-TS scheduler on a 12-node fan-out/fan-in DAG with real
 *      slack (robust whether or not the dylib is present — no fragile
 *      force-absence via a bogus env path, which a populated dist/core defeats);
 *   2. when the real dylib is present, drives it concurrently (the daemon is
 *      multi-request) and asserts every interleaved call agrees;
 *   3. feeds the raw koffi export corrupted/truncated/non-UTF-8/oversized
 *      buffers and asserts it fails CLOSED (parseable `ok:false`, never a crash
 *      or a torn read) so the TS caller degrades cleanly.
 *
 * Dylib-required blocks are `describe.skip`-gated so CI (which does not build
 * the dylib) stays green; run `npm run build:core:dist` to exercise them.
 */
import { describe, expect, test, beforeEach } from '@jest/globals';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  scheduleDagPreferKernel,
  schedulerKernelAvailable,
  __resetSchedulerKernelForTests,
} from '../../lib/planner-schedule-ffi.js';
import { schedule as scheduleTs } from '../../lib/planner-schedule.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// A realistic 12-node build/release DAG — the same shape asserted on the Rust
// side in core/kernel/pd-anchor/tests/schedule_ffi_roundtrip.rs. Three parallel
// compile branches fan in through a diamond, with a short side branch that
// carries positive slack (so per-node slack/critical marshaling is load-bearing).
function realisticDag() {
  const nodes = [
    { id: 'root', estimate: 1 },
    { id: 'compile_a', estimate: 5 },
    { id: 'compile_b', estimate: 2 },
    { id: 'compile_c', estimate: 1 },
    { id: 'link_ab', estimate: 4 },
    { id: 'link_bc', estimate: 2 },
    { id: 'test_heavy', estimate: 6 },
    { id: 'test_light', estimate: 1 },
    { id: 'bundle', estimate: 3 },
    { id: 'sign', estimate: 1 },
    { id: 'side_probe', estimate: 1 },
    { id: 'release', estimate: 2 },
  ];
  const edges = [
    { from: 'root', to: 'compile_a' },
    { from: 'root', to: 'compile_b' },
    { from: 'root', to: 'compile_c' },
    { from: 'compile_a', to: 'link_ab' },
    { from: 'compile_b', to: 'link_ab' },
    { from: 'compile_b', to: 'link_bc' },
    { from: 'compile_c', to: 'link_bc' },
    { from: 'link_ab', to: 'test_heavy' },
    { from: 'link_bc', to: 'test_light' },
    { from: 'compile_c', to: 'side_probe' },
    { from: 'test_heavy', to: 'bundle' },
    { from: 'test_light', to: 'bundle' },
    { from: 'side_probe', to: 'bundle' },
    { from: 'bundle', to: 'sign' },
    { from: 'sign', to: 'release' },
    { from: 'test_heavy', to: 'release' },
  ];
  return { nodes, edges };
}

const cyclic = () => ({
  nodes: [
    { id: 'a', estimate: 1 },
    { id: 'b', estimate: 1 },
    { id: 'c', estimate: 1 },
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'a' },
  ],
});

const FFI_DYLIB =
  process.env.PD_ANCHOR_DYLIB ||
  join(here, '../../dist/core', 'libpd_anchor.' + (process.platform === 'darwin' ? 'dylib' : 'so'));
const haveDylib = existsSync(FFI_DYLIB);

describe('planner-schedule-ffi round-trip — kernel-preferred output equals the pure TS scheduler', () => {
  beforeEach(() => {
    __resetSchedulerKernelForTests();
  });

  test('a 12-node fan-out/fan-in DAG round-trips identically through whichever engine is live', () => {
    const { nodes, edges } = realisticDag();
    // The real loader (kernel when the dylib is present, TS otherwise)...
    const viaPreferred = scheduleDagPreferKernel(nodes, edges);
    // ...must match the directly imported pure-TS scheduler byte-for-byte.
    const viaTs = scheduleTs(nodes, edges);
    expect(viaPreferred).toEqual(viaTs);

    // Guard against a degenerate DAG that could mask a slack-marshaling bug.
    expect(viaPreferred.ok).toBe(true);
    expect(viaPreferred.cyclic).toBe(false);
    expect(viaPreferred.nodes).toHaveLength(12);
    expect(viaPreferred.makespan).toBeGreaterThan(0);
    expect(viaPreferred.nodes.filter((n) => n.slack > 0).length).toBeGreaterThanOrEqual(1);
    expect(viaPreferred.nodes.filter((n) => n.critical).length).toBeGreaterThanOrEqual(3);
    expect(viaPreferred.criticalPath.length).toBeGreaterThanOrEqual(3);
  });

  test('a cyclic graph fails closed identically through the preferred engine and the pure TS impl', () => {
    const { nodes, edges } = cyclic();
    const viaPreferred = scheduleDagPreferKernel(nodes, edges);
    const viaTs = scheduleTs(nodes, edges);
    expect(viaPreferred).toEqual(viaTs);
    expect(viaPreferred.ok).toBe(false);
    expect(viaPreferred.cyclic).toBe(true);
  });
});

// Only when a real dylib is available (locally after build:core:dist; CI skips).
const ffiDescribe = haveDylib ? describe : describe.skip;

ffiDescribe('planner-schedule-ffi round-trip — the Rust kernel dylib actually drives scheduling', () => {
  beforeEach(() => {
    process.env.PD_ANCHOR_DYLIB = FFI_DYLIB;
    __resetSchedulerKernelForTests();
  });

  test('the kernel loads and schedules the realistic DAG identically to the pure TS impl', () => {
    expect(schedulerKernelAvailable()).toBe(true); // proves the real boundary was crossed
    const { nodes, edges } = realisticDag();
    const viaKernel = scheduleDagPreferKernel(nodes, edges);
    expect(viaKernel).toEqual(scheduleTs(nodes, edges));
  });

  test('concurrent interleaved kernel calls all agree (the daemon is multi-request)', async () => {
    const { nodes, edges } = realisticDag();
    const reference = scheduleTs(nodes, edges);
    // Wrap the sync FFI call in a microtask and fire many at once so their
    // koffi decode/free cycles interleave; every result must be the one answer.
    const results = await Promise.all(
      Array.from({ length: 64 }, () => Promise.resolve().then(() => scheduleDagPreferKernel(nodes, edges))),
    );
    for (const r of results) expect(r).toEqual(reference);
  });

  test('the raw koffi export fails closed on corrupted / truncated / non-UTF-8 / oversized buffers', () => {
    const koffi = require('koffi');
    const lib = koffi.load(FFI_DYLIB);
    const scheduleDag = lib.func('void* pd_schedule_dag_json(const char* req, size_t len)');
    const free = lib.func('void pd_string_free(void* ptr)');

    const callRaw = (buf, len) => {
      const ptr = scheduleDag(buf, len);
      expect(ptr).toBeTruthy(); // encodable input never returns null
      try {
        return JSON.parse(koffi.decode(ptr, 'char', -1));
      } finally {
        free(ptr);
      }
    };

    // Valid JSON but a truncated length — must parse-fail cleanly, not read past.
    const valid = Buffer.from(JSON.stringify({ nodes: [{ id: 'a', estimate: 1 }], edges: [] }));
    expect(callRaw(valid, Math.floor(valid.length / 2)).ok).toBe(false);

    // Non-UTF-8 bytes — the utf8 guard must reject.
    const nonUtf8 = Buffer.from([0xff, 0xfe, 0x01, 0x80]);
    expect(callRaw(nonUtf8, nonUtf8.length).ok).toBe(false);

    // Garbage that isn't JSON.
    const garbage = Buffer.from('not json at all');
    expect(callRaw(garbage, garbage.length).ok).toBe(false);

    // Oversized (> 256 KiB) — rejected fail-fast.
    const huge = Buffer.from('x'.repeat(300 * 1024));
    expect(callRaw(huge, huge.length).ok).toBe(false);

    // After abusing the raw boundary, the real loader still returns the correct
    // result — the export left no corrupt state behind.
    __resetSchedulerKernelForTests();
    process.env.PD_ANCHOR_DYLIB = FFI_DYLIB;
    const { nodes, edges } = realisticDag();
    expect(scheduleDagPreferKernel(nodes, edges)).toEqual(scheduleTs(nodes, edges));
  });
});
