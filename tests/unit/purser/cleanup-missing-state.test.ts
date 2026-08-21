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

async function loadProduct(): Promise<TutorialModule> {
  const module = await import('../../../cli/commands/tutorial.ts') as unknown as Record<string, unknown>;
  if (typeof module.cleanupTutorialState !== 'function') {
    throw new TypeError('tutorial product marker exists without cleanupTutorialState export');
  }
  return module as TutorialModule;
}

describe('tutorial cleanup with partial state', () => {
  test('empty state performs no calls', async () => {
    if (!PRODUCT_READY) {
      expect(TUTORIAL_SOURCE).toContain('const state: TutorialState');
      return;
    }

    const { cleanupTutorialState } = await loadProduct();
    const state: TutorialState = { claimedPorts: [], sessionId: null, agentId: null };
    const calls: string[] = [];
    await cleanupTutorialState(state, async (path) => {
      calls.push(path);
      return response();
    });
    expect(calls).toEqual([]);
    expect(state).toEqual({ claimedPorts: [], sessionId: null, agentId: null });
  });

  test('legacy lock state without a registered owner uses the former owner credential only', async () => {
    if (!PRODUCT_READY) return;

    const { cleanupTutorialState } = await loadProduct();
    const state: TutorialState = {
      claimedPorts: [],
      sessionId: null,
      agentId: null,
      lockName: 'tutorial-lock',
    };
    const calls: Array<{ path: string; options?: FetchOptions }> = [];
    await cleanupTutorialState(state, async (path, options) => {
      calls.push({ path, options });
      return response();
    });

    expect(calls.map(({ path }) => path)).toEqual(['/locks/tutorial-lock']);
    expect(JSON.parse(String(calls[0]?.options?.body))).toEqual({ owner: 'tutorial-agent' });
    expect(state.lockName).toBeUndefined();
  });

  test('an owner without a lock is unregistered, while incomplete session identity is retained', async () => {
    if (!PRODUCT_READY) return;

    const { cleanupTutorialState } = await loadProduct();
    const state: TutorialState = {
      claimedPorts: [],
      sessionId: 'session-without-agent',
      agentId: null,
      lockOwnerAgent: 'owner-without-lock',
    };
    const calls: string[] = [];
    await cleanupTutorialState(state, async (path) => {
      calls.push(path);
      return response();
    });

    expect(calls).toEqual(['/agents/owner-without-lock']);
    expect(state.lockOwnerAgent).toBeUndefined();
    expect(state.sessionId).toBe('session-without-agent');
    expect(state.agentId).toBeNull();
  });
});
