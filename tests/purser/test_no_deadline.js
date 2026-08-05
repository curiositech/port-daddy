const { mockSpawn, fakeChild, spawnViaCliTube, waitForCliChildProcess } = require('../support');
const { jest } = require('@jest/globals');

jest.useFakeTimers();

describe('spawnViaCliTube with no deadline', () => {
  test('schedules no timers or process-tree polling', async () => {
    const child = fakeChild({ stdout: 'still running', exitCode: 0, neverClose: true });
    mockSpawn.mockReturnValue(child);

    const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi' }); // no timeoutMs
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(0);
    expect(mockSpawn).toHaveBeenCalled();

    // Advance time well past 5 minutes
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(child.kill).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);

    child.emit('close', 0);
    const res = await resultPromise;
    expect(res.error).toBeNull();
    expect(res.exitCode).toBe(0);
    expect(res.output).toBe('still running');
  });

  test('process lifecycle events override deadline logic', async () => {
    const child = fakeChild({ stdout: 'exited early', exitCode: 0 });
    mockSpawn.mockReturnValue(child);

    const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi' });
    await Promise.resolve();

    child.emit('close', 0);
    const res = await resultPromise;
    expect(res.error).toBeNull();
    expect(res.exitCode).toBe(0);
    expect(res.output).toBe('exited early');
  });
});