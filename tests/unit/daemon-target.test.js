/**
 * Canonical daemon connection-target resolver.
 *
 * WHY: before this, THREE copies of socket-first resolution existed with THREE
 * different precedence orders — cli/utils/fetch.ts (URL before SOCK, and it
 * ignored PORT_DADDY_SOCK entirely), lib/request.ts (SOCK before URL), and
 * lib/client.ts (instance-based). `shared/daemon-discovery.ts` — the *named*
 * canonical helper — only did TCP and knew nothing about the Unix socket.
 *
 * `resolveDaemonTarget()` is now the ONE place that decides socket-vs-TCP.
 * Precedence (pinned here and matching the long-standing lib/request.test.js):
 *   0. PORT_DADDY_FORCE_TCP=1 -> loopback TCP, bypassing Unix socket
 *   1. PORT_DADDY_SOCK env    -> explicit Unix socket
 *   2. PORT_DADDY_URL env     -> explicit TCP URL
 *   3. the daemon's socket file exists -> Unix socket
 *   4. TCP from the port file (or the canonical preferred port)
 *
 * env + fileExists are injectable so this is deterministic regardless of
 * whether a real ~/.port-daddy/daemon.sock happens to exist on the test box.
 */

import { describe, test, expect } from '@jest/globals';
import { resolveDaemonTarget } from '../../shared/daemon-discovery.js';

const NEVER = () => false;
const ALWAYS = () => true;

describe('resolveDaemonTarget (the one canonical resolver)', () => {
  test('0. PORT_DADDY_FORCE_TCP bypasses socket env and socket files', () => {
    const t = resolveDaemonTarget(
      {
        PORT_DADDY_FORCE_TCP: '1',
        PORT_DADDY_SOCK: '/run/pd-custom.sock',
        PORT_DADDY_URL: 'http://127.0.0.1:4321',
      },
      ALWAYS,
    );
    expect(t.socketPath).toBeUndefined();
    expect(t.host).toBe('127.0.0.1');
    expect(t.port).toBe(4321);
  });

  test('1. PORT_DADDY_SOCK env -> explicit socket', () => {
    const t = resolveDaemonTarget({ PORT_DADDY_SOCK: '/run/pd-custom.sock' }, NEVER);
    expect(t.socketPath).toBe('/run/pd-custom.sock');
    expect(t.host).toBeUndefined();
    expect(t.port).toBeUndefined();
  });

  test('2. PORT_DADDY_URL env -> TCP target parsed from the URL', () => {
    const t = resolveDaemonTarget({ PORT_DADDY_URL: 'http://192.168.1.5:3001' }, NEVER);
    expect(t.host).toBe('192.168.1.5');
    expect(t.port).toBe(3001);
    expect(t.socketPath).toBeUndefined();
  });

  test('SOCK takes priority over URL when both are set (matches request.test.js)', () => {
    const t = resolveDaemonTarget(
      { PORT_DADDY_SOCK: '/run/a.sock', PORT_DADDY_URL: 'http://h:9999' },
      ALWAYS,
    );
    expect(t.socketPath).toBe('/run/a.sock');
  });

  test('3. no env, socket file present -> Unix socket', () => {
    const t = resolveDaemonTarget({}, ALWAYS);
    expect(t.socketPath).toBeTruthy();
    expect(t.socketPath).toMatch(/daemon\.sock$/);
  });

  test('4. no env, no socket file -> loopback TCP from the port file', () => {
    const t = resolveDaemonTarget({}, NEVER);
    expect(t.socketPath).toBeUndefined();
    expect(t.host).toBe('127.0.0.1');
    expect(typeof t.port).toBe('number');
    expect(t.port).toBeGreaterThanOrEqual(1024);
  });

  test('URL without explicit port preserves normal HTTP URL semantics', () => {
    const t = resolveDaemonTarget({ PORT_DADDY_URL: 'http://myhost' }, NEVER);
    expect(t.host).toBe('myhost');
    expect(t.port).toBe(80);
  });

  test('injected PORT_DADDY_PORT is honored when TCP discovery is forced', () => {
    const t = resolveDaemonTarget({
      PORT_DADDY_FORCE_TCP: '1',
      PORT_DADDY_PORT: '4322',
    }, ALWAYS);
    expect(t).toEqual({ host: '127.0.0.1', port: 4322 });
  });

  test('defaults to process.env + real existsSync when called with no args', () => {
    // Just assert it returns a structurally valid target — no throw, one transport.
    const t = resolveDaemonTarget();
    const isSocket = typeof t.socketPath === 'string';
    const isTcp = typeof t.host === 'string' && typeof t.port === 'number';
    expect(isSocket || isTcp).toBe(true);
    expect(isSocket && isTcp).toBe(false);
  });
});
