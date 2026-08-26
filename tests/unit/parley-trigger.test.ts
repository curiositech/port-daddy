/** Tests for the bounded structural Parley checkpoint gate. */

import { describe, expect, test } from '@jest/globals';
import {
  buildConversationalDiagnosticSignal,
  conflictSignalId,
  CONFLICT_SIGNAL_KINDS,
  CONFLICT_SIGNAL_LIMITS,
  CONFLICT_SIGNAL_PRODUCERS,
  CONFLICT_SIGNAL_SCHEMA_VERSION,
  PARLEY_CHECKPOINT_POLICIES,
  PARLEY_CHECKPOINTS,
  PARLEY_SHAPES,
  shouldConvene,
  type ConflictSignal,
  type ConflictSignalKind,
  type ParleyCheckpoint,
  type ParleyEvaluationOptions,
  type ParleyShape,
} from '../../lib/parley-trigger.js';
import type { ThreadDigest } from '../../lib/discourse-lineage.js';

const PRODUCED_AT = 1_800_000_000_000;

function automaticProducer(checkpoint: ParleyCheckpoint) {
  return {
    conversation: CONFLICT_SIGNAL_PRODUCERS.conversationConflict,
    claim: CONFLICT_SIGNAL_PRODUCERS.claimConflict,
    session_begin: CONFLICT_SIGNAL_PRODUCERS.sessionBeginConvergence,
    session_takeover: CONFLICT_SIGNAL_PRODUCERS.sessionTakeoverConflict,
    continuation_accept: CONFLICT_SIGNAL_PRODUCERS.continuationConflict,
    quorum_vote: CONFLICT_SIGNAL_PRODUCERS.quorumVoteConflict,
    guard_receipt: CONFLICT_SIGNAL_PRODUCERS.guardReceiptConflict,
  }[checkpoint];
}

function autoSignal(overrides: Partial<ConflictSignal> = {}): ConflictSignal {
  const signal: ConflictSignal = {
    schemaVersion: CONFLICT_SIGNAL_SCHEMA_VERSION,
    signalId: '',
    kind: 'claim_overlap',
    checkpoint: 'claim',
    shape: 'contract-net',
    parties: ['agent-a', 'agent-b'],
    surface: 'lib/example.ts#run',
    magnitude: 1,
    confidence: 0.95,
    reason: 'two live claims resolve to the same symbol',
    evidenceRefs: ['claim:a', 'claim:b'],
    provenance: {
      producer: CONFLICT_SIGNAL_PRODUCERS.claimConflict,
      trustTier: 'INTERNAL',
      producedAt: PRODUCED_AT,
    },
    ...overrides,
  };

  return {
    ...signal,
    provenance: overrides.provenance ?? {
      producer: automaticProducer(signal.checkpoint),
      trustTier: 'INTERNAL',
      producedAt: PRODUCED_AT,
    },
    signalId: overrides.signalId ?? conflictSignalId({
      checkpoint: signal.checkpoint,
      kind: signal.kind,
      surface: signal.surface,
      parties: signal.parties,
      evidenceRefs: signal.evidenceRefs,
    }),
  };
}

function digest(n = 1): ThreadDigest {
  const edges = Array.from({ length: n }, (_, i) => ({
    from: 100 + i,
    to: i,
    sender: i % 2 === 0 ? 'agent-b' : 'agent-a',
    relationship: 'contradicts' as const,
  }));
  return {
    total: n + 1,
    participants: ['agent-a', 'agent-b'],
    roots: [0],
    maxDepth: 1,
    byRelationship: { supports: 0, contradicts: n, extends: 0, narrows: 0, synthesizes: 0 },
    byPerformative: {},
    contradictions: edges,
    unresolvedContradictions: edges,
    typed: n > 0,
  };
}

