/**
 * Unit tests for lib/binary-drift-detector.ts
 *
 * Verifies that the daemon can detect when its in-memory binary has drifted
 * from the canonical on-disk pd binary (the brew-upgrade scenario).
 */

import { mkdtempSync, writeFileSync, rmSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectDrift,
  resolveOnDiskPdPath,
  snapshotRunningBinary,
} from '../../lib/binary-drift-detector.js';

describe('binary-drift-detector', () => {
  let tmpRoot;

  beforeEach(() => {
    // ~/coding/tmp is the only durable scratch surface; the global tmpdir on
    // macOS is /var/folders/... which is ALSO machine-managed. For unit tests
    // it's fine because they clean up after themselves; if a test crashes,
    // afterEach still wipes the dir.
    tmpRoot = mkdtempSync(join(tmpdir(), 'pd-drift-test-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('snapshotRunningBinary', () => {
    test('hashes a real binary file once at startup', () => {
      const path = join(tmpRoot, 'fake-pd');
      writeFileSync(path, 'fake binary v3.14.1 contents\n');
      chmodSync(path, 0o755);

      const snap = snapshotRunningBinary(path);

      // On macOS, /var/folders/... realpath-resolves to /private/var/folders/...
      // The detector normalizes both sides via realpathSync so the comparison is symlink-stable.
      expect(snap.runningPath).toBe(realpathSync(path));
      expect(snap.runningHash).toMatch(/^[0-9a-f]{64}$/);
      expect(snap.runningSizeBytes).toBe('fake binary v3.14.1 contents\n'.length);
    });

    test('returns null hash when the path does not exist', () => {
      const snap = snapshotRunningBinary(join(tmpRoot, 'does-not-exist'));
      expect(snap.runningHash).toBeNull();
      expect(snap.runningSizeBytes).toBeNull();
    });

    test('snapshot survives the file being mutated after startup', () => {
      const path = join(tmpRoot, 'fake-pd');
      writeFileSync(path, 'v3.14.1\n');
      const snap = snapshotRunningBinary(path);
      const hashBefore = snap.runningHash;

      // Simulate brew upgrade: overwrite the file.
      writeFileSync(path, 'v3.15.0\n');

      // The cached snapshot must NOT have changed; that's the whole point.
      expect(snap.runningHash).toBe(hashBefore);
    });
  });

  describe('detectDrift', () => {
    test('reports no drift when running and on-disk hashes match', () => {
      const path = join(tmpRoot, 'pd');
      writeFileSync(path, 'identical contents\n');
      const snap = snapshotRunningBinary(path);

      const drift = detectDrift({
        runningSnapshot: snap,
        resolveOnDisk: () => path,
      });

      expect(drift.drifted).toBe(false);
      expect(drift.reason).toMatch(/matches comparable on-disk/);
      expect(drift.onDiskHash).toBe(snap.runningHash);
    });

    test('reports drift when on-disk binary has been replaced (brew upgrade)', () => {
      const path = join(tmpRoot, 'pd');
      writeFileSync(path, 'v3.14.1 contents\n');
      const snap = snapshotRunningBinary(path);

      // brew upgrade swaps the file underneath us.
      writeFileSync(path, 'v3.15.0 contents — fleet-ui assets embedded\n');

      const drift = detectDrift({
        runningSnapshot: snap,
        resolveOnDisk: () => path,
      });

      expect(drift.drifted).toBe(true);
      expect(drift.reason).toMatch(/Restart required: pd stop && pd start/);
      expect(drift.onDiskHash).not.toBe(snap.runningHash);
      expect(drift.runningHash).toBe(snap.runningHash);
    });

    test('does not falsely report drift when canonical pd cannot be found', () => {
      const path = join(tmpRoot, 'pd');
      writeFileSync(path, 'running contents\n');
      const snap = snapshotRunningBinary(path);

      const drift = detectDrift({
        runningSnapshot: snap,
        resolveOnDisk: () => null,
      });

      expect(drift.drifted).toBe(false);
      expect(drift.reason).toMatch(/No comparable Port Daddy binary found on disk/);
    });

    test('does not falsely report drift when canonical pd path no longer exists', () => {
      const runningPath = join(tmpRoot, 'pd-old');
      writeFileSync(runningPath, 'old running contents\n');
      const snap = snapshotRunningBinary(runningPath);

      const drift = detectDrift({
        runningSnapshot: snap,
        resolveOnDisk: () => join(tmpRoot, 'pd-deleted'),
      });

      expect(drift.drifted).toBe(false);
      expect(drift.reason).toMatch(/does not exist/);
    });

    test('compares split daemon installs against sibling port-daddy-daemon, not pd launcher', () => {
      const daemonPath = join(tmpRoot, 'port-daddy-daemon');
      const pdPath = join(tmpRoot, 'pd');
      writeFileSync(daemonPath, 'daemon contents\n');
      writeFileSync(pdPath, 'short launcher contents\n');
      const snap = snapshotRunningBinary(daemonPath);

      const drift = detectDrift({
        runningSnapshot: snap,
        env: { PATH: '' },
      });

      expect(drift.drifted).toBe(false);
      expect(drift.onDiskPath).toBe(realpathSync(daemonPath));
      expect(drift.onDiskHash).toBe(snap.runningHash);
    });

    test('reports drift for split daemon installs when sibling daemon is replaced', () => {
      const daemonPath = join(tmpRoot, 'port-daddy-daemon');
      writeFileSync(daemonPath, 'old daemon contents\n');
      const snap = snapshotRunningBinary(daemonPath);
      writeFileSync(daemonPath, 'new daemon contents\n');

      const drift = detectDrift({
        runningSnapshot: snap,
        env: { PATH: '' },
      });

      expect(drift.drifted).toBe(true);
      expect(drift.onDiskPath).toBe(realpathSync(daemonPath));
      expect(drift.onDiskHash).not.toBe(snap.runningHash);
    });

    test('compares Homebrew port-daddy runtime to itself, not the pd launcher', () => {
      const runtimePath = join(tmpRoot, 'port-daddy');
      const launcherPath = join(tmpRoot, 'pd');
      writeFileSync(runtimePath, 'compiled runtime contents\n');
      writeFileSync(launcherPath, 'small launcher contents\n');
      const snap = snapshotRunningBinary(runtimePath);

      const drift = detectDrift({
        runningSnapshot: snap,
        env: { PATH: tmpRoot },
      });

      expect(drift.drifted).toBe(false);
      expect(drift.onDiskPath).toBe(realpathSync(runtimePath));
      expect(drift.onDiskHash).toBe(snap.runningHash);
    });

    test('reports unavailable when the running binary could not be hashed at startup', () => {
      const drift = detectDrift({
        runningSnapshot: {
          runningPath: '/nonexistent/pd',
          runningHash: null,
          runningSizeBytes: null,
        },
        resolveOnDisk: () => null,
      });

      expect(drift.drifted).toBe(false);
      expect(drift.reason).toMatch(/drift detection unavailable/);
    });

    test('includes onDiskSizeBytes for diagnostics', () => {
      const path = join(tmpRoot, 'pd');
      const contents = 'v3.15.0\n';
      writeFileSync(path, contents);
      const snap = snapshotRunningBinary(path);

      const drift = detectDrift({
        runningSnapshot: snap,
        resolveOnDisk: () => path,
      });

      expect(drift.onDiskSizeBytes).toBe(contents.length);
      expect(drift.runningSizeBytes).toBe(contents.length);
    });

    test('checkedAt reflects the time the drift check ran', () => {
      const path = join(tmpRoot, 'pd');
      writeFileSync(path, 'x\n');
      const snap = snapshotRunningBinary(path);

      const drift = detectDrift({
        runningSnapshot: snap,
        resolveOnDisk: () => path,
        now: () => 1717000000000,
      });

      expect(drift.checkedAt).toBe(1717000000000);
    });
  });

  describe('resolveOnDiskPdPath', () => {
    test('honors PORT_DADDY_BIN_OVERRIDE for test injection', () => {
      const path = join(tmpRoot, 'fake-pd');
      writeFileSync(path, 'x\n');

      const resolved = resolveOnDiskPdPath({
        PORT_DADDY_BIN_OVERRIDE: path,
        PATH: '/usr/bin:/bin',
      });

      expect(resolved).toBe(realpathSync(path));
    });

    test('returns null when PATH has no pd', () => {
      // Empty PATH guarantees `command -v pd` finds nothing on any host.
      const resolved = resolveOnDiskPdPath({
        PATH: '',
      });
      expect(resolved).toBeNull();
    });
  });
});
