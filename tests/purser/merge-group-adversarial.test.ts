import { describe, it, beforeEach, afterEach } from 'vitest';
import { executeMergeGroupGate } from '../../apps/fleet-executor/src/execute.ts';
import { makeJob, makeEnv, state } from '../helpers';

describe('Adversarial Merge Group Gate Tests', () => {
  beforeEach(() => {
    state.existingCheckRuns = [];
    state.mergeQueueEntries = [];
    state.failMergeQueueQuery = false;
  });

  it('fails closed when PRs have mixed valid/invalid reviews', async () => {
    state.mergeQueueEntries = [
      { position: 1, prNumber: 10, headSha: 'SHA1', groupHeadSha: 'GROUP1' },
      { position: 2, prNumber: 11, headSha: 'SHA2', groupHeadSha: 'GROUP1' }
    ];
    
    // Valid review for PR10
    state.existingCheckRuns.push({
      id: 100,
      name: 'Port Daddy Fleet',
      headSha: 'SHA1',
      status: 'completed',
      conclusion: 'success',
      app: { id: 3810450 }
    });
    
    // Invalid review (foreign app) for PR11
    state.existingCheckRuns.push({
      id: 101,
      name: 'Port Daddy Fleet',
      headSha: 'SHA2',
      status: 'completed',
      conclusion: 'success',
      app: { id: 999 }
    });

    const kv = { get: () => Promise.resolve('test-token') };
    
    await executeMergeGroupGate(
      makeJob({
        eventType: 'merge_group',
        action: 'checks_requested',
        payloadMinimal: { merge_group: { head_sha: 'GROUP1', base_ref: 'main' } }
      }),
      makeEnv({ FLEET_TOKENS: kv })
    );

    expect(state.completed[state.completed.length - 1].conclusion).toBe('failure');
    expect(state.completed[state.completed.length - 1].summary).toContain('PR #11');
    expect(state.completed[state.completed.length - 1].summary).toContain('foreign App');
  });

  it('fails closed with malformed merge_group payload', async () => {
    const kv = { get: () => Promise.resolve('test-token') };
    
    await executeMergeGroupGate(
      makeJob({
        eventType: 'merge_group',
        action: 'checks_requested',
        payloadMinimal: { merge_group: { base_ref: 'main' } } // Missing head_sha
      }),
      makeEnv({ FLEET_TOKENS: kv })
    );

    expect(state.completed[state.completed.length - 1].conclusion).toBe('failure');
    expect(state.completed[state.completed.length - 1].summary).toContain('invalid merge_group');
  });

  it('ensures atomic check run creation during concurrent execution', async () => {
    const kv = { get: () => Promise.resolve('test-token') };
    
    // Simulate concurrent execution
    const promises = Array(5).fill(0).map(() =>
      executeMergeGroupGate(
        makeJob({
          eventType: 'merge_group',
          action: 'checks_requested',
          payloadMinimal: { merge_group: { head_sha: 'CONCURRENT_SHA', base_ref: 'main' } }
        }),
        makeEnv({ FLEET_TOKENS: kv })
      )
    );

    await Promise.all(promises);

    // Verify only one check run was created
    const checkRuns = state.records.filter(r => r.url.endsWith('/check-runs'));
    expect(checkRuns.length).toBe(1);
  });

  it('fails closed when token validation fails', async () => {
    const kv = { get: () => Promise.resolve('invalid-token') };
    
    await executeMergeGroupGate(
      makeJob({
        eventType: 'merge_group',
        action: 'checks_requested',
        payloadMinimal: { merge_group: { head_sha: 'TOKEN_SHA', base_ref: 'main' } }
      }),
      makeEnv({ FLEET_TOKENS: kv })
    );

    expect(state.completed[state.completed.length - 1].conclusion).toBe('failure');
    expect(state.completed[state.completed.length - 1].summary).toContain('token validation failed');
  });

  it('prevents AI invocation during merge group processing', async () => {
    const kv = { get: () => Promise.resolve('test-token') };
    const ai = { stub: () => {} };
    
    await executeMergeGroupGate(
      makeJob({
        eventType: 'merge_group',
        action: 'checks_requested',
        payloadMinimal: { merge_group: { head_sha: 'AI_SHA', base_ref: 'main' } }
      }),
      makeEnv({ FLEET_TOKENS: kv, AI: ai })
    );

    expect(ai.stub).not.toHaveBeenCalled();
  });
});