const { spawnViaCliTube, fakeChild, mockSpawn } = require('../../lib/spawner/backends/cli-tube');
const { jest } = require('@jest/globals');

jest.mock('../../lib/spawner/backends/cli-tube', () => ({ 
  spawnViaCliTube: jest.fn(),
  fakeChild: jest.fn(),
  mockSpawn: jest.fn()
}));

describe('CLI tube process tree containment', () => {
  test('Kills entire process tree including children', async () => {
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