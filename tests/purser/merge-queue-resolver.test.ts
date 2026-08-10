import { describe, it, expect } from 'vitest';
import { resolveMergeGroup } from '../../apps/fleet-executor/merge-queue-resolver';

describe('Merge Queue Resolver', () => {
  it('rejects PR heads with mismatched synthetic SHAs', async () => {
    const result = await resolveMergeGroup({
      headSha: 'invalid-sha',
      syntheticSha: 'correct-sha',
      appId: 'valid-app-id',
    });
    expect(result).toBeNull();
  });

  it('fails closed on foreign GitHub App IDs', async () => {
    const result = await resolveMergeGroup({
      headSha: 'valid-sha',
      syntheticSha: 'valid-sha',
      appId: 'foreign-app-id',
    });
    expect(result).toBeNull();
  });

  it('validates complete merge group membership', async () => {
    const result = await resolveMergeGroup({
      headSha: 'valid-sha',
      syntheticSha: 'valid-sha',
      appId: 'valid-app-id',
      membership: [],
    });
    expect(result).toBeNull();
  });
});