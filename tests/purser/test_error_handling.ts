import { describe, it } from 'https://deno.land/std@0.221.0/testing/bdd.ts';
import { fetchMergeGroupMembers } from '../../apps/fleet-executor/src/github.ts';
import { freshState, installGitHubFetch } from './harness.ts';

describe('Error Handling', () => {
  it('should handle failed merge queue query', async () => {
    const state = freshState();
    state.failMergeQueueQuery = true;
    installGitHubFetch(state);
    await assertRejects(
      () => fetchMergeGroupMembers('owner', 'repo', 'main', 'sha', 'token'),
      Error,
      'merge queue unavailable'
    );
  });

  it('should reject invalid head SHA format', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{ position: 1, prNumber: 7, headSha: 'invalid', groupHeadSha: 'sha' }];
    installGitHubFetch(state);
    await assertRejects(
      () => fetchMergeGroupMembers('owner', 'repo', 'main', 'sha', 'token'),
      Error,
      'merge queue entry does not match sha'
    );
  });
});