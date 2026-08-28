/**
 * Agent Harbor M6 — context pressure + Longshoreman compactor tests
 * (ADR-0097 phase 1; binder ch04; ch07 M6 gate lines 1–2).
 *
 * Gates covered here:
 *   - ch04 thresholds (0.60 / 0.75 / 0.85 / 0.92) fire at exact boundaries,
 *     fail-closed on unmeasurable windows;
 *   - the frozen F0 ContextEnvelope is consumed unmodified: assessment
 *     validates against the schema and reports (never corrects) self-report
 *     drift;
 *   - "force context threshold and see compaction packet": an
 *     envelope-derived trigger yields a schema-valid CompactionPacket whose
 *     sourceTranscript pins the ledger's real chain head;
 *   - the ch04 validator is EXECUTABLE: uncited factual claims fail, broken
 *     cross-field citations fail, citations to events the ledger does not
 *     hold fail, missing active obligations warn without failing;
 *   - "resume successor from packet and transcript": resume verifies the
 *     hash pin against the append-only ledger and refuses tampered or
 *     unvalidated packets;
 *   - the original transcript is never mutated: compaction only APPENDS.
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initDatabase, closeDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import {
  appendEvent,
  ensureEventLedgerSchema,
  readEvents,
  sessionChainHeadHash,
  verifySessionChain,
  type HarborPayload,
} from '../../lib/agent-harbor/event-ledger.js';
import {
  CONTEXT_PRESSURE_THRESHOLDS,
  assessContextEnvelope,
  buildContextEnvelope,
  classifyPressure,
  latestPressureFromLedger,
  pressureHistoryFromLedger,
  type ContextEnvelope,
} from '../../lib/agent-harbor/context-pressure.js';
import {
  CompactionValidationError,
  MAX_COMPACTION_PACKET_BYTES,
  MAX_PACKET_COMMANDS,
  MAX_SUCCESSOR_TRANSCRIPT_HANDLES,
  ResumeVerificationError,
  buildCompactionPacket,
  extractCommandsRun,
  resumeFromPacket,
  validateCitation,
  validateCompactionPacket,
  type BuildPacketInput,
  type CompactionPacket,
  type FactualClaim,
} from '../../lib/agent-harbor/compaction.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', '..', 'schemas', 'agent-harbor', 'v0', 'fixtures');

const SESSION = 'session_cpk_test_01';
const NODE = 'agent_node_cpk_test_01';

function evt(seq: number, kind: string, payloadJson: Record<string, unknown> = {}, overrides: HarborPayload = {}): HarborPayload {
  return {
    eventId: `evt_${SESSION}_${seq}`,
    sessionId: SESSION,
    agentNodeId: NODE,
    sequence: seq,
    occurredAt: new Date(Date.UTC(2026, 6, 6, 12, 0, seq)).toISOString(),
    schemaVersion: 1,
    kind,
    payloadJson,
    ...overrides,
  };
}

/** Seed a realistic little session: messages, a shell command, a file write. */
function seedSession(db: DatabaseInstance): void {
  appendEvent(db, { streamType: 'transcript-event', payload: evt(1, 'session_started') });
  appendEvent(db, { streamType: 'transcript-event', payload: evt(2, 'operator_message', { text: 'wire the webhook receiver' }) });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: evt(3, 'shell_command', { command: 'npx jest tests/unit/health-board.test.js', exitCode: 0, resultSummary: '12 passed' }),
  });
  appendEvent(db, { streamType: 'transcript-event', payload: evt(4, 'file_write', { path: 'src/routes/health-board.ts' }) });
  appendEvent(db, { streamType: 'transcript-event', payload: evt(5, 'assistant_message', { text: 'health board route added and tests pass' }) });
}

function citedClaim(text: string, transcriptEventId: string): FactualClaim {
  return { text, citations: [{ kind: 'transcript-event', transcriptEventId }] };
}

function packetInput(overrides: Partial<BuildPacketInput> = {}): BuildPacketInput {
  return {
    sessionId: SESSION,
    agentNodeId: NODE,
    runId: 'agent_run_cpk_test_01',
    createdBy: { kind: 'longshoreman', agentNodeId: 'agent_node_longshoreman_test' },
    trigger: { kind: 'context-threshold', pressure: 0.78, contextEnvelopeRef: 'ctx_test_01' },
    identity: { role: 'implementation voyager', task: 'wire the webhook receiver health board' },
    factualClaims: [citedClaim('the health-board tests pass (12 green)', `evt_${SESSION}_3`)],
    obligations: [
      {
        obligationId: 'obl_test_01',
        text: 'add the Email Routing rule after deploy',
        status: 'open',
        citations: [{ kind: 'transcript-event', transcriptEventId: `evt_${SESSION}_2` }],
      },
    ],
    nextAction: { recommendation: 'run the health-board smoke check' },
    ...overrides,
  };
}

