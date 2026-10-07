/**
 * Pure runtime-posture and effect-admission policy.
 *
 * This module performs no I/O. It keeps operator intent, the local stop
 * boundary, and capability health separate so "no stop marker" never means
 * "the whole product is ready".
 */

export type RuntimeDesiredState = 'off' | 'on';

export type RuntimeControlObservation =
  | 'disabled'
  | 'enabled'
  | 'stopping'
  | 'unknown';

export type RuntimeCapability =
  | 'coordination_guard'
  | 'sandbox'
  | 'harness'
  | 'cost_accounting'
  | 'provider_access'
  | 'effect_receipts';

export type RuntimeCapabilityStatus =
  | 'ready'
  | 'absent'
  | 'disabled'
  | 'degraded'
  | 'unknown';

export type RuntimeCapabilityReason =
  | 'not_installed'
  | 'disabled_by_operator'
  | 'untrusted_project'
  | 'duplicate_hook_scope'
  | 'advisory_only'
  | 'egress_unconfined'
  | 'stale'
  | 'wrong_scope'
  | 'cleanup_incomplete'
  | 'probe_failed';

export type RuntimePosture = 'off' | 'on' | 'degraded' | 'transitioning' | 'activation_blocked' | 'unknown';

export type RuntimeEffect =
  | 'human_local'
  | 'read_only'
  | 'emergency_control'
  | 'automatic_local'
  | 'managed_subprocess'
  | 'background_agent'
  | 'paid_inference'
  | 'provider_call'
  | 'external_mutation'
  | 'scheduled_automation';

export interface RuntimeCapabilityObservation {
  status: RuntimeCapabilityStatus;
  reason?: RuntimeCapabilityReason;
  detail?: string;
  scope?: string;
  observedAt?: number;
  validUntil?: number;
}

export interface RuntimePostureInput {
  desired: RuntimeDesiredState;
  control: RuntimeControlObservation;
  capabilities?: Partial<Record<RuntimeCapability, RuntimeCapabilityObservation>>;
  /**
   * Authority scope expected for each capability observation. An omitted entry
   * is not a wildcard: that capability remains unknown and cannot authorize an
   * effect. The map stays optional because human-safe effects do not require
   * capability evidence.
   */
  expectedScopes?: Partial<Record<RuntimeCapability, string>>;
  controlObservedAt?: number;
  controlValidUntil?: number;
}

export interface RuntimePostureAssessment {
  posture: RuntimePosture;
  desired: RuntimeDesiredState | 'unknown';
  control: RuntimeControlObservation;
  blockers: RuntimeCapability[];
  warnings: RuntimeCapability[];
  reasons: string[];
}

export interface RuntimeEffectRequest {
  /** Every applicable trait is required; composite work must not choose one convenient label. */
  effects: readonly [RuntimeEffect, ...RuntimeEffect[]];
  additionalRequirements?: RuntimeCapability[];
}

export interface RuntimeEffectAdmission {
  allowed: boolean;
  posture: RuntimePosture;
  effects: RuntimeEffect[];
  requiredCapabilities: RuntimeCapability[];
  reasons: string[];
}

const COMMON_READINESS: RuntimeCapability[] = [
  'coordination_guard',
  'sandbox',
  'harness',
  'cost_accounting',
  'provider_access',
  'effect_receipts',
];

/** Minimum capabilities for the named effect. Callers may only add requirements. */
const requirements = (...values: RuntimeCapability[]): readonly RuntimeCapability[] => Object.freeze(values);

export const RUNTIME_EFFECT_REQUIREMENTS: Readonly<Record<RuntimeEffect, readonly RuntimeCapability[]>> = Object.freeze({
  human_local: requirements(),
  read_only: requirements(),
  emergency_control: requirements(),
  automatic_local: requirements(),
  managed_subprocess: requirements('sandbox'),
  background_agent: requirements('coordination_guard', 'sandbox', 'harness', 'cost_accounting', 'provider_access', 'effect_receipts'),
  paid_inference: requirements('cost_accounting', 'provider_access', 'effect_receipts'),
  provider_call: requirements('provider_access', 'cost_accounting', 'effect_receipts'),
  external_mutation: requirements('coordination_guard', 'cost_accounting', 'effect_receipts'),
  scheduled_automation: requirements('harness', 'effect_receipts'),
});

const HUMAN_SAFE_EFFECTS = new Set<RuntimeEffect>(['human_local', 'read_only', 'emergency_control']);
const RUNTIME_DESIRED_STATES = new Set<unknown>(['off', 'on']);
const RUNTIME_CONTROL_OBSERVATIONS = new Set<unknown>(['disabled', 'enabled', 'stopping', 'unknown']);
const RUNTIME_CAPABILITIES = new Set<unknown>(COMMON_READINESS);
const RUNTIME_CAPABILITY_STATUSES = new Set<unknown>(['ready', 'absent', 'disabled', 'degraded', 'unknown']);
const MAX_OBSERVATION_AGE_MS = 60_000;
const MAX_OBSERVATION_HORIZON_MS = 60_000;

function isPolicyObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueCapabilities(values: readonly RuntimeCapability[]): RuntimeCapability[] {
  return [...new Set(values)];
}

function isDenseArray(values: readonly unknown[]): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(values, index)) return false;
  }
  return true;
}

function capabilityStatus(
  input: RuntimePostureInput,
  capability: RuntimeCapability,
): RuntimeCapabilityStatus {
  if (
    !Object.prototype.hasOwnProperty.call(input, 'capabilities')
    || !Object.prototype.hasOwnProperty.call(input, 'expectedScopes')
  ) return 'unknown';
  const observedCapabilities = input.capabilities;
  const expectedScopes = input.expectedScopes;
  if (
    !observedCapabilities
    || !Object.prototype.hasOwnProperty.call(observedCapabilities, capability)
    || !expectedScopes
    || !Object.prototype.hasOwnProperty.call(expectedScopes, capability)
  ) return 'unknown';
  const observation = observedCapabilities[capability];
  if (
    !observation
    || !['status', 'scope', 'observedAt', 'validUntil'].every((field) => (
      Object.prototype.hasOwnProperty.call(observation, field)
    ))
    || !RUNTIME_CAPABILITY_STATUSES.has(observation.status)
  ) return 'unknown';
  if (observation.status === 'ready' && observation.reason !== undefined) return 'degraded';
  const expectedScope = expectedScopes[capability];
  if (
    typeof expectedScope !== 'string'
    || expectedScope.trim().length === 0
    || typeof observation.scope !== 'string'
    || observation.scope.trim().length === 0
    || observation.scope !== expectedScope
  ) return 'unknown';
  const now = Date.now();
  if (!Number.isFinite(observation.observedAt) || !Number.isFinite(observation.validUntil)) return 'unknown';
  if (observation.observedAt! > now || now - observation.observedAt! > MAX_OBSERVATION_AGE_MS) return 'unknown';
  if (
    observation.validUntil! <= now
    || observation.validUntil! - observation.observedAt! > MAX_OBSERVATION_HORIZON_MS
  ) return 'unknown';
  return observation.status;
}

function observedControl(input: RuntimePostureInput): RuntimeControlObservation {
  if (
    !Object.prototype.hasOwnProperty.call(input, 'control')
    || !Object.prototype.hasOwnProperty.call(input, 'controlObservedAt')
    || !Object.prototype.hasOwnProperty.call(input, 'controlValidUntil')
  ) return 'unknown';
  if (!RUNTIME_CONTROL_OBSERVATIONS.has(input.control)) return 'unknown';
  const now = Date.now();
  if (!Number.isFinite(input.controlObservedAt) || !Number.isFinite(input.controlValidUntil)) return 'unknown';
  if (input.controlObservedAt! > now || now - input.controlObservedAt! > MAX_OBSERVATION_AGE_MS) return 'unknown';
  if (
    input.controlValidUntil! <= now
    || input.controlValidUntil! - input.controlObservedAt! > MAX_OBSERVATION_HORIZON_MS
  ) return 'unknown';
  return input.control;
}

function observedDesired(input: RuntimePostureInput): RuntimeDesiredState | 'unknown' {
  if (!Object.prototype.hasOwnProperty.call(input, 'desired')) return 'unknown';
  return RUNTIME_DESIRED_STATES.has(input.desired) ? input.desired : 'unknown';
}

/**
 * Summarize the whole runtime without using that summary as effect authority.
 * Individual effects still pass through admitRuntimeEffect below.
 */
export function assessRuntimePosture(input: RuntimePostureInput): RuntimePostureAssessment {
  if (!isPolicyObject(input)) {
    return {
      posture: 'unknown',
      desired: 'unknown',
      control: 'unknown',
      blockers: [],
      warnings: [...COMMON_READINESS],
      reasons: ['runtime_input_invalid'],
    };
  }

  const desired = observedDesired(input);
  const control = observedControl(input);
  const warnings = COMMON_READINESS.filter((capability) => capabilityStatus(input, capability) !== 'ready');

  const unknownReasons: string[] = [];
  if (desired === 'unknown') unknownReasons.push('runtime_desired_unknown');
  if (control === 'unknown') unknownReasons.push('runtime_control_unknown');
  if (unknownReasons.length > 0) {
    return { posture: 'unknown', desired, control, blockers: [], warnings, reasons: unknownReasons };
  }
  if (desired === 'off' && control === 'disabled') {
    return { posture: 'off', desired, control, blockers: [], warnings, reasons: ['operator_intent_off'] };
  }
  if (desired === 'off' || control === 'stopping') {
    return {
      posture: 'transitioning', desired, control, blockers: [], warnings,
      reasons: desired === 'off' ? ['operator_intent_off'] : ['runtime_control_stopping'],
    };
  }
  if (control === 'disabled') {
    return { posture: 'activation_blocked', desired, control, blockers: [], warnings, reasons: ['runtime_control_disabled'] };
  }

  const blockers = COMMON_READINESS.filter((capability) => capabilityStatus(input, capability) !== 'ready');
  return {
    posture: blockers.length === 0 ? 'on' : 'degraded',
    desired,
    control,
    blockers,
    warnings,
    reasons: blockers.map((capability) => `${capability}_${capabilityStatus(input, capability)}`),
  };
}

