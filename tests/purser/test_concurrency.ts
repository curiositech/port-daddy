import { describe, it } from 'https://deno.land/std@0.221.0/testing/bdd.ts';
import { fetchMergeGroupMembers } from '../../apps/fleet-executor/src/github.ts';
import { freshState, installGitHubFetch } from './harness.ts';

describe('Concurrency', () => {
  it('should handle concurrent requests', async () => {
    const state = freshState();
    state.mergeQueueEntries = [
      { position: 1, prNumber: 7, headSha: 'HEADSHA', groupHeadSha: 'MERGEGROUPSHA' },
      { position: 2, prNumber: 8, headSha: 'OTHER', groupHeadSha: 'MERGEGROUPSHA' }
    ];
    installGitHubFetch(state);
    const promises = [
      fetchMergeGroupMembers('owner', 'repo', 'main', 'MERGEGROUPSHA', 'token'),
      fetchMergeGroupMembers('owner', 'repo', 'main', 'MERGEGROUPSHA', 'token')
    ];
    const results = await Promise.all(promises);
    assertDeepEquals(results[0], [
      { prNumber: 7, headSha: 'HEADSHA' },
      { prNumber: 8, headSha: 'OTHER' }
    ]);
    assertDeepEquals(results[1], [
      { prNumber: 7, headSha: 'HEADSHA' },
      { prNumber: 8, headSha: 'OTHER' }
    ]);
  });
});