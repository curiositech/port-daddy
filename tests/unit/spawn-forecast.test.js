/**
 * Spawn forecast (lib/spawn-forecast.ts) — the "how many calls/hour on which
 * models" computation behind GET /fleet/forecast and the FleetBar dropdown.
 *
 * The forecast must mirror ENGINE reality, not YAML intent:
 *   - cron rates come from the same interval parser the engine arms
 *     setInterval with (a weekly cron REALLY fires every 10 minutes);
 *   - cooldowns damp rates; max_spawns_per_hour caps project totals;
 *   - the forced CLI backend rewrites every agent's effective backend/model
 *     with the launcher's placeholder rules.
 */

import { describe, expect, test } from '@jest/globals';
import { computeSpawnForecast, cronPerHour, cronIsRepresentable } from '../../lib/spawn-forecast.js';
import { resolveModel } from '../../lib/model-registry.js';

function fleet(overrides = {}) {
  return {
    project: 'demo',
    projectDir: '/tmp/demo',
    running: true,
    config: {
      name: 'demo',
      agents: [],
      watchers: [],
      channels: {},
      ...overrides,
    },
  };
}

describe('cronPerHour mirrors the engine interval parser', () => {
  test('*/30 minutes → 2/hr; */10 → 6/hr', () => {
    expect(cronPerHour('*/30 * * * *')).toBe(2);
    expect(cronPerHour('*/10 * * * *')).toBe(6);
  });

  test('0 */2 hourly-step → 0.5/hr; top of hour → 1/hr', () => {
    expect(cronPerHour('0 */2 * * *')).toBe(0.5);
    expect(cronPerHour('0 * * * *')).toBe(1);
  });

  test('unrepresentable cron (weekly) falls to the 10-minute default → 6/hr', () => {
    // This is the engine's ACTUAL behavior: startAgent arms
    // setInterval(parseCronInterval(cron)) with no fire-time cron gate, so
    // "0 8 * * 1" (weekly) really fires every 10 minutes.
    expect(cronPerHour('0 8 * * 1')).toBe(6);
    expect(cronIsRepresentable('0 8 * * 1')).toBe(false);
    expect(cronIsRepresentable('*/30 * * * *')).toBe(true);
    expect(cronIsRepresentable('0 */4 * * *')).toBe(true);
    expect(cronIsRepresentable('0 * * * *')).toBe(true);
  });
});

