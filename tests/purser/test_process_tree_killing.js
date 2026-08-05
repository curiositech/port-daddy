const { mockSpawn, fakeChild, spawnViaCliTube, waitForCliChildProcess } = require('../support');
const { jest } = require('@jest/globals');

jest.useFakeTimers();

describe('process tree killing with deadline', () => {
  test('parent and child processes are both killed', async () => {
    const parentChild = fakeChild({ neverClose: true });
    const childChild = fakeChild({ neverClose: true });
    mockSpawn.mockImplementation((command, args, opts) => {
      if (command === 'parent') {
        return parentChild;
      }
      return childChild;
    });

    const resultPromise = spawnViaCliTube({
      cli: 'agy',
      prompt: 'hi',
      timeoutMs: 1000
    });
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(1000);
    expect(parentChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(childChild.kill).toHaveBeenCalledWith('SIGTERM');

    await jest.advanceTimersByTimeAsync(5000);
    expect(parentChild.kill).toHaveBeenCalledWith('SIGKILL');
    expect(childChild.kill).toHaveBeenCalledWith('SIGKILL');

    parentChild.emit('close', -1);
    childChild.emit('close', -1);
    const res = await resultPromise;
    expect(res.error).toContain('agy timed out after 1000ms');
  });
});