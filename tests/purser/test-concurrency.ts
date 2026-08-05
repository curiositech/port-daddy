import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processMergeGroup } from '../../apps/fleet-executor/src/merge-group-validator';

describe('Concurrency & Idempotency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should handle concurrent merge groups', async () => {
    const prs = [{ head: 'sha1', appId: 'app1', checkStatus: 'success' }];
    const result1 = processMergeGroup(prs);
    const result2 = processMergeGroup(prs);
    await expect(result1).resolves.toBe(true);
    await expect(result2).resolves.toBe(true);
  });

  it('should be idempotent on repeated processing', async () => {
    const prs = [{ head: 'sha1', appId: 'app1', checkStatus: 'success' }];
    const result1 = processMergeGroup(prs);
    const result2 = processMergeGroup(prs);
    await expect(result1).resolves.toBe(true);
    await expect(result2).resolves.toBe(true);
  });
});