import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BOSUN_HEARTBEAT_SCHEMA,
  createBosunHeartbeat,
  readBosunHeartbeat,
} from '../../lib/bosun-heartbeat.js';

const tmpRoots = [];

function tmpHeartbeatPath() {
  const root = mkdtempSync(join(tmpdir(), 'pd-bosun-heartbeat-'));
  tmpRoots.push(root);
  return join(root, 'heartbeat');
}

function createWriter(overrides = {}) {
  return createBosunHeartbeat({
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

describe('Bosun heartbeat writer', () => {
  test('writeOnce writes an atomic V1 heartbeat payload', () => {
    const heartbeatPath = tmpHeartbeatPath();
    const writer = createWriter({ heartbeatPath });

    const payload = writer.writeOnce();
    const raw = JSON.parse(readFileSync(heartbeatPath, 'utf8'));

    expect(payload).toEqual(expect.objectContaining({
      schema: BOSUN_HEARTBEAT_SCHEMA,
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

  test('readBosunHeartbeat returns parsed V1 payloads and rejects missing files', () => {
    const heartbeatPath = tmpHeartbeatPath();
    const writer = createWriter({ heartbeatPath });

    expect(readBosunHeartbeat(heartbeatPath)).toBeNull();
    const payload = writer.writeOnce();

    expect(readBosunHeartbeat(heartbeatPath)).toEqual(payload);
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
    expect(warnings.map((w) => w.msg)).toContain('bosun_heartbeat_displaced');
    expect(infos.map((i) => i.msg)).toContain('bosun_heartbeat_self_stop');

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