describe('agent-harbor M6 context pressure (ch04 thresholds)', () => {
  it('freezes the ch04 threshold constants', () => {
    expect(CONTEXT_PRESSURE_THRESHOLDS).toEqual({ prepare: 0.6, compact: 0.75, warn: 0.85, require: 0.92 });
  });

  it.each([
    [0.0, 'low', 'none', null],
    [0.59, 'low', 'none', null],
    [0.6, 'medium', 'prepare_compaction', 0.6],
    [0.74, 'medium', 'prepare_compaction', 0.6],
    [0.75, 'high', 'build_compaction_packet', 0.75],
    [0.84, 'high', 'build_compaction_packet', 0.75],
    [0.85, 'high', 'warn_before_broad_work', 0.85],
    [0.91, 'high', 'warn_before_broad_work', 0.85],
    [0.92, 'critical', 'require_compaction_or_successor', 0.92],
    [1.0, 'critical', 'require_compaction_or_successor', 0.92],
  ] as const)('ratio %p → band %p, action %p', (ratio, band, action, threshold) => {
    const a = classifyPressure(100_000, ratio * 100_000);
    expect(a.band).toBe(band);
    expect(a.action).toBe(action);
    expect(a.thresholdCrossed).toBe(threshold);
    expect(a.compactionNeeded).toBe(ratio >= 0.75);
    expect(a.successorRequired).toBe(ratio >= 0.92);
  });

  it('clamps overflow ratios for packet use but keeps the raw ratio honest', () => {
    const a = classifyPressure(100_000, 130_000);
    expect(a.rawRatio).toBeCloseTo(1.3);
    expect(a.ratio).toBe(1);
    expect(a.band).toBe('critical');
    expect(a.action).toBe('require_compaction_or_successor');
  });

  it.each([
    [0, 50_000],
    [-1, 50_000],
    [Number.NaN, 50_000],
    [100_000, Number.NaN],
    [100_000, -5],
  ])('fails closed to critical when the window is unmeasurable (window %p, used %p)', (windowTokens, used) => {
    const a = classifyPressure(windowTokens, used);
    expect(a.band).toBe('critical');
    expect(a.successorRequired).toBe(true);
  });

  it('buildContextEnvelope derives band and compactionNeeded, never self-asserts', () => {
    const env = buildContextEnvelope({
      agentNodeId: NODE,
      sessionId: SESSION,
      windowTokens: 200_000,
      usedTokensEstimate: 152_000, // 0.76
    });
    expect(env.pressure).toBe('high');
    expect(env.compactionNeeded).toBe(true);
    // Schema-valid by construction (assertAgainstSchema ran inside).
    expect(env.schema).toBe('pd.agent-harbor.context-envelope.v0');
  });

  it('assesses the frozen F0 fixture with no self-report drift', () => {
    const fixture = JSON.parse(readFileSync(join(fixtureDir, 'context-envelope.json'), 'utf8')) as ContextEnvelope;
    const a = assessContextEnvelope(fixture);
    expect(a.band).toBe('low'); // 71000 / 200000
    expect(a.selfReportDrift).toEqual([]);
    expect(a.droppableTokensEstimate).toBe(2400 + 600); // skill-graft + memory-episode refs
  });

  it('reports (never corrects) a self-reported pressure that disagrees with the ratio', () => {
    const env = buildContextEnvelope({
      agentNodeId: NODE,
      sessionId: SESSION,
      windowTokens: 100_000,
      usedTokensEstimate: 80_000,
    });
    const lying: ContextEnvelope = { ...env, pressure: 'low', compactionNeeded: false };
    const a = assessContextEnvelope(lying);
    expect(a.band).toBe('high');
    expect(a.selfReportDrift).toHaveLength(2);
    expect(a.selfReportDrift[0]).toContain('"low"');
    // Input untouched — tolerant reader, drift is reported not repaired.
    expect(lying.pressure).toBe('low');
  });

  it('rejects an envelope that violates the frozen contract', () => {
    expect(() =>
      assessContextEnvelope({
        schema: 'pd.agent-harbor.context-envelope.v0',
        envelopeId: 'ctx_bad',
        agentNodeId: NODE,
        sessionId: SESSION,
        usedTokensEstimate: 10,
        measuredAt: new Date().toISOString(),
      } as unknown as ContextEnvelope),
    ).toThrow(/contract violation.*windowTokens/s);
  });
});

