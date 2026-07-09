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

function queryEnvelope(overrides = {}) {
  return gateway({
    envelopeId: 'surface_gateway_query_01JZFIX0001',
    surface: 'pd-console',
    mode: 'query',
    noun: 'AgentRun',
    operation: 'agent-run.list',
    issuedBy: 'pd-console:operator:erich',
    idempotencyKey: null,
    capabilityDecision: decision({
      decisionId: 'cap_decision_query_01JZFIX0001',
      surface: 'pd-console',
      operation: 'agent-run.list',
      capability: 'agent-run',
      reason: 'Query allowed against selected berth.',
      evidence: {
        berthTargetId: 'berth_target_stable',
      },
    }),
    payload: { filters: { status: 'running' } },
    projection: { stale: false, lastLedgerSeq: 42, headSeq: 42 },
    ...overrides,
  });
}

function daemonTranscriptEvent(overrides = {}) {
  return gateway({
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
      sessionId: 'session_01JZFIX0001',
      agentNodeId: 'agent_node_01JZFIX0001',
      sequence: 42,
      occurredAt: '2026-07-05T12:04:01.000Z',
      schemaVersion: 1,
      kind: 'tool_result',
    },
    projection: { stale: false, lastLedgerSeq: 43, headSeq: 43 },
    ...overrides,
  });
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
    const envelope = queryEnvelope();

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

  it('normalizes explicit command idempotency keys without deriving hidden command keys', () => {
    const envelope = gateway({ idempotencyKey: '  fleetbar:ctl_01JZFIX0001  ' });
    const admitted = validateSurfaceGatewayEnvelope(envelope);

    expect(admitted.ok).toBe(true);
    expect(admitted.idempotency).toEqual({
      required: true,
      key: 'fleetbar:ctl_01JZFIX0001',
      source: 'explicit',
    });
  });

  it('derives a payload-scoped idempotency key for daemon event delivery', () => {
    const envelope = daemonTranscriptEvent();

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

  it('rejects top-level hot/cool routing overrides instead of accepting mixed semantics', () => {
    const commandAsCool = validateSurfaceGatewayEnvelope(gateway({ busTarget: 'cool-bus' }));
    expect(commandAsCool.ok).toBe(false);
    expect(commandAsCool.errors.join(' ')).toMatch(/busTarget; hot\/cool routing is derived/);

    const queryAsHot = validateSurfaceGatewayEnvelope(queryEnvelope({ routeFamily: 'hot-bus' }));
    expect(queryAsHot.ok).toBe(false);
    expect(queryAsHot.errors.join(' ')).toMatch(/routeFamily; hot\/cool routing is derived/);
  });

  it('rejects envelopes whose issuer does not match the surface identity', () => {
    const wrongSurfaceIssuer = validateSurfaceGatewayEnvelope(gateway({
      issuedBy: 'pd-console:operator:erich',
    }));
    expect(wrongSurfaceIssuer.ok).toBe(false);
    expect(wrongSurfaceIssuer.errors.join(' ')).toMatch(/issuedBy "pd-console:operator:erich" must start with "fleetbar:"/);

    const wrongDaemonIssuer = validateSurfaceGatewayEnvelope(daemonTranscriptEvent({
      issuedBy: 'scout:operator:erich',
    }));
    expect(wrongDaemonIssuer.ok).toBe(false);
    expect(wrongDaemonIssuer.errors.join(' ')).toMatch(/must start with "daemon:"/);
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

  it('rejects command authority that is not berth-granted or evidence-bound', () => {
    const noCommandGrant = validateSurfaceGatewayEnvelope(gateway({
      berthTarget: {
        ...gateway().berthTarget,
        authority: {
          ...gateway().berthTarget.authority,
          canCommand: false,
        },
      },
    }));
    expect(noCommandGrant.ok).toBe(false);
    expect(noCommandGrant.errors.join(' ')).toMatch(/canCommand=true/);

    const wrongBerthEvidence = validateSurfaceGatewayEnvelope(gateway({
      capabilityDecision: decision({
        evidence: {
          controlCommandId: 'ctl_01JZFIX0001',
          berthTargetId: 'berth_target_other',
        },
      }),
    }));
    expect(wrongBerthEvidence.ok).toBe(false);
    expect(wrongBerthEvidence.errors.join(' ')).toMatch(/evidence\.berthTargetId/);

    const wrongCommandEvidence = validateSurfaceGatewayEnvelope(gateway({
      capabilityDecision: decision({
        evidence: {
          controlCommandId: 'ctl_other',
          berthTargetId: 'berth_target_stable',
        },
      }),
    }));
    expect(wrongCommandEvidence.ok).toBe(false);
    expect(wrongCommandEvidence.errors.join(' ')).toMatch(/evidence\.controlCommandId/);

    const futureDecision = validateSurfaceGatewayEnvelope(gateway({
      capabilityDecision: decision({ issuedAt: '2026-07-05T12:04:01.000Z' }),
    }));
    expect(futureDecision.ok).toBe(false);
    expect(futureDecision.errors.join(' ')).toMatch(/cannot be issued after/);
  });

  it('rejects invalid berth targets that would let a surface promote or command the wrong lane', () => {
    const nonStableCanonical = validateSurfaceGatewayEnvelope(gateway({
      berthTarget: {
        ...gateway().berthTarget,
        tier: 'codebase',
        canonical: true,
        authority: {
          ...gateway().berthTarget.authority,
          domain: 'worktree-lane',
        },
      },
    }));
    expect(nonStableCanonical.ok).toBe(false);
    expect(nonStableCanonical.errors.join(' ')).toMatch(/canonical=true is only valid for stable targets/);

    const readOnlyCommandGrant = validateSurfaceGatewayEnvelope(gateway({
      berthTarget: {
        ...gateway().berthTarget,
        tier: 'remote',
        canonical: false,
        authority: {
          ...gateway().berthTarget.authority,
          domain: 'read-only-import',
          canCommand: true,
        },
      },
    }));
    expect(readOnlyCommandGrant.ok).toBe(false);
    expect(readOnlyCommandGrant.errors.join(' ')).toMatch(/read-only-import berth targets cannot grant canCommand=true/);

    const readOnlyCodebaseTarget = validateSurfaceGatewayEnvelope(gateway({
      berthTarget: {
        ...gateway().berthTarget,
        tier: 'codebase',
        canonical: false,
        authority: {
          ...gateway().berthTarget.authority,
          domain: 'read-only-import',
          canCommand: false,
          canQuery: true,
          canSubscribeEvents: true,
        },
      },
    }));
    expect(readOnlyCodebaseTarget.ok).toBe(false);
    expect(readOnlyCodebaseTarget.errors.join(' ')).toMatch(/read-only-import berth authority requires tier "remote"/);
  });

  it('rejects query and event envelopes when berth authority does not grant that lane', () => {
    const queryWithoutGrant = validateSurfaceGatewayEnvelope(queryEnvelope({
      envelopeId: 'surface_gateway_query_no_grant',
      berthTarget: {
        ...gateway().berthTarget,
        authority: {
          ...gateway().berthTarget.authority,
          canQuery: false,
        },
      },
    }));
    expect(queryWithoutGrant.ok).toBe(false);
    expect(queryWithoutGrant.errors.join(' ')).toMatch(/canQuery=true/);

    const eventWithoutGrant = validateSurfaceGatewayEnvelope(daemonTranscriptEvent({
      envelopeId: 'surface_gateway_event_no_subscribe_grant',
      berthTarget: {
        ...gateway().berthTarget,
        authority: {
          ...gateway().berthTarget.authority,
          canSubscribeEvents: false,
        },
      },
    }));
    expect(eventWithoutGrant.ok).toBe(false);
    expect(eventWithoutGrant.errors.join(' ')).toMatch(/canSubscribeEvents=true/);
  });

  it('rejects capability decisions that leak across query or event surfaces', () => {
    const queryLeak = validateSurfaceGatewayEnvelope(queryEnvelope({
      capabilityDecision: decision({
        decisionId: 'cap_decision_query_leak',
        surface: 'fleetbar',
        operation: 'agent-run.list',
        capability: 'control-command',
        reason: 'A FleetBar control grant must not authorize a pd-console query.',
        evidence: {
          berthTargetId: 'berth_target_stable',
        },
      }),
    }));
    expect(queryLeak.ok).toBe(false);
    expect(queryLeak.errors.join(' ')).toMatch(/surface "fleetbar" must match envelope surface "pd-console"/);
    expect(queryLeak.errors.join(' ')).toMatch(/capability "control-command" must match noun capability "agent-run"/);

    const eventLeak = validateSurfaceGatewayEnvelope(daemonTranscriptEvent({
      capabilityDecision: decision({
        decisionId: 'cap_decision_event_leak',
        surface: 'scout',
        operation: 'transcript-event.appended',
        capability: 'transcript-event',
        reason: 'Subscribed surface may receive transcript event projection.',
        evidence: {
          berthTargetId: 'berth_target_stable',
          transcriptEventId: 'evt_other',
        },
      }),
    }));
    expect(eventLeak.ok).toBe(false);
    expect(eventLeak.errors.join(' ')).toMatch(/evidence\.transcriptEventId/);
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

  it('validates canonical event payloads by noun even without a schema discriminator', () => {
    const admitted = validateSurfaceGatewayEnvelope(daemonTranscriptEvent({
      envelopeId: 'surface_gateway_event_malformed_payload',
      payload: {
        eventId: 'evt_01JZFIX0042',
        schemaVersion: 1,
        kind: 'tool_result',
      },
    }));
    expect(admitted.ok).toBe(false);
    expect(admitted.errors.join(' ')).toMatch(/payload transcript-event: .*sessionId/);
    expect(admitted.errors.join(' ')).toMatch(/payload transcript-event: .*agentNodeId/);
    expect(admitted.errors.join(' ')).toMatch(/payload transcript-event: .*sequence/);
    expect(admitted.errors.join(' ')).toMatch(/payload transcript-event: .*occurredAt/);
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
    const badSurface = validateSurfaceGatewayEnvelope(gateway({
      surface: 'fleetbar-private-api',
      issuedBy: 'fleetbar-private-api:operator:erich',
      capabilityDecision: decision({ surface: 'fleetbar-private-api' }),
    }));
    expect(badSurface.ok).toBe(false);
    expect(badSurface.errors.join(' ')).toMatch(/surface|enum|not one of/);

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

  it('does not leak mutable capability projection arrays across callers', () => {
    const projection = surfaceGatewayCapabilityProjection();
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.nouns)).toBe(true);
    expect(Object.isFrozen(projection.authority.command)).toBe(true);

    try {
      projection.nouns.push('Spawn');
    } catch {
      // Frozen arrays throw in strict mode; either way, mutation must not land.
    }
    try {
      projection.authority.command.push('legacyRoute');
    } catch {
      // Same as above.
    }

    expect(projection.nouns).not.toContain('Spawn');
    expect(projection.authority.command).toEqual(['canCommand', 'freshProjection', 'allowDecision']);
    expect(surfaceGatewayCapabilityProjection().nouns).not.toContain('Spawn');
  });
});
