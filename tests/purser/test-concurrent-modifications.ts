import { installGitHubFetch, freshState } from '../apps/fleet-executor/tests/harness';
import { fetchMergeGroupMembers } from '../apps/fleet-executor/src/github';

describe('fetchMergeGroupMembers concurrent modifications', () => {
  it('handles queue changes during fetch', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{ position: 1, prNumber: 7, headSha: 'HEADSHA', groupHeadSha: 'MERGEGROUPSHA' }];
    installGitHubFetch(state);
    
    // Simulate queue change during fetch
    state.mergeQueueEntries = [{ position: 1, prNumber: 8, headSha: 'NEWHEAD', groupHeadSha: 'NEWGROUP' }];
    
    const members = await fetchMergeGroupMembers('owner', 'repo', 7, 'HEADSHA', 'token');
    expect(members).toEqual([{ prNumber: 7, headSha: 'HEADSHA' }]);
  });

  it('detects concurrent modification after fetch', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{ position: 1, prNumber: 7, headSha: 'HEADSHA', groupHeadSha: 'MERGEGROUPSHA' }];
    installGitHubFetch(state);
    
    const members = await fetchMergeGroupMembers('owner', 'repo', 7, 'HEADSHA', 'token');
    
    // Simulate concurrent modification after fetch
    state.mergeQueueEntries = [{ position: 1, prNumber: 7, headSha: 'CHANGED', groupHeadSha: 'CHANGED' }];
    
    expect(members).toEqual([{ prNumber: 7, headSha: 'HEADSHA' }]);
  });
});