function diagnosticSignal(): ConflictSignal {
  return buildConversationalDiagnosticSignal({
    channel: 'coordination',
    conversationId: 'conversation-1',
    digest: digest(),
    producer: CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
    producedAt: PRODUCED_AT,
  });
}

describe('ConflictSignal lifecycle contract', () => {
  test('publishes the ADR-0129 checkpoints, required kinds, and protocol shapes', () => {
    expect(CONFLICT_SIGNAL_SCHEMA_VERSION).toBe(1);
    expect(PARLEY_CHECKPOINTS).toEqual([
      'conversation',
      'claim',
      'session_begin',
      'session_takeover',
      'continuation_accept',
      'quorum_vote',
      'guard_receipt',
    ]);
    expect(CONFLICT_SIGNAL_KINDS).toEqual([
      'conversational_contradiction',
      'claim_overlap',
      'semantic_surface_conflict',
      'decision_contradiction',
      'task_convergence',
    ]);
    expect(PARLEY_SHAPES).toEqual(['debate-with-judge', 'contract-net']);

    const signal = autoSignal();
    expect(Object.keys(signal).sort()).toEqual([
      'checkpoint',
      'confidence',
      'evidenceRefs',
      'kind',
      'magnitude',
      'parties',
      'provenance',
      'reason',
      'schemaVersion',
      'shape',
      'signalId',
      'surface',
    ]);
    expect(signal.provenance).toEqual({
      producer: 'port-daddy:claim-conflict',
      trustTier: 'INTERNAL',
      producedAt: PRODUCED_AT,
    });
  });

  test.each<{
    kind: ConflictSignalKind;
    checkpoint: ParleyCheckpoint;
    shape: ParleyShape;
  }>([
    { kind: 'conversational_contradiction', checkpoint: 'conversation', shape: 'debate-with-judge' },
    { kind: 'claim_overlap', checkpoint: 'claim', shape: 'contract-net' },
    { kind: 'decision_contradiction', checkpoint: 'quorum_vote', shape: 'debate-with-judge' },
    { kind: 'task_convergence', checkpoint: 'session_begin', shape: 'contract-net' },
    { kind: 'semantic_surface_conflict', checkpoint: 'session_takeover', shape: 'debate-with-judge' },
  ])('admits $kind at the $checkpoint checkpoint as $shape', ({ kind, checkpoint, shape }) => {
    const decision = shouldConvene(
      autoSignal({ kind, checkpoint, shape }),
      { mode: 'automatic' },
    );
    expect(decision.policyCleared).toBe(true);
    expect(decision.convene).toBe(true);
    expect(decision.shape).toBe(shape);
    expect(decision.checkpoint).toBe(checkpoint);
  });

  test('central adapter builds an INTERNAL conversation signal with production time', () => {
    const signal = diagnosticSignal();
    expect(signal.checkpoint).toBe('conversation');
    expect(signal.kind).toBe('conversational_contradiction');
    expect(signal.shape).toBe('debate-with-judge');
    expect(signal.parties).toEqual(['agent-a', 'agent-b']);
    expect(signal.magnitude).toBe(1);
    expect(signal.evidenceRefs).toEqual(['tube-message:100:contradicts:0']);
    expect(signal.signalId).toMatch(/^parley-signal:v1:[a-f0-9]{64}$/);
    expect(signal.signalId).toBe(conflictSignalId({
      checkpoint: signal.checkpoint,
      kind: signal.kind,
      surface: signal.surface,
      parties: signal.parties,
      evidenceRefs: signal.evidenceRefs,
    }));
    expect(signal.provenance).toEqual({
      producer: CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
      trustTier: 'INTERNAL',
      producedAt: PRODUCED_AT,
    });
  });

  test('keeps signal identity stable when only production time changes', () => {
    const observation = {
      channel: 'coordination',
      conversationId: 'conversation-1',
      digest: digest(2),
      producer: CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
    } as const;
    const first = buildConversationalDiagnosticSignal({
      ...observation,
      producedAt: PRODUCED_AT,
    });
    const replay = buildConversationalDiagnosticSignal({
      ...observation,
      producedAt: PRODUCED_AT + 60_000,
    });

    expect(replay.signalId).toBe(first.signalId);
    expect(replay.provenance.producedAt).not.toBe(first.provenance.producedAt);
  });

  test('changes signal identity when a stable structural field changes', () => {
    const first = diagnosticSignal();
    const changedSurface = buildConversationalDiagnosticSignal({
      channel: 'different-channel',
      conversationId: 'conversation-1',
      digest: digest(),
      producer: CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
      producedAt: PRODUCED_AT,
    });
    expect(changedSurface.signalId).not.toBe(first.signalId);
  });

  test('keeps signal identity stable across party and evidence ordering', () => {
    const original = digest(2);
    const reordered: ThreadDigest = {
      ...original,
      participants: [...original.participants].reverse(),
      unresolvedContradictions: [...original.unresolvedContradictions].reverse(),
    };
    const first = buildConversationalDiagnosticSignal({
      channel: 'coordination',
      digest: original,
      producer: CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
      producedAt: PRODUCED_AT,
    });
    const replay = buildConversationalDiagnosticSignal({
      channel: 'coordination',
      digest: reordered,
      producer: CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
      producedAt: PRODUCED_AT,
    });
    expect(replay.signalId).toBe(first.signalId);
    expect(replay.parties).toEqual(first.parties);
    expect(replay.evidenceRefs).toEqual(first.evidenceRefs);
  });

  test('canonicalizes repeated evidence into the same structural body and economics', () => {
    const original = digest();
    const repeatedEvidence: ThreadDigest = {
      ...original,
      unresolvedContradictions: [
        original.unresolvedContradictions[0],
        original.unresolvedContradictions[0],
      ],
    };
    const first = buildConversationalDiagnosticSignal({
      channel: 'coordination',
      digest: original,
      producer: CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
      producedAt: PRODUCED_AT,
    });
    const replay = buildConversationalDiagnosticSignal({
      channel: 'coordination',
      digest: repeatedEvidence,
      producer: CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
      producedAt: PRODUCED_AT,
    });
    expect(replay).toEqual(first);
    expect(replay.evidenceRefs).toEqual(['tube-message:100:contradicts:0']);
    expect(replay.magnitude).toBe(1);
  });
});

