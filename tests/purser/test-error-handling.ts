import { installGitHubFetch, freshState } from '../apps/fleet-executor/tests/harness';
import { fetchMergeGroupMembers } from '../apps/fleet-executor/src/github';

describe('fetchMergeGroupMembers error handling', () => {
  it('fails on network error', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{ position: 1, prNumber: 7, headSha: 'HEADSHA', groupHeadSha: 'MERGEGROUPSHA' }];
    installGitHubFetch(state, { status: 500 });
    
    await expect(fetchMergeGroupMembers('owner', 'repo', 7, 'HEADSHA', 'token'))
      .rejects
      .toThrow('fetch merge queue failed 500');
  });

  it('fails on invalid response format', async () => {
    const state = freshState();
    state.mergeQueueEntries = 'invalid format';
    installGitHubFetch(state);
    
    await expect(fetchMergeGroupMembers('owner', 'repo', 7, 'HEADSHA', 'token'))
      .rejects
      .toThrow('merge queue response format invalid');
  });
});