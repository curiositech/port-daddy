// tests/unit/purser/cleanup-missing-state.test.ts
import { describe, expect, test } from '@jest/globals';
import {
  cleanupTutorialState,
  type TutorialState,
} from '../../../cli/commands/tutorial.ts';
import type { FetchOptions, PdFetchResponse } from '../../../cli/utils/fetch.ts';

/**
 * Helper to create a minimal PdFetchResponse.
 */
function mkResponse(status = 200): PdFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    json: async () => ({}),
    text: async () => '',
  };
}

/**
 * Helper to capture fetch calls.
 */
function makeFakeFetch(
  onCall: (path: string, options?: FetchOptions) => PdFetchResponse | Promise<PdFetchResponse>,
) {
  return async (path: string, options?: FetchOptions) => {
    return await onCall(path, options);
  };
}

describe('cleanupTutorialState missing or incomplete state', () => {
  test('no state fields: cleanup does nothing and does not error', async () => {
    const state: TutorialState = {
      claimedPorts: [],
      sessionId: null,
      agentId: null,
    };
    const calls: Array<{ path: string; options?: FetchOptions }> = [];
    await cleanupTutorialState(state, makeFakeFetch((p, o) => {
      calls.push({ path: p, options: o });
      return mkResponse();
    }));
    expect(calls).toHaveLength(0);
    expect(state).toEqual({
      claimedPorts: [],
      sessionId: null,
      agentId: null,
    });
  });

  test('missing lockOwnerAgent: lock release uses default owner', async () => {
    const state: TutorialState = {
      claimedPorts: [],
      sessionId: null,
      agentId: null,
      lockName: 'tutorial-lock',
    };
    const calls: Array<{ path: string; options?: FetchOptions }> = [];
    await cleanupTutorialState(state, makeFakeFetch((p, o) => {
      calls.push({ path: p, options: o });
      return mkResponse();
    }));
    const lockCall = calls.find(c => c.path === '/locks/tutorial-lock');
    expect(lockCall).toBeDefined();
    const body = JSON.parse(String(lockCall!.options?.body));
    expect(body).toEqual({ owner: 'tutorial-agent', ttl: 60000 });
    expect(state).toEqual({
      claimedPorts: [],
      sessionId: null,
      agentId: null,
      lockName: undefined,
    });
  });

  test('missing sessionId or agentId: /sugar/done not called', async () => {
    const state1: TutorialState = {
      claimedPorts: [],
      sessionId: 's1',
      agentId: null,
    };
    const state2: TutorialState = {
      claimedPorts: [],
      sessionId: null,
      agentId: 'a1',
    };
    const calls: Array<{ path: string; options?: FetchOptions }> = [];
    await cleanupTutorialState(state1, makeFakeFetch((p, o) => {
      calls.push({ path: p, options: o });
      return mkResponse();
    }));
    await cleanupTutorialState(state2, makeFakeFetch((p, o) => {
      calls.push({ path: p, options: o });
      return mkResponse();
    }));
    const doneCalls = calls.filter(c => c.path === '/sugar/done');
    expect(doneCalls).toHaveLength(0);
  });

  test('missing dnsIdentity: /dns not called', async () => {
    const state: TutorialState = {
      claimedPorts: [],
      sessionId: null,
      agentId: null,
    };
    const calls: Array<{ path: string; options?: FetchOptions }> = [];
    await cleanupTutorialState(state, makeFakeFetch((p, o) => {
      calls.push({ path: p, options: o });
      return mkResponse();
    }));
    const dnsCalls = calls.filter(c => c.path.startsWith('/dns/'));
    expect(dnsCalls).toHaveLength(0);
  });

  test('missing inbox agents: inbox delete not called', async () => {
    const state: TutorialState = {
      claimedPorts: [],
      sessionId: null,
      agentId: null,
    };
    const calls: Array<{ path: string; options?: FetchOptions }> = [];
    await cleanupTutorialState(state, makeFakeFetch((p, o) => {
      calls.push({ path: p, options: o });
      return mkResponse();
    }));
    const inboxCalls = calls.filter(c => c.path.includes('/inbox'));
    expect(inboxCalls).toHaveLength(0);
  });

  test('cleanup is idempotent: subsequent call does nothing', async () => {
    const state: TutorialState = {
      claimedPorts: ['p1'],
      sessionId: 's1',
      agentId: 'a1',
    };
    const calls: Array<{ path: string; options?: FetchOptions }> = [];
    await cleanupTutorialState(state, makeFakeFetch((p, o) => {
      calls.push({ path: p, options: o });
      return mkResponse();
    }));
    // After first cleanup, state should be cleared
    expect(state).toEqual({
      claimedPorts: [],
      sessionId: null,
      agentId: null,
    });
    // Second cleanup should make no further calls
    await cleanupTutorialState(state, makeFakeFetch((p, o) => {
      calls.push({ path: p, options: o });
      return mkResponse();
    }));
    const uniquePaths = Array.from(new Set(calls.map(c => c.path)));
    expect(uniquePaths).toEqual([
      '/release',
      '/sugar/done',
    ]);
  });

  test('failed port release leaves port in state', async () => {
    const state: TutorialState = {
      claimedPorts: ['bad-port'],
      sessionId: null,
      agentId: null,
    };
    const calls: Array<{ path: string; options?: FetchOptions }> = [];
    await cleanupTutorialState(state, makeFakeFetch((p, o) => {
      calls.push({ path: p, options: o });
      if (p === '/release') return mkResponse(500); // simulate failure
      return mkResponse();
    }));
    expect(calls.map(c => c.path)).toContain('/release');
    // port should remain in state because release failed
    expect(state.claimedPorts).toEqual(['bad-port']);
  });
});