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
  | 'derived-envelope'
  | 'not-required';

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
    event: 'explicit-key-or-derived-envelope-key';
  };
  authority: {
    command: readonly ['canCommand', 'freshProjection', 'allowDecision'];
    query: readonly ['canQuery'];
    daemonToSurfaceEvent: readonly ['canSubscribeEvents'];
    surfaceToDaemonEvent: readonly ['canCommand'];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nounOperationPrefix(noun: SurfaceGatewayNoun): string {
  return noun.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function idempotencyRequirement(envelope: SurfaceGatewayEnvelope): boolean {
  return envelope.mode === 'command';
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

  return {
    required,
    key: [
      'surface-gateway',
      envelope.surface,
      envelope.mode,
      envelope.noun,
      envelope.operation,
      envelope.envelopeId,
    ].join(':'),
    source: 'derived-envelope',
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

function validateAuthority(envelope: SurfaceGatewayEnvelope): string[] {
  const errors: string[] = [];
  const authority = envelope.berthTarget.authority;
  const decision = envelope.capabilityDecision?.decision;

  if (envelope.mode === 'command') {
    if (!authority.canCommand) {
      errors.push('command envelope requires berthTarget.authority.canCommand=true');
    }
    if (envelope.projection.stale) {
      errors.push('command envelope cannot be authorized from a stale projection');
    }
    if (!envelope.capabilityDecision) {
      errors.push('command envelope requires an allow CapabilityDecision summary');
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
  errors.push(...validateOperationPrefix(envelope));
  errors.push(...validateAuthority(envelope));

  const idempotency = normalizeSurfaceGatewayIdempotency(envelope);
  if (idempotency.source === 'explicit' && !idempotency.key) {
    errors.push('idempotencyKey cannot be blank when provided');
  }
  if (idempotency.required && idempotency.source !== 'explicit') {
    errors.push('command envelope requires an explicit idempotencyKey');
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
  return {
    schema: 'pd.agent-harbor.surface-gateway.capability-projection.v0',
    surfaces: SURFACE_GATEWAY_SURFACES,
    directions: SURFACE_GATEWAY_DIRECTIONS,
    modes: SURFACE_GATEWAY_MODES,
    nouns: SURFACE_GATEWAY_NOUNS,
    busTargets: SURFACE_GATEWAY_BUS_TARGETS,
    routeIntegration: {
      mounted: Boolean(opts.mounted),
      path: '/agent-harbor/surface-gateway/capabilities',
    },
    idempotency: {
      command: 'explicit-key-required',
      query: 'not-required',
      event: 'explicit-key-or-derived-envelope-key',
    },
    authority: {
      command: ['canCommand', 'freshProjection', 'allowDecision'],
      query: ['canQuery'],
      daemonToSurfaceEvent: ['canSubscribeEvents'],
      surfaceToDaemonEvent: ['canCommand'],
    },
  };
}
