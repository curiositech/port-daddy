import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type FetchOptions = { method?: string; headers?: Record<string, string>; body?: string };
type FetchResponse = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};
type TutorialState = {
  claimedPorts: string[];
  sessionId: string | null;
  agentId: string | null;
  dnsIdentity?: string;
  lockName?: string;
  lockOwnerAgent?: string;
  inboxSenderAgent?: string;
  inboxReceiverAgent?: string;
};
type FetchCall = { path: string; options?: FetchOptions };
type TutorialModule = {
  cleanupTutorialState: (
    state: TutorialState,
    fetchImpl: (path: string, options?: FetchOptions) => Promise<FetchResponse>,
  ) => Promise<void>;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TUTORIAL_SOURCE = readFileSync(join(ROOT, 'cli', 'commands', 'tutorial.ts'), 'utf8');
const PRODUCT_READY = TUTORIAL_SOURCE.includes('export async function cleanupTutorialState(');

function response(status = 200): FetchResponse {
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

async function loadProduct(): Promise<TutorialModule> {
  const module = await import('../../../cli/commands/tutorial.ts') as unknown as Record<string, unknown>;
  if (typeof module.cleanupTutorialState !== 'function') {
    throw new TypeError('tutorial product marker exists without cleanupTutorialState export');
  }
  return module as TutorialModule;
}

describe('tutorial cleanup idempotency', () => {
  test('successful cleanup uses exact payloads and a second pass is a no-op', async () => {
    if (!PRODUCT_READY) {
      expect(TUTORIAL_SOURCE).not.toContain('export async function cleanupTutorialState(');
      return;
    }

    const { cleanupTutorialState } = await loadProduct();
    const state = populatedState();
    const calls: FetchCall[] = [];
    const fakeFetch = async (path: string, options?: FetchOptions): Promise<FetchResponse> => {
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
    expect(JSON.parse(String(calls.find(({ path }) => path === '/sugar/done')?.options?.body))).toEqual({
      agentId: 'agent-tutorial',
      sessionId: 'session-tutorial',
      note: 'Result: Tutorial cleanup completed. not-applicable: tutorial exercise',
    });
    expect(JSON.parse(String(calls.find(({ path }) => path === '/locks/tutorial-lock')?.options?.body))).toEqual({
      owner: 'tutorial-lock-agent',
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

  test('404 responses are idempotent success for already-removed resources', async () => {
    if (!PRODUCT_READY) return;

    const { cleanupTutorialState } = await loadProduct();
    const state = populatedState();
    await cleanupTutorialState(state, async () => response(404));

    expect(state.claimedPorts).toEqual([]);
    expect(state.sessionId).toBeNull();
    expect(state.agentId).toBeNull();
    expect(state.dnsIdentity).toBeUndefined();
    expect(state.lockName).toBeUndefined();
    expect(state.lockOwnerAgent).toBeUndefined();
    expect(state.inboxSenderAgent).toBeUndefined();
    expect(state.inboxReceiverAgent).toBeUndefined();
  });
});
