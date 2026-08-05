const { spawnViaCliTube, waitForCliChildProcess } = require('../../lib/spawner/backends/cli-tube-backend');
const { mockSpawn, fakeChild } = require('../test-utils');
const { jest } = require('@jest/globals');

jest.mock('../../lib/spawner/backends/cli-tube', () => ({
  buildArgs: jest.fn(),
  spawnViaCliTube: jest.fn(),
  waitForCliChildProcess: jest.fn()
}));

describe('Adversarial tests for CLI timeout handling', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('No timeoutMs: no timers or process-tree polling scheduled', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ stdout: 'still running', exitCode: 0, neverClose: true });
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi' }); // no timeoutMs
      await Promise.resolve();
      await Promise.resolve();

      expect(jest.getTimerCount()).toBe(0);
      expect(mockSpawn).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));
      expect(waitForCliChildProcess).toHaveBeenCalledWith(expect.any(Object), {
        deadlineMs: undefined,
        killGraceMs: expect.any(Number),
        killCloseDeadlineMs: expect.any(Number)
      });

      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(child.kill).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);

      child.emit('close', 0);
      const res = await resultPromise;
      expect(res.error).toBeNull();
      expect(res.exitCode).toBe(0);
      expect(res.output).toBe('still running');
    } finally {
      jest.useRealTimers();
    }
  });

  test('Explicit timeoutMs: SIGTERM then SIGKILL with proper grace periods', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ neverClose: true });
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 1000 });
      await Promise.resolve();
      await Promise.resolve();

      expect(jest.getTimerCount()).toBeGreaterThan(0);
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

  test('Non-finite timeoutMs: treated as no deadline', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ neverClose: true });
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: NaN });
      await Promise.resolve();
      await Promise.resolve();

      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(child.kill).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);

      child.emit('close', 0);
      const res = await resultPromise;
      expect(res.error).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('Negative timeoutMs: treated as no deadline', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ neverClose: true });
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: -5000 });
      await Promise.resolve();
      await Promise.resolve();

      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(child.kill).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);

      child.emit('close', 0);
      const res = await resultPromise;
      expect(res.error).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('Timeout message includes exact deadline value', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ neverClose: true });
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 1234 });
      await Promise.resolve();
      await Promise.resolve();

      await jest.advanceTimersByTimeAsync(1234);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      await jest.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      child.emit('close', -1);
      const res = await resultPromise;
      expect(res.error).toContain('agy timed out after 1234ms');
    } finally {
      jest.useRealTimers();
    }
  });
});