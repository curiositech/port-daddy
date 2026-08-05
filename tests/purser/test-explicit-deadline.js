const { spawnViaCliTube, fakeChild, mockSpawn } = require('../../lib/spawner/backends/cli-tube');
const { jest } = require('@jest/globals');

jest.mock('../../lib/spawner/backends/cli-tube', () => ({ 
  spawnViaCliTube: jest.fn(),
  fakeChild: jest.fn(),
  mockSpawn: jest.fn()
}));

describe('CLI tube explicit deadline behavior', () => {
  test('Triggers SIGTERM then SIGKILL with proper error message', async () => {
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

  test('Process tree termination includes child processes', async () => {
    jest.useFakeTimers();
    try {
      const parentChild = fakeChild({ neverClose: true });
      const childChild = fakeChild({ neverClose: true });
      mockSpawn.mockImplementation((cmd, opts) => {
        if (cmd === 'parent') return parentChild;
        if (cmd === 'child') return childChild;
        return fakeChild();
      });

      const resultPromise = spawnViaCliTube({ 
        cli: 'agy', 
        prompt: 'spawn tree',
        timeoutMs: 1000
      });
      await Promise.resolve();

      await jest.advanceTimersByTimeAsync(1000);
      expect(parentChild.kill).toHaveBeenCalledWith('SIGTERM');
      expect(childChild.kill).toHaveBeenCalledWith('SIGTERM');
      await jest.advanceTimersByTimeAsync(5000);
      expect(parentChild.kill).toHaveBeenCalledWith('SIGKILL');
      expect(childChild.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      jest.useRealTimers();
    }
  });
});