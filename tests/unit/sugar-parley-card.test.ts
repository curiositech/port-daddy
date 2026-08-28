import { describe, expect, test } from '@jest/globals';
import { renderAttentionLinework } from '../../cli/commands/attention.js';
import { renderSugarParleyAttention, renderSugarParleyCard } from '../../cli/utils/sugar-parley-card.js';
import type { SugarParleyCard } from '../../lib/sugar-parley.js';
import { visibleWidth } from '../../cli/utils/ui.js';

function card(): SugarParleyCard {
  return {
    kind: 'sugar_parley_card',
    schemaVersion: 1,
    cardId: 'sugar-parley-card:v1:fixture',
    signalId: 'parley-signal:v1:fixture',
    surface: 'session-begin:lib/shared.ts#createShared',
    reason: 'A semantically reviewed live peer holds an exact overlapping claim.',
    participants: [
      { actorId: 'actor-a', agentId: 'source-agent', sessionId: 'session-a' },
      { actorId: 'actor-b', agentId: 'peer-agent', sessionId: 'session-b' },
    ],
    semanticEvidence: {
      peerAgentId: 'peer-agent',
      peerActorId: 'actor-b',
      stage: 'semantic',
      resolverStage: 'semantic',
      score: 0.93,
      similarity: 0.95,
      phrase: 'coordinate shared workflow',
      evidenceRef: 'semantic-peer:actor-b:peer-agent:semantic',
    },
    structuralEvidence: {
      address: { filePath: 'lib/shared.ts', symbolPath: 'createShared', startLine: 10, endLine: 30 },
      sourceClaimRef: 'session-claim:session-a:lib/shared.ts#createShared:1',
      peerClaimRef: 'session-claim:session-b:lib/shared.ts#createShared:2',
    },
    decision: {
      convene: true,
      checkpoint: 'session_begin',
      signalId: 'parley-signal:v1:fixture',
      policyCleared: true,
      unresolved: 1,
      expectedWaste: 1.9,
      margin: 0.9,
      terminated: null,
      reason: 'fixture',
    },
    bounds: { maxParleyRounds: 2, turnsPerParty: 3, cooldownMs: 300_000 },
    actions: [
      { id: 'work-separately', label: 'Work separately', enabled: true, reason: null },
      { id: 'send-note', label: 'Send note', enabled: true, reason: null },
      { id: 'resolve-together', label: 'Resolve together', enabled: true, reason: null },
    ],
  };
}

function summonsPayload(): Record<string, unknown> {
  return {
    kind: 'parley_summons',
    parleyId: 'parley-42',
    surface: 'cli/commands/attention.ts#renderAttentionLinework',
    reason: 'Two active agents are working in the same attention view.',
    sugarHookContext: {
      kind: 'sugar_parley_hook_context',
      schemaVersion: 1,
      origin: 'sugar-parley',
      parleyId: 'parley-42',
      cardId: 'sugar-parley-card:v1:parley-42',
      surface: 'cli/commands/attention.ts#renderAttentionLinework',
      evidenceRefs: ['claim:attention-renderer', 'claim:sugar-experience'],
      message: '⚑ PARLEY BEGUN ⚑ A bounded Sugar Parley is active.',
    },
  };
}

function messagePayload(): Record<string, unknown> {
  return {
    kind: 'sugar_parley_message',
    schemaVersion: 1,
    origin: 'sugar-parley',
    parleyId: 'parley-42',
    cardId: 'sugar-parley-card:v1:parley-42',
    surface: 'cli/commands/attention.ts#renderAttentionLinework',
    fromActorId: 'actor-peer',
    message: 'I can take the plain output while you keep the card compact.',
    evidenceRefs: ['claim:attention-renderer'],
    turnSequence: 2,
    at: 1_725_000_000_000,
  };
}

function settlementPayload(): Record<string, unknown> {
  return {
    kind: 'sugar_parley_settlement_receipt',
    schemaVersion: 1,
    state: 'settled',
    origin: 'sugar-parley',
    parleyId: 'parley-42',
    harbor: 'port-daddy',
    proposalId: 'proposal-42',
    surface: 'cli/commands/attention.ts#renderAttentionLinework',
    evidenceRefs: ['claim:attention-renderer'],
    outcome: {
      parleyId: 'parley-42',
      status: 'COLLAPSED',
      decision: 'split the presentation work',
      reason: 'The work is now clearly divided.',
      resolvedBy: 'actor-peer',
      dissenters: [],
      at: 1_725_000_000_000,
    },
    claimUpdates: [{ sessionId: 'session-peer', claimRef: 'claim:attention-renderer', released: true }],
    planUpdates: [{ sessionId: 'session-peer', updated: true }],
    remindersSuppressed: true,
    replayed: false,
    reason: 'One agent owns the plain output and the other owns the compact card.',
  };
}

