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
  ResumeVerificationError,
  buildCompactionPacket,
  checkToolPairBoundary,
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

  it('excerptCount: 0 means ZERO excerpts, never the whole transcript (slice(-0) regression)', () => {
    const { packet } = buildCompactionPacket(db, packetInput({ excerptCount: 0 }));
    expect(packet.transcriptExcerpts).toEqual([]);
    expect(packet.validator.passed).toBe(true);
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
});

describe('agent-harbor M6 tool_call/tool_result boundary rule (binder ch04 "Boundary rule")', () => {
  let db: DatabaseInstance;
  const TOOL_SESSION = 'session_toolpair_test_01';

  function toolEvt(seq: number, kind: 'tool_call' | 'tool_result', toolCallId: string): HarborPayload {
    return {
      eventId: `evt_${TOOL_SESSION}_${seq}`,
      sessionId: TOOL_SESSION,
      agentNodeId: NODE,
      sequence: seq,
      occurredAt: new Date(Date.UTC(2026, 6, 6, 12, 0, seq)).toISOString(),
      schemaVersion: 1,
      kind,
      payloadJson: { toolCallId },
    };
  }

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    ensureEventLedgerSchema(db);
    // 1: session_started, 2: tool_call(A), 3: tool_result(A), 4: tool_call(B),
    // 5: tool_result(B), 6: assistant_message. Pair A is entirely inside
    // [2,4); pair B straddles [2,4) — call in, result out.
    appendEvent(db, { streamType: 'transcript-event', payload: evt(1, 'session_started') });
    appendEvent(db, { streamType: 'transcript-event', payload: toolEvt(2, 'tool_call', 'toolcall_a') });
    appendEvent(db, { streamType: 'transcript-event', payload: toolEvt(3, 'tool_result', 'toolcall_a') });
    appendEvent(db, { streamType: 'transcript-event', payload: toolEvt(4, 'tool_call', 'toolcall_b') });
    appendEvent(db, { streamType: 'transcript-event', payload: toolEvt(5, 'tool_result', 'toolcall_b') });
    appendEvent(db, { streamType: 'transcript-event', payload: evt(6, 'assistant_message', { text: 'done' }) });
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('rejects a range that splits a tool_call/tool_result pair, and names the split', () => {
    const rows = readEvents(db, { streamType: 'transcript-event', sessionId: TOOL_SESSION });
    // [1, 5) covers sequences 1..4 → pair B's tool_call (seq 4) is in range,
    // its tool_result (seq 5) is not: a split.
    const result = checkToolPairBoundary(rows, { startSeq: 1, endSeq: 5 });

    expect(result.ok).toBe(false);
    expect(result.splits).toHaveLength(1);
    expect(result.splits[0]).toEqual(expect.objectContaining({
      toolCallId: 'toolcall_b',
      toolCallEventId: `evt_${TOOL_SESSION}_4`,
      toolResultEventId: `evt_${TOOL_SESSION}_5`,
    }));
    // The adjusted range widens to swallow the whole pair (endSeq exclusive, so 6 covers seq 5).
    expect(result.adjustedRange).toEqual({ startSeq: 1, endSeq: 6 });
  });

  it('accepts a range where every tool_call/tool_result pair is fully inside or fully outside', () => {
    const rows = readEvents(db, { streamType: 'transcript-event', sessionId: TOOL_SESSION });
    // [1, 4) covers sequences 1..3 → pair A (2,3) is fully inside, pair B (4,5) fully outside.
    const result = checkToolPairBoundary(rows, { startSeq: 1, endSeq: 4 });

    expect(result.ok).toBe(true);
    expect(result.splits).toEqual([]);
    expect(result.adjustedRange).toEqual({ startSeq: 1, endSeq: 4 });
  });

  it('accepts the full-session range (session-start through head) — the shape every real packet uses today', () => {
    const rows = readEvents(db, { streamType: 'transcript-event', sessionId: TOOL_SESSION });
    const head = rows[rows.length - 1];
    const result = checkToolPairBoundary(rows, { startSeq: 0, endSeq: (head.sequence ?? rows.length) + 1 });
    expect(result.ok).toBe(true);
    expect(result.splits).toEqual([]);
  });

  it('ignores unpaired tool events (no toolCallId, or only one side present) — nothing to split', () => {
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: {
        eventId: `evt_${TOOL_SESSION}_7`,
        sessionId: TOOL_SESSION,
        agentNodeId: NODE,
        sequence: 7,
        occurredAt: new Date(Date.UTC(2026, 6, 6, 12, 0, 7)).toISOString(),
        schemaVersion: 1,
        kind: 'tool_call',
        payloadJson: {}, // no toolCallId — untagged
      },
    });
    const rows = readEvents(db, { streamType: 'transcript-event', sessionId: TOOL_SESSION });
    // [7, 8) isolates the untagged tool_call alone.
    const result = checkToolPairBoundary(rows, { startSeq: 7, endSeq: 8 });
    expect(result.ok).toBe(true);
    expect(result.splits).toEqual([]);
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
    expect(bootstrap.transcriptPrefix[4].transcriptEventId).toBe(packet.sourceTranscript.headEventId);
    expect(bootstrap.transcriptPrefix.map((p) => p.sequence)).toEqual([1, 2, 3, 4, 5]);
    // Ready-to-attach context ref for the successor's ContextEnvelope.
    expect(bootstrap.contextRef).toEqual({ kind: 'compaction-packet', ref: packet.packetId, droppable: false });
    // Resume wrote nothing.
    expect(readEvents(db, { streamType: 'transcript-event', sessionId: SESSION })).toHaveLength(6);
    expect(verifySessionChain(db, SESSION)).toBeNull();
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
