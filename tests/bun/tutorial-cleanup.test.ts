import { describe, expect, test } from 'bun:test';
import {
  cleanupTutorialState,
  runWithTutorialCleanup,
  type TutorialState,
} from '../../cli/commands/tutorial.ts';
import type { FetchOptions, PdFetchResponse } from '../../cli/utils/fetch.ts';

type FetchCall = { path: string; options?: FetchOptions };

function response(status = 200): PdFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    json: async () => ({}),
    text: async () => '',
  };
}

function populatedState(): TutorialState {
  return {
    claimedPorts: ['tutorial:demo:learn'],
    sessionId: 'session-tutorial',
    agentId: 'agent-tutorial',
    dnsIdentity: 'tutorial:dns:lesson9',
    lockName: 'tutorial-lock',
    lockOwnerAgent: 'tutorial-lock-agent',
    inboxSenderAgent: 'tutorial-alice',
    inboxReceiverAgent: 'tutorial-bob',
  };
}

describe('pd learn cleanup lifecycle', () => {
  test('normal completion and thrown errors both run cleanup', async () => {
    let cleanups = 0;
    await runWithTutorialCleanup(async () => {}, async () => { cleanups += 1; });
    expect(cleanups).toBe(1);

    await expect(runWithTutorialCleanup(
      async () => { throw new Error('lesson failed'); },
      async () => { cleanups += 1; },
    )).rejects.toThrow('lesson failed');
    expect(cleanups).toBe(2);
  });

  test('releases every temporary resource once and satisfies the pd done sentinel', async () => {
    const state = populatedState();
    const calls: FetchCall[] = [];
    const fakeFetch = async (path: string, options?: FetchOptions): Promise<PdFetchResponse> => {
      calls.push({ path, options });
      return response();
    };

    await cleanupTutorialState(state, fakeFetch);
    await cleanupTutorialState(state, fakeFetch);

    expect(calls.map(({ path }) => path)).toEqual([
      '/release',
      '/sugar/done',
      '/dns/tutorial%3Adns%3Alesson9',
      '/locks/tutorial-lock',
      '/agents/tutorial-lock-agent',
      '/agents/tutorial-bob/inbox',
      '/agents/tutorial-bob',
      '/agents/tutorial-alice',
    ]);
    const done = calls.find(({ path }) => path === '/sugar/done');
    const doneBody = JSON.parse(String(done?.options?.body));
    expect(doneBody).toEqual({
      agentId: 'agent-tutorial',
      sessionId: 'session-tutorial',
      note: 'Result: Tutorial cleanup completed. not-applicable: tutorial exercise',
    });
    expect(state).toEqual({
      claimedPorts: [],
      sessionId: null,
      agentId: null,
      dnsIdentity: undefined,
      lockName: undefined,
      lockOwnerAgent: undefined,
      inboxSenderAgent: undefined,
      inboxReceiverAgent: undefined,
    });
  });

  test('one failed cleanup request does not strand independent resources', async () => {
    const state = populatedState();
    const calls: string[] = [];
    const fakeFetch = async (path: string): Promise<PdFetchResponse> => {
      calls.push(path);
      if (path === '/agents/tutorial-bob/inbox') throw new Error('inbox route unavailable');
      return response();
    };

    await cleanupTutorialState(state, fakeFetch);

    expect(calls).toContain('/agents/tutorial-bob');
    expect(calls).toContain('/agents/tutorial-alice');
    expect(state.inboxReceiverAgent).toBeUndefined();
    expect(state.inboxSenderAgent).toBeUndefined();
  });

  test('preserves the lock owner until a failed lock release can be retried', async () => {
    const state = populatedState();
    const calls: string[] = [];
    let lockReleaseStatus = 500;
    const fakeFetch = async (path: string): Promise<PdFetchResponse> => {
      calls.push(path);
      if (path === '/locks/tutorial-lock') return response(lockReleaseStatus);
      return response();
    };

    await cleanupTutorialState(state, fakeFetch);

    expect(state.lockName).toBe('tutorial-lock');
    expect(state.lockOwnerAgent).toBe('tutorial-lock-agent');
    expect(calls).not.toContain('/agents/tutorial-lock-agent');
    expect(state.inboxReceiverAgent).toBeUndefined();
    expect(state.inboxSenderAgent).toBeUndefined();

    lockReleaseStatus = 200;
    await cleanupTutorialState(state, fakeFetch);

    expect(state.lockName).toBeUndefined();
    expect(state.lockOwnerAgent).toBeUndefined();
    expect(calls).toContain('/agents/tutorial-lock-agent');
  });
});
