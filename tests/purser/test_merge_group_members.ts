import { describe, it } from 'https://deno.land/std@0.221.0/testing/bdd.ts';
import { fetchMergeGroupMembers } from '../../apps/fleet-executor/src/github.ts';
import { freshState, installGitHubFetch } from './harness.ts';

describe('fetchMergeGroupMembers', () => {
  it('should reject empty base branch', async () => {
    const state = freshState();
    installGitHubFetch(state);
    await assertRejects(
      () => fetchMergeGroupMembers('owner', 'repo', 'refs/heads/', 'sha', 'token'),
      Error,
      'merge group has no base branch'
    );
  });

  it('should reject missing group head SHA', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{ position: 1, prNumber: 7, headSha: 'HEADSHA', groupHeadSha: 'OTHER' }];
    installGitHubFetch(state);
    await assertRejects(
      () => fetchMergeGroupMembers('owner', 'repo', 'main', 'sha', 'token'),
      Error,
      'merge queue entry does not match sha'
    );
  });

  it('should reject non-contiguous queue', async () => {
    const state = freshState();
    state.mergeQueueEntries = [
      { position: 1, prNumber: 7, headSha: 'HEADSHA', groupHeadSha: 'MERGEGROUPSHA' },
      { position: 3, prNumber: 8, headSha: 'OTHER', groupHeadSha: 'MERGEGROUPSHA' }
    ];
    installGitHubFetch(state);
    await assertRejects(
      () => fetchMergeGroupMembers('owner', 'repo', 'main', 'MERGEGROUPSHA', 'token'),
      Error,
      'merge queue membership is incomplete at position 2'
    );
  });

  it('should return members for valid queue', async () => {
    const state = freshState();
    state.mergeQueueEntries = [
      { position: 1, prNumber: 7, headSha: 'HEADSHA', groupHeadSha: 'MERGEGROUPSHA' },
      { position: 2, prNumber: 8, headSha: 'OTHER', groupHeadSha: 'MERGEGROUPSHA' }
    ];
    installGitHubFetch(state);
    const result = await fetchMergeGroupMembers('owner', 'repo', 'main', 'MERGEGROUPSHA', 'token');
    assertDeepEquals(result, [
      { prNumber: 7, headSha: 'HEADSHA' },
      { prNumber: 8, headSha: 'OTHER' }
    ]);
  });
});