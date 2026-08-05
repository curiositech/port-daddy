import { installGitHubFetch, freshState } from '../apps/fleet-executor/tests/harness';
import { fetchMergeGroupMembers } from '../apps/fleet-executor/src/github';

describe('fetchMergeGroupMembers missing fields', () => {
  it('fails on missing position', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{
      position: undefined,
      prNumber: 7,
      headSha: 'HEADSHA',
      groupHeadSha: 'MERGEGROUPSHA'
    }];
    installGitHubFetch(state);
    
    await expect(fetchMergeGroupMembers('owner', 'repo', 7, 'HEADSHA', 'token'))
      .rejects
      .toThrow('merge queue entry does not match');
  });

  it('fails on missing prNumber', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{
      position: 1,
      prNumber: undefined,
      headSha: 'HEADSHA',
      groupHeadSha: 'MERGEGROUPSHA'
    }];
    installGitHubFetch(state);
    
    await expect(fetchMergeGroupMembers('owner', 'repo', 7, 'HEADSHA', 'token'))
      .rejects
      .toThrow('merge queue entry does not match');
  });
});