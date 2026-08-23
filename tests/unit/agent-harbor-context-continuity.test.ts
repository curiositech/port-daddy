import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from '@jest/globals';
import { createTranscripts } from '../../lib/transcripts.js';
import { createEpisodicMemory } from '../../lib/episodic-memory.js';
import { createContinuationStore, hashContinuationPrompt } from '../../lib/continuation-runtime.js';
import { createSpawnerHarborBridge } from '../../lib/agent-harbor/spawner-bridge.js';
import { listContextContinuity } from '../../lib/agent-harbor/context-continuity.js';
import { appendEvent, readEvents, verifySessionChain } from '../../lib/agent-harbor/event-ledger.js';

const databases: Database.Database[] = [];

function state() {
  const db = new Database(':memory:');
  databases.push(db);
  const transcripts = createTranscripts(db);
  const episodicMemory = createEpisodicMemory(db);
  const errors: Array<{ message: string; meta?: Record<string, unknown> }> = [];
  const bridge = createSpawnerHarborBridge(db, {
    episodicMemory,
    gitleaksRunner: () => ({ findings: [] }),
    logger: { error: (message, meta) => errors.push({ message, meta }) },
  });
  return { db, transcripts, episodicMemory, bridge, errors };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('Agent Harbor context continuity vertical slice', () => {
  test('turns redacted transcript rows into a verified packet and standard exactly-once handoff input', () => {
    const { db, transcripts, episodicMemory, bridge, errors } = state();
    const agentId = 'spawn-context-critical';
    const transcriptId = transcripts.start({
      id: 'transcript-context-critical',
      ship: 'test',
      spawned_agent_id: agentId,
      trigger: 'test',
      backend: 'cli:codex',
      model: 'gpt-5',
      started_at: 1_000,
    });
    transcripts.appendMessage(transcriptId, {
      role: 'user',
      content: 'Finish the bounded context-continuity slice.',
      timestamp: 1_001,
    });
    transcripts.appendMessage(transcriptId, {
      role: 'assistant',
      content: 'I preserved the cited packet and its source transcript.',
      timestamp: 1_002,
    });

    bridge.registerNode(agentId, 'port-daddy:test:context', 1_000);
    bridge.appendTranscriptEvent(agentId, 'session_started', 1_000, { transcriptId });
    expect(bridge.syncTranscript(agentId, transcriptId)).toBe(2);
    bridge.appendTranscriptEvent(agentId, 'session_end', 1_003, { transcriptId, status: 'completed' });

    const first = bridge.recordContext({
      agentNodeId: agentId,
      sessionId: agentId,
      runId: transcriptId,
      transcriptId,
      sourceAdapter: 'cli:codex',
      model: 'gpt-5',
      windowTokens: 1_000,
      daemonUsedTokensEstimate: 610,
      adapterUsedTokensEstimate: 950,
      estimateMode: 'exact',
      project: 'port-daddy',
      projectDir: '/workspace',
      workdir: '/workspace',
      measuredAt: '2026-08-23T12:00:00.000Z',
    });

    expect(errors).toEqual([]);
    expect(first).not.toBeNull();
    expect(first?.assessment.ratio).toBe(0.95);
    expect(first?.assessment.successorRequired).toBe(true);
    expect(first?.envelope.estimator).toMatchObject({
      strategy: 'max-daemon-and-adapter',
      adapterUsedTokensEstimate: 950,
      estimateMode: 'exact',
    });
    expect(first?.packet?.validator.passed).toBe(true);
    expect(first?.bootstrap?.contextRef.ref).toBe(first?.packet?.packetId);
    expect(first?.handoffEpisodeId).toEqual(expect.any(Number));
    expect(verifySessionChain(db, agentId)).toBeNull();

    const events = readEvents(db, { streamType: 'transcript-event', sessionId: agentId });
    expect(events.map((event) => event.kind)).toEqual([
      'session_started',
      'operator_message',
      'assistant_message',
      'session_end',
      'context_pressure',
      'compaction_packet',
    ]);
    const operator = events.find((event) => event.kind === 'operator_message');
    expect(JSON.parse(operator!.payload_json).payloadJson.content).toBe(
      'Finish the bounded context-continuity slice.',
    );

    const episode = episodicMemory.get(first!.handoffEpisodeId!);
    expect(episode?.sourceType).toBe('handoff-capsule');
    expect(episode?.metadata?.projectionOf).toMatchObject({
      packetId: first?.packet?.packetId,
      sourceHeadHash: first?.packet?.sourceTranscript.headHash,
    });

    const second = bridge.recordContext({
      agentNodeId: agentId,
      sessionId: agentId,
      runId: transcriptId,
      transcriptId,
      sourceAdapter: 'cli:codex',
      model: 'gpt-5',
      windowTokens: 1_000,
      daemonUsedTokensEstimate: 610,
      adapterUsedTokensEstimate: 950,
      estimateMode: 'exact',
      measuredAt: '2026-08-23T12:00:00.000Z',
    });
    expect(second?.replayed).toBe(true);
    expect(second?.packet?.packetId).toBe(first?.packet?.packetId);
    expect(readEvents(db, { streamType: 'transcript-event', sessionId: agentId })).toHaveLength(6);

    const readyProjection = listContextContinuity(db);
    expect(readyProjection.counts).toMatchObject({ observed: 1, packetReady: 1, successorRequired: 1 });
    expect(readyProjection.items[0].readiness).toBe('successor-required');

    const continuationStore = createContinuationStore(db, { ownerId: 'test-owner' });
    const request = {
      idempotencyKey: `context-packet:${first!.packet!.packetId}:successor`,
      sourceEpisodeId: first!.handoffEpisodeId!,
      sourceCapsuleId: first!.packet!.packetId,
      durableAgentId: agentId,
      mode: 'handoff' as const,
      sourceAdapter: 'codex',
      sourceSessionId: agentId,
      sourceAgentId: agentId,
      targetAdapter: 'claude-code',
      requestedBackend: 'cli:claude-code',
      promptHash: hashContinuationPrompt('Continue the verified packet.'),
    };
    const accepted = continuationStore.accept(request);
    const replay = continuationStore.accept(request);
    expect(accepted.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.id).toBe(accepted.receipt.id);

    const projection = listContextContinuity(db);
    expect(projection.counts).toMatchObject({ observed: 1, packetReady: 1, successorRequired: 0, continuing: 1 });
    expect(projection.items[0]).toMatchObject({
      readiness: 'continuing',
      handoffEpisodeId: first!.handoffEpisodeId,
      continuation: { id: accepted.receipt.id, status: 'accepted' },
      packet: { validatorPassed: true },
    });
  });

  test('records a low-pressure envelope without manufacturing a packet or handoff', () => {
    const { db, transcripts, bridge } = state();
    const agentId = 'spawn-context-low';
    const transcriptId = transcripts.start({
      id: 'transcript-context-low',
      ship: 'test',
      spawned_agent_id: agentId,
      trigger: 'test',
      backend: 'cli:codex',
      model: 'gpt-5',
      started_at: 2_000,
    });
    transcripts.appendMessage(transcriptId, { role: 'user', content: 'Small task.', timestamp: 2_001 });
    bridge.registerNode(agentId, null, 2_000);
    bridge.syncTranscript(agentId, transcriptId);

    const result = bridge.recordContext({
      agentNodeId: agentId,
      sessionId: agentId,
      runId: transcriptId,
      transcriptId,
      sourceAdapter: 'cli:codex',
      model: 'gpt-5',
      windowTokens: 1_000,
      daemonUsedTokensEstimate: 100,
      adapterUsedTokensEstimate: 120,
      estimateMode: 'estimated',
    });

    expect(result?.assessment.band).toBe('low');
    expect(result?.packet).toBeNull();
    expect(result?.handoffEpisodeId).toBeNull();
    expect(listContextContinuity(db).items[0].readiness).toBe('observed');
  });

  test('surfaces a malformed continuity proof instead of silently looking empty', () => {
    const { db } = state();
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: {
        eventId: 'evt-broken-context-proof',
        sessionId: 'broken-context-session',
        agentNodeId: 'broken-context-agent',
        sequence: 1,
        occurredAt: '2026-08-23T12:00:00.000Z',
        schemaVersion: 1,
        kind: 'context_pressure',
        visibility: 'operator',
        payloadJson: {},
      },
    });

    const projection = listContextContinuity(db);
    expect(projection.counts).toMatchObject({ observed: 0, verificationFailed: 1 });
    expect(projection.failures).toEqual([expect.objectContaining({
      eventId: 'evt-broken-context-proof',
      reason: expect.stringMatching(/context envelope is missing/),
    })]);
  });
});
