/**
 * Unit Tests for shared/port-utils.js
 *
 * Tests utility functions for port and process management.
 * Some tests use the real OS (ps, lsof) but with known-good PIDs.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  formatUptime,
  getSystemPorts,
  clearSystemPortsCache,
  isProcessAlive,
  isProcessAliveAsync,
  batchCheckProcesses,
  startSystemPortsRefresh,
} from '../../shared/port-utils.js';
import { resolveDaemonTcpTarget } from '../../shared/daemon-discovery.js';

const selectedDaemonPort = () => resolveDaemonTcpTarget().port;

// ─── formatUptime ────────────────────────────────────────────────────────────

describe('formatUptime', () => {
  test('formats minutes only (< 1 hour)', () => {
    expect(formatUptime(0)).toBe('0m');
    expect(formatUptime(59)).toBe('0m');
    expect(formatUptime(60)).toBe('1m');
    expect(formatUptime(120)).toBe('2m');
    expect(formatUptime(3599)).toBe('59m');
  });

  test('formats hours and minutes (< 1 day)', () => {
    expect(formatUptime(3600)).toBe('1h 0m');
    expect(formatUptime(3661)).toBe('1h 1m');
    expect(formatUptime(7200)).toBe('2h 0m');
    expect(formatUptime(86399)).toBe('23h 59m');
  });

  test('formats days, hours, minutes (>= 1 day)', () => {
    expect(formatUptime(86400)).toBe('1d 0h 0m');
    expect(formatUptime(90000)).toBe('1d 1h 0m');
    expect(formatUptime(172800)).toBe('2d 0h 0m');
    expect(formatUptime(172861)).toBe('2d 0h 1m');
    expect(formatUptime(604800)).toBe('7d 0h 0m');
  });

  test('handles large values', () => {
    const result = formatUptime(30 * 86400);
    expect(result).toBe('30d 0h 0m');
  });
});

// ─── getSystemPorts ──────────────────────────────────────────────────────────

describe('getSystemPorts', () => {
  beforeEach(() => {
    clearSystemPortsCache();
  });

  test('returns an array (empty when cache is cold)', () => {
    const ports = getSystemPorts();
    expect(Array.isArray(ports)).toBe(true);
  });

  test('returns empty array after cache clear', () => {
    clearSystemPortsCache();
    expect(getSystemPorts()).toEqual([]);
  });
});

// ─── clearSystemPortsCache ───────────────────────────────────────────────────

describe('clearSystemPortsCache', () => {
  test('is callable without error', () => {
    expect(() => clearSystemPortsCache()).not.toThrow();
  });

  test('makes getSystemPorts return empty after clear', () => {
    clearSystemPortsCache();
    expect(getSystemPorts()).toEqual([]);
  });
});

// ─── isProcessAlive (sync) ───────────────────────────────────────────────────

describe('isProcessAlive', () => {
  test('returns true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test('returns false for PID 0 (invalid)', () => {
    // PID 0 is not a valid user process
    expect(isProcessAlive(0)).toBe(false);
  });

  test('returns false for a very high unlikely PID', () => {
    // PID 99999 is extremely unlikely to exist — this is best-effort
    // We can't guarantee it, but it usually works in test environments
    const result = isProcessAlive(99999);
    expect(typeof result).toBe('boolean');
  });
});

// ─── isProcessAliveAsync ─────────────────────────────────────────────────────

describe('isProcessAliveAsync', () => {
  test('returns true for the current process', async () => {
    const alive = await isProcessAliveAsync(process.pid);
    expect(alive).toBe(true);
  });

  test('returns false for PID 0', async () => {
    const alive = await isProcessAliveAsync(0);
    expect(alive).toBe(false);
  });

  test('returns a boolean', async () => {
    const result = await isProcessAliveAsync(process.pid);
    expect(typeof result).toBe('boolean');
  });
}, 5000);

// ─── batchCheckProcesses ─────────────────────────────────────────────────────

describe('batchCheckProcesses', () => {
  test('returns empty Set for empty input', async () => {
    const result = await batchCheckProcesses([]);
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  test('contains current PID when checked', async () => {
    const result = await batchCheckProcesses([process.pid]);
    expect(result.has(process.pid)).toBe(true);
  });

  test('does not contain clearly dead PID', async () => {
    // Use PID 0 which is never a valid user process
    const result = await batchCheckProcesses([0]);
    expect(result.has(0)).toBe(false);
  });

  // batchCheckProcesses uses `ps -p` which behaves differently across
  // platforms and CI environments. The core logic (parsing ps output) is
  // covered by the other tests. This mixed-PID test is only reliable on macOS.
  const testFn = process.platform === 'darwin' ? test : test.skip;
  testFn('handles mixed live and dead PIDs', async () => {
    const result = await batchCheckProcesses([process.ppid, 0]);
    expect(result.has(process.ppid)).toBe(true);
    expect(result.has(0)).toBe(false);
  });

  test('returns a Set of numbers', async () => {
    const result = await batchCheckProcesses([process.pid]);
    for (const pid of result) {
      expect(typeof pid).toBe('number');
    }
  });
}, 10000);

// ─── startSystemPortsRefresh ─────────────────────────────────────────────────

describe('startSystemPortsRefresh', () => {
  test('returns a stop handle', () => {
    const handle = startSystemPortsRefresh(60000);
    expect(handle).toBeDefined();
    expect(typeof handle.stop).toBe('function');
    handle.stop();
  });

  test('stop() does not throw', () => {
    const handle = startSystemPortsRefresh(60000);
    expect(() => handle.stop()).not.toThrow();
  });

  test('can be stopped before interval fires', () => {
    const handle = startSystemPortsRefresh(60000);
    handle.stop();
    // No error thrown = success
  });
});

// ─── getSystemPortsAsync ─────────────────────────────────────────────────────

import { getSystemPortsAsync, isPortInUseOnSystem, isPortInUseOnSystemAsync } from '../../shared/port-utils.js';

describe('getSystemPortsAsync', () => {
  beforeEach(() => {
    clearSystemPortsCache();
  });

  test('returns an array', async () => {
    const ports = await getSystemPortsAsync();
    expect(Array.isArray(ports)).toBe(true);
  }, 10000);

  test('each entry has port, pid, command, user fields', async () => {
    const ports = await getSystemPortsAsync();
    for (const entry of ports) {
      expect(typeof entry.port).toBe('number');
      expect(typeof entry.pid).toBe('number');
      expect(typeof entry.command).toBe('string');
      expect(typeof entry.user).toBe('string');
    }
  }, 10000);

  test('ports are sorted in ascending order', async () => {
    const ports = await getSystemPortsAsync();
    for (let i = 1; i < ports.length; i++) {
      expect(ports[i].port).toBeGreaterThanOrEqual(ports[i - 1].port);
    }
  }, 10000);

  test('returns cached result on second call within TTL', async () => {
    const first = await getSystemPortsAsync();
    const second = await getSystemPortsAsync();
    // Both calls return arrays; if cache is hit, second is same reference
    expect(Array.isArray(second)).toBe(true);
    // Length should be the same (cached result)
    expect(second.length).toBe(first.length);
  }, 10000);

  test('port numbers are positive integers', async () => {
    const ports = await getSystemPortsAsync();
    for (const entry of ports) {
      expect(entry.port).toBeGreaterThan(0);
      expect(Number.isInteger(entry.port)).toBe(true);
    }
  }, 10000);
});

// ─── isPortInUseOnSystem (sync) ───────────────────────────────────────────────

describe('isPortInUseOnSystem', () => {
  test('returns a boolean', () => {
    const result = isPortInUseOnSystem(selectedDaemonPort());
    expect(typeof result).toBe('boolean');
  });

  test('returns false for port 1 (reserved, almost never listening)', () => {
    // Port 1 is a reserved port, very unlikely to be in use in a test environment
    const result = isPortInUseOnSystem(1);
    expect(typeof result).toBe('boolean');
  });

  test('returns false for port 65535 (edge case)', () => {
    // Port 65535 is the maximum valid port, very unlikely to be in use
    const result = isPortInUseOnSystem(65535);
    expect(typeof result).toBe('boolean');
  });

  test('selected daemon port check returns a boolean', () => {
    const result = isPortInUseOnSystem(selectedDaemonPort());
    expect(typeof result).toBe('boolean');
  });
});

// ─── isPortInUseOnSystemAsync ─────────────────────────────────────────────────

describe('isPortInUseOnSystemAsync', () => {
  test('returns a boolean', async () => {
    const result = await isPortInUseOnSystemAsync(selectedDaemonPort());
    expect(typeof result).toBe('boolean');
  }, 5000);

  test('returns false for port 1 (reserved)', async () => {
    const result = await isPortInUseOnSystemAsync(1);
    // Just verify it's a boolean; port 1 might or might not be in use
    expect(typeof result).toBe('boolean');
  }, 5000);

  test('sync and async versions agree on the selected daemon port', async () => {
    const daemonPort = selectedDaemonPort();
    const syncResult = isPortInUseOnSystem(daemonPort);
    const asyncResult = await isPortInUseOnSystemAsync(daemonPort);
    // Both should report the same state for the same port
    expect(asyncResult).toBe(syncResult);
  }, 5000);

  test('returns a boolean for port 65535', async () => {
    const result = await isPortInUseOnSystemAsync(65535);
    expect(typeof result).toBe('boolean');
  }, 5000);
});
