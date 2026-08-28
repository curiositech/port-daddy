import { afterEach, describe, expect, jest, test } from '@jest/globals';
import type { SugarParleyCard } from '../../lib/sugar-parley.js';

const mockIsatty = jest.fn<(fd: number) => boolean>(() => false);

jest.unstable_mockModule('node:tty', () => ({
  ...jest.requireActual<typeof import('node:tty')>('node:tty'),
  isatty: mockIsatty,
}));

const {
  fetchSugarParleyCard,
  fetchHelpfulPeerSuggestions,
  credentialForBegunSugarContext,
  SUGAR_PARLEY_CARD_TIMEOUT_MS,
  shouldShowSugarParleyExperience,
} = await import('../../cli/commands/sugar.js');
const { handleAttention } = await import('../../cli/commands/attention.js');
const { canPrompt, lineworkColorLevel } = await import('../../cli/utils/ui.js');
const { renderSugarParleyCard } = await import('../../cli/utils/sugar-parley-card.js');

const originalCredential = process.env.PD_ACTOR_CREDENTIAL;
const terminalStreams = [process.stdin, process.stdout, process.stderr] as const;
const originalTtyDescriptors = terminalStreams.map((stream) => Object.getOwnPropertyDescriptor(stream, 'isTTY'));
const promptEnvironmentKeys = ['CI', 'NO_COLOR', 'FORCE_COLOR', 'PORT_DADDY_NON_INTERACTIVE', 'PD_EMIT_EXPORTS'] as const;
const originalPromptEnvironment = Object.fromEntries(
  promptEnvironmentKeys.map((key) => [key, process.env[key]]),
) as Record<(typeof promptEnvironmentKeys)[number], string | undefined>;

function pinTerminalFds(activeFds: readonly number[]): void {
  mockIsatty.mockImplementation((fd) => activeFds.includes(fd));
  for (const stream of terminalStreams) {
    Object.defineProperty(stream, 'isTTY', { configurable: true, value: false });
  }
}

function restoreTerminalFds(): void {
  for (const [index, stream] of terminalStreams.entries()) {
    const descriptor = originalTtyDescriptors[index];
    if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor);
    else delete (stream as { isTTY?: boolean }).isTTY;
  }
  mockIsatty.mockReset();
  mockIsatty.mockImplementation(() => false);
}

function card(): SugarParleyCard {
  return {
    kind: 'sugar_parley_card',
    schemaVersion: 1,
    cardId: 'sugar-parley-card:v1:test',
    signalId: 'parley-signal:v1:test',
    surface: 'session-begin:lib/shared.ts#createShared',
    reason: 'A semantically reviewed live peer holds an exact overlapping claim.',
    participants: [
      { actorId: 'actor-source', agentId: 'source', sessionId: 'session-source' },
      { actorId: 'actor-peer', agentId: 'peer', sessionId: 'session-peer' },
    ],
    semanticEvidence: {
      peerAgentId: 'peer', peerActorId: 'actor-peer', stage: 'semantic', resolverStage: 'semantic', score: 0.94, similarity: 0.96,
      phrase: 'coordinate shared workflow', evidenceRef: 'semantic-peer:actor-peer:peer:semantic',
    },
    structuralEvidence: {
      address: { filePath: 'lib/shared.ts', symbolPath: 'createShared', startLine: 10, endLine: 30 },
      sourceClaimRef: 'session-claim:session-source:lib/shared.ts#createShared:1',
      peerClaimRef: 'session-claim:session-peer:lib/shared.ts#createShared:2',
    },
    decision: {
      convene: true, checkpoint: 'session_begin', signalId: 'parley-signal:v1:test', policyCleared: true,
      unresolved: 1, expectedWaste: 1.9, margin: 0.9, terminated: null, reason: 'fixture',
    },
    bounds: { maxParleyRounds: 2, turnsPerParty: 3, cooldownMs: 300_000 },
    actions: [
      { id: 'work-separately', label: 'Work separately', enabled: true, reason: null },
      { id: 'send-note', label: 'Send note', enabled: true, reason: null },
      { id: 'resolve-together', label: 'Resolve together', enabled: true, reason: null },
    ],
  };
}

