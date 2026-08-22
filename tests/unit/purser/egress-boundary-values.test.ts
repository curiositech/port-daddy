// tests/unit/purser/egress-boundary-values.test.ts
import { describe, test, expect } from '@jest/globals';

/**
 * The same loopback detection logic as used by the integration test
 * (see tests/integration/egress-local-only.integration.test.js).
 * This is a pure helper that decides whether a recorded socket
 * connection target should be considered "loopback" (i.e. allowed).
 */
function isLoopbackTarget(entry: {
  host?: string | null;
  port?: number;
  path?: string;
}): boolean {
  // Unix domain sockets are always safe.
  if (entry.path) return true;

  const host = entry.host;
  // No host => defaults to localhost.
  if (host === undefined || host === null) return true;

  const LOOPBACK_HOSTS = new Set([
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'localhost',
    '0.0.0.0',
    '::',
    '',
  ]);

  return LOOPBACK_HOSTS.has(String(host));
}

describe('egress boundary values – loopback detection', () => {
  const testCases: Array<{
    name: string;
    entry: { host?: string | null; port?: number; path?: string };
    expected: boolean;
  }> = [
    {
      name: 'IPv4 loopback 127.0.0.1',
      entry: { host: '127.0.0.1', port: 80 },
      expected: true,
    },
    {
      name: 'IPv6 loopback ::1',
      entry: { host: '::1', port: 443 },
      expected: true,
    },
    {
      name: 'IPv4 unspecified 0.0.0.0',
      entry: { host: '0.0.0.0', port: 8080 },
      expected: true,
    },
    {
      name: 'IPv6 unspecified ::',
      entry: { host: '::', port: 22 },
      expected: true,
    },
    {
      name: 'IPv4 mapped IPv6 ::ffff:127.0.0.1',
      entry: { host: '::ffff:127.0.0.1', port: 8443 },
      expected: true,
    },
    {
      name: 'Hostname localhost',
      entry: { host: 'localhost', port: 3000 },
      expected: true,
    },
    {
      name: 'Empty host string',
      entry: { host: '', port: 5000 },
      expected: true,
    },
    {
      name: 'Undefined host (defaults to localhost)',
      entry: { port: 4000 },
      expected: true,
    },
    {
      name: 'Null host (treated as localhost)',
      entry: { host: null, port: 4000 },
      expected: true,
    },
    {
      name: 'Unix socket path only',
      entry: { path: '/tmp/port-daddy.sock' },
      expected: true,
    },
    {
      name: 'Non-loopback host example.com',
      entry: { host: 'example.com', port: 80 },
      expected: false,
    },
    {
      name: 'Non-loopback IP 192.0.2.1 (TEST-NET-1)',
      entry: { host: '192.0.2.1', port: 9 },
      expected: false,
    },
    {
      name: 'Port 0 on loopback 127.0.0.1',
      entry: { host: '127.0.0.1', port: 0 },
      expected: true,
    },
    {
      name: 'Port 0 on non-loopback 192.0.2.1',
      entry: { host: '192.0.2.1', port: 0 },
      expected: false,
    },
  ];

  testCases.forEach(({ name, entry, expected }) => {
    test(name, () => {
      const result = isLoopbackTarget(entry);
      expect(result).toBe(expected);
    });
  });
});