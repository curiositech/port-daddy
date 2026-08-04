import { describe, test, expect, afterEach } from '@jest/globals';
import { existsSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildDaemonProfileEnv,
  getDaemonProfilesRoot,
  installDaemonProfileCliShim,
  listDaemonProfiles,
  readDaemonProfileState,
  resolveActiveDaemonRuntimeDir,
  resolveDaemonProfile,
  writeDaemonProfileState,
} from '../../lib/daemon-profiles.js';

const tmpDirs = [];

function makeHome() {
  const dir = mkdtempSync(join(tmpdir(), 'pd-profile-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

describe('daemon profiles', () => {
  test('resolves named profile paths under the profiles root', () => {
    const homeDir = makeHome();
    const profile = resolveDaemonProfile('dev', { homeDir });

    expect(getDaemonProfilesRoot(homeDir)).toBe(join(homeDir, 'instances'));
    expect(profile.runtimeDir).toBe(join(homeDir, 'instances', 'dev'));
    expect(profile.dbPath).toBe(join(profile.runtimeDir, 'port-daddy.db'));
    expect(profile.sockPath).toBe(join(profile.runtimeDir, 'port-daddy.sock'));
    expect(profile.ipcPath).toBe(join(profile.runtimeDir, 'port-daddy.ipc'));
    expect(profile.portFile).toBe(join(profile.runtimeDir, 'daemon.port'));
    expect(profile.logFile).toBe(join(profile.runtimeDir, 'daemon.log'));
  });

  test('rejects reserved or unsafe profile names', () => {
    expect(() => resolveDaemonProfile('stable')).toThrow(/reserved/);
    expect(() => resolveDaemonProfile('canonical')).toThrow(/reserved/);
    expect(() => resolveDaemonProfile('../oops')).toThrow(/letters/);
    expect(() => resolveDaemonProfile('bad/name')).toThrow(/letters/);
  });

  test('builds an isolated child env by default', () => {
    const homeDir = makeHome();
    const profile = resolveDaemonProfile('dogfood', { homeDir });

    const env = buildDaemonProfileEnv(profile, {
      baseEnv: {
        PD_URL: 'http://old.example',
        PD_ACTIVE_DAEMON: 'old-berth',
        PORT_DADDY_URL: 'http://old.example',
        PORT_DADDY_DB: '/old/db.sqlite',
        PORT_DADDY_SOCK: '/old/daemon.sock',
        PORT_DADDY_PORT_FILE: '/old/daemon.port',
        PORT_DADDY_PORT: '9999',
        PORT_DADDY_PLANE: 'prod',
      },
      port: 9888,
    });

    expect(env.PD_URL).toBeUndefined();
    expect(env.PD_ACTIVE_DAEMON).toBe('dogfood');
    expect(env.PORT_DADDY_URL).toBe('http://127.0.0.1:9888');
    expect(env.PORT_DADDY_DB).toBeUndefined();
    expect(env.PORT_DADDY_SOCK).toBe(profile.sockPath);
    expect(env.PORT_DADDY_IPC).toBe(profile.ipcPath);
    expect(env.PORT_DADDY_PID_FILE).toBe(profile.pidFile);
    expect(env.PORT_DADDY_PORT_FILE).toBe(profile.portFile);
    expect(env.PORT_DADDY_HEARTBEAT_FILE).toBe(profile.heartbeatFile);
    // An inherited plane override must never leak into a child berth — it
    // would poison the new daemon's state-plane classification.
    expect(env.PORT_DADDY_PLANE).toBeUndefined();
    expect(env.PORT_DADDY_PROFILE).toBe('dogfood');
    expect(env.PORT_DADDY_PREFIX).toBe(profile.runtimeDir);
    expect(env.PORT_DADDY_PORT).toBe('9888');
    expect(env.PORT_DADDY_NO_FLEET).toBe('1');
    expect(env.PORT_DADDY_NO_FLEETBAR).toBe('1');
  });

  test('can opt a profile into fleet and FleetBar startup', () => {
    const homeDir = makeHome();
    const profile = resolveDaemonProfile('fleet-lab', { homeDir });
    const env = buildDaemonProfileEnv(profile, {
      baseEnv: {},
      enableFleet: true,
      enableFleetBar: true,
    });

    expect(env.PORT_DADDY_NO_FLEET).toBe('0');
    expect(env.PORT_DADDY_NO_FLEETBAR).toBe('0');
  });

  test('prepends a matching feature CLI shim for named-daemon children', () => {
    const homeDir = makeHome();
    const profile = resolveDaemonProfile('feature-cli', { homeDir });
    const cliBinary = join(homeDir, 'port-daddy');
    writeFileSync(cliBinary, '#!/bin/sh\n', { mode: 0o700 });
    const env = { PATH: '/opt/homebrew/bin' };

    const binDir = installDaemonProfileCliShim(profile, cliBinary, env, 'darwin');

    expect(env.PORT_DADDY_CLI).toBe(cliBinary);
    expect(env.PATH.split(':')[0]).toBe(binDir);
    expect(existsSync(join(binDir, 'pd'))).toBe(true);
    expect(readlinkSync(join(binDir, 'pd'))).toBe(cliBinary);
    expect(readlinkSync(join(binDir, 'port-daddy'))).toBe(cliBinary);
  });

  test('resolves client-selected runtime files without exporting a state prefix', () => {
    const homeDir = makeHome();
    const profile = resolveDaemonProfile('feature-branch', { homeDir });
    writeDaemonProfileState(profile, {
      name: profile.name,
      pid: 123,
      port: 9890,
      preferredPort: 9890,
      runtimeDir: profile.runtimeDir,
      socketPath: profile.sockPath,
      ipcPath: profile.ipcPath,
      dbPath: profile.dbPath,
      startedAt: null,
      cwd: null,
      fleetEnabled: false,
      fleetBarEnabled: false,
    });

    expect(resolveActiveDaemonRuntimeDir({ PD_ACTIVE_DAEMON: 'feature/branch' }, { homeDir }))
      .toBe(profile.runtimeDir);
    expect(resolveActiveDaemonRuntimeDir({ PORT_DADDY_PREFIX: '/explicit', PD_ACTIVE_DAEMON: 'feature/branch' }, { homeDir }))
      .toBe('/explicit');
    expect(resolveActiveDaemonRuntimeDir({ PD_ACTIVE_DAEMON: 'http://127.0.0.1:9999' }, { homeDir }))
      .toBeNull();
  });

  test('persists and lists profile state', () => {
    const homeDir = makeHome();
    const profile = resolveDaemonProfile('ui-lab', { homeDir });

    writeDaemonProfileState(profile, {
      name: profile.name,
      pid: 123,
      port: 9890,
      preferredPort: 9890,
      runtimeDir: profile.runtimeDir,
      socketPath: profile.sockPath,
      ipcPath: profile.ipcPath,
      dbPath: profile.dbPath,
      startedAt: '2026-04-27T00:00:00.000Z',
      cwd: '/tmp/project',
      fleetEnabled: false,
      fleetBarEnabled: false,
    });

    expect(readDaemonProfileState(profile)).toMatchObject({
      name: 'ui-lab',
      pid: 123,
      port: 9890,
      runtimeDir: profile.runtimeDir,
    });
    expect(listDaemonProfiles({ homeDir }).map((p) => p.name)).toEqual(['ui-lab']);
  });
});
