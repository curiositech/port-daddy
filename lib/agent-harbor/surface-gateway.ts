import type {
  SurfaceGatewayEnvelope,
  SurfaceGatewayMode,
  SurfaceGatewayNoun,
} from './types.js';
import {
  SURFACE_GATEWAY_DIRECTIONS,
  SURFACE_GATEWAY_MODES,
  SURFACE_GATEWAY_NOUNS,
  SURFACE_GATEWAY_SURFACES,
} from './types.js';
import {
  validateAgainstSchema,
  type SchemaValidationResult,
} from './schema-validate.js';

export const SURFACE_GATEWAY_BUS_TARGETS = ['hot-bus', 'cool-bus'] as const;
export type SurfaceGatewayBusTarget = (typeof SURFACE_GATEWAY_BUS_TARGETS)[number];

export type SurfaceGatewayIdempotencySource =
  | 'explicit'
  | 'derived-payload'
  | 'not-required'
  | 'missing-payload-id';

export interface SurfaceGatewayIdempotency {
  required: boolean;
  key: string | null;
  source: SurfaceGatewayIdempotencySource;
}

export interface SurfaceGatewayRouteDecision {
  mode: SurfaceGatewayMode;
  noun: SurfaceGatewayNoun;
  operation: string;
  target: SurfaceGatewayBusTarget;
  requiresDurableRecord: boolean;
  reason: string;
}

export interface SurfaceGatewayValidationOptions {
  /**
   * Runtime gateway admission defaults to fail-closed. Tests for trimmed
   * package layouts can opt into the honest schema-missing path.
   */
  allowMissingSchema?: boolean;
}

export type SurfaceGatewayValidationResult =
  | {
      ok: true;
      envelope: SurfaceGatewayEnvelope;
      route: SurfaceGatewayRouteDecision;
      idempotency: SurfaceGatewayIdempotency;
      schema: SchemaValidationResult;
    }
  | {
      ok: false;
      errors: string[];
      schema?: SchemaValidationResult;
    };

export interface SurfaceGatewayCapabilityProjection {
  schema: 'pd.agent-harbor.surface-gateway.capability-projection.v0';
  surfaces: readonly string[];
  directions: readonly string[];
  modes: readonly string[];
  nouns: readonly string[];
  busTargets: readonly SurfaceGatewayBusTarget[];
  routeIntegration: {
    mounted: boolean;
    path: '/agent-harbor/surface-gateway/capabilities';
  };
  idempotency: {
    command: 'explicit-key-required';
    query: 'not-required';
    event: 'explicit-key-or-derived-payload-key';
  };
  authority: {
    command: readonly ['canCommand', 'freshProjection', 'allowDecision'];
    query: readonly ['canQuery'];
    daemonToSurfaceEvent: readonly ['canSubscribeEvents'];
    surfaceToDaemonEvent: readonly ['canCommand'];
  };
}

const SURFACE_GATEWAY_ROUTE_OVERRIDE_FIELDS = [
  'bus',
  'busTarget',
  'compatRoute',
  'legacyRoute',
  'legacyVerb',
  'route',
  'routeDecision',
  'routeFamily',
  'routeTarget',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function frozenList<T extends readonly unknown[]>(values: T): Readonly<T> {
  return Object.freeze([...values]) as unknown as Readonly<T>;
}

function frozenRecord<T extends object>(value: T): T {
  return Object.freeze(value) as T;
}

function nounOperationPrefix(noun: SurfaceGatewayNoun): string {
  return noun.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function idempotencyRequirement(envelope: SurfaceGatewayEnvelope): boolean {
  return envelope.mode === 'command';
}

function payloadStableId(envelope: SurfaceGatewayEnvelope): string | null {
  const payload = envelope.payload;
  if (!isRecord(payload)) return null;
  const candidatesByNoun: Partial<Record<SurfaceGatewayNoun, string[]>> = {
    WorkIntent: ['intentId', 'workIntentId'],
    WorkPlan: ['planId', 'workPlanId'],
    AgentNode: ['agentNodeId'],
    AgentRun: ['runId'],
    Body: ['bodyId'],
    ControlCommand: ['commandId'],
    TranscriptEvent: ['eventId'],
    CapabilityDecision: ['decisionId'],
    WorkReceipt: ['receiptId'],
    BerthTarget: ['targetId'],
  };
  const candidates = candidatesByNoun[envelope.noun] ?? [];
  for (const key of candidates) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) return `${key}:${value.trim()}`;
  }
  return null;
}

