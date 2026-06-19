/**
 * Unit Tests for shared/connection-tracking.js
 *
 * Tests connection limits, tracking, and cleanup for SSE and long-poll.
 * Pure in-memory state — no network or DB required.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  canOpenConnection,
  trackConnection,
  untrackConnection,
  getConnectionStats,
  resetConnections,
  connectionLimits,
} from '../../shared/connection-tracking.js';

const IP_A = '127.0.0.1';
const IP_B = '10.0.0.1';
const IP_C = '192.168.1.1';

beforeEach(() => {
  resetConnections();
});

// ─── connectionLimits constants ──────────────────────────────────────────────

describe('connectionLimits', () => {
  test('exposes expected limit fields', () => {
    expect(typeof connectionLimits.maxLongPoll).toBe('number');
    expect(typeof connectionLimits.maxSSE).toBe('number');
    expect(typeof connectionLimits.maxPerIP).toBe('number');
    expect(typeof connectionLimits.pollInterval).toBe('number');
    expect(typeof connectionLimits.sseTimeout).toBe('number');
  });

  test('limits are positive numbers', () => {
    expect(connectionLimits.maxLongPoll).toBeGreaterThan(0);
    expect(connectionLimits.maxSSE).toBeGreaterThan(0);
    expect(connectionLimits.maxPerIP).toBeGreaterThan(0);
  });
});

// ─── canOpenConnection ───────────────────────────────────────────────────────

describe('canOpenConnection', () => {
  test('allows connections on fresh state (longPoll)', () => {
    expect(canOpenConnection(IP_A, 'longPoll')).toBe(true);
  });

  test('allows connections on fresh state (sse)', () => {
    expect(canOpenConnection(IP_A, 'sse')).toBe(true);
  });

  test('blocks when per-IP limit reached for longPoll', () => {
    for (let i = 0; i < connectionLimits.maxPerIP; i++) {
      trackConnection(IP_A, 'longPoll');
    }
    expect(canOpenConnection(IP_A, 'longPoll')).toBe(false);
  });

  test('blocks when per-IP limit reached for SSE', () => {
    for (let i = 0; i < connectionLimits.maxPerIP; i++) {
      const mockRes = { id: i };
      trackConnection(IP_A, 'sse', mockRes);
    }
    expect(canOpenConnection(IP_A, 'sse')).toBe(false);
  });

  test('other IPs still allowed after one IP hits limit', () => {
    for (let i = 0; i < connectionLimits.maxPerIP; i++) {
      trackConnection(IP_A, 'longPoll');
    }
    expect(canOpenConnection(IP_B, 'longPoll')).toBe(true);
  });

  test('blocks when global longPoll limit reached', () => {
    // Fill up to global limit using different IPs to bypass per-IP limit
    const maxPerIP = connectionLimits.maxPerIP;
    const totalNeeded = connectionLimits.maxLongPoll;
    let filled = 0;
    let ipIndex = 0;

    while (filled < totalNeeded) {
      const ip = `10.0.${ipIndex}.1`;
      const batch = Math.min(maxPerIP, totalNeeded - filled);
      for (let i = 0; i < batch; i++) {
        trackConnection(ip, 'longPoll');
        filled++;
      }
      ipIndex++;
    }

    expect(canOpenConnection('1.2.3.4', 'longPoll')).toBe(false);
  });

  test('blocks when global SSE limit reached', () => {
    const maxPerIP = connectionLimits.maxPerIP;
    const totalNeeded = connectionLimits.maxSSE;
    let filled = 0;
    let ipIndex = 0;

    while (filled < totalNeeded) {
      const ip = `10.1.${ipIndex}.1`;
      const batch = Math.min(maxPerIP, totalNeeded - filled);
      for (let i = 0; i < batch; i++) {
        trackConnection(ip, 'sse', { id: filled });
        filled++;
      }
      ipIndex++;
    }

    expect(canOpenConnection('1.2.3.4', 'sse')).toBe(false);
  });
});

// ─── trackConnection ─────────────────────────────────────────────────────────

describe('trackConnection', () => {
  test('tracks a longPoll connection', () => {
    trackConnection(IP_A, 'longPoll');
    const stats = getConnectionStats();
    expect(stats.totalLongPoll).toBe(1);
  });

  test('tracks an SSE connection', () => {
    const res = { id: 'sse-1' };
    trackConnection(IP_A, 'sse', res);
    const stats = getConnectionStats();
    expect(stats.totalSSE).toBe(1);
  });

  test('accumulates multiple longPoll connections from same IP', () => {
    trackConnection(IP_A, 'longPoll');
    trackConnection(IP_A, 'longPoll');
    const stats = getConnectionStats();
    expect(stats.totalLongPoll).toBe(2);
  });

  test('tracks multiple SSE connections from different IPs', () => {
    trackConnection(IP_A, 'sse', { id: 1 });
    trackConnection(IP_B, 'sse', { id: 2 });
    const stats = getConnectionStats();
    expect(stats.totalSSE).toBe(2);
    expect(stats.uniqueIPs.sse).toBe(2);
  });

  test('tracks SSE connections per-IP in a Set (deduplicates same res)', () => {
    const res = { id: 'shared' };
    trackConnection(IP_A, 'sse', res);
    trackConnection(IP_A, 'sse', res);
    // Same res object added twice — Set deduplication
    const stats = getConnectionStats();
    expect(stats.totalSSE).toBe(2);
  });
});

// ─── untrackConnection ───────────────────────────────────────────────────────

describe('untrackConnection', () => {
  test('decrements longPoll count', () => {
    trackConnection(IP_A, 'longPoll');
    trackConnection(IP_A, 'longPoll');
    untrackConnection(IP_A, 'longPoll');
    expect(getConnectionStats().totalLongPoll).toBe(1);
  });

  test('removes IP entry when last longPoll connection removed', () => {
    trackConnection(IP_A, 'longPoll');
    untrackConnection(IP_A, 'longPoll');
    const stats = getConnectionStats();
    expect(stats.totalLongPoll).toBe(0);
    expect(stats.uniqueIPs.longPoll).toBe(0);
  });

  test('decrements SSE count when res removed', () => {
    const res1 = { id: 1 };
    const res2 = { id: 2 };
    trackConnection(IP_A, 'sse', res1);
    trackConnection(IP_A, 'sse', res2);
    untrackConnection(IP_A, 'sse', res1);
    expect(getConnectionStats().totalSSE).toBe(1);
  });

  test('removes IP entry when last SSE connection removed', () => {
    const res = { id: 1 };
    trackConnection(IP_A, 'sse', res);
    untrackConnection(IP_A, 'sse', res);
    const stats = getConnectionStats();
    expect(stats.totalSSE).toBe(0);
    expect(stats.uniqueIPs.sse).toBe(0);
  });

  test('does not go below 0 for totalLongPoll', () => {
    untrackConnection(IP_A, 'longPoll'); // Untrack without tracking
    expect(getConnectionStats().totalLongPoll).toBe(0);
  });

  test('does not throw when untracking unknown SSE IP', () => {
    const res = { id: 999 };
    expect(() => untrackConnection('unknown-ip', 'sse', res)).not.toThrow();
  });

  test('allows new connection after untracking from limit', () => {
    for (let i = 0; i < connectionLimits.maxPerIP; i++) {
      trackConnection(IP_A, 'longPoll');
    }
    expect(canOpenConnection(IP_A, 'longPoll')).toBe(false);

    untrackConnection(IP_A, 'longPoll');
    expect(canOpenConnection(IP_A, 'longPoll')).toBe(true);
  });
});

// ─── getConnectionStats ──────────────────────────────────────────────────────

describe('getConnectionStats', () => {
  test('returns expected shape on fresh state', () => {
    const stats = getConnectionStats();
    expect(stats.totalLongPoll).toBe(0);
    expect(stats.totalSSE).toBe(0);
    expect(stats.uniqueIPs.longPoll).toBe(0);
    expect(stats.uniqueIPs.sse).toBe(0);
    expect(stats.limits).toBeDefined();
  });

  test('limits in stats match connectionLimits', () => {
    const stats = getConnectionStats();
    expect(stats.limits.maxPerIP).toBe(connectionLimits.maxPerIP);
    expect(stats.limits.maxSSE).toBe(connectionLimits.maxSSE);
    expect(stats.limits.maxLongPoll).toBe(connectionLimits.maxLongPoll);
  });

  test('reflects tracking state accurately', () => {
    trackConnection(IP_A, 'longPoll');
    trackConnection(IP_B, 'longPoll');
    trackConnection(IP_C, 'sse', { id: 1 });

    const stats = getConnectionStats();
    expect(stats.totalLongPoll).toBe(2);
    expect(stats.totalSSE).toBe(1);
    expect(stats.uniqueIPs.longPoll).toBe(2);
    expect(stats.uniqueIPs.sse).toBe(1);
  });
});

// ─── resetConnections ────────────────────────────────────────────────────────

describe('resetConnections', () => {
  test('resets all state to zero', () => {
    trackConnection(IP_A, 'longPoll');
    trackConnection(IP_B, 'sse', { id: 1 });
    resetConnections();

    const stats = getConnectionStats();
    expect(stats.totalLongPoll).toBe(0);
    expect(stats.totalSSE).toBe(0);
    expect(stats.uniqueIPs.longPoll).toBe(0);
    expect(stats.uniqueIPs.sse).toBe(0);
  });

  test('allows connections again after reset from full state', () => {
    // Fill up one IP
    for (let i = 0; i < connectionLimits.maxPerIP; i++) {
      trackConnection(IP_A, 'longPoll');
    }
    expect(canOpenConnection(IP_A, 'longPoll')).toBe(false);

    resetConnections();
    expect(canOpenConnection(IP_A, 'longPoll')).toBe(true);
  });
});
