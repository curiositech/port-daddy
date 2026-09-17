import { describe, expect, test } from '@jest/globals';
import {
  admitRuntimeEffect,
  assessRuntimePosture,
  RUNTIME_EFFECT_REQUIREMENTS,
} from '../../lib/runtime-posture.js';
import { capabilities, NOW, ready } from './runtime-posture-fixtures.js';

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

  test('unrecognized desired and control values fail closed for untyped callers', () => {
    expect(assessRuntimePosture({ ...ready, desired: 'future_value' } as never)).toMatchObject({
      posture: 'unknown',
      desired: 'unknown',
      reasons: ['runtime_desired_unknown'],
    });
    expect(assessRuntimePosture({ ...ready, control: 'future_value' } as never)).toMatchObject({
      posture: 'unknown',
      control: 'unknown',
      reasons: ['runtime_control_unknown'],
    });
    expect(assessRuntimePosture({ ...ready, desired: 'future_desired', control: 'future_control' } as never)).toMatchObject({
      posture: 'unknown',
      desired: 'unknown',
      control: 'unknown',
      reasons: ['runtime_desired_unknown', 'runtime_control_unknown'],
    });
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'on'],
  ])('a %s top-level posture payload returns stable unknown state', (_label, input) => {
    expect(assessRuntimePosture(input as never)).toMatchObject({
      posture: 'unknown',
      desired: 'unknown',
      control: 'unknown',
      blockers: [],
      reasons: ['runtime_input_invalid'],
    });
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

  test.each([
    [
      'operator Off with a disabled boundary',
      { ...ready, desired: 'off' as const, control: 'disabled' as const },
      ['operator_intent_off', 'runtime_control_disabled'],
    ],
    [
      'operator Off while the boundary remains enabled',
      { ...ready, desired: 'off' as const },
      ['operator_intent_off'],
    ],
    [
      'an unknown control boundary',
      { ...ready, control: 'unknown' as const },
      ['runtime_control_unknown'],
    ],
  ])('a human-safe effect with provider authority is denied under %s', (_label, input, reasons) => {
    expect(admitRuntimeEffect(input, {
      effects: ['read_only'],
      additionalRequirements: ['provider_access'],
    })).toMatchObject({
      allowed: false,
      requiredCapabilities: ['provider_access'],
      reasons,
    });
  });

  test('unknown additional requirements fail closed even when an untyped caller supplies matching ready evidence', () => {
    const input = {
      ...ready,
      capabilities: {
        ...ready.capabilities,
        future_capability: {
          status: 'ready',
          scope: 'fixture/future_capability',
          observedAt: NOW - 1_000,
          validUntil: NOW + 60_000,
        },
      },
      expectedScopes: {
        ...ready.expectedScopes,
        future_capability: 'fixture/future_capability',
      },
    } as never;
    expect(admitRuntimeEffect(input, {
      effects: ['automatic_local'],
      additionalRequirements: ['future_capability'],
    } as never)).toMatchObject({
      allowed: false,
      requiredCapabilities: [],
      reasons: ['capability_requirement_unknown'],
    });
  });

  test('mixed known and unknown additional requirements retain the known minimum and deny the unknown one', () => {
    expect(admitRuntimeEffect(ready, {
      effects: ['managed_subprocess'],
      additionalRequirements: ['harness', 'future_capability'],
    } as never)).toMatchObject({
      allowed: false,
      requiredCapabilities: ['sandbox', 'harness'],
      reasons: ['capability_requirement_unknown'],
    });
  });

  test('a non-array additional requirement fails closed without throwing', () => {
    expect(admitRuntimeEffect(ready, {
      effects: ['automatic_local'],
      additionalRequirements: 'sandbox',
    } as never)).toMatchObject({
      allowed: false,
      requiredCapabilities: [],
      reasons: ['capability_requirement_unknown'],
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
    expect(admitRuntimeEffect(ready, { effects: new Array(1) } as never)).toMatchObject({ allowed: false, reasons: ['effect_set_sparse'] });
    expect(admitRuntimeEffect(ready, { effects: ['future_effect'] } as never)).toMatchObject({ allowed: false, reasons: ['effect_unknown'] });
  });

  test('mixed sparse effect and capability arrays cannot hide missing classifications', () => {
    const sparseEffects = ['automatic_local'];
    sparseEffects.length = 2;
    expect(admitRuntimeEffect(ready, { effects: sparseEffects } as never)).toMatchObject({
      allowed: false,
      effects: ['automatic_local'],
      reasons: ['effect_set_sparse'],
    });

    const sparseRequirements = ['sandbox'];
    sparseRequirements.length = 2;
    expect(admitRuntimeEffect(ready, {
      effects: ['automatic_local'],
      additionalRequirements: sparseRequirements,
    } as never)).toMatchObject({
      allowed: false,
      requiredCapabilities: ['sandbox'],
      reasons: ['capability_requirement_sparse'],
    });
  });

  test('unrecognized desired and control values deny every automatic effect', () => {
    expect(admitRuntimeEffect({ ...ready, desired: 'future_value' } as never, {
      effects: ['automatic_local'],
    })).toMatchObject({ allowed: false, posture: 'unknown', reasons: ['runtime_desired_unknown'] });
    expect(admitRuntimeEffect({ ...ready, control: 'future_value' } as never, {
      effects: ['automatic_local'],
    })).toMatchObject({ allowed: false, posture: 'unknown', reasons: ['runtime_control_unknown'] });
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'automatic_local'],
  ])('a %s top-level effect request is denied without throwing', (_label, request) => {
    expect(admitRuntimeEffect(ready, request as never)).toEqual({
      allowed: false,
      posture: 'on',
      effects: [],
      requiredCapabilities: [],
      reasons: ['effect_request_invalid'],
    });
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'on'],
  ])('a %s top-level posture input cannot use the human-safe exemption', (_label, input) => {
    expect(admitRuntimeEffect(input as never, { effects: ['read_only'] })).toEqual({
      allowed: false,
      posture: 'unknown',
      effects: [],
      requiredCapabilities: [],
      reasons: ['runtime_input_invalid'],
    });
  });

  test('two malformed top-level objects report both stable denial reasons', () => {
    expect(admitRuntimeEffect(null as never, null as never)).toEqual({
      allowed: false,
      posture: 'unknown',
      effects: [],
      requiredCapabilities: [],
      reasons: ['runtime_input_invalid', 'effect_request_invalid'],
    });
  });
});
