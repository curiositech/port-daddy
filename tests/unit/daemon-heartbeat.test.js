import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DAEMON_HEARTBEAT_SCHEMA,
  createDaemonHeartbeat,
  createSocketHealthProbe,
  readDaemonHeartbeat,
} from '../../lib/daemon-heartbeat.js';

const tmpRoots = [];

function tmpHeartbeatPath() {
  const root = mkdtempSync(join(tmpdir(), 'pd-daemon-heartbeat-'));
  tmpRoots.push(root);
  return join(root, 'heartbeat');
}

function createWriter(overrides = {}) {
  return createDaemonHeartbeat({
    heartbeatPath: tmpHeartbeatPath(),
    intervalMs: 50,
    version: '9.9.9-test',
    codeHash: 'hash-test',
    startedAt: 1_700_000_000_000,
    installDir: '/repo/port-daddy',
    pidFile: '/runtime/daemon.pid',
    portFile: '/runtime/daemon.port',
    pid: 4242,
    now: () => 1_700_000_005_000,
    uptimeMs: () => 5_000,
    ...overrides,
  });
}

afterEach(() => {
  jest.useRealTimers();
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('daemon heartbeat writer', () => {
  test('writeOnce writes an atomic V1 heartbeat payload', () => {
    const heartbeatPath = tmpHeartbeatPath();
    const writer = createWriter({ heartbeatPath });

    const payload = writer.writeOnce();
    const raw = JSON.parse(readFileSync(heartbeatPath, 'utf8'));

    expect(payload).toEqual(expect.objectContaining({
      schema: DAEMON_HEARTBEAT_SCHEMA,
      pid: 4242,
      writtenAt: 1_700_000_005_000,
      uptimeMs: 5_000,
      version: '9.9.9-test',
      codeHash: 'hash-test',
      startedAt: 1_700_000_000_000,
      installDir: '/repo/port-daddy',
      pidFile: '/runtime/daemon.pid',
      portFile: '/runtime/daemon.port',
    }));
    expect(raw).toEqual(payload);
    expect(writer.getStatus()).toEqual(expect.objectContaining({
      enabled: true,
      state: 'healthy',
      heartbeatPath,
      lastWrittenAt: 1_700_000_005_000,
      lastError: null,
      writeCount: 1,
      ownerPid: null,
    }));
  });

  test('writeOnce carries the state plane into the heartbeat file when configured (S1)', () => {
    const heartbeatPath = tmpHeartbeatPath();
    const writer = createWriter({ heartbeatPath, plane: 'dev-latest' });
    const payload = writer.writeOnce();
    const raw = JSON.parse(readFileSync(heartbeatPath, 'utf8'));
    expect(payload.plane).toBe('dev-latest');
    expect(raw.plane).toBe('dev-latest');
  });

  test('writeOnce omits plane when none configured (legacy payload shape)', () => {
    const heartbeatPath = tmpHeartbeatPath();
    const writer = createWriter({ heartbeatPath });
    writer.writeOnce();
    const raw = JSON.parse(readFileSync(heartbeatPath, 'utf8'));
    expect('plane' in raw).toBe(false);
  });

  test('readDaemonHeartbeat returns parsed V1 payloads and rejects missing files', () => {
    const heartbeatPath = tmpHeartbeatPath();
    const writer = createWriter({ heartbeatPath });

    expect(readDaemonHeartbeat(heartbeatPath)).toBeNull();
    const payload = writer.writeOnce();

    expect(readDaemonHeartbeat(heartbeatPath)).toEqual(payload);
  });

  test('start writes immediately, repeats on the interval, and stops cleanly', () => {
    jest.useFakeTimers();
    let now = 1_700_000_005_000;
    const writer = createWriter({
      now: () => now,
      uptimeMs: () => now - 1_700_000_000_000,
    });

    writer.start();
    expect(writer.getStatus().writeCount).toBe(1);

    now += 50;
    jest.advanceTimersByTime(50);
    expect(writer.getStatus()).toEqual(expect.objectContaining({
      state: 'healthy',
      lastWrittenAt: 1_700_000_005_050,
      writeCount: 2,
    }));

    writer.stop();
    now += 50;
    jest.advanceTimersByTime(50);
    expect(writer.getStatus()).toEqual(expect.objectContaining({
      enabled: false,
      state: 'stopped',
      writeCount: 2,
    }));
  });

  test('bootstrap heartbeat advances before the request probe is armed', async () => {
    jest.useFakeTimers();
    const selfProbe = jest.fn(() => true);
    const writer = createWriter({
      selfProbe,
      deferSelfProbeUntilReady: true,
    });

    writer.start();
    jest.advanceTimersByTime(150);

    expect(selfProbe).not.toHaveBeenCalled();
    expect(writer.getStatus().writeCount).toBe(4);

    writer.startProbing();
    await Promise.resolve();
    expect(selfProbe).toHaveBeenCalledTimes(1);
    writer.stop();
  });

  test('canonical guard refuses to overwrite a heartbeat from a foreign daemon', () => {
    const heartbeatPath = tmpHeartbeatPath();
    const pidFile = join(heartbeatPath, '..', 'daemon.pid');
    writeFileSync(pidFile, '9999\n');
    const writer = createWriter({
      heartbeatPath,
      pidFile,
      pid: 4242,
      requirePidFileMatch: true,
    });

    expect(() => writer.writeOnce()).toThrow(/belongs to 9999, not heartbeat pid 4242/);
    expect(writer.getStatus()).toEqual(expect.objectContaining({
      enabled: true,
      state: 'displaced',
      ownerPid: 9999,
      writeCount: 0,
    }));
  });

  test('a missing pid file is treated as transient and stays degraded', () => {
    // No pid file written — readPidFileOwner returns null.
    const writer = createWriter({
      pidFile: join(tmpHeartbeatPath(), '..', 'daemon.pid.missing'),
      pid: 4242,
      requirePidFileMatch: true,
    });

    expect(() => writer.writeOnce()).toThrow(/belongs to nobody, not heartbeat pid 4242/);
    expect(writer.getStatus()).toEqual(expect.objectContaining({
      state: 'degraded',
      ownerPid: null,
    }));
  });

  test('start self-stops the interval once a foreign daemon takes the pid file', () => {
    jest.useFakeTimers();
    const heartbeatPath = tmpHeartbeatPath();
    const pidFile = join(heartbeatPath, '..', 'daemon.pid');
    writeFileSync(pidFile, '4242\n');
    const warnings = [];
    const infos = [];
    const errors = [];
    const writer = createWriter({
      heartbeatPath,
      pidFile,
      pid: 4242,
      requirePidFileMatch: true,
      logger: {
        info: (msg, meta) => infos.push({ msg, meta }),
        warn: (msg, meta) => warnings.push({ msg, meta }),
        error: (msg, meta) => errors.push({ msg, meta }),
      },
    });

    writer.start();
    expect(writer.getStatus().state).toBe('healthy');

    // Another daemon takes the canonical pid file.
    writeFileSync(pidFile, '9999\n');

    // Next interval tick: writeOnce throws displaced, the interval logs once
    // and self-stops. Subsequent ticks must not produce new errors.
    jest.advanceTimersByTime(50);
    expect(writer.getStatus()).toEqual(expect.objectContaining({
      enabled: false,
      state: 'displaced',
      ownerPid: 9999,
    }));
    expect(warnings.map((w) => w.msg)).toContain('daemon_heartbeat_displaced');
    expect(infos.map((i) => i.msg)).toContain('daemon_heartbeat_self_stop');

    // Drain another second of ticks; nothing else should fire.
    const errorCountBefore = errors.length;
    const warnCountBefore = warnings.length;
    jest.advanceTimersByTime(1000);
    expect(errors.length).toBe(errorCountBefore);
    expect(warnings.length).toBe(warnCountBefore);
    expect(writer.getStatus().state).toBe('displaced');
  });

  test('canonical guard writes after the pid file names the current daemon', () => {
    const heartbeatPath = tmpHeartbeatPath();
    const pidFile = join(heartbeatPath, '..', 'daemon.pid');
    writeFileSync(pidFile, '4242\n');
    const writer = createWriter({
      heartbeatPath,
      pidFile,
      pid: 4242,
      requirePidFileMatch: true,
    });

    writer.writeOnce();

    expect(writer.getStatus()).toEqual(expect.objectContaining({
      state: 'healthy',
      ownerPid: 4242,
      writeCount: 1,
    }));
  });
});

describe('daemon heartbeat HTTP self-probe (wedge detection)', () => {
  test('no selfProbe configured: heartbeat never halts (back-compat)', () => {
    const writer = createWriter();
    // Even if the counter were somehow non-zero, shouldHalt is gated on a
    // configured probe, so the tick always writes.
    writer.recordProbeResult(false);
    writer.recordProbeResult(false);
    writer.recordProbeResult(false);
    writer.heartbeatTick();
    expect(writer.getStatus()).toEqual(expect.objectContaining({
      state: 'healthy',
      writeCount: 1,
    }));
  });

  test('probe failures below threshold are tolerated (still writes)', () => {
    const writer = createWriter({ selfProbe: () => false, probeFailureThreshold: 3 });
    writer.recordProbeResult(false);
    writer.recordProbeResult(false); // 2 < 3
    writer.heartbeatTick();
    expect(writer.getStatus()).toEqual(expect.objectContaining({
      state: 'healthy',
      writeCount: 1,
      consecutiveProbeFailures: 2,
    }));
  });

  test('probe failures at threshold halt the heartbeat (wedged)', () => {
    const errors = [];
    const writer = createWriter({
      selfProbe: () => false,
      probeFailureThreshold: 3,
      logger: { error: (msg, meta) => errors.push({ msg, meta }) },
    });

    // Prime a healthy write so writeCount is observable.
    writer.heartbeatTick();
    expect(writer.getStatus().writeCount).toBe(1);

    writer.recordProbeResult(false);
    writer.recordProbeResult(false);
    writer.recordProbeResult(false); // 3 >= 3 -> wedged

    writer.heartbeatTick();
    writer.heartbeatTick(); // idempotent: logs once, never advances
    const status = writer.getStatus();
    expect(status.state).toBe('wedged');
    expect(status.writeCount).toBe(1); // heartbeat frozen -> diagnostics expose the wedge
    expect(status.lastProbeOk).toBe(false);
    expect(errors.filter((e) => e.msg === 'daemon_heartbeat_wedged')).toHaveLength(1);
  });

  test('a recovered probe resumes the heartbeat and self-heals to healthy', () => {
    const writer = createWriter({ selfProbe: () => true, probeFailureThreshold: 2 });
    writer.recordProbeResult(false);
    writer.recordProbeResult(false); // wedged
    writer.heartbeatTick();
    expect(writer.getStatus().state).toBe('wedged');
    expect(writer.getStatus().writeCount).toBe(0);

    writer.recordProbeResult(true); // probe recovers -> counter resets
    writer.heartbeatTick();
    expect(writer.getStatus()).toEqual(expect.objectContaining({
      state: 'healthy',
      writeCount: 1,
      consecutiveProbeFailures: 0,
    }));
  });

  test('probeNow folds an async probe result into the failure counter', async () => {
    let alive = false;
    const writer = createWriter({ selfProbe: async () => alive, probeFailureThreshold: 2 });

    expect(await writer.probeNow()).toBe(false);
    expect(await writer.probeNow()).toBe(false);
    expect(writer.getStatus().consecutiveProbeFailures).toBe(2);

    alive = true;
    expect(await writer.probeNow()).toBe(true);
    expect(writer.getStatus()).toEqual(expect.objectContaining({
      consecutiveProbeFailures: 0,
      lastProbeOk: true,
    }));
  });

  test('a throwing probe counts as a failure', async () => {
    const writer = createWriter({
      selfProbe: () => {
        throw new Error('connection refused');
      },
    });
    expect(await writer.probeNow()).toBe(false);
    expect(writer.getStatus().consecutiveProbeFailures).toBe(1);
  });
});

describe('createSocketHealthProbe', () => {
  const servers = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
    );
  });

  function listenOnSocket(handler) {
    const socketPath = join(mkdtempSync(join(tmpdir(), 'pd-probe-')), 'daemon.sock');
    const server = http.createServer(handler);
    servers.push(server);
    return new Promise((resolve) => server.listen(socketPath, () => resolve(socketPath)));
  }

  test('returns true when the socket answers any HTTP response', async () => {
    const socketPath = await listenOnSocket((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    const probe = createSocketHealthProbe({ socketPath });
    expect(await probe()).toBe(true);
  });

  test('counts a 5xx response as alive (pipeline answered)', async () => {
    const socketPath = await listenOnSocket((_req, res) => {
      res.writeHead(503);
      res.end('degraded');
    });
    const probe = createSocketHealthProbe({ socketPath });
    expect(await probe()).toBe(true);
  });

  test('returns false when the socket does not exist (refused/hang-up)', async () => {
    const socketPath = join(mkdtempSync(join(tmpdir(), 'pd-probe-')), 'missing.sock');
    const probe = createSocketHealthProbe({ socketPath, timeoutMs: 200 });
    expect(await probe()).toBe(false);
  });

  test('returns false when the request exceeds the timeout (wedged)', async () => {
    const socketPath = await listenOnSocket(() => {
      // Never respond — simulate a wedged request pipeline.
    });
    const probe = createSocketHealthProbe({ socketPath, timeoutMs: 150 });
    expect(await probe()).toBe(false);
  });
});