describe('computeSpawnForecast', () => {
  test('scheduled agents get deterministic rates; event agents get null + triggers', () => {
    const result = computeSpawnForecast(
      [
        fleet({
          agents: [
            { name: 'cartographer', task: 't', backend: 'codex', schedule: '*/30 * * * *' },
            { name: 'qa', task: 't', backend: 'codex', trigger: 'pull_request:opened' },
          ],
        }),
      ],
      { forcedCliBackend: null },
    );

    const [project] = result.projects;
    const scheduled = project.agents.find((a) => a.agent === 'cartographer');
    const event = project.agents.find((a) => a.agent === 'qa');

    expect(scheduled.kind).toBe('scheduled');
    expect(scheduled.perHour).toBe(2);
    expect(event.kind).toBe('event');
    expect(event.perHour).toBeNull();
    expect(event.triggers).toEqual(['pull_request:opened']);
    expect(project.eventAgentCount).toBe(1);
    expect(result.totals.scheduledPerHour).toBe(2);
  });

  test('weekly cron is flagged approxSchedule and counted at its REAL 6/hr rate', () => {
    const result = computeSpawnForecast(
      [fleet({ agents: [{ name: 'tenderfoot', task: 't', backend: 'codex', schedule: '0 8 * * 1' }] })],
      { forcedCliBackend: null },
    );
    const agent = result.projects[0].agents[0];
    expect(agent.approxSchedule).toBe(true);
    expect(agent.perHour).toBe(6);
  });

  test('cooldown damps the effective rate', () => {
    const result = computeSpawnForecast(
      [
        fleet({
          agents: [
            // Interval says 6/hr; a 30-minute cooldown means at most 2/hr.
            { name: 'harbor-pilot', task: 't', backend: 'codex', schedule: '*/10 * * * *', cooldownMs: 1_800_000 },
          ],
        }),
      ],
      { forcedCliBackend: null },
    );
    expect(result.projects[0].agents[0].perHour).toBe(2);
  });

  test('max_spawns_per_hour caps the project and machine totals', () => {
    const result = computeSpawnForecast(
      [
        fleet({
          limits: { maxSpawnsPerHour: 4 },
          agents: [
            { name: 'a', task: 't', backend: 'codex', schedule: '*/10 * * * *' }, // 6/hr
            { name: 'b', task: 't', backend: 'codex', schedule: '*/10 * * * *' }, // 6/hr
          ],
        }),
      ],
      { forcedCliBackend: null },
    );
    const [project] = result.projects;
    expect(project.scheduledPerHourRaw).toBe(12);
    expect(project.scheduledPerHour).toBe(4);
    expect(result.totals.scheduledPerHour).toBe(4);
    // by-model attribution is scaled so it still sums to the cap.
    const byModelSum = result.totals.byModel.reduce((s, r) => s + r.perHour, 0);
    expect(byModelSum).toBeCloseTo(4, 1);
  });

  test('stopped fleets are reported but excluded from machine totals', () => {
    const stopped = fleet({ agents: [{ name: 'a', task: 't', backend: 'codex', schedule: '*/30 * * * *' }] });
    stopped.running = false;
    const result = computeSpawnForecast([stopped], { forcedCliBackend: null });
    expect(result.projects[0].scheduledPerHour).toBe(2);
    expect(result.totals.scheduledPerHour).toBe(0);
    expect(result.totals.byModel).toEqual([]);
  });

  test('forced cli:codex rewrites every effective backend and resolves the codex model', () => {
    const result = computeSpawnForecast(
      [
        fleet({
          agents: [
            // Placeholder model (backend name) → registry codex cheap default.
            { name: 'a', task: 't', backend: 'codex', schedule: '*/30 * * * *' },
          ],
        }),
      ],
      { forcedCliBackend: 'cli:codex' },
    );
    const agent = result.projects[0].agents[0];
    expect(agent.effectiveBackend).toBe('cli:codex');
    expect(agent.model).toBe(resolveModel({ backend: 'codex', capability: 'cheap' }));
    expect(result.forcedCliBackend).toBe('cli:codex');
  });

  test('forced CLI + cross-provider model is flagged as a mismatch risk', () => {
    const result = computeSpawnForecast(
      [
        fleet({
          agents: [
            { name: 'a', task: 't', backend: 'claude', model: 'claude-sonnet-4-6', schedule: '*/30 * * * *' },
          ],
        }),
      ],
      { forcedCliBackend: 'cli:codex' },
    );
    const agent = result.projects[0].agents[0];
    expect(agent.effectiveBackend).toBe('cli:codex');
    // The launcher passes the resolved model verbatim — codex may reject it.
    expect(agent.model).toBe('claude-sonnet-4-6');
    expect(agent.modelMismatchRisk).toBe(true);
  });

  test('totals group by effective (backend, model)', () => {
    const result = computeSpawnForecast(
      [
        fleet({
          agents: [
            { name: 'a', task: 't', backend: 'codex', schedule: '*/30 * * * *' }, // 2/hr
            { name: 'b', task: 't', backend: 'codex', schedule: '*/30 * * * *' }, // 2/hr
            { name: 'c', task: 't', backend: 'codex', modelTier: 'high', schedule: '0 * * * *' }, // 1/hr, different model
          ],
        }),
      ],
      { forcedCliBackend: null },
    );
    expect(result.totals.scheduledPerHour).toBe(5);
    expect(result.totals.byModel.length).toBe(2);
    expect(result.totals.byModel[0].perHour).toBe(4);
    expect(result.totals.byModel[1].perHour).toBe(1);
  });
});
