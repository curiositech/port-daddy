/**
 * tests/unit/purser/checkpoint-binding-grill.test.ts
 *
 * Grill checkpoint‑resume stability:
 *   – Ensure a checkpoint binding cannot be reused when the underlying
 *     contract/policy hash changes.
 *   – Ensure a manually‑tampered hash also forces a fail‑closed outcome.
 *
 * The test deliberately uses dynamic property access (`any`) to stay
 * compatible with the concrete export names in the repository while still
 * exercising the required behaviour.
 */

import * as shipCheckpoint from '../../../apps/fleet-executor/src/ship-checkpoint.js';

// Helper to locate the creation & verification functions regardless of their exact
// exported names.  The repository may expose them as `createShipCheckpointBinding`,
// `makeBinding`, `createBinding`, etc.; similarly for verification.
const createBindingFn: (shipId: string, contract: unknown) => unknown =
  // @ts-ignore – we purposefully probe multiple possible names.
  (shipCheckpoint as any).createShipCheckpointBinding ??
  (shipCheckpoint as any).makeBinding ??
  (shipCheckpoint as any).createBinding ??
  (() => {
    throw new Error(
      'No checkpoint‑creation function found in ship-checkpoint module. ' +
        'Expected one of: createShipCheckpointBinding, makeBinding, createBinding.'
    );
  });

const verifyBindingFn: (binding: unknown, contract: unknown) => boolean =
  // @ts-ignore – we purposefully probe multiple possible names.
  (shipCheckpoint as any).verifyShipCheckpointBinding ??
  (shipCheckpoint as any).verifyBinding ??
  (shipCheckpoint as any).isValidBinding ??
  (() => {
    throw new Error(
      'No checkpoint‑verification function found in ship-checkpoint module. ' +
        'Expected one of: verifyShipCheckpointBinding, verifyBinding, isValidBinding.'
    );
  });

describe('Checkpoint binding stability (hash mismatches & policy changes)', () => {
  test('fails to resume when the contract hash differs after a policy change', async () => {
    // Two distinct contract objects – the second simulates a policy version bump.
    const contractV1 = { policyVersion: 1, rules: [] };
    const contractV2 = { policyVersion: 2, rules: [] };

    // Create a binding based on the first contract.
    const binding = createBindingFn('ship-1', contractV1) as Record<string, unknown>;

    // The binding should carry a hash (named either `checkpointHash` or `hash`).
    const originalHash = (binding as any).checkpointHash ?? (binding as any).hash;
    expect(typeof originalHash).toBe('string');

    // Verification against the original contract must succeed (fail‑closed is false here).
    expect(verifyBindingFn(binding, contractV1)).toBe(true);

    // Verification against a different contract (different policy version) must fail.
    expect(verifyBindingFn(binding, contractV2)).toBe(false);
  });

  test('fails to resume when the stored checkpoint hash is manually tampered', async () => {
    const contract = { policyVersion: 1, rules: [] };
    const binding = createBindingFn('ship-2', contract) as Record<string, unknown>;

    // Clone the binding and corrupt its hash.
    const tamperedBinding = {
      ...binding,
      // Overwrite the hash field – we support both possible field names.
      checkpointHash: 'tampered-hash',
      hash: 'tampered-hash',
    };

    // Verification should now reject the tampered binding, regardless of the contract.
    expect(verifyBindingFn(tamperedBinding, contract)).toBe(false);
  });
});