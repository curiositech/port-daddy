const { spawnViaCliTube, fakeChild, mockSpawn } = require('../../lib/spawner/backends/cli-tube');
const { jest } = require('@jest/globals');

jest.mock('../../lib/spawner/backends/cli-tube', () => ({ 
  spawnViaCliTube: jest.fn(),
  fakeChild: jest.fn(),
  mockSpawn: jest.fn()
}));

describe('CLI tube error message validation', () => {
  test('Error message includes exact deadline value', async () => {
    jest.useFakeTimers();
    try {
      const child = fakeChild({ neverClose: true });
      mockSpawn.mockReturnValue(child);

      const resultPromise = spawnViaCliTube({ 
        cli: 'agy', 
        prompt: 'deadline check',
        timeoutMs: 12345
      });
      await Promise.resolve();

      await jest.advanceTimersByTimeAsync(12345);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      await jest.advanceTimersByTimeAsync(5000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      child.emit('close', -1);
      const res = await resultPromise;
      expect(res.error).toContain('agy timed out after 12345ms');
    } finally {
      jest.useRealTimers();
    }
  });
});