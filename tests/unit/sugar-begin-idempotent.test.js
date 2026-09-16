/**
 * Regression: `pd begin` forked a NEW session+agent on every call. Two begins
 * for the same identity in the same worktree produced two parallel active
 * sessions; the first held the file claims, the second could not re-claim, and
 * the Coordination Guard then rejected the commit ("no active session" /
 * "claimed by another active session"). This bit the operator at essentially
 * every API-driven commit.
 *
 * Fix: begin is idempotent per (identity, worktree) — it RESUMES the existing
 * active session instead of forking. `force: true` opts back into a fresh one.
 */

import { createTestDb, createMockLogger } from '../setup-unit.js';
import { createAgents } from '../../lib/agents.js';
import { createSessions } from '../../lib/sessions.js';
import { createActivityLog } from '../../lib/activity.js';
import { createSugar, projectContextContinuation } from '../../lib/sugar.js';

function readyContextLookup(sourceSessionId) {
  const packet = {
    schema: 'pd.agent-harbor.compaction-packet.v0',
    packetId: 'cpk_verified_fixture',
    agentNodeId: 'agent_fixture',
    sessionId: sourceSessionId,
    createdAt: '2026-08-27T00:00:00.000Z',
    createdBy: { kind: 'daemon' },
    trigger: { kind: 'context-threshold', contextEnvelopeRef: 'ctx_verified_fixture' },
    identity: { task: 'Continue only from the verified plan' },
    obligations: [],
    factualClaims: [],
    transcriptExcerpts: [{ citation: { kind: 'transcript-event', transcriptEventId: 'evt_private' }, excerpt: 'RAW_TRANSCRIPT_MUST_NOT_ESCAPE' }],
    nextAction: { recommendation: 'Use the bounded checkpoint.' },
    sourceTranscript: { headEventId: 'evt_context_head', headHash: 'head_hash' },
    validator: { passed: true, uncitedClaimCount: 0, missingObligationWarnings: [] },
    transcriptEventId: 'evt_packet_fixture',
  };
  return {
    status: 'ready',
    sourceSessionId,
    packet,
    bootstrap: {
      packet,
      sessionId: sourceSessionId,
      agentNodeId: 'agent_fixture',
      planCheckpoint: {
        transcriptEventId: 'evt_plan_fixture',
        content: '- [ ] Resume the bounded plan',
        capturedAt: '2026-08-27T00:00:00.000Z',
      },
      transcriptPrefix: [{ transcriptEventId: 'evt_private', sequence: 7, kind: 'tool_result', ledgerSeq: 9 }],
      transcriptPrefixTruncated: true,
      contextRef: { kind: 'compaction-packet', ref: 'packet:cpk_verified_fixture', droppable: false },
      revalidation: { passed: true, uncitedClaimCount: 0, missingObligationWarnings: [] },
    },
    envelope: { schema: 'pd.agent-harbor.context-envelope.v0' },
  };
}

function setup({ contextBootstrapLookup } = {}) {
  const db = createTestDb();
  const agents = createAgents(db);
  const sessions = createSessions(db);
  const activityLog = createActivityLog(db);
  sessions.setActivityLog(activityLog);
  const sugar = createSugar({
    agents,
    sessions,
    activityLog,
    gitOriginChecker: { checkBranchOnOrigin: () => ({ ok: true, branch: 'feat/x', upstream: 'origin/feat/x', ahead: 0 }) },
    contextBootstrapLookup,
  });
  return { db, agents, sessions, sugar };
}

