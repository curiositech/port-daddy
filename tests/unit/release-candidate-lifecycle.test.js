import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  closeServerBoundedly,
  prepareOwnedPrivateDirectory,
  prepareReleaseCandidateRunDirectories,
  secretFreeBaseEnv,
  waitForChildExit,
} from '../../scripts/lib/release-candidate-e2e.mjs';

describe('release-candidate process lifecycle', () => {
  test('private runtime fixtures are created at 0700 and repair harness-owned permissive modes', () => {
    const base = join(homedir(), 'coding', 'tmp');
    mkdirSync(base, { recursive: true });
    const fixture = mkdtempSync(join(base, 'pd-rc-private-dir-test-'));
    const fresh = join(fixture, 'fresh', 'pd-home');
    const permissive = join(fixture, 'permissive');
    try {
      expect(prepareOwnedPrivateDirectory(fresh)).toBe(fresh);
      expect(statSync(fresh).mode & 0o777).toBe(0o700);

      mkdirSync(permissive, { mode: 0o755 });
      chmodSync(permissive, 0o755);
      expect(statSync(permissive).mode & 0o777).toBe(0o755);
      prepareOwnedPrivateDirectory(permissive);
      expect(statSync(permissive).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('every inherited release-candidate directory exists privately before a shard starts', () => {
    const base = join(homedir(), 'coding', 'tmp');
    mkdirSync(base, { recursive: true });
    const fixture = mkdtempSync(join(base, 'pd-rc-run-dirs-test-'));
    try {
      expect(prepareReleaseCandidateRunDirectories(fixture)).toBe(fixture);
      for (const name of ['build-home', 'build-scratch', 'control', 'tmp']) {
        expect(statSync(join(fixture, name)).isDirectory()).toBe(true);
        expect(statSync(join(fixture, name)).mode & 0o777).toBe(0o700);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('child-exit proof settles for fast failures and remains readable after close', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(7)'], {
      stdio: 'ignore',
      env: secretFreeBaseEnv(),
    });
    await expect(waitForChildExit(child, 2_000)).resolves.toMatchObject({ code: 7, signal: null });
  });

  test('bounded server cleanup rejects instead of leaving the suite await unsettled', async () => {
    const neverCloses = { close() {} };
    await expect(closeServerBoundedly(neverCloses, 100, 'stuck fixture')).rejects.toThrow(
      /stuck fixture did not close within 100ms/,
    );
  });

  test('bounded server cleanup preserves callback and synchronous close errors', async () => {
    const callbackError = new Error('callback close failed');
    const callbackFailure = {
      close(callback) {
        callback(callbackError);
      },
    };
    await expect(closeServerBoundedly(callbackFailure, 1_000, 'callback fixture')).rejects.toThrow(
      /callback close failed/,
    );

    const synchronousFailure = {
      close() {
        throw new Error('synchronous close failed');
      },
    };
    await expect(closeServerBoundedly(synchronousFailure, 1_000, 'synchronous fixture')).rejects.toThrow(
      /synchronous close failed/,
    );
  });

  test('bounded fixture cleanup destroys tracked accepted sockets before closing the listener', async () => {
    const sockets = new Set();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    expect(typeof address).toBe('object');
    const client = createConnection(address.port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('error', reject);
    });
    expect(sockets.size).toBe(1);
    const clientClosed = new Promise((resolve) => client.once('close', resolve));
    await expect(closeServerBoundedly(server, 1_000, 'tracked fixture', sockets)).resolves.toBeUndefined();
    await clientClosed;
    expect(sockets.size).toBe(0);
    expect(client.destroyed).toBe(true);
  });
});
