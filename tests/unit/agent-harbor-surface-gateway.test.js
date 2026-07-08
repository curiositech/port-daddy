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

  it('derives an envelope-scoped idempotency key for daemon event delivery', () => {
    const envelope = gateway({
      envelopeId: 'surface_gateway_event_01JZFIX0001',
      surface: 'scout',
      direction: 'daemon-to-surface',
      mode: 'event',
      noun: 'TranscriptEvent',
      operation: 'transcript-event.appended',
      issuedBy: 'daemon:local',
      idempotencyKey: null,
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
      key: 'surface-gateway:scout:event:TranscriptEvent:transcript-event.appended:surface_gateway_event_01JZFIX0001',
      source: 'derived-envelope',
    });
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
      capabilityDecision: {
        decisionId: 'cap_decision_denied',
        decision: 'deny',
        reason: 'operator lease is not active',
      },
    }));
    expect(denied.ok).toBe(false);
    expect(denied.errors.join(' ')).toMatch(/decision="deny"|not dispatchable/);
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