describe('begin idempotency — resume, do not fork', () => {
  test('re-begin with the same identity in the same worktree RESUMES the same session', () => {
    const { sugar } = setup();
    const first = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'first call' });
    expect(first.success).toBe(true);

    const second = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'second call, same identity' });
    expect(second.success).toBe(true);
    expect(second.resumed).toBe(true);
    expect(second.agentId).toBe(first.agentId);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.contextContinuation).toEqual({ status: 'none' });
  });

  test('active re-begin reads only the exact session verified packet and plan', () => {
    const lookups = [];
    const { sugar } = setup({
      contextBootstrapLookup: (sourceSessionId) => {
        lookups.push(sourceSessionId);
        return readyContextLookup(sourceSessionId);
      },
    });
    const first = sugar.begin({ lifecycle: 'durable', identity: 'demo:test:active-context', purpose: 'first active call' });
    const second = sugar.begin({ lifecycle: 'durable', identity: 'demo:test:active-context', purpose: 'resume active context' });

    expect(second.resumed).toBe(true);
    expect(second.takeover).toBeUndefined();
    expect(lookups).toEqual([first.sessionId]);
    expect(second.contextContinuation).toEqual(expect.objectContaining({
      status: 'ready',
      sourceSessionId: first.sessionId,
      planCheckpoint: expect.objectContaining({ content: '- [ ] Resume the bounded plan' }),
    }));
    expect(JSON.stringify(second.contextContinuation)).not.toContain('RAW_TRANSCRIPT_MUST_NOT_ESCAPE');
  });

  test('force: true mints a fresh session even for the same identity', () => {
    const { sugar } = setup();
    const first = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'work' });
    const forced = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'work', force: true });
    expect(forced.success).toBe(true);
    expect(forced.resumed).toBeFalsy();
    expect(forced.sessionId).not.toBe(first.sessionId);
  });

  test('a different identity does NOT resume — it gets its own session', () => {
    const { sugar } = setup();
    const a = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:alpha', purpose: 'work' });
    const b = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:beta', purpose: 'work' });
    expect(b.resumed).toBeFalsy();
    expect(b.sessionId).not.toBe(a.sessionId);
  });

  test('an explicit agentId opts out of resume (caller owns identity)', () => {
    const { sugar } = setup();
    const first = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'work' });
    const explicit = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'work', agentId: 'agent-explicit-xyz' });
    expect(explicit.resumed).toBeFalsy();
    expect(explicit.agentId).toBe('agent-explicit-xyz');
    expect(explicit.sessionId).not.toBe(first.sessionId);
  });

  test('resume claims newly-passed files onto the existing session', () => {
    const { sugar, sessions } = setup();
    const first = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'work' });
    const second = sugar.begin({ lifecycle: 'ephemeral', identity: 'demo:test:ctx', purpose: 'work', files: ['lib/widget.ts'] });
    expect(second.resumed).toBe(true);
    const got = sessions.get(first.sessionId);
    expect(JSON.stringify(got)).toContain('lib/widget.ts');
  });

  test('begin without an identity is unaffected (still creates)', () => {
    const { sugar } = setup();
    const a = sugar.begin({ lifecycle: 'ephemeral', purpose: 'no identity A' });
    const b = sugar.begin({ lifecycle: 'ephemeral', purpose: 'no identity B' });
    expect(a.success && b.success).toBe(true);
    expect(b.resumed).toBeFalsy();
    expect(b.sessionId).not.toBe(a.sessionId);
  });

  test('closed-session re-begin returns an exact takeover candidate without reading predecessor context', () => {
    const lookups = [];
    const { sugar, sessions } = setup({
      contextBootstrapLookup: (sourceSessionId) => {
        lookups.push(sourceSessionId);
        return readyContextLookup(sourceSessionId);
      },
    });
    const first = sugar.begin({ lifecycle: 'durable', identity: 'demo:test:verified', purpose: 'first verified call' });
    expect(first.contextContinuation).toEqual({ status: 'none' });
    sessions.end(first.sessionId, { note: 'completed before verified takeover' });

    const second = sugar.begin({ lifecycle: 'durable', identity: 'demo:test:verified', purpose: 'take over verified work' });

    expect(second).toMatchObject({
      success: false,
      code: 'CLOSED_SESSION_REQUIRES_EXPLICIT_TAKEOVER',
      candidates: [expect.objectContaining({
        sessionId: first.sessionId,
        status: 'completed',
        lifecycle: 'durable',
      })],
    });
    expect(second.hint).toContain(`pd session takeover ${first.sessionId}`);
    expect(lookups).toEqual([]);
    expect(second).not.toHaveProperty('contextContinuation');
    expect(JSON.stringify(second)).not.toContain('RAW_TRANSCRIPT_MUST_NOT_ESCAPE');
  });

  test('malformed lookup output is withheld rather than copied into a continuation', () => {
    const result = projectContextContinuation('session_exact', () => ({
      ...readyContextLookup('session_other'),
      sourceSessionId: 'session_exact',
    }));

    expect(result).toEqual({
      status: 'withheld',
      sourceSessionId: 'session_exact',
      packetId: null,
      reason: 'verified-context-bootstrap-invalid',
    });
  });

  test('a packet without its last plan checkpoint is withheld at the entry boundary', () => {
    const lookup = readyContextLookup('session_exact');
    lookup.bootstrap.planCheckpoint = null;

    expect(projectContextContinuation('session_exact', () => lookup)).toEqual({
      status: 'withheld',
      sourceSessionId: 'session_exact',
      packetId: null,
      reason: 'verified-context-bootstrap-invalid',
    });
  });

  test('a verified lookup withholding context exposes no underlying reason or transcript material', () => {
    expect(projectContextContinuation('session_exact', () => ({
      status: 'withheld',
      sourceSessionId: 'session_exact',
      packetId: 'cpk_withheld_fixture',
      reason: 'internal ledger validation detail',
    }))).toEqual({
      status: 'withheld',
      sourceSessionId: 'session_exact',
      packetId: 'cpk_withheld_fixture',
      reason: 'verified-context-bootstrap-withheld',
    });
  });
});
