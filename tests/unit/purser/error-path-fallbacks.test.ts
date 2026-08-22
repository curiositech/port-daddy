// tests/unit/purser/error-path-fallbacks.test.ts
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isPidAlive } from '../../../lib/spawner/backends/cli-tube-lifecycle';

describe('isPidAlive error path handling', () => {
  // Restore all mocks after each test
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Helper to mock process.kill to succeed
  const mockKillSuccess = () => {
    jest.spyOn(process, 'kill').mockImplementation(() => {});
  };

  // Helper to mock process.kill to throw (e.g., ESRCH)
  const mockKillThrow = () => {
    jest.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('ESRCH');
      (err as any).code = 'ESRCH';
      throw err;
    });
  };

  it('returns true for a running process with non-zombie /proc state', async () => {
    mockKillSuccess();
    jest.spyOn(readFileSync, 'call').mockReturnValue(
      // Simulate /proc/<pid>/stat with state 'S' (sleeping)
      '12345 (node) S 1 2 3 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0'
    );
    const result = await isPidAlive(12345);
    expect(result).toBe(true);
  });

  it('returns false for a zombie process (state Z) in /proc', async () => {
    mockKillSuccess();
    jest.spyOn(readFileSync, 'call').mockReturnValue(
      // Simulate /proc/<pid>/stat with state 'Z'
      '12345 (node) Z 1 2 3 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0'
    );
    const result = await isPidAlive(12345);
    expect(result).toBe(false);
  });

  it('falls back to ps when /proc read fails and correctly interprets ps state', async () => {
    mockKillSuccess();
    // /proc read throws
    jest.spyOn(readFileSync, 'call').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    // ps returns state 'S' (running)
    jest.spyOn(execFileSync, 'call').mockReturnValue('S\n');
    const result = await isPidAlive(12345);
    expect(result).toBe(true);
  });

  it('returns false when /proc read fails and ps reports zombie state', async () => {
    mockKillSuccess();
    jest.spyOn(readFileSync, 'call').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    jest.spyOn(execFileSync, 'call').mockReturnValue('Z\n');
    const result = await isPidAlive(12345);
    expect(result).toBe(false);
  });

  it('falls back to true when both /proc and ps fail', async () => {
    mockKillSuccess();
    jest.spyOn(readFileSync, 'call').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    jest.spyOn(execFileSync, 'call').mockImplementation(() => {
      throw new Error('ps error');
    });
    const result = await isPidAlive(12345);
    expect(result).toBe(true);
  });

  it('returns false for invalid PIDs (non-integer, <=0)', async () => {
    const invalidPids: any[] = [0, -1, 'abc', NaN, undefined, null];
    for (const pid of invalidPids) {
      const result = await isPidAlive(pid as any);
      expect(result).toBe(false);
    }
  });

  it('returns false when process.kill throws (e.g., no such process)', async () => {
    mockKillThrow();
    const result = await isPidAlive(999999);
    expect(result).toBe(false);
  });
});