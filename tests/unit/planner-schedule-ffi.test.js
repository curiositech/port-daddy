/**
 * lib/planner-schedule-ffi: kernel-preferred CPM scheduling with graceful TS
 * fallback (ADR-0086 / ADR-0054).
 *
 * The fallback path is exercised always (CI does not build the dylib). The FFI
 * path runs only when a dylib is present (set PD_ANCHOR_DYLIB, or build
 * dist/core/libpd_anchor) and asserts it returns the SAME result as the
 * fallback — the cross-runtime parity guarantee, at the API boundary. Mirrors
 * tests/unit/macaroon-ffi.test.js's structure exactly.
 */
import { describe, expect, test, beforeEach } from '@jest/globals';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scheduleDagPreferKernel,
  schedulerKernelAvailable,
  __resetSchedulerKernelForTests,
} from '../../lib/planner-schedule-ffi.js';

const here = dirname(fileURLToPath(import.meta.url));

const linearChain = () => ({
  nodes: [
    { id: 'a', estimate: 2 },
    { id: 'b', estimate: 3 },
    { id: 'c', estimate: 1 },
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ],
});

const cyclic = () => ({
  nodes: [
    { id: 'a', estimate: 1 },
    { id: 'b', estimate: 1 },
  ],
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
  ],
});

// A dylib for the FFI path: PD_ANCHOR_DYLIB, else the standard dist/core location.
const FFI_DYLIB =
  process.env.PD_ANCHOR_DYLIB ||
  join(here, '../../dist/core', 'libpd_anchor.' + (process.platform === 'darwin' ? 'dylib' : 'so'));
const haveDylib = existsSync(FFI_DYLIB);

describe('planner-schedule-ffi — graceful TS fallback (dylib absent)', () => {
  beforeEach(() => {
    delete process.env.PD_ANCHOR_DYLIB;
    process.env.PD_ANCHOR_DYLIB = '/nonexistent/libpd_anchor.dylib';
    __resetSchedulerKernelForTests();
  });

  test('falls back to the TS impl and schedules a linear chain', () => {
    expect(schedulerKernelAvailable()).toBe(false); // forced-absent dylib
    const { nodes, edges } = linearChain();
    const res = scheduleDagPreferKernel(nodes, edges);
    expect(res.ok).toBe(true);
    expect(res.makespan).toBe(6);
    expect(res.criticalPath).toEqual(['a', 'b', 'c']);
  });

  test('fallback fails closed on a cyclic graph', () => {
    const { nodes, edges } = cyclic();
    const res = scheduleDagPreferKernel(nodes, edges);
    expect(res.ok).toBe(false);
    expect(res.cyclic).toBe(true);
  });
});

// Only runs when a real dylib is available (locally; CI does not build it).
const ffiDescribe = haveDylib ? describe : describe.skip;
ffiDescribe('planner-schedule-ffi — Rust kernel path (dylib present) agrees with the fallback', () => {
  beforeEach(() => {
    process.env.PD_ANCHOR_DYLIB = FFI_DYLIB;
    __resetSchedulerKernelForTests();
  });

  test('the kernel loads and schedules a linear chain identically to TS', () => {
    expect(schedulerKernelAvailable()).toBe(true);
    const { nodes, edges } = linearChain();
    const viaKernel = scheduleDagPreferKernel(nodes, edges);
    expect(viaKernel.ok).toBe(true);
    expect(viaKernel.makespan).toBe(6);
    expect(viaKernel.criticalPath).toEqual(['a', 'b', 'c']);

    // Same inputs through the forced fallback must agree.
    process.env.PD_ANCHOR_DYLIB = '/nonexistent';
    __resetSchedulerKernelForTests();
    const viaFallback = scheduleDagPreferKernel(nodes, edges);
    expect(viaKernel).toEqual(viaFallback);
  });

  test('the kernel fails closed on a cyclic graph identically to TS', () => {
    const { nodes, edges } = cyclic();
    const res = scheduleDagPreferKernel(nodes, edges);
    expect(res.ok).toBe(false);
    expect(res.cyclic).toBe(true);
  });
});
