import {
  type RuntimeCapability,
  type RuntimeCapabilityStatus,
  type RuntimePostureInput,
} from '../../lib/runtime-posture.js';

export const NOW = Date.now();

export const CAPABILITY_SCOPE = Object.fromEntries(
  (['coordination_guard', 'sandbox', 'harness', 'cost_accounting', 'provider_access', 'effect_receipts'] as const)
    .map((capability) => [capability, `fixture/${capability}`]),
) as Record<RuntimeCapability, string>;

export const capabilities = (
  overrides: Partial<Record<RuntimeCapability, RuntimeCapabilityStatus>> = {},
) => Object.fromEntries(
  (['coordination_guard', 'sandbox', 'harness', 'cost_accounting', 'provider_access', 'effect_receipts'] as const)
    .map((capability) => [capability, {
      status: overrides[capability] ?? 'ready',
      scope: CAPABILITY_SCOPE[capability],
      observedAt: NOW - 1_000,
      validUntil: NOW + 60_000,
    }]),
);

export const ready: RuntimePostureInput = {
  desired: 'on',
  control: 'enabled',
  controlObservedAt: NOW - 1_000,
  controlValidUntil: NOW + 60_000,
  capabilities: capabilities(),
  expectedScopes: CAPABILITY_SCOPE,
};
