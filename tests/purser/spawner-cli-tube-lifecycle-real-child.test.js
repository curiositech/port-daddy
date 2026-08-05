const { spawnViaCliTube, waitForCliChildProcess } = require('../../lib/spawner/backends/cli-tube-backend');
const { mockSpawn, fakeChild } = require('../test-utils');
const { jest } = require('@jest/globals');
const { execFileSync } = require('child_process');
const { mkdirSync, writeFileSync, chmodSync, join, existsSync, rmSync } = require('fs-extra');
const { tmpdir } = require('os');

jest.mock('../../lib/spawner/backends/cli-tube', () => ({
  buildArgs: jest.fn(),
  spawnViaCliTube: jest.fn(),
  waitForCliChildProcess: jest.fn()
}));

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
  spawn: jest.fn()
}));

jest.mock('fs-extra', () => ({
  ...jest.requireActual('fs-extra'),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  chmodSync: jest.fn(),
  join: jest.fn(),
  existsSync: jest.fn(),
  rmSync: jest.fn()
}));

describe('Adversarial integration tests for CLI process lifecycle', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = tmpdir();
    originalEnv = { ...process.env };
    jest.resetAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('Process tree cleanup: all child processes terminated on deadline', async () => {
    const parentPidFile = join(tempDir, 'parent.pid');
    const launcherPidFile = join(tempDir, 'launcher.pid');

    const mockExecFileSync = jest.spyOn(require('child_process'), 'execFileSync');
    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd.includes('pgrep') && args.includes('parent')) {
        return '1234';
      }
      if (cmd.includes('pgrep') && args.includes('child')) {
        return '1235';
      }
      return '';
    });

    const child = fakeChild({ neverClose: true });
    mockSpawn.mockReturnValue(child);

    const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 1000 });
    await Promise.resolve();
    await Promise.resolve();

    jest.useFakeTimers();
    try {
      await jest.advanceTimersByTimeAsync(1000);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      await jest.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      child.emit('close', -1);
      const res = await resultPromise;
      expect(res.error).toContain('agy timed out after 1000ms');
    } finally {
      jest.useRealTimers();
    }
  });

  test('No deadline: real child process survives extended runtime', async () => {
    const previousAgyBin = process.env.PD_CLI_AGY_BIN;
    const slowExitScript = `#!${process.execPath}
setTimeout(() => {
  console.log('done sleeping');
  process.exit(0);
}, 150);
`;
    const agyBinPath = join(tempDir, 'agy');
    writeFileSync(agyBinPath, slowExitScript);
    chmodSync(agyBinPath, 0o755);
    process.env.PD_CLI_AGY_BIN = agyBinPath;

    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    try {
      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'run past the old hidden default' });
      await Promise.resolve();
      await Promise.resolve();

      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(jest.getTimerCount()).toBe(0);

      const res = await resultPromise;
      expect(res.error).toBeNull();
      expect(res.exitCode).toBe(0);
      expect(res.output).toBe('done sleeping');
    } finally {
      jest.useRealTimers();
      process.env.PD_CLI_AGY_BIN = previousAgyBin;
    }
  });

  test('Idempotent termination: multiple kill calls have no effect', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ neverClose: true });
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 1000 });
      await Promise.resolve();
      await Promise.resolve();

      await jest.advanceTimersByTimeAsync(1000);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      await jest.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      // Simulate multiple kill calls
      child.kill('SIGTERM');
      child.kill('SIGKILL');
      expect(child.kill).toHaveBeenCalledTimes(2);

      child.emit('close', -1);
      const res = await resultPromise;
      expect(res.error).toContain('agy timed out after 1000ms');
    } finally {
      jest.useRealTimers();
    }
  });
});