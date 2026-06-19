import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createCounters } from '../../lib/counters.js';
import { createUsageTelemetry, classifyUsageCategory } from '../../lib/usage-telemetry.js';

describe('usage telemetry', () => {
  let db;
  let counters;
  let usage;

  beforeEach(() => {
    db = createTestDb();
    counters = createCounters(db);
    usage = createUsageTelemetry(db, {
      version: '9.9.9',
      codeHash: 'abc123',
      buildDate: '2026-04-30T00:00:00.000Z',
    }, { counters });
  });

  afterEach(() => {
    counters.shutdown();
    db.close();
  });

  test('records append-only events and bumps counters', () => {
    usage.record({
      surface: 'cli',
      kind: 'command',
      name: 'pd tuple out',
      agentType: 'codex',
      agentModel: 'gpt-5.3-codex',
      backend: 'codex',
      status: 'ok',
    });

    counters.flush();

    const summary = usage.summary();
    expect(summary.totals.events).toBe(1);
    expect(summary.costByScope.find(row => row.scope === 'port_daddy_call')?.events).toBe(1);
    expect(summary.bySurface[0]).toMatchObject({ key: 'cli', count: 1 });
    expect(summary.byCategory[0]).toMatchObject({ key: 'tuples', count: 1 });

    const counterRows = counters.summary();
    expect(counterRows.some((row) => row.key === 'usage.cli.command')).toBe(true);
  });

  test('tracks capability gaps for unused surfaces', () => {
    usage.record({
      surface: 'mcp',
      kind: 'tool_call',
      name: 'claim_port',
      agentType: 'claude',
      agentModel: 'sonnet',
    });

    const summary = usage.summary();
    expect(summary.unusedCapabilities).toContain('pheromones');
    expect(summary.unusedCapabilities).toContain('tuples');
    expect(summary.capabilities.find((row) => row.category === 'ports')?.count).toBe(1);
  });

  test('separates Port Daddy call overhead from spawned agent work cost', () => {
    usage.record({
      surface: 'mcp',
      kind: 'tool_call',
      name: 'tuple_out',
      toolCalls: 1,
    });
    usage.record({
      surface: 'daemon',
      kind: 'agent_work',
      name: 'spawn.completed',
      workScope: 'agent_work',
      agentType: 'codex',
      agentModel: 'gpt-5.3-codex',
      inputTokens: 1000,
      cachedInputTokens: 100,
      outputTokens: 250,
      turns: 2,
      toolCalls: 3,
      costUsd: 0.005,
    });

    const summary = usage.summary();
    expect(summary.totals.totalTokens).toBe(1250);
    expect(summary.totals.turns).toBe(2);
    expect(summary.totals.toolCalls).toBe(4);
    expect(summary.totals.costUsd).toBe(0.005);

    const callScope = summary.costByScope.find(row => row.scope === 'port_daddy_call');
    const workScope = summary.costByScope.find(row => row.scope === 'agent_work');
    expect(callScope).toMatchObject({ events: 1, toolCalls: 1, costUsd: 0 });
    expect(workScope).toMatchObject({ events: 1, totalTokens: 1250, turns: 2, toolCalls: 3, costUsd: 0.005 });
  });

  test('category classifier recognizes key Port Daddy primitives', () => {
    expect(classifyUsageCategory({ name: 'tuple_out' })).toBe('tuples');
    expect(classifyUsageCategory({ name: 'file_heat' })).toBe('pheromones');
    expect(classifyUsageCategory({ name: 'GET /resources/overview' })).toBe('resources');
  });
});
