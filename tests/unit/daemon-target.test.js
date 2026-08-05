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
 *   4. TCP from the selected daemon's published port file
 *   5. no publication -> fail closed (never guess the preferred seed)
 *
 * env + fileExists are injectable so this is deterministic regardless of
 * whether a real ~/.port-daddy/daemon.sock happens to exist on the test box.
 */

import { describe, test, expect } from '@jest/globals';
import {
  DaemonEndpointDiscoveryError,
  discoverPublishedDaemonPort,
  resolveDaemonPort,
  resolveDaemonUrl,
  resolvePublishedDaemonUrl,
  resolveDaemonTarget,
  PREFERRED_DAEMON_PORT,
} from '../../shared/daemon-discovery.js';

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

  test('4. no env, no socket file -> loopback TCP from the published port file', () => {
    const t = resolveDaemonTarget({}, NEVER, { readTextFile: () => '4312\n', portFile: '/state/daemon.port' });
    expect(t.socketPath).toBeUndefined();
    expect(t.host).toBe('127.0.0.1');
    expect(t.port).toBe(4312);
  });

  test('URL without explicit port honors the protocol default instead of guessing the preferred daemon seed', () => {
    const t = resolveDaemonTarget({ PORT_DADDY_URL: 'http://myhost' }, NEVER);
    expect(t.host).toBe('myhost');
    expect(t.port).toBe(80);
    const secure = resolveDaemonTarget({ PORT_DADDY_URL: 'https://myhost' }, NEVER);
    expect(secure.port).toBe(443);
  });

  test('URL with explicit privileged ports 80/443 are accepted (regression: Copilot discussion_r3721781527)', () => {
    const http80 = resolveDaemonTarget({ PORT_DADDY_URL: 'http://example.com:80' }, NEVER);
    expect(http80.port).toBe(80);
    const https443 = resolveDaemonTarget({ PORT_DADDY_URL: 'https://example.com:443' }, NEVER);
    expect(https443.port).toBe(443);
  });

  test('no URL, socket, env port, or published port file fails closed', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    expect(() => resolveDaemonTarget({}, NEVER, { readTextFile: () => { throw missing; } })).toThrow(
      expect.objectContaining({ code: 'ENDPOINT_NOT_PUBLISHED' }),
    );
  });

  test('defaults to process.env when called with no args', () => {
    const previousForceTcp = process.env.PORT_DADDY_FORCE_TCP;
    const previousSocket = process.env.PORT_DADDY_SOCK;
    try {
      delete process.env.PORT_DADDY_FORCE_TCP;
      process.env.PORT_DADDY_SOCK = '/run/pd-default-arguments.sock';

      expect(resolveDaemonTarget()).toEqual({ socketPath: '/run/pd-default-arguments.sock' });
    } finally {
      if (previousForceTcp === undefined) delete process.env.PORT_DADDY_FORCE_TCP;
      else process.env.PORT_DADDY_FORCE_TCP = previousForceTcp;
      if (previousSocket === undefined) delete process.env.PORT_DADDY_SOCK;
      else process.env.PORT_DADDY_SOCK = previousSocket;
    }
  });
});

describe('discoverPublishedDaemonPort', () => {
  test('prefers an exact PORT_DADDY_PORT publication over the port file', () => {
    expect(discoverPublishedDaemonPort({
      env: { PORT_DADDY_PORT: '4317' },
      portFile: '/ignored',
      readTextFile: () => { throw new Error('must not read'); },
    })).toEqual({ port: 4317, source: 'env', portFile: null });
  });

  test('accepts one exact decimal port plus surrounding file whitespace', () => {
    expect(discoverPublishedDaemonPort({
      env: {},
      portFile: '/state/daemon.port',
      readTextFile: () => '  4318\n',
    })).toEqual({ port: 4318, source: 'port-file', portFile: '/state/daemon.port' });
  });

  test.each(['4318junk', '4318 4319', '0x10de', '80', '65536', ''])('rejects malformed or out-of-range publication %j', (raw) => {
    expect(() => discoverPublishedDaemonPort({
      env: {},
      portFile: '/state/daemon.port',
      readTextFile: () => raw,
    })).toThrow(DaemonEndpointDiscoveryError);
  });

  test('returns null only when the port file is genuinely absent', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    expect(discoverPublishedDaemonPort({
      env: {},
      portFile: '/state/daemon.port',
      readTextFile: () => { throw missing; },
    })).toBeNull();
  });

  test('does not disguise unreadable state as an absent endpoint', () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
    expect(() => discoverPublishedDaemonPort({
      env: {},
      portFile: '/state/daemon.port',
      readTextFile: () => { throw denied; },
    })).toThrow(expect.objectContaining({ code: 'INVALID_PUBLISHED_PORT' }));
  });
});

describe('strict URL publication versus the deprecated compatibility alias', () => {
  test('strict URL discovery fails closed while the legacy alias temporarily retains its seed fallback', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const options = { env: {}, portFile: '/state/daemon.port', readTextFile: () => { throw missing; } };

    expect(() => resolvePublishedDaemonUrl(undefined, options)).toThrow(
      expect.objectContaining({ code: 'ENDPOINT_NOT_PUBLISHED' }),
    );
    expect(resolveDaemonUrl(undefined, options)).toMatch(/^http:\/\/127\.0\.0\.1:[0-9]+$/);
  });
});

describe('resolveDaemonPort (deprecated alias) stays forgiving like resolveDaemonUrl', () => {
  test('malformed PORT_DADDY_PORT falls back to the preferred seed instead of throwing', () => {
    const saved = process.env.PORT_DADDY_PORT;
    process.env.PORT_DADDY_PORT = 'not-a-port';
    try {
      expect(resolveDaemonPort()).toBe(PREFERRED_DAEMON_PORT);
    } finally {
      if (saved === undefined) delete process.env.PORT_DADDY_PORT;
      else process.env.PORT_DADDY_PORT = saved;
    }
  });

  test('out-of-range PORT_DADDY_PORT falls back to the preferred seed instead of throwing', () => {
    const saved = process.env.PORT_DADDY_PORT;
    process.env.PORT_DADDY_PORT = '70000';
    try {
      expect(resolveDaemonPort()).toBe(PREFERRED_DAEMON_PORT);
    } finally {
      if (saved === undefined) delete process.env.PORT_DADDY_PORT;
      else process.env.PORT_DADDY_PORT = saved;
    }
  });
});
