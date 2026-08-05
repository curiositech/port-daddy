import { installGitHubFetch, freshState } from '../apps/fleet-executor/tests/harness';
import { fetchMergeGroupMembers } from '../apps/fleet-executor/src/github';

describe('fetchMergeGroupMembers incomplete queue', () => {
  it('fails when PR not in merge queue', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{ position: 1, prNumber: 8, headSha: 'HEADSHA', groupHeadSha: 'MERGEGROUPSHA' }];
    installGitHubFetch(state);
    
    await expect(fetchMergeGroupMembers('owner', 'repo', 7, 'HEADSHA', 'token'))
      .rejects
      .toThrow('merge queue membership is incomplete for PR #7');
  });

  it('fails when groupHeadSha does not match', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{ position: 1, prNumber: 7, headSha: 'HEADSHA', groupHeadSha: 'DIFFERENT' }];
    installGitHubFetch(state);
    
    await expect(fetchMergeGroupMembers('owner', 'repo', 7, 'HEADSHA', 'token'))
      .rejects
      .toThrow('merge queue entry does not match DIFFERENT');
  });
});