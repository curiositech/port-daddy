import { installGitHubFetch, freshState } from '../apps/fleet-executor/tests/harness';
import { fetchMergeGroupMembers } from '../apps/fleet-executor/src/github';

describe('fetchMergeGroupMembers invalid response', () => {
  it('fails on missing fields', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{ position: 1, prNumber: 7, headSha: 'HEADSHA', groupHeadSha: 'MERGEGROUPSHA' }];
    installGitHubFetch(state);
    
    // Modify response to remove required fields
    state.mergeQueueEntries[0].groupHeadSha = undefined;
    
    await expect(fetchMergeGroupMembers('owner', 'repo', 7, 'HEADSHA', 'token'))
      .rejects
      .toThrow('merge queue entry does not match');
  });

  it('fails on malformed position', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{ position: 'invalid', prNumber: 7, headSha: 'HEADSHA', groupHeadSha: 'MERGEGROUPSHA' }];
    installGitHubFetch(state);
    
    await expect(fetchMergeGroupMembers('owner', 'repo', 7, 'HEADSHA', 'token'))
      .rejects
      .toThrow('merge queue entry does not match');
  });
});