/**
 * Admit one effect at its final boundary. Unknown state denies automation,
 * paid/provider work, subprocesses, schedules, and outward mutations. Human
 * local work, read-only inspection, and emergency controls remain available
 * only while the request remains capability-free; adding a capability also
 * opts the request back into the On/control authority boundary.
 */
export function admitRuntimeEffect(
  input: RuntimePostureInput,
  request: RuntimeEffectRequest,
): RuntimeEffectAdmission {
  const inputIsValid = isPolicyObject(input);
  const assessment = assessRuntimePosture(input);
  const requestIsValid = isPolicyObject(request);
  if (!inputIsValid || !requestIsValid) {
    return {
      allowed: false,
      posture: assessment.posture,
      effects: [],
      requiredCapabilities: [],
      reasons: [
        ...(inputIsValid ? [] : ['runtime_input_invalid']),
        ...(requestIsValid ? [] : ['effect_request_invalid']),
      ],
    };
  }

  const suppliedEffects: readonly unknown[] = (
    Object.prototype.hasOwnProperty.call(request, 'effects')
    && Array.isArray(request.effects)
  ) ? request.effects : [];
  const effectsAreDense = isDenseArray(suppliedEffects);
  const knownEffects = new Set(Object.keys(RUNTIME_EFFECT_REQUIREMENTS));
  const invalidEffects = suppliedEffects.filter((effect) => typeof effect !== 'string' || !knownEffects.has(effect));
  const effects = [...new Set(suppliedEffects.filter(
    (effect): effect is RuntimeEffect => typeof effect === 'string' && knownEffects.has(effect),
  ))];
  const suppliedAdditionalRequirements: readonly unknown[] = Array.isArray(request.additionalRequirements)
    ? request.additionalRequirements
    : [];
  const additionalRequirementsAreDense = isDenseArray(suppliedAdditionalRequirements);
  const invalidAdditionalRequirements = request.additionalRequirements !== undefined
    && !Array.isArray(request.additionalRequirements)
    ? [request.additionalRequirements]
    : suppliedAdditionalRequirements.filter((capability) => !RUNTIME_CAPABILITIES.has(capability));
  const additionalRequirements = suppliedAdditionalRequirements.filter(
    (capability): capability is RuntimeCapability => RUNTIME_CAPABILITIES.has(capability),
  );
  const requiredCapabilities = uniqueCapabilities([
    ...effects.flatMap((effect) => RUNTIME_EFFECT_REQUIREMENTS[effect]),
    ...additionalRequirements,
  ]);
  const onlyHumanSafeEffects = effects.every((effect) => HUMAN_SAFE_EFFECTS.has(effect));
  const postureExempt = onlyHumanSafeEffects && requiredCapabilities.length === 0;
  const classificationReasons: string[] = [];
  if (!effectsAreDense) classificationReasons.push('effect_set_sparse');
  if (effectsAreDense && effects.length === 0 && invalidEffects.length === 0) classificationReasons.push('effect_set_empty');
  if (invalidEffects.length > 0) classificationReasons.push('effect_unknown');
  if (!additionalRequirementsAreDense) classificationReasons.push('capability_requirement_sparse');
  if (invalidAdditionalRequirements.length > 0) classificationReasons.push('capability_requirement_unknown');

  if (postureExempt && classificationReasons.length === 0) {
    return {
      allowed: true,
      posture: assessment.posture,
      effects,
      requiredCapabilities,
      reasons: [],
    };
  }

  const reasons = [...classificationReasons];
  if (!postureExempt) {
    if (assessment.desired !== 'on') {
      reasons.push(assessment.desired === 'unknown' ? 'runtime_desired_unknown' : 'operator_intent_off');
    }
    if (assessment.control !== 'enabled') reasons.push(`runtime_control_${assessment.control}`);
  }

  for (const capability of requiredCapabilities) {
    const status = capabilityStatus(input, capability);
    if (status !== 'ready') reasons.push(`${capability}_${status}`);
  }

  return {
    allowed: reasons.length === 0,
    posture: assessment.posture,
    effects,
    requiredCapabilities,
    reasons,
  };
}