describe('immutable checkpoint policy', () => {
  test('deep-freezes every server-owned lifecycle policy', () => {
    expect(Object.isFrozen(CONFLICT_SIGNAL_LIMITS)).toBe(true);
    expect(CONFLICT_SIGNAL_LIMITS).toEqual({
      maxParties: 32,
      maxEvidenceRefs: 256,
      maxSignalIdChars: 128,
      maxSurfaceChars: 1024,
      maxReasonChars: 2048,
      maxPartyChars: 128,
      maxEvidenceRefChars: 512,
    });
    expect(Object.isFrozen(PARLEY_CHECKPOINT_POLICIES)).toBe(true);
    for (const checkpoint of PARLEY_CHECKPOINTS) {
      const policy = PARLEY_CHECKPOINT_POLICIES[checkpoint];
      expect(Object.isFrozen(policy)).toBe(true);
      expect(Object.isFrozen(policy.costs)).toBe(true);
      expect(Object.isFrozen(policy.limits)).toBe(true);
      expect(Object.isFrozen(policy.automaticProducers)).toBe(true);
      expect(Object.isFrozen(policy.diagnosticProducers)).toBe(true);
      expect(Object.isFrozen(policy.kinds)).toBe(true);
      for (const kind of Object.values(policy.kinds)) {
        expect(Object.isFrozen(kind)).toBe(true);
      }
    }
  });

  test.each([
    'lib/parley-auto-trigger.ts#observeClaim',
    'lib/parley-auto-trigger.ts',
  ])('a single high-confidence exact claim overlap clears claim policy for %s', (surface) => {
    const decision = shouldConvene(
      autoSignal({ surface, magnitude: 1, confidence: 0.95 }),
      { mode: 'automatic' },
    );
    expect(decision.policyCleared).toBe(true);
    expect(decision.convene).toBe(true);
    expect(decision.shape).toBe('contract-net');
    expect(decision.unresolved).toBe(1);
  });

  test('uses structure rather than reason text', () => {
    const decision = shouldConvene(
      autoSignal({ reason: 'everything is calm; no classifier terms are present' }),
      { mode: 'automatic' },
    );
    expect(decision.policyCleared).toBe(true);
    expect(decision.convene).toBe(true);
  });

  test('rejects an allowlisted internal producer at the wrong lifecycle checkpoint', () => {
    const signal = autoSignal({
      provenance: {
        producer: CONFLICT_SIGNAL_PRODUCERS.quorumVoteConflict,
        trustTier: 'INTERNAL',
        producedAt: PRODUCED_AT,
      },
    });
    const decision = shouldConvene(signal, { mode: 'automatic' });

    expect(decision.policyCleared).toBe(false);
    expect(decision.convene).toBe(false);
    expect(decision.reason).toMatch(/not allowed for automatic claim evaluation/);
  });
});

