import { afterEach, describe, expect, jest, test } from '@jest/globals';
import {
  fetchSugarParleyCard,
  credentialForBegunSugarContext,
  SUGAR_PARLEY_CARD_TIMEOUT_MS,
  shouldShowSugarParleyExperience,
} from '../../cli/commands/sugar.js';
import { handleAttention } from '../../cli/commands/attention.js';
import type { SugarParleyCard } from '../../lib/sugar-parley.js';

const originalCredential = process.env.PD_ACTOR_CREDENTIAL;

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

  test('leaves JSON, quiet, export, and noninteractive begins deterministic while retaining an ANSI-free no-color card', () => {
    expect(shouldShowSugarParleyExperience({}, true, {})).toBe(true);
    expect(shouldShowSugarParleyExperience({ json: true }, true, {})).toBe(false);
    expect(shouldShowSugarParleyExperience({ quiet: true }, true, {})).toBe(false);
    expect(shouldShowSugarParleyExperience({}, false, {})).toBe(false);
    expect(shouldShowSugarParleyExperience({}, true, { NO_COLOR: '1' })).toBe(true);
    expect(shouldShowSugarParleyExperience({}, true, { PORT_DADDY_NON_INTERACTIVE: '1' })).toBe(false);
    expect(shouldShowSugarParleyExperience({}, true, { PD_EMIT_EXPORTS: '1' })).toBe(false);
  });
});