describe('agent-harbor M6 pressure tracking from the ledger', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    ensureEventLedgerSchema(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('derives pressure history from heartbeat/context_pressure events (both nesting styles)', () => {
    const env1 = buildContextEnvelope({
      agentNodeId: NODE, sessionId: SESSION, windowTokens: 100_000, usedTokensEstimate: 40_000,
    });
    const env2 = buildContextEnvelope({
      agentNodeId: NODE, sessionId: SESSION, windowTokens: 100_000, usedTokensEstimate: 77_000,
    });
    appendEvent(db, { streamType: 'transcript-event', payload: evt(1, 'session_started') });
    // Style A: payloadJson IS the envelope.
    appendEvent(db, { streamType: 'transcript-event', payload: evt(2, 'heartbeat', env1 as unknown as Record<string, unknown>) });
    // Non-pressure event in between is ignored.
    appendEvent(db, { streamType: 'transcript-event', payload: evt(3, 'tool_call', { toolName: 'Read' }) });
    // Style B: envelope nested under contextEnvelope.
    appendEvent(db, { streamType: 'transcript-event', payload: evt(4, 'context_pressure', { contextEnvelope: env2 }) });

    const { readings, skipped } = pressureHistoryFromLedger(db, SESSION);
    expect(skipped).toEqual([]);
    expect(readings).toHaveLength(2);
    expect(readings[0].assessment.band).toBe('low');
    expect(readings[1].assessment.band).toBe('high');
    expect(readings[1].assessment.action).toBe('build_compaction_packet');

    const latest = latestPressureFromLedger(db, SESSION);
    expect(latest?.transcriptEventId).toBe(`evt_${SESSION}_4`);
    expect(latest?.assessment.compactionNeeded).toBe(true);
  });

  it('skips heartbeats whose claimed envelope violates the contract, with a reason', () => {
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: evt(1, 'heartbeat', {
        schema: 'pd.agent-harbor.context-envelope.v0',
        envelopeId: 'ctx_broken',
        // missing agentNodeId / sessionId / windowTokens / usedTokensEstimate / measuredAt
      }),
    });
    const { readings, skipped } = pressureHistoryFromLedger(db, SESSION);
    expect(readings).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain('contract violation');
  });
});

