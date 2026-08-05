const { spawnViaCliTube, fakeChild, mockSpawn } = require('../../lib/spawner/backends/cli-tube');
const { jest } = require('@jest/globals');

jest.mock('../../lib/spawner/backends/cli-tube', () => ({ 
  spawnViaCliTube: jest.fn(),
  fakeChild: jest.fn(),
  mockSpawn: jest.fn()
}));

describe('CLI tube no-deadline behavior', () => {
  test('Schedules no timers or process-tree polls when timeoutMs is omitted', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ stdout: 'still running', exitCode: 0, neverClose: true });
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi' }); // no timeoutMs
      await Promise.resolve();
      await Promise.resolve();

      expect(jest.getTimerCount()).toBe(0);
      expect(mockSpawn).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: undefined }));

      // Advance virtual time well past the old hidden 5-minute default
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

  test('Handles zero or negative deadlines as no deadline', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ neverClose: true });
      mockSpawn.mockReturnValue(child);

      // Zero deadline
      const resultPromiseZero = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 0 });
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(0);

      // Negative deadline
      const resultPromiseNeg = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: -1000 });
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(0);

      // Advance timers
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(child.kill).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});