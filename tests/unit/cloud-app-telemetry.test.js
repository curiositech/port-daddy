/**
 * Unit tests for remote Cloud App telemetry.
 */

import { createTestDb } from '../setup-unit.js';
import { createCostTracker } from '../../lib/cost-tracker.js';
import { createCloudAppTelemetry } from '../../lib/cloud-app-telemetry.js';

describe('CloudAppTelemetry', () => {
  let db;
  let cloudAppTelemetry;

  beforeEach(() => {
    db = createTestDb();
    const costTracker = createCostTracker(db);
    cloudAppTelemetry = createCloudAppTelemetry(db, { costTracker });
  });

  afterEach(() => {
    db.close();
  });

  test('records remote GitHub App ship activity and derives Cloudflare token cost', () => {
    const event = cloudAppTelemetry.record({
      id: 'delivery-1:code-reviewer',
      timestamp: Date.now(),
      deliveryId: 'delivery-1',
      event: 'pull_request',
      action: 'opened',
      owner: 'curiositech',
      repo: 'port-daddy',
      prNumber: 625,
      sha: 'abc123',
      ship: 'code-reviewer',
      role: 'skeptical reviewer',
      status: 'findings',
      conclusion: 'failure',
      backend: 'cloudflare',
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(event).toEqual(expect.objectContaining({
      deliveryId: 'delivery-1',
      ship: 'code-reviewer',
      status: 'findings',
      costIsEstimate: false,
    }));
    expect(event.costUsd).toBeGreaterThan(0);

    const summary = cloudAppTelemetry.summary();
    expect(summary.totals.events).toBe(1);
    expect(summary.totals.shipEvents).toBe(1);
    expect(summary.totals.costUsd).toBe(event.costUsd);
    expect(summary.byRepo[0]).toEqual(expect.objectContaining({
      owner: 'curiositech',
      repo: 'port-daddy',
      pullRequests: 1,
    }));
    expect(summary.byShip[0]).toEqual(expect.objectContaining({
      ship: 'code-reviewer',
      findings: 1,
    }));
    expect(summary.byBackend[0]).toEqual(expect.objectContaining({
      backend: 'cloudflare',
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
    }));
  });

  test('upserts duplicate delivery events so retries do not double count remote spend', () => {
    cloudAppTelemetry.record({
      id: 'delivery-2:qa',
      deliveryId: 'delivery-2',
      event: 'pull_request',
      owner: 'curiositech',
      repo: 'port-daddy',
      prNumber: 626,
      ship: 'qa',
      status: 'error',
      backend: 'cloudflare',
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      inputTokens: 1000,
      outputTokens: 1000,
    });
    cloudAppTelemetry.record({
      id: 'delivery-2:qa',
      deliveryId: 'delivery-2',
      event: 'pull_request',
      owner: 'curiositech',
      repo: 'port-daddy',
      prNumber: 626,
      ship: 'qa',
      status: 'clean',
      backend: 'cloudflare',
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      inputTokens: 100,
      outputTokens: 10,
    });

    const summary = cloudAppTelemetry.summary();
    expect(summary.totals.events).toBe(1);
    expect(summary.byShip[0]).toEqual(expect.objectContaining({
      ship: 'qa',
      clean: 1,
      errors: 0,
    }));
  });

  test('keeps unknown-cost remote activity visible instead of inventing a local spend number', () => {
    const event = cloudAppTelemetry.record({
      deliveryId: 'delivery-3',
      event: 'pull_request',
      owner: 'curiositech',
      repo: 'port-daddy',
      prNumber: 627,
      status: 'accepted',
    });

    expect(event.costUsd).toBeNull();
    const summary = cloudAppTelemetry.summary();
    expect(summary.totals.events).toBe(1);
    expect(summary.totals.costUsd).toBe(0);
    expect(summary.totals.unknownCostEvents).toBe(1);
  });

  test('projects Cloudflare PR ship events as agent-shaped fleet records', () => {
    const now = Date.now();
    cloudAppTelemetry.record({
      id: 'delivery-4:code-reviewer:1',
      timestamp: now - 60_000,
      deliveryId: 'delivery-4',
      event: 'pull_request',
      action: 'opened',
      owner: 'curiositech',
      repo: 'port-daddy',
      prNumber: 628,
      ship: 'code-reviewer',
      role: 'skeptical reviewer',
      status: 'findings',
      conclusion: 'failure',
      backend: 'cloudflare',
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      inputTokens: 1200,
      outputTokens: 300,
      commentUrl: 'https://github.com/curiositech/port-daddy/pull/628#issuecomment-1',
    });
    cloudAppTelemetry.record({
      id: 'delivery-4:webhook-accepted',
      timestamp: now - 90_000,
      deliveryId: 'delivery-4',
      event: 'pull_request',
      action: 'opened',
      owner: 'curiositech',
      repo: 'port-daddy',
      prNumber: 628,
      status: 'accepted',
    });

    const agents = cloudAppTelemetry.agents();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^cloudflare:curiositech\.port-daddy:code-reviewer:/),
      name: 'pd-code-reviewer',
      type: 'cloudflare',
      pid: 0,
      isActive: true,
      identity: 'port-daddy:cloudflare:code-reviewer',
      purpose: 'Remote skeptical reviewer for curiositech/port-daddy PR fleet',
      status: 'draining',
      isReady: false,
    }));
    expect(agents[0].metadata).toEqual(expect.objectContaining({
      origin: 'remote',
      remote: true,
      events: 1,
      pullRequests: 1,
      latestPrNumber: 628,
      latestStatus: 'findings',
      latestCommentUrl: 'https://github.com/curiositech/port-daddy/pull/628#issuecomment-1',
    }));
    expect(agents[0].metadata.costUsd).toBeGreaterThan(0);

    expect(cloudAppTelemetry.getAgent(agents[0].id)).toEqual(expect.objectContaining({
      id: agents[0].id,
      name: 'pd-code-reviewer',
    }));
  });
});