describe('agent-harbor M6 Longshoreman compactor', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    ensureEventLedgerSchema(db);
    seedSession(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('builds a schema-valid packet pinned to the real chain head, and appends the compaction_packet event', () => {
    const before = readEvents(db, { streamType: 'transcript-event', sessionId: SESSION });
    const { packet, appendResult } = buildCompactionPacket(db, packetInput());

    // sourceTranscript pins the PRE-compaction chain head.
    expect(packet.sourceTranscript.headEventId).toBe(`evt_${SESSION}_5`);
    expect(packet.sourceTranscript.headHash).toBe(before[before.length - 1].content_hash);
    expect(packet.sourceTranscript.throughSequence).toBe(5);

    // Commands were extracted from the transcript, cited by construction.
    expect(packet.commandsRun).toEqual([
      expect.objectContaining({
        command: 'npx jest tests/unit/health-board.test.js',
        exitCode: 0,
        transcriptEventId: `evt_${SESSION}_3`,
      }),
    ]);

    // Excerpts are citations first, convenience text second.
    expect(packet.transcriptExcerpts!.length).toBeGreaterThan(0);
    for (const excerpt of packet.transcriptExcerpts!) {
      expect(excerpt.citation.kind).toBe('transcript-event');
      expect(excerpt.citation.transcriptEventId).toMatch(/^evt_/);
    }

    // Validator verdict embedded and passing.
    expect(packet.validator.passed).toBe(true);
    expect(packet.validator.uncitedClaimCount).toBe(0);

    // The packet rode in as a first-class transcript event, chained cleanly.
    expect(appendResult).not.toBeNull();
    expect(appendResult!.duplicate).toBe(false);
    const after = readEvents(db, { streamType: 'transcript-event', sessionId: SESSION });
    expect(after).toHaveLength(before.length + 1);
    const packetRow = after[after.length - 1];
    expect(packetRow.kind).toBe('compaction_packet');
    expect(packetRow.event_id).toBe(packet.transcriptEventId);
    expect(verifySessionChain(db, SESSION)).toBeNull();
  });

  it('never mutates the original transcript — compaction only appends', () => {
    const before = readEvents(db, { streamType: 'transcript-event', sessionId: SESSION });
    buildCompactionPacket(db, packetInput());
    const after = readEvents(db, { streamType: 'transcript-event', sessionId: SESSION });
    for (let i = 0; i < before.length; i++) {
      expect(after[i].payload_json).toBe(before[i].payload_json);
      expect(after[i].content_hash).toBe(before[i].content_hash);
    }
    expect(sessionChainHeadHash(db, SESSION)).toBe(after[after.length - 1].content_hash);
  });

  it('returns the committed packet for a deterministic event-id retry after the transcript advances', () => {
    const eventId = 'evt_cpk_retry_after_advance';
    const first = buildCompactionPacket(db, packetInput({
      packetId: 'cpk_retry_first',
      eventId,
      createdAt: '2026-08-27T12:00:00.000Z',
    }));
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: evt(7, 'assistant_message', { text: 'new evidence arrived after the first commit' }),
    });

    const retry = buildCompactionPacket(db, packetInput({
      packetId: 'cpk_retry_phantom',
      eventId,
      createdAt: '2026-08-27T12:01:00.000Z',
    }));

    expect(retry.appendResult?.duplicate).toBe(true);
    expect(retry.packet).toEqual(first.packet);
    expect(retry.packet.packetId).toBe('cpk_retry_first');
    expect(retry.packet.sourceTranscript.headEventId).toBe(first.packet.sourceTranscript.headEventId);
    expect(readEvents(db, { streamType: 'transcript-event', sessionId: SESSION })
      .filter((row) => row.kind === 'compaction_packet')).toHaveLength(1);
  });

  it('replays the committed deterministic packet before a later oversized tool tail can be reconstructed', () => {
    const eventId = 'evt_cpk_retry_before_oversized_tail';
    const first = buildCompactionPacket(db, packetInput({
      packetId: 'cpk_retry_before_oversized_tail',
      eventId,
      createdAt: '2026-08-27T12:00:00.000Z',
    }));

    // This is valid durable evidence from later work, but reconstructing all
    // 64 bounded command/result summaries would exceed the packet budget.
    // A crash retry of the first event must replay its committed packet before
    // inspecting that newer tail.
    for (let sequence = 7; sequence <= 70; sequence++) {
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: evt(sequence, 'shell_command', {
          command: `command-${sequence}-${'x'.repeat(1_000)}`,
          exitCode: 0,
          resultSummary: `result-${sequence}-${'y'.repeat(2_048)}`,
        }),
      });
    }

    const retry = buildCompactionPacket(db, packetInput({
      packetId: 'cpk_phantom_later_tail',
      eventId,
      createdAt: '2026-08-27T12:01:00.000Z',
    }));

    expect(retry.appendResult).toMatchObject({ duplicate: true, eventId });
    expect(retry.packet).toEqual(first.packet);
    expect(retry.packet.sourceTranscript.headEventId).toBe(first.packet.sourceTranscript.headEventId);
    expect(readEvents(db, { streamType: 'transcript-event', sessionId: SESSION })
      .filter((row) => row.kind === 'compaction_packet')).toHaveLength(1);
  });

  it('fails closed when a deterministic packet id collides with another durable event', () => {
    const eventId = 'evt_cpk_collision';
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: {
        ...evt(6, 'assistant_message', { text: 'foreign event' }),
        eventId,
        sessionId: 'session_other_compaction_test',
      },
    });

    expect(() => buildCompactionPacket(db, packetInput({ eventId }))).toThrow(CompactionValidationError);
    expect(() => buildCompactionPacket(db, packetInput({ eventId }))).toThrow(/event-id collision/);
  });

  it('fails closed when a deterministic packet id resolves to a malformed stored packet', () => {
    const eventId = 'evt_cpk_malformed_retry';
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: {
        ...evt(6, 'compaction_packet', { not: 'a valid compaction packet' }),
        eventId,
      },
    });

    expect(() => buildCompactionPacket(db, packetInput({ eventId }))).toThrow(CompactionValidationError);
    expect(() => buildCompactionPacket(db, packetInput({ eventId }))).toThrow(/no reusable validated packet payload/);
  });

  it('excerptCount: 0 means ZERO excerpts, never the whole transcript (slice(-0) regression)', () => {
    const { packet } = buildCompactionPacket(db, packetInput({ excerptCount: 0 }));
    expect(packet.transcriptExcerpts).toEqual([]);
    expect(packet.validator.passed).toBe(true);
  });

  it('does not expose a tool result without its invocation when the excerpt cap cuts through a valid pair', () => {
    appendEvent(db, { streamType: 'transcript-event', payload: evt(6, 'tool_call', { toolCallId: 'excerpt-boundary' }) });
    appendEvent(db, { streamType: 'transcript-event', payload: evt(7, 'tool_result', { toolCallId: 'excerpt-boundary', content: 'paired' }) });
    for (let sequence = 8; sequence <= 11; sequence++) {
      appendEvent(db, { streamType: 'transcript-event', payload: evt(sequence, 'assistant_message', { text: `after pair ${sequence}` }) });
    }

    const { packet } = buildCompactionPacket(db, packetInput({ excerptCount: 5 }));
    const citations = packet.transcriptExcerpts!.map((excerpt) => excerpt.citation.transcriptEventId);
    expect(citations).not.toContain(`evt_${SESSION}_7`);
    expect(citations).not.toContain(`evt_${SESSION}_6`);
    expect(citations).toHaveLength(4);
  });

  it('omits every split tool row across ordinary intervening evidence and accepts canonical id variants only as a complete pair', () => {
    appendEvent(db, { streamType: 'transcript-event', payload: evt(6, 'tool_call', { tool_call_id: 'gapped-pair' }) });
    appendEvent(db, { streamType: 'transcript-event', payload: evt(7, 'assistant_message', { text: 'ordinary evidence between the pair' }) });
    appendEvent(db, { streamType: 'transcript-event', payload: evt(8, 'tool_result', { toolCall: { id: 'gapped-pair' }, content: 'paired' }) });

    const gapped = buildCompactionPacket(db, packetInput({ excerptCount: 2, append: false })).packet;
    expect(gapped.transcriptExcerpts!.map((excerpt) => excerpt.citation.transcriptEventId)).toEqual([`evt_${SESSION}_7`]);

    const cleanDb = initDatabase({ inMemory: true });
    ensureEventLedgerSchema(cleanDb);
    try {
      seedSession(cleanDb);
      appendEvent(cleanDb, { streamType: 'transcript-event', payload: evt(6, 'tool_call', { tool_call_id: 'canonical-pair' }) });
      appendEvent(cleanDb, { streamType: 'transcript-event', payload: evt(7, 'tool_result', { toolCall: { id: 'canonical-pair' }, content: 'paired' }) });
      const complete = buildCompactionPacket(cleanDb, packetInput({ excerptCount: 2, append: false })).packet;
      expect(complete.transcriptExcerpts!.map((excerpt) => excerpt.citation.transcriptEventId)).toEqual([
        `evt_${SESSION}_6`,
        `evt_${SESSION}_7`,
      ]);
    } finally {
      closeDatabase(cleanDb);
    }
  });

  it('omits an invocation when a packet boundary precedes its eventual result', () => {
    appendEvent(db, { streamType: 'transcript-event', payload: evt(6, 'tool_call', { toolCallId: 'future-result' }) });
    appendEvent(db, { streamType: 'transcript-event', payload: evt(7, 'assistant_message', { text: 'packet boundary before result' }) });

    const { packet } = buildCompactionPacket(db, packetInput({ excerptCount: 2 }));
    expect(packet.transcriptExcerpts!.map((excerpt) => excerpt.citation.transcriptEventId)).toEqual([`evt_${SESSION}_7`]);
    appendEvent(db, { streamType: 'transcript-event', payload: evt(20_008, 'tool_result', { toolCallId: 'future-result' }) });
  });

  it('derives the trigger from a ContextEnvelope when one is given (M6 gate: force threshold, see packet)', () => {
    const envelope = buildContextEnvelope({
      agentNodeId: NODE,
      sessionId: SESSION,
      windowTokens: 200_000,
      usedTokensEstimate: 156_000, // 0.78 — above the 0.75 Longshoreman threshold
    });
    const { packet, pressure } = buildCompactionPacket(db, packetInput({ trigger: undefined, contextEnvelope: envelope }));
    expect(pressure?.action).toBe('build_compaction_packet');
    expect(packet.trigger).toEqual({
      kind: 'context-threshold',
      pressure: 0.78,
      contextEnvelopeRef: envelope.envelopeId,
    });
  });

  it('FAILS an uncited factual claim (the ch04 validator is executable, not a comment)', () => {
    expect(() =>
      buildCompactionPacket(db, packetInput({
        factualClaims: [{ text: 'the deploy worked', citations: [] } as unknown as FactualClaim],
      })),
    ).toThrow(CompactionValidationError);
    try {
      buildCompactionPacket(db, packetInput({
        factualClaims: [{ text: 'the deploy worked', citations: [] } as unknown as FactualClaim],
      }));
    } catch (err) {
      const e = err as CompactionValidationError;
      expect(e.result.passed).toBe(false);
      expect(e.result.uncitedClaimCount).toBe(1);
      expect((e.result.errors ?? []).join(' ')).toContain('no citations');
    }
  });

  it('FAILS a citation that violates the ADR-0097 cross-field rules', () => {
    // kind transcript-event without transcriptEventId
    expect(() =>
      buildCompactionPacket(db, packetInput({
        factualClaims: [{ text: 'x', citations: [{ kind: 'transcript-event' }] }],
      })),
    ).toThrow(/requires transcriptEventId/);
    // kind file without fileRef
    expect(() =>
      buildCompactionPacket(db, packetInput({
        factualClaims: [{ text: 'x', citations: [{ kind: 'file' }] }],
      })),
    ).toThrow(/requires fileRef/);
    // kind claim without claimRef
    expect(() =>
      buildCompactionPacket(db, packetInput({
        factualClaims: [{ text: 'x', citations: [{ kind: 'claim' }] }],
      })),
    ).toThrow(/requires claimRef/);
  });

  it('FAILS a citation to a transcript event the ledger does not hold', () => {
    expect(() =>
      buildCompactionPacket(db, packetInput({
        factualClaims: [citedClaim('phantom evidence', 'evt_never_existed')],
      })),
    ).toThrow(/does not exist in the ledger/);
  });

  it('FAILS a citation to an event from a different session than cited', () => {
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: evt(1, 'session_started', {}, { eventId: 'evt_other_1', sessionId: 'session_other' }),
    });
    expect(() =>
      buildCompactionPacket(db, packetInput({
        factualClaims: [citedClaim('borrowed evidence', 'evt_other_1')],
      })),
    ).toThrow(/belongs to session/);
  });

  it('rejects a nonsense citation span (end before start)', () => {
    const errors = validateCitation(
      { kind: 'transcript-event', transcriptEventId: 'evt_x', span: { start: 100, end: 5 } },
      'test',
    );
    expect(errors.join(' ')).toContain('precedes start');
  });

  it('WARNS (without failing) when active known obligations are missing from the packet', () => {
    const { packet } = buildCompactionPacket(db, packetInput({
      knownObligations: [
        { obligationId: 'obl_test_01', text: 'add the Email Routing rule after deploy', status: 'open' }, // present
        { obligationId: 'obl_missing', text: 'unpin the daemon after issue #676', status: 'open' }, // missing → warn
        { obligationId: 'obl_done', text: 'already finished', status: 'done' }, // done → no warn
      ],
    }));
    expect(packet.validator.passed).toBe(true);
    expect(packet.validator.missingObligationWarnings).toHaveLength(1);
    expect(packet.validator.missingObligationWarnings[0]).toContain('obl_missing');
  });

  it('refuses to compact an empty transcript', () => {
    expect(() =>
      buildCompactionPacket(db, packetInput({ sessionId: 'session_empty' })),
    ).toThrow(/no transcript events/);
  });

  it('validates the frozen fixture packet structurally (cross-field rules hold on the contract example)', () => {
    const fixture = JSON.parse(
      readFileSync(join(fixtureDir, 'compaction-packet.json'), 'utf8'),
    ) as CompactionPacket;
    // No db: structural + cross-field only (the fixture's events are narrative).
    const verdict = validateCompactionPacket(fixture);
    expect(verdict.passed).toBe(true);
    expect(verdict.uncitedClaimCount).toBe(0);
  });

  it('extractCommandsRun ignores rows without a command string', () => {
    const rows = readEvents(db, { streamType: 'transcript-event', sessionId: SESSION });
    const commands = extractCommandsRun(rows);
    expect(commands).toHaveLength(1);
    expect(commands[0].resultSummary).toBe('12 passed');
  });

  it('bounds packet construction to a tail and never copies a huge tool command into the packet', () => {
    // A long-lived session must not turn PreCompact into an unbounded replay.
    for (let sequence = 6; sequence <= 10_006; sequence++) {
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: evt(sequence, 'assistant_message', { text: `old evidence ${sequence}` }),
      });
    }
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: evt(10_007, 'shell_command', {
        command: 'pd plan check 3',
        resultSummary: 'checked',
        exitCode: 0,
      }),
    });
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: evt(10_008, 'shell_command', {
        command: 'x'.repeat(128 * 1024),
        resultSummary: 'y'.repeat(128 * 1024),
        exitCode: 0,
      }),
    });
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: evt(10_009, 'assistant_message', { text: 'tail evidence' }),
    });
    // SQLite's text LENGTH() counts characters, not UTF-8 bytes. This source
    // stays below the former character threshold but exceeds the byte budget.
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: evt(10_010, 'shell_command', {
        command: '🦑'.repeat(5_000),
        resultSummary: '🦑'.repeat(5_000),
        exitCode: 0,
      }),
    });

    const { packet } = buildCompactionPacket(db, packetInput());
    expect(packet.sourceTranscript.throughSequence).toBe(10_010);
    expect(packet.commandsRun).toHaveLength(1);
    expect(packet.commandsRun?.[0]).toMatchObject({ command: 'pd plan check 3', resultSummary: 'checked' });
    expect(packet.commandsRun?.length).toBeLessThanOrEqual(MAX_PACKET_COMMANDS);
    expect(Buffer.byteLength(JSON.stringify(packet), 'utf8')).toBeLessThanOrEqual(MAX_COMPACTION_PACKET_BYTES);
    expect(JSON.stringify(packet)).not.toContain('x'.repeat(4_096));
    expect(JSON.stringify(packet)).not.toContain('🦑'.repeat(100));
  });
});

