import { describe, expect, test } from '@jest/globals';
import {
  admitRuntimeEffect,
  assessRuntimePosture,
  RUNTIME_EFFECT_REQUIREMENTS,
  type RuntimeCapability,
  type RuntimeCapabilityStatus,
  type RuntimePostureInput,
} from '../../lib/runtime-posture.js';

const NOW = Date.now();
const CAPABILITY_SCOPE = Object.fromEntries(
  (['coordination_guard', 'sandbox', 'harness', 'cost_accounting', 'provider_access', 'effect_receipts'] as const)
    .map((capability) => [capability, `fixture/${capability}`]),
) as Record<RuntimeCapability, string>;

const capabilities = (overrides: Partial<Record<RuntimeCapability, RuntimeCapabilityStatus>> = {}) => Object.fromEntries(
  (['coordination_guard', 'sandbox', 'harness', 'cost_accounting', 'provider_access', 'effect_receipts'] as const)
    .map((capability) => [capability, {
      status: overrides[capability] ?? 'ready',
      scope: CAPABILITY_SCOPE[capability],
      observedAt: NOW - 1_000,
      validUntil: NOW + 60_000,
    }]),
);

const ready: RuntimePostureInput = {
  desired: 'on',
  control: 'enabled',
  controlObservedAt: NOW - 1_000,
  controlValidUntil: NOW + 60_000,
  capabilities: capabilities(),
  expectedScopes: CAPABILITY_SCOPE,
};

describe('runtime posture names the product state instead of treating it as a boolean', () => {
  test.each([
    ['operator Off is observed', { ...ready, desired: 'off', control: 'disabled' as const }, 'off'],
    ['Off was requested but the boundary is still open', { ...ready, desired: 'off' }, 'transitioning'],
    ['the control boundary cannot be observed', { ...ready, control: 'unknown' as const }, 'unknown'],
    ['the stop marker remains after an On request', { ...ready, control: 'disabled' as const }, 'activation_blocked'],
    ['all common capabilities are ready', ready, 'on'],
    ['the coordination guard is absent', { ...ready, capabilities: capabilities({ coordination_guard: 'absent' }) }, 'degraded'],
    ['the sandbox is unavailable', { ...ready, capabilities: capabilities({ sandbox: 'unknown' }) }, 'degraded'],
    ['the harness is disabled', { ...ready, capabilities: capabilities({ harness: 'disabled' }) }, 'degraded'],
    ['cost accounting is stale', { ...ready, capabilities: capabilities({ cost_accounting: 'degraded' }) }, 'degraded'],
  ])('%s -> %s', (_name, input, posture) => {
    expect(assessRuntimePosture(input).posture).toBe(posture);
  });
});