describe('evaluation mode boundary', () => {
  test('accepts diagnostic conversation producers only in diagnostic mode', () => {
    const signal = diagnosticSignal();
    const diagnostic = shouldConvene(signal, { mode: 'diagnostic' });
    const automatic = shouldConvene(signal, { mode: 'automatic' });

    expect(diagnostic.policyCleared).toBe(true);
    expect(diagnostic.convene).toBe(true);
    expect(automatic.policyCleared).toBe(false);
    expect(automatic.convene).toBe(false);
    expect(automatic.reason).toMatch(/not allowed for automatic/);
  });

  test.each([
    ['costs', { mode: 'automatic', costs: { wastePerUnresolved: 0, parleyCost: 100 } }],
    ['round counters', { mode: 'automatic', limits: { priorRounds: 2 } }],
    ['delegation counters', { mode: 'automatic', limits: { delegationDepth: 5 } }],
    ['undefined override fields', { mode: 'automatic', costs: undefined, limits: undefined }],
  ])('automatic mode fails closed on caller-supplied %s', (_name, options) => {
    const decision = shouldConvene(autoSignal(), options as ParleyEvaluationOptions);
    expect(decision.policyCleared).toBe(false);
    expect(decision.convene).toBe(false);
    expect(decision.reason).toMatch(/automatic evaluation does not accept/);
  });

  test('diagnostic mode applies explicit cost and max-limit overrides', () => {
    const economic = shouldConvene(diagnosticSignal(), {
      mode: 'diagnostic',
      costs: { wastePerUnresolved: 10, parleyCost: 100 },
    });
    expect(economic.expectedWaste).toBe(10);
    expect(economic.convene).toBe(false);

    const terminated = shouldConvene(diagnosticSignal(), {
      mode: 'diagnostic',
      limits: { priorRounds: 1, maxRounds: 1 },
    });
    expect(terminated.terminated).toBe('max-rounds');
    expect(terminated.reason).toMatch(/max 1/);
  });
});