describe('agent-harbor M6 successor resume (packet + transcript, append-only)', () => {
  let db: DatabaseInstance;
  let packet: CompactionPacket;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    ensureEventLedgerSchema(db);
    seedSession(db);
    packet = buildCompactionPacket(db, packetInput()).packet;
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('resumes from a valid packet: verified pin, bounded prefix handles, re-validation', () => {
    const bootstrap = resumeFromPacket(db, packet);
    expect(bootstrap.sessionId).toBe(SESSION);
    expect(bootstrap.revalidation.passed).toBe(true);
    // Prefix covers exactly the pinned transcript, in replay order.
    expect(bootstrap.transcriptPrefix).toHaveLength(5);
    expect(bootstrap.transcriptPrefixTruncated).toBe(false);
    expect(bootstrap.transcriptPrefix[4].transcriptEventId).toBe(packet.sourceTranscript.headEventId);
    expect(bootstrap.transcriptPrefix.map((p) => p.sequence)).toEqual([1, 2, 3, 4, 5]);
    // Ready-to-attach context ref for the successor's ContextEnvelope.
    expect(bootstrap.contextRef).toEqual({ kind: 'compaction-packet', ref: packet.packetId, droppable: false });
    // Resume wrote nothing.
    expect(readEvents(db, { streamType: 'transcript-event', sessionId: SESSION })).toHaveLength(6);
    expect(verifySessionChain(db, SESSION)).toBeNull();
  });

  it('keeps successor bootstrap handles bounded instead of exporting a long transcript', () => {
    // The baseline packet has already appended sequence 6 in beforeEach.
    for (let sequence = 7; sequence <= MAX_SUCCESSOR_TRANSCRIPT_HANDLES + 13; sequence++) {
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: evt(sequence, 'assistant_message', { text: `bounded handle ${sequence}` }),
      });
    }
    const longPacket = buildCompactionPacket(db, packetInput()).packet;
    const bootstrap = resumeFromPacket(db, longPacket);

    expect(bootstrap.transcriptPrefix).toHaveLength(MAX_SUCCESSOR_TRANSCRIPT_HANDLES);
    expect(bootstrap.transcriptPrefixTruncated).toBe(true);
    expect(bootstrap.transcriptPrefix.at(-1)?.transcriptEventId).toBe(longPacket.sourceTranscript.headEventId);
    expect(bootstrap.transcriptPrefix[0]?.sequence).toBeGreaterThan(1);
  });

  it('omits a leading tool result rather than splitting a valid pair at the bootstrap-handle cap', () => {
    const existingRows = readEvents(db, { streamType: 'transcript-event', sessionId: SESSION }).length;
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: evt(20_001, 'tool_call', { toolCallId: 'bootstrap-boundary' }),
    });
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: evt(20_002, 'tool_result', { toolCallId: 'bootstrap-boundary', content: 'paired' }),
    });
    // Make the result the first of the last 128 source rows. The matching
    // call remains immediately before that capped convenience lens.
    for (let offset = 0; offset < MAX_SUCCESSOR_TRANSCRIPT_HANDLES - 1; offset++) {
      appendEvent(db, {
        streamType: 'transcript-event',
        payload: evt(20_003 + offset, 'assistant_message', { text: `after bootstrap pair ${offset}` }),
      });
    }
    expect(readEvents(db, { streamType: 'transcript-event', sessionId: SESSION })).toHaveLength(
      existingRows + 2 + MAX_SUCCESSOR_TRANSCRIPT_HANDLES - 1,
    );

    const longPacket = buildCompactionPacket(db, packetInput()).packet;
    const bootstrap = resumeFromPacket(db, longPacket);
    expect(bootstrap.transcriptPrefix).toHaveLength(MAX_SUCCESSOR_TRANSCRIPT_HANDLES - 1);
    expect(bootstrap.transcriptPrefix.map((row) => row.transcriptEventId))
      .not.toContain(`evt_${SESSION}_20002`);
    expect(bootstrap.transcriptPrefix.map((row) => row.transcriptEventId))
      .not.toContain(`evt_${SESSION}_20001`);
  });

  it('refuses a packet whose embedded validator says passed: false', () => {
    const failed = { ...packet, validator: { ...packet.validator, passed: false } };
    expect(() => resumeFromPacket(db, failed)).toThrow(ResumeVerificationError);
    expect(() => resumeFromPacket(db, failed)).toThrow(/refuse an unvalidated packet/);
  });

  it('refuses a forged passed: true when re-validation against the live ledger fails', () => {
    const forged: CompactionPacket = {
      ...packet,
      factualClaims: [
        ...packet.factualClaims,
        { text: 'invented after the fact', citations: [{ kind: 'transcript-event', transcriptEventId: 'evt_forged' }] },
      ],
      // Embedded verdict still claims clean — a self-report, not truth.
      validator: { ...packet.validator },
    };
    expect(() => resumeFromPacket(db, forged)).toThrow(/re-validation against the live ledger failed/);
  });

  it('refuses a tampered headHash (the packet does not describe this transcript)', () => {
    const tampered = {
      ...packet,
      sourceTranscript: { ...packet.sourceTranscript, headHash: 'sha256:' + 'f'.repeat(64) },
    };
    expect(() => resumeFromPacket(db, tampered)).toThrow(/does not match the ledger's contentHash/);
  });

  it('refuses a tampered throughSequence', () => {
    const tampered = {
      ...packet,
      sourceTranscript: { ...packet.sourceTranscript, throughSequence: 99 },
    };
    expect(() => resumeFromPacket(db, tampered)).toThrow(/does not match the head event's sequence/);
  });

  it('refuses a headEventId that is not in the ledger', () => {
    const tampered = {
      ...packet,
      sourceTranscript: { ...packet.sourceTranscript, headEventId: 'evt_missing', throughSequence: undefined },
    };
    expect(() => resumeFromPacket(db, tampered)).toThrow(/is not in the ledger/);
  });

  it('refuses a head event pinned from a different session', () => {
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: evt(1, 'session_started', {}, { eventId: 'evt_foreign_1', sessionId: 'session_foreign' }),
    });
    // Re-cite claims against the foreign session too? No — keep the claims
    // valid so the FIRST failure surfaced is the head pin, proving the pin
    // check is independent of citation checks.
    const foreignHead = db
      .prepare("SELECT content_hash, sequence FROM harbor_events WHERE event_id = 'evt_foreign_1'")
      .get() as { content_hash: string; sequence: number };
    const tampered = {
      ...packet,
      sourceTranscript: { headEventId: 'evt_foreign_1', headHash: foreignHead.content_hash, throughSequence: foreignHead.sequence },
    };
    expect(() => resumeFromPacket(db, tampered)).toThrow(/belongs to session/);
  });

  it('round-trips through the appended transcript event (packet payload is the event payload)', () => {
    const rows = readEvents(db, { streamType: 'transcript-event', sessionId: SESSION });
    const packetRow = rows.find((r) => r.kind === 'compaction_packet')!;
    const stored = JSON.parse(packetRow.payload_json) as { payloadJson: CompactionPacket };
    const bootstrap = resumeFromPacket(db, stored.payloadJson);
    expect(bootstrap.packet.packetId).toBe(packet.packetId);
    expect(bootstrap.revalidation.passed).toBe(true);
  });
});
