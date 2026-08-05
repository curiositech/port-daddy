/**
 * Unit Tests for lib/banner.ts
 *
 * Tests exported constants and functions. Smoke-tests the print functions
 * by verifying they complete without throwing (they write to stdout/stderr).
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  BANNER,
  BANNER_COMPACT,
  TAGLINE,
  WHEEL,
  ANCHOR,
  WAVE,
  SKULL,
  JOLLY_ROGER,
  JOLLY_ROGER_COMPACT,
  ANSI,
  printBanner,
  printCompactHeader,
  printDivider,
  announcePort,
  serviceStatus,
  printStartupInfo,
  printFarewell,
} from '../../lib/banner.js';

// ─── Exported constants ───────────────────────────────────────────────────────

describe('Exported string constants', () => {
  test('BANNER is a non-empty string', () => {
    expect(typeof BANNER).toBe('string');
    expect(BANNER.length).toBeGreaterThan(0);
  });

  test('BANNER_COMPACT is a non-empty string', () => {
    expect(typeof BANNER_COMPACT).toBe('string');
    expect(BANNER_COMPACT.length).toBeGreaterThan(0);
  });

  test('TAGLINE is a non-empty string', () => {
    expect(typeof TAGLINE).toBe('string');
    expect(TAGLINE.length).toBeGreaterThan(0);
  });

  test('WHEEL is a non-empty string', () => {
    expect(typeof WHEEL).toBe('string');
    expect(WHEEL.length).toBeGreaterThan(0);
  });

  test('ANCHOR is a non-empty string', () => {
    expect(typeof ANCHOR).toBe('string');
    expect(ANCHOR.length).toBeGreaterThan(0);
  });

  test('WAVE is a non-empty string', () => {
    expect(typeof WAVE).toBe('string');
    expect(WAVE.length).toBeGreaterThan(0);
  });

  test('SKULL is a non-empty string', () => {
    expect(typeof SKULL).toBe('string');
    expect(SKULL.length).toBeGreaterThan(0);
  });

  test('JOLLY_ROGER is a non-empty string', () => {
    expect(typeof JOLLY_ROGER).toBe('string');
    expect(JOLLY_ROGER.length).toBeGreaterThan(0);
  });

  test('JOLLY_ROGER_COMPACT is a non-empty string', () => {
    expect(typeof JOLLY_ROGER_COMPACT).toBe('string');
    expect(JOLLY_ROGER_COMPACT.length).toBeGreaterThan(0);
  });

  test('ANSI is re-exported and has at least fgCyan and reset', () => {
    expect(ANSI).toBeDefined();
    expect(typeof ANSI.fgCyan).toBe('string');
    expect(typeof ANSI.reset).toBe('string');
  });
});

// ─── announcePort ─────────────────────────────────────────────────────────────

describe('announcePort(service, port)', () => {
  test('returns a string', () => {
    const result = announcePort('myapp:api', 3000);
    expect(typeof result).toBe('string');
  });

  test('includes the service name', () => {
    const result = announcePort('myapp:api', 3000);
    expect(result).toContain('myapp:api');
  });

  test('includes the port number', () => {
    const result = announcePort('myapp:api', 3000);
    expect(result).toContain('3000');
  });

  test('works with port 80', () => {
    const result = announcePort('web', 80);
    expect(result).toContain('web');
    expect(result).toContain('80');
  });

  test('works with a long service name', () => {
    const longName = 'very-long-project-name:very-long-stack:main';
    const result = announcePort(longName, 9999);
    expect(result).toContain(longName);
    expect(result).toContain('9999');
  });
});

// ─── serviceStatus ────────────────────────────────────────────────────────────

describe('serviceStatus(name, status)', () => {
  test('returns a string for "up"', () => {
    const result = serviceStatus('my-api', 'up');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns a string for "down"', () => {
    const result = serviceStatus('my-api', 'down');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns a string for "starting"', () => {
    const result = serviceStatus('my-api', 'starting');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns a string for "stopping"', () => {
    const result = serviceStatus('my-api', 'stopping');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('includes the service name in the output', () => {
    const result = serviceStatus('my-special-service', 'up');
    expect(result).toContain('my-special-service');
  });

  test('all four statuses produce distinct output', () => {
    const statuses = ['up', 'down', 'starting', 'stopping'];
    const outputs = statuses.map(s => serviceStatus('svc', s));
    const unique = new Set(outputs);
    expect(unique.size).toBe(4);
  });
});

// ─── Print functions ──────────────────────────────────────────────────────────

describe('printBanner()', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('does not throw', () => {
    expect(() => printBanner()).not.toThrow();
  });

  test('calls console.log at least once', () => {
    printBanner();
    expect(logSpy).toHaveBeenCalled();
  });
});

describe('printCompactHeader(title)', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('does not throw with a normal title', () => {
    expect(() => printCompactHeader('My Section')).not.toThrow();
  });

  test('does not throw with an empty title', () => {
    expect(() => printCompactHeader('')).not.toThrow();
  });

  test('calls console.log', () => {
    printCompactHeader('Test Header');
    expect(logSpy).toHaveBeenCalled();
  });
});

describe('printDivider()', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('does not throw', () => {
    expect(() => printDivider()).not.toThrow();
  });

  test('calls console.log', () => {
    printDivider();
    expect(logSpy).toHaveBeenCalled();
  });
});

describe('printStartupInfo(opts)', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('does not throw with valid opts', () => {
    expect(() =>
      printStartupInfo({ port: 43121, pid: 12345, version: '3.8.0', hash: 'abc123' })
    ).not.toThrow();
  });

  test('calls console.log multiple times', () => {
    printStartupInfo({ port: 43121, pid: 1, version: '1.0.0', hash: 'deadbeef' });
    expect(logSpy.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('printFarewell()', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test('does not throw', () => {
    expect(() => printFarewell()).not.toThrow();
  });

  test('calls console.log', () => {
    printFarewell();
    expect(logSpy).toHaveBeenCalled();
  });
});