describe('fail-closed runtime validation', () => {
  const base = autoSignal();
  const hostileSignals: Array<[string, unknown]> = [
    ['non-object signal', null],
    ['unknown schema', { ...base, schemaVersion: 99 }],
    ['unknown checkpoint', { ...base, checkpoint: 'gate-a' }],
    ['unknown kind', { ...base, kind: 'free_text_conflict' }],
    ['unknown shape', { ...base, shape: 'town-hall' }],
    ['empty identity', { ...base, signalId: '  ' }],
    ['over-limit identity', { ...base, signalId: 'i'.repeat(CONFLICT_SIGNAL_LIMITS.maxSignalIdChars + 1) }],
    ['empty surface', { ...base, surface: '' }],
    ['over-limit surface', { ...base, surface: 's'.repeat(CONFLICT_SIGNAL_LIMITS.maxSurfaceChars + 1) }],
    ['empty reason', { ...base, reason: ' ' }],
    ['over-limit reason', { ...base, reason: 'r'.repeat(CONFLICT_SIGNAL_LIMITS.maxReasonChars + 1) }],
    ['empty evidence', { ...base, evidenceRefs: [] }],
    ['malformed evidence', { ...base, evidenceRefs: [''] }],
    ['duplicate evidence', { ...base, evidenceRefs: ['claim:a', 'claim:b', 'claim:b'] }],
    ['whitespace-normalized duplicate evidence', {
      ...base,
      evidenceRefs: ['claim:a', 'claim:b', ' claim:b '],
    }],
    ['over-limit evidence count', {
      ...base,
      evidenceRefs: Array.from(
        { length: CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs + 1 },
        (_, i) => `evidence:${i}`,
      ),
    }],
    ['over-limit evidence ref', {
      ...base,
      evidenceRefs: ['e'.repeat(CONFLICT_SIGNAL_LIMITS.maxEvidenceRefChars + 1)],
    }],
    ['one party', { ...base, parties: ['agent-a'] }],
    ['duplicate parties', { ...base, parties: ['agent-a', 'agent-b', 'agent-b'] }],
    ['whitespace-normalized duplicate parties', {
      ...base,
      parties: ['agent-a', 'agent-b', ' agent-b '],
    }],
    ['empty party', { ...base, parties: ['agent-a', ''] }],
    ['over-limit party count', {
      ...base,
      parties: Array.from(
        { length: CONFLICT_SIGNAL_LIMITS.maxParties + 1 },
        (_, i) => `agent-${i}`,
      ),
    }],
    ['over-limit party', {
      ...base,
      parties: ['agent-a', 'p'.repeat(CONFLICT_SIGNAL_LIMITS.maxPartyChars + 1)],
    }],
    ['NaN magnitude', { ...base, magnitude: Number.NaN }],
    ['infinite magnitude', { ...base, magnitude: Number.POSITIVE_INFINITY }],
    ['fractional magnitude', { ...base, magnitude: 1.5 }],
    ['negative magnitude', { ...base, magnitude: -1 }],
    ['NaN confidence', { ...base, confidence: Number.NaN }],
    ['infinite confidence', { ...base, confidence: Number.POSITIVE_INFINITY }],
    ['out-of-range confidence', { ...base, confidence: 1.1 }],
    ['absent provenance', { ...base, provenance: undefined }],
    ['forged producer', { ...base, provenance: { ...base.provenance, producer: 'forged' } }],
    ['external trust tier', { ...base, provenance: { ...base.provenance, trustTier: 'ANONYMOUS_EXTERNAL' } }],
    ['absent production time', { ...base, provenance: { producer: base.provenance.producer, trustTier: 'INTERNAL' } }],
    ['zero production time', { ...base, provenance: { ...base.provenance, producedAt: 0 } }],
    ['NaN production time', { ...base, provenance: { ...base.provenance, producedAt: Number.NaN } }],
  ];

  test.each(hostileSignals)('refuses %s without throwing', (_name, candidate) => {
    let decision: ReturnType<typeof shouldConvene> | undefined;
    expect(() => {
      decision = shouldConvene(candidate as ConflictSignal, { mode: 'automatic' });
    }).not.toThrow();
    expect(decision?.convene).toBe(false);
    expect(decision?.policyCleared).toBe(false);
    expect(decision?.terminated).toBeNull();
  });

  test.each([
    ['wrong identity for the same body', {
      ...base,
      signalId: `parley-signal:v1:${'0'.repeat(64)}`,
    }],
    ['reused identity after surface mutation', {
      ...base,
      surface: 'lib/other.ts#run',
    }],
    ['reused identity after evidence mutation', {
      ...base,
      evidenceRefs: ['claim:a', 'claim:c'],
    }],
  ])('refuses %s', (_name, candidate) => {
    const decision = shouldConvene(candidate as ConflictSignal, { mode: 'automatic' });

    expect(decision.convene).toBe(false);
    expect(decision.policyCleared).toBe(false);
    expect(decision.reason).toMatch(/identity does not match its structural fields/);
  });

  test('refuses malformed evaluation options without throwing', () => {
    const hostileOptions: unknown[] = [
      null,
      {},
      { mode: 'gate-a' },
      { mode: 'diagnostic', costs: { wastePerUnresolved: Number.NaN, parleyCost: 1 } },
      { mode: 'diagnostic', costs: { wastePerUnresolved: 1, parleyCost: -1 } },
      { mode: 'diagnostic', limits: { priorRounds: -1 } },
      { mode: 'diagnostic', limits: { delegationDepth: 1.5 } },
      { mode: 'diagnostic', limits: { maxRounds: Number.POSITIVE_INFINITY } },
    ];

    for (const options of hostileOptions) {
      expect(() => shouldConvene(
        autoSignal(),
        options as ParleyEvaluationOptions,
      )).not.toThrow();
      expect(shouldConvene(autoSignal(), options as ParleyEvaluationOptions).convene).toBe(false);
    }
  });

  test('does not truncate an adapter observation that exceeds evidence policy', () => {
    const signal = buildConversationalDiagnosticSignal({
      channel: 'coordination',
      digest: digest(CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs + 1),
      producer: CONFLICT_SIGNAL_PRODUCERS.messagingDiagnostic,
      producedAt: PRODUCED_AT,
    });
    const decision = shouldConvene(signal, { mode: 'diagnostic' });

    expect(signal.evidenceRefs).toHaveLength(CONFLICT_SIGNAL_LIMITS.maxEvidenceRefs + 1);
    expect(decision.convene).toBe(false);
    expect(decision.policyCleared).toBe(false);
    expect(decision.reason).toMatch(/evidence exceeds/);
  });
});

