import { installGitHubFetch, freshState } from '../apps/fleet-executor/tests/harness';
import { fetchMergeGroupMembers } from '../apps/fleet-executor/src/github';

describe('fetchMergeGroupMembers boundary cases', () => {
  it('handles PR at position limit', async () => {
    const state = freshState();
    state.mergeQueueEntries = Array(100).fill(null).map((_, i) => ({
      position: i + 1,
      prNumber: i + 1,
      headSha: `SHA${i}`,
      groupHeadSha: 'MERGEGROUPSHA'
    }));
    installGitHubFetch(state);
    
    const members = await fetchMergeGroupMembers('owner', 'repo', 100, 'MERGEGROUPSHA', 'token');
    expect(members.length).toBe(100);
  });

  it('handles empty merge queue', async () => {
    const state = freshState();
    state.mergeQueueEntries = [];
    installGitHubFetch(state);
    
    await expect(fetchMergeGroupMembers('owner', 'repo', 1, 'HEADSHA', 'token'))
      .rejects
      .toThrow('merge queue membership is incomplete for PR #1');
  });
});