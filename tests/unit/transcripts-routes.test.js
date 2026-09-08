/**
 * Smoke tests for routes/transcripts.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createTranscripts } from '../../lib/transcripts.js';
import {
  TRANSCRIPT_EMERGENCY_KIND,
  TRANSCRIPT_EMERGENCY_STATE,
} from '../../lib/transcript-emergency.js';
import { transcriptsPlugin } from '../../routes/transcripts.js';

async function buildApp(deps) {
  const app = Fastify();
  await app.register(transcriptsPlugin, { deps });
  await app.ready();
  return app;
}

function makeDeps(transcripts, extra = {}) {
  return {
    transcripts,
    metrics: { errors: 0 },
    logger: { info: () => {}, error: () => {} },
    ...extra,
  };
}

describe('routes/transcripts', () => {
  let db;
  let transcripts;
  let app;

  beforeEach(async () => {
    db = createTestDb();
    transcripts = createTranscripts(db);
    app = await buildApp(makeDeps(transcripts));
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('GET /transcripts returns empty list initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/transcripts' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.transcripts).toEqual([]);
    expect(body.count).toBe(0);
  });

  it('GET /transcripts filters by ship', async () => {
    transcripts.start({ ship: 'qa', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm' });
    transcripts.start({ ship: 'code-reviewer', spawned_agent_id: 'b', trigger: 't', backend: 'c', model: 'm' });
    const res = await app.inject({ method: 'GET', url: '/transcripts?ship=qa' });
    const body = JSON.parse(res.body);
    expect(body.count).toBe(1);
    expect(body.transcripts[0].ship).toBe('qa');
  });

  it('GET /transcripts/compliance returns the backend matrix even with no live runs', async () => {
    const res = await app.inject({ method: 'GET', url: '/transcripts/compliance' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.matrix).toEqual(expect.arrayContaining([
      expect.objectContaining({ backend: 'cloudflare', support: 'supported' }),
      expect.objectContaining({
        backend: 'cli:agy',
        support: 'degraded',
        captureMode: 'final_only',
        liveHeartbeatExpected: false,
        finalTranscriptExpected: true,
      }),
    ]));
    expect(body.summary.flow.running).toBe(0);
  });

  it('GET /transcripts/compliance reports stalled live runs as HITL issues', async () => {
    await app.close();
    const startedAt = Date.now() - 10_000;
    const id = transcripts.start({
      ship: 'spawn:cli:codex',
      spawned_agent_id: 'spawned-stalled-route',
      trigger: 'manual',
      backend: 'cli:codex',
      model: 'codex-cli',
      started_at: startedAt,
    });
    transcripts.appendMessage(id, {
      role: 'assistant',
      content: 'stale delta',
      timestamp: startedAt,
    });
    app = await buildApp(makeDeps(transcripts, {
      spawner: {
        list() {
          return [{
            agentId: 'spawned-stalled-route',
            backend: 'cli:codex',
            status: 'running',
            startedAt,
            completedAt: null,
          }];
        },
      },
    }));

    const res = await app.inject({ method: 'GET', url: '/transcripts/compliance?stallAfterMs=1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.degraded).toBe(true);
    expect(body.hitlEmergency).toBe(true);
    expect(body.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'transcript_flow_stalled',
        agentId: 'spawned-stalled-route',
        requiresHitl: true,
      }),
    ]));
  });

  it('GET /transcripts/emergency returns HITL emergency records for stalled transcript flow', async () => {
    await app.close();
    const startedAt = Date.now() - 10_000;
    const id = transcripts.start({
      ship: 'spawn:cli:codex',
      spawned_agent_id: 'spawned-emergency-route',
      trigger: 'manual',
      backend: 'cli:codex',
      model: 'codex-cli',
      started_at: startedAt,
    });
    transcripts.appendMessage(id, {
      role: 'assistant',
      content: 'stale delta',
      timestamp: startedAt,
    });
    app = await buildApp(makeDeps(transcripts, {
      spawner: {
        list() {
          return [{
            agentId: 'spawned-emergency-route',
            backend: 'cli:codex',
            status: 'running',
            startedAt,
            completedAt: null,
          }];
        },
      },
    }));

    const res = await app.inject({ method: 'GET', url: '/transcripts/emergency?stallAfterMs=1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.hitlEmergency).toBe(true);
    expect(body.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: TRANSCRIPT_EMERGENCY_KIND.LOCAL_SPAWNER,
        state: TRANSCRIPT_EMERGENCY_STATE.EMERGENCY,
        requiresHitl: true,
      }),
    ]));
  });

  it('GET /transcripts/emergency rejects invalid stallAfterMs instead of ignoring it', async () => {
    const res = await app.inject({ method: 'GET', url: '/transcripts/emergency?stallAfterMs=not-a-number' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body).toEqual({
      success: false,
      error: 'stallAfterMs must be a positive integer duration in milliseconds',
    });
  });

  it('GET /transcripts/emergency rejects invalid since instead of ignoring it', async () => {
    const res = await app.inject({ method: 'GET', url: '/transcripts/emergency?since=0' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body).toEqual({
      success: false,
      error: 'since must be a positive integer duration in milliseconds',
    });
  });

  it('GET /transcripts/:id returns 404 for unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/transcripts/tx_does_not_exist' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /transcripts/:id returns the full transcript', async () => {
    const id = transcripts.start({
      ship: 'qa', spawned_agent_id: 'a', trigger: 'manual', backend: 'claude', model: 'm',
    });
    transcripts.appendMessage(id, { role: 'user', content: 'hello', timestamp: Date.now() });
    transcripts.appendOutput(id, { type: 'noop', summary: 'no-op' });
    transcripts.finalize(id, { status: 'completed', cost_usd: 0.001 });

    const res = await app.inject({ method: 'GET', url: `/transcripts/${id}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.transcript.status).toBe('completed');
    expect(body.transcript.messages).toHaveLength(1);
    expect(body.transcript.outputs).toHaveLength(1);
  });

  it('does not expose a full-entry writer that can terminalize a live transcript', async () => {
    const id = transcripts.start({
      id: 'tx_live_canonical',
      ship: 'spawn:cli:codex',
      spawned_agent_id: 'spawned-canonical',
      trigger: 'manual',
      backend: 'cli:codex',
      model: 'codex-cli',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/transcripts',
      payload: {
        id,
        ship: 'forged',
        session_id: null,
        spawned_agent_id: 'attacker',
        trigger: 'forged',
        backend: 'forged',
        model: 'forged',
        status: 'completed',
        started_at: Date.now(),
        ended_at: Date.now(),
        messages: [{ role: 'assistant', content: 'forged terminal result', timestamp: Date.now() }],
        outputs: [{ type: 'commit', summary: 'forged output' }],
      },
    });

    expect(res.statusCode).toBe(404);
    expect(transcripts.getTranscript(id)).toEqual(expect.objectContaining({
      ship: 'spawn:cli:codex',
      spawned_agent_id: 'spawned-canonical',
      status: 'running',
      messages: [],
      outputs: [],
    }));
  });

  it('does not expose a message writer that can poison a live transcript', async () => {
    const id = transcripts.start({ ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm' });
    const res = await app.inject({
      method: 'POST',
      url: `/transcripts/${id}/messages`,
      payload: { role: 'assistant', content: 'forged canonical output' },
    });
    expect(res.statusCode).toBe(404);
    expect(transcripts.getTranscript(id).messages).toEqual([]);
  });

  it('does not expose an output writer that can forge durable evidence', async () => {
    const id = transcripts.start({ ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm' });
    const res = await app.inject({
      method: 'POST',
      url: `/transcripts/${id}/outputs`,
      payload: { type: 'commit', summary: 'forged commit receipt' },
    });
    expect(res.statusCode).toBe(404);
    expect(transcripts.getTranscript(id).outputs).toEqual([]);
  });

  it('does not expose deletion even to an uncredentialed local caller', async () => {
    const id = transcripts.start({ ship: 's', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm' });
    const res = await app.inject({ method: 'DELETE', url: `/transcripts/${id}` });
    expect(res.statusCode).toBe(404);
    expect(transcripts.getTranscript(id)).toEqual(expect.objectContaining({ status: 'running' }));
  });

  it('does not expose archive backfill as credentialless forced work', async () => {
    const res = await app.inject({ method: 'POST', url: '/transcripts/archive/backfill' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /transcripts/cost returns aggregated cost rollup', async () => {
    const t0 = Date.now() - 1000;
    const id = transcripts.start({
      ship: 'qa', spawned_agent_id: 'a', trigger: 't', backend: 'c', model: 'm', started_at: t0,
    });
    transcripts.finalize(id, { status: 'completed', cost_usd: 0.05, tokens_in: 100, tokens_out: 25 });
    const res = await app.inject({ method: 'GET', url: `/transcripts/cost?since=${t0 - 1}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.total_runs).toBe(1);
    expect(body.total_cost_usd).toBeCloseTo(0.05, 5);
    expect(body.by_ship).toEqual(expect.arrayContaining([
      expect.objectContaining({ ship: 'qa', runs: 1 }),
    ]));
  });

  it('returns 501 when transcripts dep is missing', async () => {
    await app.close();
    const naked = await buildApp(makeDeps(undefined));
    const res = await naked.inject({ method: 'GET', url: '/transcripts' });
    expect(res.statusCode).toBe(501);
    await naked.close();
  });
});