describe('economics and hard termination', () => {
  test('uses the uncalibrated confidence proxy and magnitude in the bootstrap heuristic', () => {
    const decision = shouldConvene(
      autoSignal({ magnitude: 3, confidence: 0.8 }),
      { mode: 'automatic' },
    );
    expect(decision.unresolved).toBe(3);
    expect(decision.expectedWaste).toBeCloseTo(4.8);
    expect(decision.margin).toBeCloseTo(3.8);
    expect(decision.convene).toBe(true);
  });

  test('requires expected waste to strictly exceed parley cost', () => {
    const decision = shouldConvene(diagnosticSignal(), {
      mode: 'diagnostic',
      costs: { wastePerUnresolved: 1, parleyCost: 1 },
    });
    expect(decision.expectedWaste).toBe(1);
    expect(decision.margin).toBe(0);
    expect(decision.policyCleared).toBe(true);
    expect(decision.convene).toBe(false);
  });

  test('hard-terminates diagnostic evaluation at the server max rounds', () => {
    const decision = shouldConvene(diagnosticSignal(), {
      mode: 'diagnostic',
      limits: { priorRounds: 2 },
    });
    expect(decision.convene).toBe(false);
    expect(decision.terminated).toBe('max-rounds');
    expect(decision.reason).toMatch(/max 2/);
  });

  test('hard-terminates diagnostic evaluation at the server delegation depth', () => {
    const decision = shouldConvene(diagnosticSignal(), {
      mode: 'diagnostic',
      limits: { delegationDepth: 5 },
    });
    expect(decision.convene).toBe(false);
    expect(decision.terminated).toBe('delegation-depth');
    expect(decision.reason).toMatch(/exceeds 4/);
  });
});
