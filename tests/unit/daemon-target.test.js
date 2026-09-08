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
 *   2. PD_URL / PORT_DADDY_URL env -> explicit TCP URL
 *   3. the daemon's socket file exists -> Unix socket
 *   4. TCP from the selected daemon's published port file
 *   5. no publication -> fail closed (never guess the preferred port)
 *
 * env + fileExists are injectable so this is deterministic regardless of
 * whether a real ~/.port-daddy/daemon.sock happens to exist on the test box.
 */

import { describe, test, expect } from '@jest/globals';
import {
  DaemonEndpointDiscoveryError,
  discoverPublishedDaemonPort,
  getDaemonTcpUrl,
  resolveDaemonTarget,
  resolvePublishedDaemonUrl,
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

  test('2. PD_URL is a real transport alias and wins over PORT_DADDY_URL', () => {
    const t = resolveDaemonTarget(
      { PD_URL: ' http://remote-peer.example:4319 ', PORT_DADDY_URL: 'http://local.invalid:9876' },
      ALWAYS,
    );
    expect(t.host).toBe('remote-peer.example');
    expect(t.port).toBe(4319);
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
    const t = resolveDaemonTarget({}, ALWAYS, { socketPath: '/state/daemon.sock' });
    expect(t.socketPath).toBe('/state/daemon.sock');
  });

  test('4. no env, no socket file -> loopback TCP from the published port file', () => {
    const t = resolveDaemonTarget({}, NEVER, {
      portFile: '/state/daemon.port',
      readTextFile: () => '4312\n',
    });
    expect(t.socketPath).toBeUndefined();
    expect(t.host).toBe('127.0.0.1');
    expect(t.port).toBe(4312);
  });

  test('HTTP URL without explicit port uses port 80 and unsupported TLS fails closed', () => {
    const t = resolveDaemonTarget({ PORT_DADDY_URL: 'http://myhost' }, NEVER);
    expect(t.host).toBe('myhost');
    expect(t.port).toBe(80);
    expect(() => resolveDaemonTarget({ PORT_DADDY_URL: 'https://myhost' }, NEVER))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_DAEMON_URL' }));
  });

  test('no URL, socket, env port, or published port file fails closed', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    expect(() => resolveDaemonTarget({}, NEVER, {
      portFile: '/state/daemon.port',
      readTextFile: () => { throw missing; },
    })).toThrow(expect.objectContaining({ code: 'ENDPOINT_NOT_PUBLISHED' }));
  });
});

describe('published daemon endpoint discovery', () => {
  test('prefers an exact environment publication over the selected port file', () => {
    expect(discoverPublishedDaemonPort({
      env: { PORT_DADDY_PORT: '4317' },
      portFile: '/ignored',
      readTextFile: () => { throw new Error('must not read'); },
    })).toEqual({ port: 4317, source: 'env', portFile: null });
  });

  test.each(['not-a-port', '0', '65536', '4317junk'])
  ('fails closed on malformed environment publication %j without reading the port file', (raw) => {
    expect(() => discoverPublishedDaemonPort({
      env: { PORT_DADDY_PORT: raw },
      portFile: '/must-not-fallback',
      readTextFile: () => { throw new Error('must not read'); },
    })).toThrow(expect.objectContaining({ code: 'INVALID_PUBLISHED_PORT' }));
  });

  test('accepts one exact decimal port plus surrounding whitespace', () => {
    expect(discoverPublishedDaemonPort({
      env: {},
      portFile: '/state/daemon.port',
      readTextFile: () => ' 4318\n',
    })).toEqual({ port: 4318, source: 'port-file', portFile: '/state/daemon.port' });
  });

  test.each(['4318junk', '4318 4319', '0x10de', '0', '65536', ''])
  ('rejects malformed or out-of-range publication %j', (raw) => {
    expect(() => discoverPublishedDaemonPort({
      env: {},
      portFile: '/state/daemon.port',
      readTextFile: () => raw,
    })).toThrow(DaemonEndpointDiscoveryError);
  });

  test('returns null only when the selected port file is absent', () => {
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

  test('strict URL discovery fails closed instead of returning the preferred seed', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    expect(() => resolvePublishedDaemonUrl(undefined, {
      env: {},
      portFile: '/state/daemon.port',
      readTextFile: () => { throw missing; },
    })).toThrow(expect.objectContaining({ code: 'ENDPOINT_NOT_PUBLISHED' }));
  });

  test('legacy TCP URL helper is strict and uses only explicit or published endpoints', () => {
    expect(getDaemonTcpUrl('http://127.0.0.1:4319')).toBe('http://127.0.0.1:4319');
    expect(getDaemonTcpUrl(undefined, {
      env: {},
      portFile: '/state/daemon.port',
      readTextFile: () => '4320\n',
    })).toBe('http://127.0.0.1:4320');

    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    expect(getDaemonTcpUrl(undefined, {
      env: {},
      portFile: '/state/daemon.port',
      readTextFile: () => { throw missing; },
    })).toBe('');
  });
});
