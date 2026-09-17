import { describe, expect, test } from '@jest/globals';
import {
  admitRuntimeEffect,
  type RuntimeCapability,
  type RuntimePostureInput,
} from '../../lib/runtime-posture.js';
import { CAPABILITY_SCOPE, capabilities, NOW, ready } from './runtime-posture-fixtures.js';

describe('runtime posture observation authority', () => {
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

  test('an omitted expected scope is not wildcard authority for a ready observation', () => {
    const expectedScopes = { ...CAPABILITY_SCOPE } as Partial<Record<RuntimeCapability, string>>;
    delete expectedScopes.sandbox;

    expect(admitRuntimeEffect({ ...ready, expectedScopes }, {
      effects: ['managed_subprocess'],
    })).toMatchObject({
      allowed: false,
      requiredCapabilities: ['sandbox'],
      reasons: ['sandbox_unknown'],
    });
  });

  test('malformed expected or observed scopes never become authority', () => {
    for (const invalidScope of [null, 42, '', '   ']) {
      const malformedObservation = capabilities();
      malformedObservation.sandbox = {
        ...malformedObservation.sandbox!,
        scope: invalidScope as string,
      };
      expect(admitRuntimeEffect({ ...ready, capabilities: malformedObservation }, {
        effects: ['managed_subprocess'],
      }).reasons).toEqual(['sandbox_unknown']);

      expect(admitRuntimeEffect({
        ...ready,
        expectedScopes: { ...CAPABILITY_SCOPE, sandbox: invalidScope as string },
      }, { effects: ['managed_subprocess'] }).reasons).toEqual(['sandbox_unknown']);

      expect(admitRuntimeEffect({
        ...ready,
        capabilities: malformedObservation,
        expectedScopes: { ...CAPABILITY_SCOPE, sandbox: invalidScope as string },
      }, { effects: ['managed_subprocess'] }).reasons).toEqual(['sandbox_unknown']);
    }
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

  test('overlong receipts never age into validity', () => {
    const receiptTime = Date.now();
    const observed = capabilities();
    observed.sandbox = {
      status: 'ready',
      scope: CAPABILITY_SCOPE.sandbox,
      observedAt: receiptTime - 30_000,
      validUntil: receiptTime + 60_000,
    };

    expect(admitRuntimeEffect({ ...ready, capabilities: observed }, {
      effects: ['managed_subprocess'],
    }).reasons).toEqual(['sandbox_unknown']);
    expect(admitRuntimeEffect({
      ...ready,
      controlObservedAt: receiptTime - 30_000,
      controlValidUntil: receiptTime + 60_000,
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
