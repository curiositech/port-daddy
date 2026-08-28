import { describe, expect, test } from '@jest/globals';
import { renderSugarParleyCard } from '../../cli/utils/sugar-parley-card.js';
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
});