export function normalizeSurfaceGatewayIdempotency(
  envelope: SurfaceGatewayEnvelope,
): SurfaceGatewayIdempotency {
  const required = idempotencyRequirement(envelope);
  const raw = envelope.idempotencyKey;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return {
      required,
      key: trimmed.length > 0 ? trimmed : null,
      source: 'explicit',
    };
  }

  if (envelope.mode === 'query') {
    return { required: false, key: null, source: 'not-required' };
  }

  const stablePayloadId = payloadStableId(envelope);
  if (stablePayloadId) {
    return {
      required,
      key: [
        'surface-gateway',
        envelope.surface,
        envelope.mode,
        envelope.noun,
        envelope.operation,
        stablePayloadId,
      ].join(':'),
      source: 'derived-payload',
    };
  }

  return {
    required,
    key: null,
    source: 'missing-payload-id',
  };
}

export function routeSurfaceGatewayEnvelope(
  envelope: SurfaceGatewayEnvelope,
): SurfaceGatewayRouteDecision {
  if (envelope.mode === 'command' && envelope.noun === 'ControlCommand') {
    return {
      mode: envelope.mode,
      noun: envelope.noun,
      operation: envelope.operation,
      target: 'hot-bus',
      requiresDurableRecord: true,
      reason: 'control commands need low-latency delivery plus a durable cool-bus audit record',
    };
  }

  if (envelope.mode === 'query') {
    return {
      mode: envelope.mode,
      noun: envelope.noun,
      operation: envelope.operation,
      target: 'cool-bus',
      requiresDurableRecord: false,
      reason: 'queries read the durable projection family and do not mutate hot state',
    };
  }

  return {
    mode: envelope.mode,
    noun: envelope.noun,
    operation: envelope.operation,
    target: 'cool-bus',
    requiresDurableRecord: true,
    reason: 'non-control commands and durable events land in the replayable cool bus',
  };
}

function validateNoRoutingOverrides(candidate: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const field of SURFACE_GATEWAY_ROUTE_OVERRIDE_FIELDS) {
    if (candidate[field] !== undefined) {
      errors.push(
        `surface gateway envelope cannot provide top-level ${field}; hot/cool routing is derived by the daemon`,
      );
    }
  }
  return errors;
}

function validateSurfaceIdentity(envelope: SurfaceGatewayEnvelope): string[] {
  const expectedPrefix = envelope.direction === 'daemon-to-surface'
    ? 'daemon:'
    : `${envelope.surface}:`;
  return envelope.issuedBy.startsWith(expectedPrefix)
    ? []
    : [
        `issuedBy "${envelope.issuedBy}" must start with "${expectedPrefix}" for ${envelope.direction} ${envelope.surface} envelopes`,
      ];
}

function validateBerthTarget(envelope: SurfaceGatewayEnvelope): string[] {
  const errors: string[] = [];
  const { tier, canonical, authority } = envelope.berthTarget;

  if (canonical && tier !== 'stable') {
    errors.push(`berthTarget canonical=true is only valid for stable targets, got tier "${tier}"`);
  }
  if (tier === 'stable' && !canonical) {
    errors.push('stable berthTarget must be canonical=true');
  }

  if (authority.domain === 'canonical-local' && (tier !== 'stable' || !canonical)) {
    errors.push('canonical-local berth authority requires a stable canonical target');
  }
  if (authority.domain === 'dev-lane' && tier !== 'dev-latest') {
    errors.push(`dev-lane berth authority requires tier "dev-latest", got "${tier}"`);
  }
  if (authority.domain === 'worktree-lane' && tier !== 'codebase') {
    errors.push(`worktree-lane berth authority requires tier "codebase", got "${tier}"`);
  }
  if (authority.domain === 'remote-harbor' && tier !== 'remote') {
    errors.push(`remote-harbor berth authority requires tier "remote", got "${tier}"`);
  }
  if (authority.domain === 'read-only-import' && authority.canCommand) {
    errors.push('read-only-import berth targets cannot grant canCommand=true');
  }

  return errors;
}

