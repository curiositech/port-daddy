const { mockSpawn, fakeChild, spawnViaCliTube, waitForCliChildProcess } = require('../support');
const { jest } = require('@jest/globals');

jest.useFakeTimers();

describe('spawnViaCliTube with explicit deadline', () => {
  test('schedules SIGTERM and SIGKILL with proper timing', async () => {
    const child = fakeChild({ neverClose: true });
    mockSpawn.mockReturnValue(child);

    const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 1000 });
    await Promise.resolve();

    expect(jest.getTimerCount()).toBeGreaterThan(0);

    await jest.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await jest.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.emit('close', -1);
    const res = await resultPromise;
    expect(res.error).toContain('agy timed out after 1000ms');
  });

  test('process exits before deadline does not trigger timeout', async () => {
    const child = fakeChild({ stdout: 'exited early', exitCode: 0 });
    mockSpawn.mockReturnValue(child);

    const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: 1000 });
    await Promise.resolve();

    child.emit('close', 0);
    const res = await resultPromise;
    expect(res.error).toBeNull();
    expect(res.exitCode).toBe(0);
    expect(res.output).toBe('exited early');
  });
});