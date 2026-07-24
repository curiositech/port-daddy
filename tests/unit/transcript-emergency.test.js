import { describe, expect, test } from '@jest/globals';

const {
  buildTranscriptEmergencyReport,
  transcriptEmergencyInputFromCloudTelemetry,
  transcriptEmergencyInputFromCompliance,
  TRANSCRIPT_EMERGENCY_EVENT,
  TRANSCRIPT_EMERGENCY_EVENTS,
  TRANSCRIPT_EMERGENCY_ISSUE_CODE,
  TRANSCRIPT_EMERGENCY_ISSUE_CODES,
  TRANSCRIPT_EMERGENCY_KIND,
  TRANSCRIPT_EMERGENCY_KINDS,
  TRANSCRIPT_EMERGENCY_SCOPE,
  TRANSCRIPT_EMERGENCY_SCOPES,
  TRANSCRIPT_EMERGENCY_STATE,
  TRANSCRIPT_EMERGENCY_STATES,
} = await import('../../lib/transcript-emergency.js');

describe('transcript emergency report', () => {
  test('normalizes per-kind inputs and marks critical HITL failures as an emergency', () => {
    const report = buildTranscriptEmergencyReport([
      {
        kind: TRANSCRIPT_EMERGENCY_KIND.LOCAL_SPAWNER,
        label: 'Local spawner transcripts',
        total: 2,
        healthy: 2,
        degraded: 0,
        missing: 0,
        issues: [],
      },
      {
        kind: TRANSCRIPT_EMERGENCY_KIND.CLOUD_FLEET_D1,
        label: 'Cloud fleet D1 transcript writes',
        total: 1,
        healthy: 0,
        degraded: 0,
        missing: 1,
        issues: [{
          code: TRANSCRIPT_EMERGENCY_ISSUE_CODE.WRITE_FAILED,
          message: 'D1 rejected fleet_run_steps insert.',
          severity: 'critical',
          requiresHitl: true,
          sourceId: 'delivery-abc',
        }],
      },
    ], { now: 1_700_000_000_000 });

    expect(report.state).toBe(TRANSCRIPT_EMERGENCY_STATE.EMERGENCY);
    expect(report.hitlEmergency).toBe(true);
    expect(report.summary.kinds).toEqual({ total: 2, nominal: 1, degraded: 0, emergency: 1 });
    expect(report.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: TRANSCRIPT_EMERGENCY_KIND.CLOUD_FLEET_D1,
        state: TRANSCRIPT_EMERGENCY_STATE.EMERGENCY,
        requiresHitl: true,
        issues: [expect.objectContaining({ code: TRANSCRIPT_EMERGENCY_ISSUE_CODE.WRITE_FAILED })],
      }),
    ]));
  });

  test('adapts transcript compliance issues into the local spawner emergency kind', () => {
    const input = transcriptEmergencyInputFromCompliance({
      degraded: true,
      hitlEmergency: true,
      issues: [{
        code: TRANSCRIPT_EMERGENCY_ISSUE_CODE.FLOW_STALLED,
        state: TRANSCRIPT_EMERGENCY_STATE.DEGRADED,
        severity: 'critical',
        requiresHitl: true,
        message: 'Run spawned-stalled is live but its transcript stopped flowing.',
        agentId: 'spawned-stalled',
        backend: 'cli:codex',
        transcriptId: 'tx-1',
      }],
      summary: {
        flow: {
          supported: 0,
          degraded: 1,
          missing: 0,
          running: 1,
          terminal: 0,
          issues: 1,
          hitl: 1,
        },
      },
    });

    const report = buildTranscriptEmergencyReport([input]);

    expect(report.hitlEmergency).toBe(true);
    expect(report.records[0]).toMatchObject({
      kind: TRANSCRIPT_EMERGENCY_KIND.LOCAL_SPAWNER,
      state: TRANSCRIPT_EMERGENCY_STATE.EMERGENCY,
      missing: 0,
      degraded: 1,
      issues: [expect.objectContaining({
        code: TRANSCRIPT_EMERGENCY_ISSUE_CODE.FLOW_STALLED,
        backend: 'cli:codex',
        sourceId: 'spawned-stalled',
      })],
    });
  });

  test('adapts cloud telemetry transcript write failures into the cloud D1 kind', () => {
    const input = transcriptEmergencyInputFromCloudTelemetry([
      {
        id: 'evt-1',
        ts: 1_700_000_000_000,
        event: TRANSCRIPT_EMERGENCY_EVENT.WRITE_FAILED,
        status: 'error',
        deliveryId: 'delivery-abc',
        owner: 'curiositech',
        repo: 'port-daddy',
        prNumber: 1379,
        ship: 'code-reviewer',
        backend: 'cloudflare',
        metadata: {
          runId: 'run:delivery-abc',
          seq: 2,
          kind: 'ship-verdict',
          error: 'D1 unavailable',
        },
      },
    ]);

    const report = buildTranscriptEmergencyReport([input]);

    expect(report.hitlEmergency).toBe(true);
    expect(report.records[0]).toMatchObject({
      kind: TRANSCRIPT_EMERGENCY_KIND.CLOUD_FLEET_D1,
      state: TRANSCRIPT_EMERGENCY_STATE.EMERGENCY,
      missing: 1,
      issues: [expect.objectContaining({
        code: TRANSCRIPT_EMERGENCY_ISSUE_CODE.WRITE_FAILED,
        sourceId: 'delivery-abc',
      })],
    });
  });

  test('exports the accepted typed contract constants', () => {
    expect(TRANSCRIPT_EMERGENCY_KINDS).toEqual([
      TRANSCRIPT_EMERGENCY_KIND.LOCAL_SPAWNER,
      TRANSCRIPT_EMERGENCY_KIND.CLOUD_FLEET_D1,
    ]);
    expect(TRANSCRIPT_EMERGENCY_SCOPES).toEqual([
      TRANSCRIPT_EMERGENCY_SCOPE.LOCAL,
      TRANSCRIPT_EMERGENCY_SCOPE.CLOUD,
      TRANSCRIPT_EMERGENCY_SCOPE.MIXED,
    ]);
    expect(TRANSCRIPT_EMERGENCY_STATES).toEqual([
      TRANSCRIPT_EMERGENCY_STATE.NOMINAL,
      TRANSCRIPT_EMERGENCY_STATE.DEGRADED,
      TRANSCRIPT_EMERGENCY_STATE.EMERGENCY,
    ]);
    expect(TRANSCRIPT_EMERGENCY_EVENTS).toEqual([
      TRANSCRIPT_EMERGENCY_EVENT.WRITE_FAILED,
      TRANSCRIPT_EMERGENCY_EVENT.WRITE_FAILED_LEGACY,
    ]);
    expect(TRANSCRIPT_EMERGENCY_ISSUE_CODES).toEqual(expect.arrayContaining([
      TRANSCRIPT_EMERGENCY_ISSUE_CODE.FLOW_STALLED,
      TRANSCRIPT_EMERGENCY_ISSUE_CODE.WRITE_FAILED,
    ]));
  });

  test('maps both cloud event spellings and metadata-only failures to the exact cloud D1 kind', () => {
    const input = transcriptEmergencyInputFromCloudTelemetry([
      {
        id: 'evt-kebab',
        ts: 1,
        event: TRANSCRIPT_EMERGENCY_EVENT.WRITE_FAILED,
        status: 'error',
        deliveryId: 'delivery-kebab',
        backend: 'cloudflare',
        metadata: { runId: 'run-kebab' },
      },
      {
        id: 'evt-snake',
        ts: 2,
        event: TRANSCRIPT_EMERGENCY_EVENT.WRITE_FAILED_LEGACY,
        status: 'error',
        deliveryId: 'delivery-snake',
        backend: 'cloudflare',
        metadata: { runId: 'run-snake' },
      },
      {
        id: 'evt-metadata',
        ts: 3,
        event: 'worker-error',
        status: 'error',
        deliveryId: 'delivery-metadata',
        backend: 'cloudflare',
        metadata: { transcriptWriteFailure: true, runId: 'run-metadata' },
      },
      {
        id: 'evt-ignored',
        ts: 4,
        event: 'worker-error',
        status: 'error',
        deliveryId: 'delivery-ignored',
        backend: 'cloudflare',
        metadata: { transcriptWriteFailure: false },
      },
    ]);

    expect(input.kind).toBe(TRANSCRIPT_EMERGENCY_KIND.CLOUD_FLEET_D1);
    expect(input.scope).toBe(TRANSCRIPT_EMERGENCY_SCOPE.CLOUD);
    expect(input.total).toBe(3);
    expect(input.missing).toBe(3);
    expect(input.issues).toHaveLength(3);
    expect(input.issues?.map((issue) => issue.sourceId)).toEqual([
      'delivery-kebab',
      'delivery-snake',
      'delivery-metadata',
    ]);
    expect(input.issues?.every((issue) => issue.code === TRANSCRIPT_EMERGENCY_ISSUE_CODE.WRITE_FAILED)).toBe(true);
  });
});
