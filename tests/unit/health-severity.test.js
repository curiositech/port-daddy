import { describe, expect, test } from '@jest/globals';
import {
  daemonHealthSeverity,
  worstSeverity,
  SEVERITY_RANK,
} from '../../lib/health-severity.js';

describe('daemonHealthSeverity', () => {
  // The single shared mapping the daemon /health, pd doctor, the Rust console,
  // and FleetBar all read. A daemon 404'ing its own contract is broken, full
  // stop; a degraded-but-serving daemon is a warning the operator should see.

  test('routes-not-ok is always critical (daemon 404ing its own contract)', () => {
    expect(daemonHealthSeverity({ routesOk: false, routesMissing: 2, runtimeDegraded: false })).toBe('critical');
    // Even with a clean runtime, missing routes win.
    expect(daemonHealthSeverity({ routesOk: false, routesMissing: 1, runtimeDegraded: false, binaryDrifted: false })).toBe('critical');
  });

  test('runtime-degraded with routes ok is a warning, not a critical', () => {
    expect(daemonHealthSeverity({ routesOk: true, routesMissing: 0, runtimeDegraded: true })).toBe('warn');
  });

  test('binary drift with everything else ok is a warning', () => {
    expect(daemonHealthSeverity({ routesOk: true, routesMissing: 0, runtimeDegraded: false, binaryDrifted: true })).toBe('warn');
  });

  test('all-clear is ok', () => {
    expect(daemonHealthSeverity({ routesOk: true, routesMissing: 0, runtimeDegraded: false, binaryDrifted: false })).toBe('ok');
  });
});

describe('worstSeverity', () => {
  test('folds to the highest-rank member', () => {
    expect(worstSeverity(['ok', 'ok', 'ok'])).toBe('ok');
    expect(worstSeverity(['ok', 'warn', 'ok'])).toBe('warn');
    expect(worstSeverity(['ok', 'warn', 'critical'])).toBe('critical');
    expect(worstSeverity(['warn', 'critical', 'warn'])).toBe('critical');
  });

  test('empty list is ok', () => {
    expect(worstSeverity([])).toBe('ok');
  });

  test('rank is a strict total order ok < warn < critical', () => {
    expect(SEVERITY_RANK.ok).toBeLessThan(SEVERITY_RANK.warn);
    expect(SEVERITY_RANK.warn).toBeLessThan(SEVERITY_RANK.critical);
  });
});
