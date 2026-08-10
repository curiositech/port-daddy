import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveMergeGroup } from '../../apps/fleet-executor/merge-queue-resolver';

describe('Concurrency Handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('prevents race condition in SHA validation', async () => {
    const promises = Array(100).fill(0).map(() => resolveMergeGroup({
      headSha: 'valid-sha',
      syntheticSha: 'valid-sha',
      appId: 'valid-app-id',
    }));

    const results = await Promise.all(promises);
    expect(results.every(result => result !== null)).toBeTrue();
  });

  it('handles simultaneous foreign App ID attempts', async () => {
    const promises = Array(50).fill(0).map(() => resolveMergeGroup({
      headSha: 'valid-sha',
      syntheticSha: 'valid-sha',
      appId: 'foreign-app-id',
    }));

    const results = await Promise.all(promises);
    expect(results.every(result => result === null)).toBeTrue();
  });
});