describe('Sugar Parley card renderer', () => {
  test('renders all human actions without exposing raw protocol verbs', () => {
    const result = renderSugarParleyCard(card(), { styled: false, width: 88 });

    expect(result).toContain('Coordination');
    expect(result).toContain('Work separately');
    expect(result).toContain('Send note');
    expect(result).toContain('Resolve together');
    expect(result).not.toMatch(/\b(propose|critique|revise|agree)\b/);
  });

  test('is ANSI-free and width-bounded in no-color narrow-terminal mode', () => {
    const result = renderSugarParleyCard(card(), { styled: false, width: 40 });

    expect(result).not.toMatch(/\u001B\[/);
    expect(result.split('\n').every((line) => visibleWidth(line) <= 40)).toBe(true);
  });

  test('renders only sealed Sugar attention payloads in natural language', () => {
    const summons = renderSugarParleyAttention(summonsPayload(), { styled: false, width: 88 });

    expect(summons).toContain('⚑ PARLEY BEGUN ⚑');
    expect(summons).toContain('Two active agents are working in the same attention view.');
    expect(summons).toContain('Reply in plain language');
    expect(summons).not.toMatch(/sugar_parley_hook_context|schemaVersion|evidenceRefs|parleyId|typed receipt/);

    const unsealed = summonsPayload();
    (unsealed.sugarHookContext as Record<string, unknown>).origin = 'other-system';
    expect(renderSugarParleyAttention(unsealed, { styled: false })).toBeNull();
    expect(renderSugarParleyAttention({ kind: 'parley_summons', reason: 'lookalike' }, { styled: false })).toBeNull();

    const unsealedMessage = messagePayload();
    unsealedMessage.origin = 'other-system';
    expect(renderSugarParleyAttention(unsealedMessage, { styled: false })).toBeNull();

    const unsealedSettlement = settlementPayload();
    unsealedSettlement.state = 'pending';
    expect(renderSugarParleyAttention(unsealedSettlement, { styled: false })).toBeNull();
  });

  test('uses the Sugar frame from pd attention pretty output', () => {
    const result = renderAttentionLinework({
      success: true,
      bound: true,
      agentId: 'attention-renderer',
      counts: { total: 1, inbox: 1, channels: 0, inboxUnreadRemaining: 0 },
      subscriptions: [],
      items: [{
        source: 'inbox',
        id: 'attention-42',
        agentId: 'attention-renderer',
        from: 'peer-agent',
        channel: null,
        type: 'parley_summons',
        content: summonsPayload(),
        contentType: 'json',
        receivedAt: Date.now(),
      }],
    });

    expect(result).toContain('⚑ PARLEY BEGUN ⚑');
    expect(result).toContain('Shared work needs a quick decision');
    expect(result).not.toMatch(/sugar_parley_hook_context|schemaVersion|evidenceRefs|parleyId/);
  });

  test('renders message and settlement frames without receipt plumbing', () => {
    const message = renderSugarParleyAttention(messagePayload(), { styled: false, width: 88 });
    const settlement = renderSugarParleyAttention(settlementPayload(), { styled: false, width: 88 });

    expect(message).toContain('PARLEY UPDATE');
    expect(message).toContain('I can take the plain output while you keep the card compact.');
    expect(message).not.toMatch(/sugar_parley_message|fromActorId|turnSequence/);
    expect(settlement).toContain('PARLEY SETTLED');
    expect(settlement).toContain('One agent owns the plain output and the other owns the compact card.');
    expect(settlement).not.toMatch(/sugar_parley_settlement_receipt|claimUpdates|planUpdates|proposalId/);
  });

  test('keeps every Sugar attention frame ANSI-free and narrow-terminal-safe', () => {
    const outputs = [summonsPayload(), messagePayload(), settlementPayload()].map((payload) => {
      const output = renderSugarParleyAttention(payload, { styled: false, width: 36 });
      expect(output).not.toBeNull();
      return output!;
    });

    for (const output of outputs) {
      expect(output).not.toMatch(/\u001B\[/);
      expect(output.split('\n').every((line) => visibleWidth(line) <= 36)).toBe(true);
    }
  });
});