describe('effect admission is narrower than the overall posture', () => {
  test.each(['human_local', 'read_only', 'emergency_control'] as const)(
    '%s remains available while Off and while control truth is unknown',
    (effect) => {
      expect(admitRuntimeEffect({ ...ready, desired: 'off', control: 'unknown' }, { effects: [effect] }).allowed).toBe(true);
    },
  );

  test.each(['automatic_local', 'managed_subprocess', 'background_agent', 'paid_inference', 'provider_call', 'external_mutation', 'scheduled_automation'] as const)(
    '%s fails closed when the control boundary is unknown',
    (effect) => {
      expect(admitRuntimeEffect({ ...ready, control: 'unknown' }, { effects: [effect] })).toMatchObject({
        allowed: false,
        reasons: ['runtime_control_unknown'],
      });
    },
  );

  test('no coordination guard blocks mutation and background agents, not ordinary local automation', () => {
    const input = { ...ready, capabilities: capabilities({ coordination_guard: 'absent' }) };
    expect(admitRuntimeEffect(input, { effects: ['automatic_local'] }).allowed).toBe(true);
    expect(admitRuntimeEffect(input, { effects: ['external_mutation'] }).reasons).toContain('coordination_guard_absent');
    expect(admitRuntimeEffect(input, { effects: ['background_agent'] }).reasons).toContain('coordination_guard_absent');
  });

  test('no sandbox blocks managed subprocesses and background agents without inventing a global Off', () => {
    const input = { ...ready, capabilities: capabilities({ sandbox: 'absent' }) };
    expect(admitRuntimeEffect(input, { effects: ['managed_subprocess'] }).reasons).toEqual(['sandbox_absent']);
    expect(admitRuntimeEffect(input, { effects: ['background_agent'] }).reasons).toContain('sandbox_absent');
    expect(admitRuntimeEffect(input, { effects: ['read_only'] }).allowed).toBe(true);
  });

  test('no harness blocks schedules and background agents but not an independently sandboxed child', () => {
    const input = { ...ready, capabilities: capabilities({ harness: 'disabled' }) };
    expect(admitRuntimeEffect(input, { effects: ['scheduled_automation'] }).reasons).toContain('harness_disabled');
    expect(admitRuntimeEffect(input, { effects: ['background_agent'] }).reasons).toContain('harness_disabled');
    expect(admitRuntimeEffect(input, { effects: ['managed_subprocess'] }).allowed).toBe(true);
  });

  test('unknown cost truth blocks paid inference and background agents', () => {
    const input = { ...ready, capabilities: capabilities({ cost_accounting: 'unknown' }) };
    expect(admitRuntimeEffect(input, { effects: ['paid_inference'] }).reasons).toEqual(['cost_accounting_unknown']);
    expect(admitRuntimeEffect(input, { effects: ['background_agent'] }).reasons).toContain('cost_accounting_unknown');
  });

  test('missing provider access blocks paid inference without blocking free local work', () => {
    const input = { ...ready, capabilities: capabilities({ provider_access: 'absent' }) };
    expect(admitRuntimeEffect(input, { effects: ['paid_inference'] }).reasons).toEqual(['provider_access_absent']);
    expect(admitRuntimeEffect(input, { effects: ['automatic_local'] }).allowed).toBe(true);
  });

  test('missing effect receipts blocks outward mutation even when coordination is healthy', () => {
    const input = { ...ready, capabilities: capabilities({ effect_receipts: 'degraded' }) };
    expect(admitRuntimeEffect(input, { effects: ['external_mutation'] }).reasons).toEqual(['effect_receipts_degraded']);
  });

  test('callers may add a stricter dependency but cannot remove the policy minimum', () => {
    const input = { ...ready, capabilities: capabilities({ harness: 'absent' }) };
    const admission = admitRuntimeEffect(input, {
      effects: ['managed_subprocess'],
      additionalRequirements: ['harness', 'sandbox'],
    });
    expect(admission.requiredCapabilities).toEqual(['sandbox', 'harness']);
    expect(admission.reasons).toEqual(['harness_absent']);
  });

  test('a caller-added dependency is still checked on an otherwise human-safe effect', () => {
    const input = { ...ready, capabilities: capabilities({ provider_access: 'unknown' }) };
    expect(admitRuntimeEffect(input, {
      effects: ['read_only'],
      additionalRequirements: ['provider_access'],
    })).toMatchObject({
      allowed: false,
      reasons: ['provider_access_unknown'],
    });
  });

  test.each(['automatic_local', 'managed_subprocess', 'background_agent', 'paid_inference', 'provider_call', 'external_mutation', 'scheduled_automation'] as const)(
    'fully ready On admits %s',
    (effect) => expect(admitRuntimeEffect(ready, { effects: [effect] }).allowed).toBe(true),
  );

  test.each(['automatic_local', 'managed_subprocess', 'background_agent', 'paid_inference', 'provider_call', 'external_mutation', 'scheduled_automation'] as const)(
    'operator intent Off denies %s before the still-open boundary can persist',
    (effect) => expect(admitRuntimeEffect({ ...ready, desired: 'off' }, { effects: [effect] })).toMatchObject({
      allowed: false,
      posture: 'transitioning',
      reasons: ['operator_intent_off'],
    }),
  );

  test('composite scheduled paid mutation accumulates every minimum and fails on each unavailable capability', () => {
    const input = {
      ...ready,
      capabilities: capabilities({ coordination_guard: 'absent', cost_accounting: 'unknown', harness: 'disabled' }),
    };
    expect(admitRuntimeEffect(input, {
      effects: ['scheduled_automation', 'paid_inference', 'external_mutation'],
    })).toMatchObject({
      allowed: false,
      requiredCapabilities: ['harness', 'effect_receipts', 'cost_accounting', 'provider_access', 'coordination_guard'],
      reasons: ['harness_disabled', 'cost_accounting_unknown', 'coordination_guard_absent'],
    });
  });

  test('policy minimum arrays and their registry are frozen against JavaScript callers', () => {
    expect(Object.isFrozen(RUNTIME_EFFECT_REQUIREMENTS)).toBe(true);
    expect(Object.values(RUNTIME_EFFECT_REQUIREMENTS).every(Object.isFrozen)).toBe(true);
  });

  test('unknown and empty effect sets fail closed without throwing for JavaScript callers', () => {
    expect(admitRuntimeEffect(ready, { effects: [] } as never)).toMatchObject({ allowed: false, reasons: ['effect_set_empty'] });
    expect(admitRuntimeEffect(ready, { effects: new Array(1) } as never)).toMatchObject({ allowed: false, reasons: ['effect_set_empty'] });
    expect(admitRuntimeEffect(ready, { effects: ['future_effect'] } as never)).toMatchObject({ allowed: false, reasons: ['effect_unknown'] });
  });

  test('stale and wrong-scope capability observations degrade to unknown', () => {
    const scopedReady = capabilities();
    scopedReady.sandbox = {
      status: 'ready', scope: CAPABILITY_SCOPE.sandbox, observedAt: NOW - 2_000, validUntil: NOW - 1,
    };
    const base = { ...ready, capabilities: scopedReady };
    expect(admitRuntimeEffect(base, { effects: ['managed_subprocess'] }).reasons).toEqual(['sandbox_unknown']);
    expect(admitRuntimeEffect({ ...ready, expectedScopes: { ...CAPABILITY_SCOPE, sandbox: 'wrong/scope' } }, {
      effects: ['managed_subprocess'],
    }).reasons).toEqual(['sandbox_unknown']);
  });

  test('future, unbounded, and contradictory ready observations never authorize', () => {
    const contradictory = capabilities();
    contradictory.sandbox = {
      status: 'ready', reason: 'egress_unconfined', scope: CAPABILITY_SCOPE.sandbox,
      observedAt: NOW - 1_000, validUntil: NOW + 60_000,
    };
    expect(admitRuntimeEffect({ ...ready, capabilities: contradictory }, {
      effects: ['managed_subprocess'],
    }).reasons).toEqual(['sandbox_degraded']);

    const future = capabilities();
    future.provider_access = {
      status: 'ready', scope: CAPABILITY_SCOPE.provider_access,
      observedAt: Date.now() + 60_000, validUntil: Date.now() + 120_000,
    };
    expect(admitRuntimeEffect({ ...ready, capabilities: future }, { effects: ['provider_call'] }).reasons)
      .toContain('provider_access_unknown');

    const unbounded = capabilities();
    unbounded.cost_accounting = {
      status: 'ready', scope: CAPABILITY_SCOPE.cost_accounting, observedAt: NOW - 1_000,
    };
    expect(admitRuntimeEffect({ ...ready, capabilities: unbounded }, { effects: ['paid_inference'] }).reasons)
      .toContain('cost_accounting_unknown');
  });

  test('provider-backed read stays behind Off even when provider capability is ready', () => {
    expect(admitRuntimeEffect({ ...ready, desired: 'off' }, {
      effects: ['read_only', 'provider_call'],
    })).toMatchObject({ allowed: false, reasons: ['operator_intent_off'] });
  });

  test('stale or future control observations deny automatic effects', () => {
    expect(admitRuntimeEffect({ ...ready, controlValidUntil: NOW - 1 }, {
      effects: ['automatic_local'],
    }).reasons).toEqual(['runtime_control_unknown']);
    expect(admitRuntimeEffect({ ...ready, controlObservedAt: Date.now() + 60_000 }, {
      effects: ['automatic_local'],
    }).reasons).toEqual(['runtime_control_unknown']);
  });

  test('non-finite, exact-expiry, ancient, and overlong observations deny', () => {
    for (const invalid of [
      { observedAt: Number.NaN, validUntil: NOW + 1_000 },
      { observedAt: NOW - 1_000, validUntil: Number.POSITIVE_INFINITY },
      { observedAt: NOW - 61_000, validUntil: NOW + 1_000 },
      { observedAt: NOW - 1_000, validUntil: Date.now() },
      { observedAt: NOW - 1_000, validUntil: Date.now() + 61_000 },
    ]) {
      const observed = capabilities();
      observed.sandbox = { status: 'ready', scope: CAPABILITY_SCOPE.sandbox, ...invalid };
      expect(admitRuntimeEffect({ ...ready, capabilities: observed }, {
        effects: ['managed_subprocess'],
      }).reasons).toEqual(['sandbox_unknown']);
    }
    expect(admitRuntimeEffect({
      ...ready,
      controlObservedAt: Number.NaN,
      controlValidUntil: Number.POSITIVE_INFINITY,
    }, { effects: ['automatic_local'] }).reasons).toEqual(['runtime_control_unknown']);
  });

  test('provider calls and outward mutations require cost truth even when they are not inference', () => {
    const input = { ...ready, capabilities: capabilities({ cost_accounting: 'unknown' }) };
    expect(admitRuntimeEffect(input, { effects: ['provider_call'] }).reasons).toContain('cost_accounting_unknown');
    expect(admitRuntimeEffect(input, { effects: ['external_mutation'] }).reasons).toContain('cost_accounting_unknown');
  });

  test('ON to OFF to ON sequence denies throughout both transitions', () => {
    const states: Array<[RuntimePostureInput, boolean, string]> = [
      [ready, true, 'on'],
      [{ ...ready, desired: 'off' }, false, 'transitioning'],
      [{ ...ready, desired: 'off', control: 'disabled' }, false, 'off'],
      [{ ...ready, control: 'disabled' }, false, 'activation_blocked'],
      [ready, true, 'on'],
    ];
    expect(states.map(([input]) => {
      const admission = admitRuntimeEffect(input, { effects: ['background_agent'] });
      return [admission.allowed, admission.posture];
    })).toEqual(states.map(([, allowed, posture]) => [allowed, posture]));
  });
});
