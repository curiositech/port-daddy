import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createUsageTelemetry } from '../../lib/usage-telemetry.js';
import { usagePlugin } from '../../routes/usage.js';

describe('usage routes', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = createTestDb();
    app = Fastify();
    const usageTelemetry = createUsageTelemetry(db, {
      version: '9.9.9',
      codeHash: 'abc123',
      buildDate: '2026-04-30T00:00:00.000Z',
    });
    await app.register(usagePlugin, { deps: { usageTelemetry } });
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  test('POST /usage/trace records token and cost dimensions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/usage/trace',
      payload: {
        surface: 'daemon',
        kind: 'agent_work',
        name: 'spawn.completed',
        workScope: 'agent_work',
        inputTokens: 200,
        outputTokens: 50,
        turns: 1,
        toolCalls: 2,
        costUsd: 0.001,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({ success: true }));

    const summary = await app.inject({ method: 'GET', url: '/usage/summary?window=24h' });
    expect(summary.statusCode).toBe(200);
    const body = summary.json();
    expect(body.totals.totalTokens).toBe(250);
    expect(body.costByScope.find(row => row.scope === 'agent_work')).toEqual(expect.objectContaining({
      events: 1,
      costUsd: 0.001,
      turns: 1,
      toolCalls: 2,
    }));
  });

  test('POST /usage/trace validates required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/usage/trace',
      payload: { name: 'missing surface' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual(expect.objectContaining({ success: false }));
  });
});
