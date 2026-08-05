const { mockSpawn, fakeChild, spawnViaCliTube, waitForCliChildProcess } = require('../support');
const { jest } = require('@jest/globals');

jest.useFakeTimers();

describe('spawnViaCliTube with invalid deadlines', () => {
  test('undefined deadline schedules no timers', async () => {
    const child = fakeChild({ neverClose: true });
    mockSpawn.mockReturnValue(child);

    const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: undefined });
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(child.kill).not.toHaveBeenCalled();
  });

  test('null deadline schedules no timers', async () => {
    const child = fakeChild({ neverClose: true });
    mockSpawn.mockReturnValue(child);

    const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: null });
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(child.kill).not.toHaveBeenCalled();
  });

  test('non-finite deadline schedules no timers', async () => {
    const child = fakeChild({ neverClose: true });
    mockSpawn.mockReturnValue(child);

    const resultPromise = spawnViaCliTube({ cli: 'agy', prompt: 'hi', timeoutMs: NaN });
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});