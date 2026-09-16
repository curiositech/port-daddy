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
  expectedScopes?: Partial<Record<RuntimeCapability, string>>;
  controlObservedAt?: number;
  controlValidUntil?: number;
}

export interface RuntimePostureAssessment {
  posture: RuntimePosture;
  desired: RuntimeDesiredState;
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
const MAX_OBSERVATION_AGE_MS = 60_000;
const MAX_OBSERVATION_HORIZON_MS = 60_000;

function uniqueCapabilities(values: readonly RuntimeCapability[]): RuntimeCapability[] {
  return [...new Set(values)];
}

function capabilityStatus(
  input: RuntimePostureInput,
  capability: RuntimeCapability,
): RuntimeCapabilityStatus {
  const observation = input.capabilities?.[capability];
  if (!observation) return 'unknown';
  if (observation.status === 'ready' && observation.reason !== undefined) return 'degraded';
  const expectedScope = input.expectedScopes?.[capability];
  if (expectedScope === undefined || observation.scope !== expectedScope) return 'unknown';
  const now = Date.now();
  if (!Number.isFinite(observation.observedAt) || !Number.isFinite(observation.validUntil)) return 'unknown';
  if (observation.observedAt! > now || now - observation.observedAt! > MAX_OBSERVATION_AGE_MS) return 'unknown';
  if (observation.validUntil! <= now || observation.validUntil! - now > MAX_OBSERVATION_HORIZON_MS) return 'unknown';
  return observation.status;
}

function observedControl(input: RuntimePostureInput): RuntimeControlObservation {
  const now = Date.now();
  if (!Number.isFinite(input.controlObservedAt) || !Number.isFinite(input.controlValidUntil)) return 'unknown';
  if (input.controlObservedAt! > now || now - input.controlObservedAt! > MAX_OBSERVATION_AGE_MS) return 'unknown';
  if (input.controlValidUntil! <= now || input.controlValidUntil! - now > MAX_OBSERVATION_HORIZON_MS) return 'unknown';
  return input.control;
}

/**
 * Summarize the whole runtime without using that summary as effect authority.
 * Individual effects still pass through admitRuntimeEffect below.
 */
export function assessRuntimePosture(input: RuntimePostureInput): RuntimePostureAssessment {
  const control = observedControl(input);
  const warnings = COMMON_READINESS.filter((capability) => capabilityStatus(input, capability) !== 'ready');

  if (control === 'unknown') {
    return { posture: 'unknown', desired: input.desired, control, blockers: [], warnings, reasons: ['runtime_control_unknown'] };
  }
  if (input.desired === 'off' && control === 'disabled') {
    return { posture: 'off', desired: input.desired, control, blockers: [], warnings, reasons: ['operator_intent_off'] };
  }
  if (input.desired === 'off' || control === 'stopping') {
    return {
      posture: 'transitioning', desired: input.desired, control, blockers: [], warnings,
      reasons: input.desired === 'off' ? ['operator_intent_off'] : ['runtime_control_stopping'],
    };
  }
  if (control === 'disabled') {
    return { posture: 'activation_blocked', desired: input.desired, control, blockers: [], warnings, reasons: ['runtime_control_disabled'] };
  }

  const blockers = COMMON_READINESS.filter((capability) => capabilityStatus(input, capability) !== 'ready');
  return {
    posture: blockers.length === 0 ? 'on' : 'degraded',
    desired: input.desired,
    control,
    blockers,
    warnings,
    reasons: blockers.map((capability) => `${capability}_${capabilityStatus(input, capability)}`),
  };
}

/**
 * Admit one effect at its final boundary. Unknown state denies automation,
 * paid/provider work, subprocesses, schedules, and outward mutations. Human
 * local work, read-only inspection, and emergency controls remain available.
 */
export function admitRuntimeEffect(
  input: RuntimePostureInput,
  request: RuntimeEffectRequest,
): RuntimeEffectAdmission {
  const assessment = assessRuntimePosture(input);
  const suppliedEffects: readonly unknown[] = Array.isArray(request.effects) ? request.effects : [];
  const knownEffects = new Set(Object.keys(RUNTIME_EFFECT_REQUIREMENTS));
  const invalidEffects = suppliedEffects.filter((effect) => typeof effect !== 'string' || !knownEffects.has(effect));
  const effects = [...new Set(suppliedEffects.filter(
    (effect): effect is RuntimeEffect => typeof effect === 'string' && knownEffects.has(effect),
  ))];
  const requiredCapabilities = uniqueCapabilities([
    ...effects.flatMap((effect) => RUNTIME_EFFECT_REQUIREMENTS[effect]),
    ...(request.additionalRequirements ?? []),
  ]);
  const onlyHumanSafeEffects = effects.every((effect) => HUMAN_SAFE_EFFECTS.has(effect));
  const classificationReasons: string[] = [];
  if (effects.length === 0 && invalidEffects.length === 0) classificationReasons.push('effect_set_empty');
  if (invalidEffects.length > 0) classificationReasons.push('effect_unknown');

  if (onlyHumanSafeEffects && requiredCapabilities.length === 0 && classificationReasons.length === 0) {
    return {
      allowed: true,
      posture: assessment.posture,
      effects,
      requiredCapabilities,
      reasons: [],
    };
  }

  const reasons = [...classificationReasons];
  if (!onlyHumanSafeEffects) {
    if (input.desired !== 'on') reasons.push('operator_intent_off');
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
