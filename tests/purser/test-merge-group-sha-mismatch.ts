import { installGitHubFetch, freshState } from '../apps/fleet-executor/tests/harness';
import { fetchMergeGroupMembers } from '../apps/fleet-executor/src/github';

describe('fetchMergeGroupMembers SHA mismatch', () => {
  it('rejects when groupHeadSha does not match entry', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{ position: 1, prNumber: 7, headSha: 'HEADSHA', groupHeadSha: 'DIFFERENT' }];
    installGitHubFetch(state);
    
    await expect(fetchMergeGroupMembers('owner', 'repo', 7, 'HEADSHA', 'token'))
      .rejects
      .toThrow('merge queue entry does not match DIFFERENT');
  });

  it('accepts when groupHeadSha matches', async () => {
    const state = freshState();
    state.mergeQueueEntries = [{ position: 1, prNumber: 7, headSha: 'HEADSHA', groupHeadSha: 'MERGEGROUPSHA' }];
    installGitHubFetch(state);
    
    const members = await fetchMergeGroupMembers('owner', 'repo', 7, 'MERGEGROUPSHA', 'token');
    expect(members).toEqual([{ prNumber: 7, headSha: 'HEADSHA' }]);
  });
});