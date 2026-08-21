// tests/unit/purser/cleanup-idempotency.test.ts
import { describe, expect, test } from 'bun:test';
import {
  cleanupTutorialState,
  type TutorialState,
} from '../../../cli/commands/tutorial.ts';
import type { FetchOptions, PdFetchResponse } from '../../../cli/utils/fetch.ts';

/** Simple mock response that always succeeds. */
function successResponse(status = 200): PdFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    json: async () => ({}),
    text: async () => '',
  };
}

/** Populate a state that mimics a fully‑filled tutorial session. */
function makePopulatedState(): TutorialState {
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

describe('tutorial cleanup idempotency', () => {
  test('cleanup runs twice without error and clears state', async () => {
    const state = makePopulatedState();
    const calls: Array<{ path: string; options?: FetchOptions }> = [];

    /** Fake fetch that records calls and always returns success. */
    const fakeFetch = async (
      path: string,
      options?: FetchOptions
    ): Promise<PdFetchResponse> => {
      calls.push({ path, options });
      return successResponse();
    };

    // First cleanup – should perform all deletions
    await cleanupTutorialState(state, fakeFetch);

    // Second cleanup – should be a no‑op and not throw
    await expect(
      cleanupTutorialState(state, fakeFetch)
    ).resolves.not.toThrow();

    // After both cleanups, state must be reset
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

    // No new fetch calls after the first cleanup
    const expectedPaths = [
      '/release',
      '/sugar/done',
      '/dns/tutorial%3Adns%3Alesson9',
      '/locks/tutorial-lock',
      '/agents/tutorial-lock-agent',
      '/agents/tutorial-bob/inbox',
      '/agents/tutorial-bob',
      '/agents/tutorial-alice',
    ];
    const actualPaths = calls.map((c) => c.path);
    expect(actualPaths).toEqual(expectedPaths);

    // Verify the /sugar/done body contains the exact sentinel
    const doneCall = calls.find((c) => c.path === '/sugar/done');
    expect(doneCall).toBeDefined();
    const doneBody = JSON.parse(String(doneCall?.options?.body));
    expect(doneBody).toEqual({
      agentId: 'agent-tutorial',
      sessionId: 'session-tutorial',
      note:
        'Result: Tutorial cleanup completed. not-applicable: tutorial exercise',
    });
  });

  test('cleanup ignores already‑deleted resources and continues', async () => {
    const state = makePopulatedState();
    const calls: string[] = [];

    /** Fake fetch that throws for the inbox delete route. */
    const errorFetch = async (path: string): Promise<PdFetchResponse> => {
      calls.push(path);
      if (path === '/agents/tutorial-bob/inbox')
        throw new Error('inbox route unavailable');
      return successResponse();
    };

    await cleanupTutorialState(state, errorFetch);

    // All other resources should have been attempted
    expect(calls).toContain('/release');
    expect(calls).toContain('/sugar/done');
    expect(calls).toContain('/dns/tutorial%3Adns%3Alesson9');
    expect(calls).toContain('/locks/tutorial-lock');
    expect(calls).toContain('/agents/tutorial-lock-agent');
    expect(calls).toContain('/agents/tutorial-bob'); // delete inbox failed, but delete agent should still run
    expect(calls).toContain('/agents/tutorial-alice');

    // The inbox delete failure should not prevent cleanup of other resources
    expect(state.inboxReceiverAgent).toBeUndefined();
    expect(state.inboxSenderAgent).toBeUndefined();
  });
});