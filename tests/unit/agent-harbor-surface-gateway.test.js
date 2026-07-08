import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const {
  isSurfaceGatewayEnvelope,
  normalizeSurfaceGatewayIdempotency,
  routeSurfaceGatewayEnvelope,
  surfaceGatewayCapabilityProjection,
  validateSurfaceGatewayEnvelope,
} = await import('../../lib/agent-harbor/surface-gateway.js');

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', '..', 'schemas', 'agent-harbor', 'v0', 'fixtures');

function fixture(name) {
  return JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), 'utf8'));
}

function gateway(overrides = {}) {
  return {
    ...fixture('surface-gateway'),
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    ...fixture('surface-gateway').capabilityDecision,
    ...overrides,
  };
}

describe('Agent Harbor Surface Gateway runtime helper', () => {
  it('admits the frozen FleetBar command fixture and classifies control through the hot bus', () => {
    const envelope = gateway();
    const admitted = validateSurfaceGatewayEnvelope(envelope);

    expect(admitted.ok).toBe(true);
    expect(admitted.route).toMatchObject({
      target: 'hot-bus',
      requiresDurableRecord: true,
      noun: 'ControlCommand',
      operation: 'control-command.steer',
    });
    expect(admitted.idempotency).toEqual({
      required: true,
      key: 'fleetbar:ctl_01JZFIX0001',
      source: 'explicit',
    });
    expect(isSurfaceGatewayEnvelope(envelope)).toBe(true);
  });

  it('keeps query envelopes on the cool projection path and does not require idempotency', () => {
    const envelope = gateway({
      envelopeId: 'surface_gateway_query_01JZFIX0001',
      surface: 'pd-console',
      mode: 'query',
      noun: 'AgentRun',
      operation: 'agent-run.list',
      issuedBy: 'pd-console:operator:erich',
      idempotencyKey: null,
      payload: { filters: { status: 'running' } },
      projection: { stale: false, lastLedgerSeq: 42, headSeq: 42 },
    });

    const admitted = validateSurfaceGatewayEnvelope(envelope);
    expect(admitted.ok).toBe(true);
    expect(admitted.route).toMatchObject({
      target: 'cool-bus',
      requiresDurableRecord: false,
      noun: 'AgentRun',
    });
    expect(admitted.idempotency).toEqual({
      required: false,
      key: null,
      source: 'not-required',
    });
  });

  it('derives a payload-scoped idempotency key for daemon event delivery', () => {
    const envelope = gateway({
      envelopeId: 'surface_gateway_event_01JZFIX0001',
      surface: 'scout',
      direction: 'daemon-to-surface',
      mode: 'event',
      noun: 'TranscriptEvent',
      operation: 'transcript-event.appended',
      issuedBy: 'daemon:local',
      idempotencyKey: null,
      capabilityDecision: undefined,
      payload: {
        eventId: 'evt_01JZFIX0042',
        schemaVersion: 1,
        kind: 'tool_result',
      },
      projection: { stale: false, lastLedgerSeq: 43, headSeq: 43 },
    });

    expect(validateSurfaceGatewayEnvelope(envelope).ok).toBe(true);
    expect(normalizeSurfaceGatewayIdempotency(envelope)).toEqual({
      required: false,
      key: 'surface-gateway:scout:event:TranscriptEvent:transcript-event.appended:eventId:evt_01JZFIX0042',
      source: 'derived-payload',
    });
    expect(normalizeSurfaceGatewayIdempotency({
      ...envelope,
      envelopeId: 'surface_gateway_event_retry_01JZFIX0002',
    })).toEqual(normalizeSurfaceGatewayIdempotency(envelope));
    expect(routeSurfaceGatewayEnvelope(envelope)).toMatchObject({
      target: 'cool-bus',
      requiresDurableRecord: true,
    });
  });

  it('rejects commands without explicit idempotency keys', () => {
    const admitted = validateSurfaceGatewayEnvelope(gateway({ idempotencyKey: null }));
    expect(admitted.ok).toBe(false);
    expect(admitted.errors.join(' ')).toMatch(/explicit idempotencyKey/);
  });

  it('rejects stale or denied command authority before dispatch', () => {
    const stale = validateSurfaceGatewayEnvelope(gateway({
      projection: { stale: true, lastLedgerSeq: 41, headSeq: 42 },
    }));
    expect(stale.ok).toBe(false);
    expect(stale.errors.join(' ')).toMatch(/stale projection/);

    const denied = validateSurfaceGatewayEnvelope(gateway({
      capabilityDecision: decision({
        decisionId: 'cap_decision_denied',
        decision: 'deny',
        reason: 'operator lease is not active',
      }),
    }));
    expect(denied.ok).toBe(false);
    expect(denied.errors.join(' ')).toMatch(/decision="deny"|not dispatchable/);
  });

  it('rejects summary-only or unbound command capability decisions', () => {
    const summaryOnly = validateSurfaceGatewayEnvelope(gateway({
      capabilityDecision: {
        decisionId: 'cap_decision_summary_only',
        decision: 'allow',
        reason: 'old summary shape should not authorize commands',
      },
    }));
    expect(summaryOnly.ok).toBe(false);
    expect(summaryOnly.errors.join(' ')).toMatch(/capabilityDecision|surface|required|schema/);

    const wrongSurface = validateSurfaceGatewayEnvelope(gateway({
      capabilityDecision: decision({ surface: 'pd-console' }),
    }));
    expect(wrongSurface.ok).toBe(false);
    expect(wrongSurface.errors.join(' ')).toMatch(/surface "pd-console" must match envelope surface "fleetbar"/);

    const wrongOperation = validateSurfaceGatewayEnvelope(gateway({
      capabilityDecision: decision({ operation: 'control-command.kill' }),
    }));
    expect(wrongOperation.ok).toBe(false);
    expect(wrongOperation.errors.join(' ')).toMatch(/operation "control-command.kill" must match envelope operation/);

    const expired = validateSurfaceGatewayEnvelope(gateway({
      capabilityDecision: decision({ expiresAt: '2026-07-05T12:03:59.000Z' }),
    }));
    expect(expired.ok).toBe(false);
    expect(expired.errors.join(' ')).toMatch(/expiresAt must be after envelope\.issuedAt/);
  });

  it('validates canonical payload schemas before dispatch', () => {
    const missingRequiredControlFields = validateSurfaceGatewayEnvelope(gateway({
      payload: {
        schema: 'pd.agent-harbor.control-command.v0',
        commandId: 'ctl_01JZFIX0001',
        agentNodeId: 'agent_node_01JZFIX0001',
        kind: 'steer',
      },
    }));
    expect(missingRequiredControlFields.ok).toBe(false);
    expect(missingRequiredControlFields.errors.join(' ')).toMatch(/payload control-command: .*requestedBy/);
    expect(missingRequiredControlFields.errors.join(' ')).toMatch(/payload control-command: .*status/);
    expect(missingRequiredControlFields.errors.join(' ')).toMatch(/payload control-command: .*createdAt/);

    const wrongPayloadSchema = validateSurfaceGatewayEnvelope(gateway({
      payload: {
        schema: 'pd.agent-harbor.agent-run.v0',
        runId: 'run_01JZFIX0001',
      },
    }));
    expect(wrongPayloadSchema.ok).toBe(false);
    expect(wrongPayloadSchema.errors.join(' ')).toMatch(/must match envelope noun schema "control-command"/);
  });

  it('rejects durable events without explicit or payload-stable idempotency', () => {
    const admitted = validateSurfaceGatewayEnvelope(gateway({
      envelopeId: 'surface_gateway_event_missing_payload_id',
      surface: 'scout',
      direction: 'daemon-to-surface',
      mode: 'event',
      noun: 'TranscriptEvent',
      operation: 'transcript-event.appended',
      issuedBy: 'daemon:local',
      idempotencyKey: null,
      capabilityDecision: undefined,
      payload: {
        schemaVersion: 1,
        kind: 'tool_result',
      },
    }));
    expect(admitted.ok).toBe(false);
    expect(admitted.errors.join(' ')).toMatch(/stable payload identifier/);
  });

  it('rejects noun and operation drift that would fork routing semantics', () => {
    const admitted = validateSurfaceGatewayEnvelope(gateway({
      noun: 'AgentRun',
      operation: 'control-command.steer',
    }));
    expect(admitted.ok).toBe(false);
    expect(admitted.errors.join(' ')).toMatch(/must start with "agent-run\."/);
  });

  it('rejects authority domains and surfaces outside the frozen schema', () => {
    const badDomain = gateway({
      berthTarget: {
        ...gateway().berthTarget,
        authority: {
          ...gateway().berthTarget.authority,
          domain: 'fleetbar',
        },
      },
    });
    const admitted = validateSurfaceGatewayEnvelope(badDomain);
    expect(admitted.ok).toBe(false);
    expect(admitted.errors.join(' ')).toMatch(/domain|enum|not one of/);
  });

  it('exposes a pure capability projection for future route mounting without route churn', () => {
    const projection = surfaceGatewayCapabilityProjection();

    expect(projection.routeIntegration).toEqual({
      mounted: false,
      path: '/agent-harbor/surface-gateway/capabilities',
    });
    expect(projection.surfaces).toEqual(['pd-console', 'fleetbar', 'scout', 'cli', 'mcp']);
    expect(projection.modes).toEqual(['command', 'query', 'event']);
    expect(projection.nouns).toContain('WorkIntent');
    expect(projection.nouns).toContain('ControlCommand');
    expect(projection.busTargets).toEqual(['hot-bus', 'cool-bus']);
    expect(projection.authority.command).toEqual(['canCommand', 'freshProjection', 'allowDecision']);
  });
});
