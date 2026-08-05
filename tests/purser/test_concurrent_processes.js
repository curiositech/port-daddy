const { mockSpawn, fakeChild, spawnViaCliTube, waitForCliChildProcess } = require('../support');
const { jest } = require('@jest/globals');

jest.useFakeTimers();

describe('concurrent processes with deadlines', () => {
  test('multiple processes with and without deadlines coexist', async () => {
    const child1 = fakeChild({ neverClose: true });
    const child2 = fakeChild({ neverClose: true });
    mockSpawn.mockImplementation((command, args, opts) => {
      if (command === 'process1') {
        return child1;
      }
      return child2;
    });

    const promise1 = spawnViaCliTube({ cli: 'agy', prompt: 'hi' }); // no deadline
    const promise2 = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 1000 });
    await Promise.resolve();

    expect(jest.getTimerCount()).toBeGreaterThan(0);

    await jest.advanceTimersByTimeAsync(1000);
    expect(child1.kill).not.toHaveBeenCalled();
    expect(child2.kill).toHaveBeenCalledWith('SIGTERM');

    await jest.advanceTimersByTimeAsync(5000);
    expect(child2.kill).toHaveBeenCalledWith('SIGKILL');

    child1.emit('close', 0);
    child2.emit('close', -1);
    const res1 = await promise1;
    const res2 = await promise2;
    expect(res1.error).toBeNull();
    expect(res2.error).toContain('agy timed out after 1000ms');
  });
});