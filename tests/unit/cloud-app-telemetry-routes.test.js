import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createCostTracker } from '../../lib/cost-tracker.js';
import { createCloudAppTelemetry } from '../../lib/cloud-app-telemetry.js';
import { cloudAppTelemetryPlugin } from '../../routes/cloud-app-telemetry.js';

describe('cloud app telemetry routes', () => {
  let db;
  let app;

  async function buildApp(token = 'remote-token') {
    db = createTestDb();
    const costTracker = createCostTracker(db);
    const cloudAppTelemetry = createCloudAppTelemetry(db, { costTracker });
    app = Fastify();
    await app.register(cloudAppTelemetryPlugin, {
      deps: { cloudAppTelemetry, remoteTelemetryToken: token },
    });
    return { app, cloudAppTelemetry };
  }

  afterEach(async () => {
    if (app) await app.close();
    if (db) db.close();
    app = null;
    db = null;
  });

  test('rejects remote ingest without the configured bearer token', async () => {
    const { app } = await buildApp();

    const missing = await app.inject({
      method: 'POST',
      url: '/telemetry/cloud-app',
      payload: { event: 'pull_request', status: 'accepted' },
    });
    expect(missing.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'POST',
      url: '/telemetry/cloud-app',
      headers: { authorization: 'Bearer nope' },
      payload: { event: 'pull_request', status: 'accepted' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  test('records authenticated remote telemetry and exposes summary plus recent events', async () => {
    const { app } = await buildApp();
    const ingest = await app.inject({
      method: 'POST',
      url: '/telemetry/cloud-app',
      headers: { authorization: 'Bearer remote-token' },
      payload: {
        id: 'delivery-4:red-team',
        deliveryId: 'delivery-4',
        event: 'pull_request',
        action: 'synchronize',
        owner: 'curiositech',
        repo: 'port-daddy',
        prNumber: 628,
        ship: 'red-team',
        status: 'clean',
        backend: 'cloudflare',
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
        inputTokens: 500,
        outputTokens: 25,
      },
    });
    expect(ingest.statusCode).toBe(200);
    expect(ingest.json().event.costUsd).toBeGreaterThan(0);

    const summary = await app.inject({ method: 'GET', url: '/telemetry/cloud-app?since=86400' });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().totals.events).toBe(1);
    expect(summary.json().byShip[0].ship).toBe('red-team');

    const events = await app.inject({ method: 'GET', url: '/telemetry/cloud-app/events?limit=10' });
    expect(events.statusCode).toBe(200);
    expect(events.json().events).toHaveLength(1);
    expect(events.json().events[0]).toEqual(expect.objectContaining({
      deliveryId: 'delivery-4',
      ship: 'red-team',
    }));
  });

  test('fails closed when ingest token is not configured', async () => {
    const oldCloudToken = process.env.PD_CLOUD_APP_TELEMETRY_TOKEN;
    const oldRemoteToken = process.env.PD_REMOTE_TELEMETRY_TOKEN;
    delete process.env.PD_CLOUD_APP_TELEMETRY_TOKEN;
    delete process.env.PD_REMOTE_TELEMETRY_TOKEN;
    try {
      const { app } = await buildApp(null);
      const res = await app.inject({
        method: 'POST',
        url: '/telemetry/cloud-app',
        headers: { authorization: 'Bearer anything' },
        payload: { event: 'pull_request', status: 'accepted' },
      });
      expect(res.statusCode).toBe(503);
    } finally {
      if (oldCloudToken === undefined) delete process.env.PD_CLOUD_APP_TELEMETRY_TOKEN;
      else process.env.PD_CLOUD_APP_TELEMETRY_TOKEN = oldCloudToken;
      if (oldRemoteToken === undefined) delete process.env.PD_REMOTE_TELEMETRY_TOKEN;
      else process.env.PD_REMOTE_TELEMETRY_TOKEN = oldRemoteToken;
    }
  });
});
