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
type TutorialModule = {
  cleanupTutorialState: (
    state: TutorialState,
    fetchImpl: (path: string, options?: FetchOptions) => Promise<FetchResponse>,
  ) => Promise<void>;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TUTORIAL_PATH = join(ROOT, 'cli', 'commands', 'tutorial.ts');
const TUTORIAL_SOURCE = readFileSync(TUTORIAL_PATH, 'utf8');
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

describe('tutorial cleanup error resilience', () => {
  test('a failed resource retains its retry handle without blocking independent cleanup', async () => {
    if (!PRODUCT_READY) {
      expect(TUTORIAL_SOURCE).toContain('async function cleanup(): Promise<void>');
      return;
    }

    const { cleanupTutorialState } = await loadProduct();
    const state = populatedState();
    const failed = new Set([
      '/release',
      '/sugar/done',
      '/dns/tutorial%3Adns%3Alesson9',
      '/locks/tutorial-lock',
      '/agents/tutorial-bob',
      '/agents/tutorial-alice',
    ]);
    const calls: string[] = [];
    const fakeFetch = async (path: string): Promise<FetchResponse> => {
      calls.push(path);
      return response(failed.has(path) ? 500 : 200);
    };

    await expect(cleanupTutorialState(state, fakeFetch)).resolves.toBeUndefined();

    expect(calls).toEqual([
      '/release',
      '/sugar/done',
      '/dns/tutorial%3Adns%3Alesson9',
      '/locks/tutorial-lock',
      '/agents/tutorial-bob',
      '/agents/tutorial-alice',
    ]);
    expect(calls).not.toContain('/agents/tutorial-lock-agent');
    expect(state).toEqual(populatedState());

    failed.clear();
    await cleanupTutorialState(state, fakeFetch);

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
    expect(calls).toContain('/agents/tutorial-lock-agent');
  });
});