afterEach(() => {
  if (originalCredential === undefined) delete process.env.PD_ACTOR_CREDENTIAL;
  else process.env.PD_ACTOR_CREDENTIAL = originalCredential;
  for (const key of promptEnvironmentKeys) {
    const value = originalPromptEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  restoreTerminalFds();
});

describe('pd begin Sugar Parley arrival enrichment', () => {
  test('a normal active attention pass offers the Sugar card against the current durable session', async () => {
    const priorAgentId = process.env.PD_AGENT_ID;
    const priorSessionId = process.env.PD_SESSION_ID;
    process.env.PD_AGENT_ID = 'agent-x';
    process.env.PD_SESSION_ID = 'session-x';
    const fetcher = jest.fn(async () => new Response(JSON.stringify({
      success: true,
      agentId: 'agent-x',
      items: [],
      counts: { total: 0, inbox: 0, channels: 0, inboxUnreadRemaining: 0 },
      subscriptions: [],
      peek: false,
      generatedAt: 1234,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const sugarParleyOffer = jest.fn(async () => undefined);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await handleAttention({}, { fetch: fetcher, sugarParleyOffer });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(sugarParleyOffer).toHaveBeenCalledWith(
        'agent-x',
        'session-x',
        expect.objectContaining({}),
      );
    } finally {
      logSpy.mockRestore();
      if (priorAgentId === undefined) delete process.env.PD_AGENT_ID;
      else process.env.PD_AGENT_ID = priorAgentId;
      if (priorSessionId === undefined) delete process.env.PD_SESSION_ID;
      else process.env.PD_SESSION_ID = priorSessionId;
    }
  });

  test('keeps the credential that authenticated a repeated begin despite a new generated display handle', () => {
    expect(credentialForBegunSugarContext(null, 'carried-credential')).toBe('carried-credential');
    expect(credentialForBegunSugarContext('newly-minted-credential', 'carried-credential')).toBe('newly-minted-credential');
    expect(credentialForBegunSugarContext(null, undefined)).toBeNull();
  });

  test('uses the daemon card verbatim with the minted credential and no client-side overlap inference', async () => {
    process.env.PD_ACTOR_CREDENTIAL = 'test-credential';
    const fetcher = jest.fn(async (path: string, options?: Record<string, unknown>) => ({
      ok: true,
      status: 200,
      headers: {},
      json: async () => ({ success: true, state: 'ready', card: card() }),
      text: async () => '',
    }));

    const result = await fetchSugarParleyCard(
      'source',
      'session-source',
      fetcher as any,
    );

    expect(result).toEqual(card());
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/sugar/parley-card?'),
      expect.objectContaining({
        timeout: SUGAR_PARLEY_CARD_TIMEOUT_MS,
        retry: false,
        headers: { 'x-actor-credential': 'test-credential' },
      }),
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('sessionId=session-source');
    expect(String(fetcher.mock.calls[0]?.[0])).not.toContain('purpose=');
  });

  test('asks Whois for semantic review before offering ordinary begin peer guidance', async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        hits: [{
          agentId: 'peer',
          agentName: 'Peer',
          harbor: 'local',
          phrase: 'coordinate shared work',
          score: 0.95,
          similarity: 0.96,
          bm25Score: 1,
          freshnessWeight: 1,
          lastHeartbeat: 1_700_000_000_000,
          stage: 'semantic',
          source: 'declared',
        }],
      }),
    }));

    await expect(fetchHelpfulPeerSuggestions('coordinate shared work', 'source', fetcher as any))
      .resolves.toEqual([expect.objectContaining({ agentId: 'peer', stage: 'semantic' })]);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('semantic_review=true');
  });

  test('does not turn an absent or not-ready server observation into a card', async () => {
    process.env.PD_ACTOR_CREDENTIAL = 'test-credential';
    const fetcher = async () => ({
      ok: true,
      status: 200,
      headers: {},
      json: async () => ({ success: true, state: 'none', reason: 'No grounded overlap.' }),
      text: async () => '',
    });

    await expect(fetchSugarParleyCard('source', 'session-source', fetcher as any))
      .resolves.toBeNull();
  });

  test('derives the default Sugar prompt capability from TTYs, not color policy', () => {
    delete process.env.CI;
    delete process.env.PORT_DADDY_NON_INTERACTIVE;
    delete process.env.PD_EMIT_EXPORTS;
    process.env.NO_COLOR = '1';
    pinTerminalFds([0, 1, 2]);

    expect(canPrompt()).toBe(true);
    expect(shouldShowSugarParleyExperience({})).toBe(true);
    expect(renderSugarParleyCard(card(), { colorLevel: lineworkColorLevel('stderr') })).not.toContain('\u001b[');

    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '3';
    pinTerminalFds([]);

    expect(canPrompt()).toBe(false);
    expect(shouldShowSugarParleyExperience({})).toBe(false);
  });

  test('leaves JSON, quiet, export, and explicit noninteractive begins deterministic', () => {
    expect(shouldShowSugarParleyExperience({}, true, {})).toBe(true);
    expect(shouldShowSugarParleyExperience({ json: true }, true, {})).toBe(false);
    expect(shouldShowSugarParleyExperience({ quiet: true }, true, {})).toBe(false);
    expect(shouldShowSugarParleyExperience({}, false, {})).toBe(false);
    expect(shouldShowSugarParleyExperience({}, true, { NO_COLOR: '1' })).toBe(true);
    expect(shouldShowSugarParleyExperience({}, true, { PORT_DADDY_NON_INTERACTIVE: '1' })).toBe(false);
    expect(shouldShowSugarParleyExperience({}, true, { PD_EMIT_EXPORTS: '1' })).toBe(false);
  });
});