function validateCapabilityDecisionBinding(envelope: SurfaceGatewayEnvelope): string[] {
  const capabilityDecision = envelope.capabilityDecision;
  if (!capabilityDecision) return [];

  const errors: string[] = [];
  const expectedCapability = nounOperationPrefix(envelope.noun);

  if (capabilityDecision.surface !== envelope.surface) {
    errors.push(
      `CapabilityDecision surface "${capabilityDecision.surface}" must match envelope surface "${envelope.surface}"`,
    );
  }
  if (capabilityDecision.operation !== envelope.operation) {
    errors.push(
      `CapabilityDecision operation "${capabilityDecision.operation}" must match envelope operation "${envelope.operation}"`,
    );
  }
  if (capabilityDecision.capability !== expectedCapability) {
    errors.push(
      `CapabilityDecision capability "${capabilityDecision.capability}" must match noun capability "${expectedCapability}"`,
    );
  }
  if (capabilityDecision.evidence?.berthTargetId !== envelope.berthTarget.targetId) {
    errors.push(
      `CapabilityDecision evidence.berthTargetId must match berthTarget.targetId "${envelope.berthTarget.targetId}"`,
    );
  }
  if (envelope.noun === 'ControlCommand') {
    const commandId = isRecord(envelope.payload) ? envelope.payload.commandId : null;
    if (typeof commandId === 'string' && capabilityDecision.evidence?.controlCommandId !== commandId) {
      errors.push(`CapabilityDecision evidence.controlCommandId must match payload.commandId "${commandId}"`);
    }
  }
  if (envelope.noun === 'TranscriptEvent') {
    const eventId = isRecord(envelope.payload) ? envelope.payload.eventId : null;
    if (typeof eventId === 'string' && capabilityDecision.evidence?.transcriptEventId !== eventId) {
      errors.push(`CapabilityDecision evidence.transcriptEventId must match payload.eventId "${eventId}"`);
    }
  }
  const decisionIssuedAt = Date.parse(capabilityDecision.issuedAt);
  const envelopeIssuedAt = Date.parse(envelope.issuedAt);
  if (Number.isFinite(decisionIssuedAt) && Number.isFinite(envelopeIssuedAt) && decisionIssuedAt > envelopeIssuedAt) {
    errors.push('CapabilityDecision cannot be issued after the envelope it authorizes');
  }
  if (capabilityDecision.expiresAt) {
    const expiresAt = Date.parse(capabilityDecision.expiresAt);
    if (Number.isFinite(expiresAt) && Number.isFinite(envelopeIssuedAt) && expiresAt <= envelopeIssuedAt) {
      errors.push('CapabilityDecision expiresAt must be after envelope.issuedAt');
    }
  }

  return errors;
}

function validateAuthority(envelope: SurfaceGatewayEnvelope): string[] {
  const errors: string[] = [];
  const authority = envelope.berthTarget.authority;
  const capabilityDecision = envelope.capabilityDecision;
  const decision = capabilityDecision?.decision;

  if (envelope.mode === 'command') {
    if (!authority.canCommand) {
      errors.push('command envelope requires berthTarget.authority.canCommand=true');
    }
    if (envelope.projection.stale) {
      errors.push('command envelope cannot be authorized from a stale projection');
    }
    if (!capabilityDecision) {
      errors.push('command envelope requires a full allow CapabilityDecision');
    } else if (decision !== 'allow') {
      errors.push(`command envelope requires capabilityDecision.decision="allow", got "${decision}"`);
    }
  }

  if (envelope.mode === 'query' && !authority.canQuery) {
    errors.push('query envelope requires berthTarget.authority.canQuery=true');
  }

  if (envelope.mode === 'event') {
    if (envelope.direction === 'daemon-to-surface' && !authority.canSubscribeEvents) {
      errors.push('daemon-to-surface event requires berthTarget.authority.canSubscribeEvents=true');
    }
    if (envelope.direction !== 'daemon-to-surface' && !authority.canCommand) {
      errors.push('surface event ingestion requires berthTarget.authority.canCommand=true');
    }
  }

  if (decision === 'deny' || decision === 'unsupported' || decision === 'requires-approval') {
    errors.push(`capabilityDecision.decision="${decision}" is not dispatchable`);
  }

  return errors;
}

function validateOperationPrefix(envelope: SurfaceGatewayEnvelope): string[] {
  const prefix = `${nounOperationPrefix(envelope.noun)}.`;
  return envelope.operation.startsWith(prefix)
    ? []
    : [`operation "${envelope.operation}" must start with "${prefix}" for noun ${envelope.noun}`];
}

function payloadSchemaName(envelope: SurfaceGatewayEnvelope): string | null {
  const payload = envelope.payload;
  if (!isRecord(payload) || typeof payload.schema !== 'string') return null;
  const match = /^pd\.agent-harbor\.([a-z0-9-]+)\.v0$/.exec(payload.schema);
  return match ? match[1] : null;
}

