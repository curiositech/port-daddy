import { installGitHubFetch, freshState } from '../apps/fleet-executor/tests/harness';
import { findOwnedFleetCheckRun } from '../apps/fleet-executor/src/github';

describe('findOwnedFleetCheckRun foreign app', () => {
  it('rejects check runs with different app ID', async () => {
    const state = freshState();
    state.existingCheckRuns = [{
      id: 1,
      name: 'fleet-check',
      headSha: 'HEADSHA',
      status: 'completed',
      conclusion: 'success',
      app: { id: 12345 }
    }];
    installGitHubFetch(state);
    
    const result = await findOwnedFleetCheckRun('owner', 'repo', 'HEADSHA', 'fleet-check', 3810450, 'token');
    expect(result).toBeNull();
  });

  it('accepts check runs with matching app ID', async () => {
    const state = freshState();
    state.existingCheckRuns = [{
      id: 1,
      name: 'fleet-check',
      headSha: 'HEADSHA',
      status: 'completed',
      conclusion: 'success',
      app: { id: 3810450 }
    }];
    installGitHubFetch(state);
    
    const result = await findOwnedFleetCheckRun('owner', 'repo', 'HEADSHA', 'fleet-check', 3810450, 'token');
    expect(result).toBeDefined();
  });
});