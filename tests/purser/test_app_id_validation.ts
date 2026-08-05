import { describe, it } from 'https://deno.land/std@0.221.0/testing/bdd.ts';
import { findOwnedFleetCheckRun } from '../../apps/fleet-executor/src/github.ts';
import { freshState, installGitHubFetch } from './harness.ts';

describe('App ID Validation', () => {
  it('should reject mismatched app ID', async () => {
    const state = freshState();
    state.existingCheckRuns = [{
      id: 1,
      name: 'fleet-check',
      headSha: 'sha',
      app: { id: 987654 }
    }];
    installGitHubFetch(state);
    const result = await findOwnedFleetCheckRun(
      'owner', 'repo', 'sha', 'fleet-check', 3810450, 'token'
    );
    assertEqual(result, null);
  });

  it('should accept matching app ID', async () => {
    const state = freshState();
    state.existingCheckRuns = [{
      id: 1,
      name: 'fleet-check',
      headSha: 'sha',
      app: { id: 3810450 }
    }];
    installGitHubFetch(state);
    const result = await findOwnedFleetCheckRun(
      'owner', 'repo', 'sha', 'fleet-check', 3810450, 'token'
    );
    assertDeepEquals(result, {
      id: 1,
      status: 'in_progress',
      conclusion: null,
      detailsUrl: null
    });
  });
});