function validatePayload(envelope: SurfaceGatewayEnvelope, allowMissingSchema: boolean): string[] {
  const declaredSchemaName = payloadSchemaName(envelope);
  const expected = nounOperationPrefix(envelope.noun);
  const schemaName =
    declaredSchemaName ?? (envelope.mode === 'command' || envelope.mode === 'event' ? expected : null);
  if (!schemaName) return [];
  const errors: string[] = [];
  if (declaredSchemaName && declaredSchemaName !== expected) {
    errors.push(`payload schema "${declaredSchemaName}" must match envelope noun schema "${expected}"`);
  }
  const result = validateAgainstSchema(schemaName, envelope.payload);
  if (result.skipped && !allowMissingSchema) {
    errors.push(`payload schema ${schemaName}.schema.json not found; gateway admission fails closed`);
  }
  errors.push(...result.errors.map((error) => `payload ${schemaName}: ${error}`));
  return errors;
}

export function validateSurfaceGatewayEnvelope(
  candidate: unknown,
  opts: SurfaceGatewayValidationOptions = {},
): SurfaceGatewayValidationResult {
  if (!isRecord(candidate)) {
    return { ok: false, errors: ['surface gateway envelope must be an object'] };
  }

  const schema = validateAgainstSchema('surface-gateway', candidate);
  const errors = [...schema.errors];
  if (schema.skipped && !opts.allowMissingSchema) {
    errors.push('surface-gateway.schema.json not found; gateway admission fails closed');
  }
  if (errors.length > 0) {
    return { ok: false, errors, schema };
  }

  const envelope = candidate as SurfaceGatewayEnvelope;
  errors.push(...validateNoRoutingOverrides(candidate));
  errors.push(...validateSurfaceIdentity(envelope));
  errors.push(...validateOperationPrefix(envelope));
  errors.push(...validateBerthTarget(envelope));
  errors.push(...validatePayload(envelope, Boolean(opts.allowMissingSchema)));
  errors.push(...validateCapabilityDecisionBinding(envelope));
  errors.push(...validateAuthority(envelope));

  const idempotency = normalizeSurfaceGatewayIdempotency(envelope);
  if (idempotency.source === 'explicit' && !idempotency.key) {
    errors.push('idempotencyKey cannot be blank when provided');
  }
  if (idempotency.required && idempotency.source !== 'explicit') {
    errors.push('command envelope requires an explicit idempotencyKey');
  }
  if (envelope.mode === 'event' && !idempotency.key) {
    errors.push('event envelope requires an explicit idempotencyKey or a stable payload identifier');
  }

  if (errors.length > 0) {
    return { ok: false, errors, schema };
  }

  return {
    ok: true,
    envelope,
    route: routeSurfaceGatewayEnvelope(envelope),
    idempotency,
    schema,
  };
}

export function isSurfaceGatewayEnvelope(candidate: unknown): candidate is SurfaceGatewayEnvelope {
  return validateSurfaceGatewayEnvelope(candidate).ok;
}

export function surfaceGatewayCapabilityProjection(
  opts: { mounted?: boolean } = {},
): SurfaceGatewayCapabilityProjection {
  const projection: SurfaceGatewayCapabilityProjection = {
    schema: 'pd.agent-harbor.surface-gateway.capability-projection.v0',
    surfaces: frozenList(SURFACE_GATEWAY_SURFACES),
    directions: frozenList(SURFACE_GATEWAY_DIRECTIONS),
    modes: frozenList(SURFACE_GATEWAY_MODES),
    nouns: frozenList(SURFACE_GATEWAY_NOUNS),
    busTargets: frozenList(SURFACE_GATEWAY_BUS_TARGETS),
    routeIntegration: frozenRecord({
      mounted: Boolean(opts.mounted),
      path: '/agent-harbor/surface-gateway/capabilities',
    }),
    idempotency: frozenRecord({
      command: 'explicit-key-required',
      query: 'not-required',
      event: 'explicit-key-or-derived-payload-key',
    }),
    authority: frozenRecord({
      command: frozenList(['canCommand', 'freshProjection', 'allowDecision'] as const),
      query: frozenList(['canQuery'] as const),
      daemonToSurfaceEvent: frozenList(['canSubscribeEvents'] as const),
      surfaceToDaemonEvent: frozenList(['canCommand'] as const),
    }),
  };
  return frozenRecord(projection);
}
