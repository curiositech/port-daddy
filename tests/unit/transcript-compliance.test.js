import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createTranscripts } from '../../lib/transcripts.js';
import {
  assessTranscriptRun,
  buildTranscriptComplianceReport,
  TRANSCRIPT_FLOW_STALL_AFTER_MS,
} from '../../lib/transcript-compliance.js';

describe('transcript compliance', () => {
  let db;
  let transcripts;

  beforeEach(() => {
    db = createTestDb();
    transcripts = createTranscripts(db);
  });

  afterEach(() => {
    db.close();
  });

  test('treats a fresh live-stream transcript as supported', () => {
    const now = 1_700_000_100_000;
    const id = transcripts.start({
      ship: 'spawn:cli:codex',
      spawned_agent_id: 'spawned-fresh',
      trigger: 'manual',
      backend: 'cli:codex',
      model: 'codex-cli',
      started_at: now - 5_000,
    });
    transcripts.appendMessage(id, {
      role: 'assistant',
      content: 'still working',
      timestamp: now - 1_000,
    });

    const run = assessTranscriptRun(
      {
        agentId: 'spawned-fresh',
        backend: 'cli:codex',
        status: 'running',
        startedAt: now - 5_000,
        completedAt: null,
      },
      transcripts.getTranscript(id),
      { now },
    );

    expect(run.profileSupport).toBe('supported');
    expect(run.captureMode).toBe('live_stream');
    expect(run.flowState).toBe('supported');
    expect(run.issue).toBeNull();
  });

  test('marks a live transcript degraded when heartbeat stops flowing', () => {
    const now = 1_700_000_200_000;
    const id = transcripts.start({
      ship: 'spawn:cli:claude-code',
      spawned_agent_id: 'spawned-stalled',
      trigger: 'manual',
      backend: 'cli:claude-code',
      model: 'claude-cli',
      started_at: now - (TRANSCRIPT_FLOW_STALL_AFTER_MS + 10_000),
    });
    transcripts.appendMessage(id, {
      role: 'user',
      content: 'start the run',
      timestamp: now - (TRANSCRIPT_FLOW_STALL_AFTER_MS + 10_000),
    });

    const run = assessTranscriptRun(
      {
        agentId: 'spawned-stalled',
        backend: 'cli:claude-code',
        status: 'running',
        startedAt: now - (TRANSCRIPT_FLOW_STALL_AFTER_MS + 10_000),
        completedAt: null,
      },
      transcripts.getTranscript(id),
      { now },
    );

    expect(run.flowState).toBe('degraded');
    expect(run.issue).toEqual(expect.objectContaining({
      code: 'transcript_flow_stalled',
      requiresHitl: true,
      severity: 'critical',
    }));
  });

  test('marks a completed run missing when no terminal transcript landed', () => {
    const now = 1_700_000_300_000;
    const id = transcripts.start({
      ship: 'spawn:cloudflare',
      spawned_agent_id: 'spawned-missing-final',
      trigger: 'manual',
      backend: 'cloudflare',
      model: '@cf/zai-org/glm-4.7-flash',
      started_at: now - 30_000,
    });
    transcripts.appendMessage(id, {
      role: 'user',
      content: 'finish cleanly',
      timestamp: now - 30_000,
    });

    const run = assessTranscriptRun(
      {
        agentId: 'spawned-missing-final',
        backend: 'cloudflare',
        status: 'completed',
        startedAt: now - 30_000,
        completedAt: now,
      },
      transcripts.getTranscript(id),
      { now },
    );
    const report = buildTranscriptComplianceReport([run]);

    expect(run.flowState).toBe('missing');
    expect(run.issue).toEqual(expect.objectContaining({
      code: 'transcript_final_missing',
      requiresHitl: true,
    }));
    expect(report.degraded).toBe(true);
    expect(report.hitlEmergency).toBe(true);
    expect(report.summary.flow.missing).toBe(1);
  });

  test('treats cli:agy completed final-output transcripts as degraded but present', () => {
    const now = 1_700_000_400_000;
    const id = transcripts.start({
      ship: 'spawn:cli:agy',
      spawned_agent_id: 'spawned-agy-final',
      trigger: 'manual',
      backend: 'cli:agy',
      model: 'agy-cli',
      started_at: now - 10_000,
    });
    transcripts.appendMessage(id, {
      role: 'user',
      content: 'Reply with exactly: agy',
      timestamp: now - 10_000,
    });
    transcripts.appendMessage(id, {
      role: 'assistant',
      content: 'agy',
      timestamp: now,
    });
    transcripts.appendOutput(id, {
      type: 'message',
      summary: 'cli:agy returned 3 chars',
      timestamp: now,
    });
    transcripts.finalize(id, { status: 'completed', cost_usd: 0.001 });

    const run = assessTranscriptRun(
      {
        agentId: 'spawned-agy-final',
        backend: 'cli:agy',
        status: 'completed',
        startedAt: now - 10_000,
        completedAt: now,
      },
      transcripts.getTranscript(id),
      { now },
    );

    expect(run.profileSupport).toBe('degraded');
    expect(run.captureMode).toBe('final_only');
    expect(run.liveHeartbeatExpected).toBe(false);
    expect(run.flowState).toBe('supported');
    expect(run.issue).toBeNull();
  });
});
