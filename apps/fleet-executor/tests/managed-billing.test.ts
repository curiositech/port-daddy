import { describe, expect, it } from 'vitest';
import {
  recordManagedShipSpend,
  releaseManagedRun,
  reserveManagedRun,
  resolveManagedEntitlement,
  settleManagedRun,
} from '../src/managed-billing.js';
import { memoryD1 } from './harness.js';
import { applyAllMigrations, makeDb } from '../../relay/tests/helpers/d1-sqlite.js';

describe('managed billing stop-loss', () => {
  it('executes the shipped reservation and settlement SQL against real SQLite', async () => {
    const real = makeDb(applyAllMigrations());
    real.exec(`INSERT INTO fleet_managed_entitlements
      (installation_id, state, retail_balance_microusd, run_retail_microusd, source_ref, created_at, updated_at)
      VALUES (42, 'active', 2000000, 1000000, 'test', 1, 1)`);
    const db = real.DB as D1Database;
    const reservation = await reserveManagedRun(db, 'run:sqlite', 42, 2);
    expect(reservation.providerCostCapMicrousd).toBe(250_000);
    await recordManagedShipSpend(db, {
      runId: 'run:sqlite', ship: 'reviewer', installationId: 42, model: '@cf/model',
      inputTokens: 100, outputTokens: 20, providerCostMicrousd: 25_000,
    }, 3);
    expect((await settleManagedRun(db, 'run:sqlite', 4)).providerCostMicrousd).toBe(25_000);
    real.raw.close();
  });

  it('requires an explicit active entitlement and a working DB', async () => {
    await expect(resolveManagedEntitlement(undefined, 42)).rejects.toMatchObject({ code: 'db-unavailable' });

    const d1 = memoryD1();
    d1.entitlements = [];
    await expect(resolveManagedEntitlement(d1.db, 42)).rejects.toMatchObject({ code: 'entitlement-missing' });

    d1.managedBillingUnavailable = true;
    await expect(resolveManagedEntitlement(d1.db, 42)).rejects.toMatchObject({ code: 'accounting-failed' });
  });

  it('atomically reserves prepaid retail once per deterministic run id', async () => {
    const d1 = memoryD1();
    d1.entitlements[0].retailBalanceMicrousd = 1_000_000;
    d1.entitlements[0].runRetailMicrousd = 1_000_000;

    const first = await reserveManagedRun(d1.db, 'run:a', 42, 10);
    const retry = await reserveManagedRun(d1.db, 'run:a', 42, 11);
    expect(retry).toEqual(first);
    expect(d1.reservations).toHaveLength(1);
    expect(first.providerCostCapMicrousd).toBe(250_000);

    await expect(reserveManagedRun(d1.db, 'run:b', 42, 12))
      .rejects.toMatchObject({ code: 'reservation-denied' });
  });

  it('records one exact spend identity and rejects retry drift', async () => {
    const d1 = memoryD1();
    await reserveManagedRun(d1.db, 'run:a', 42, 10);
    const spend = {
      runId: 'run:a', ship: 'reviewer', installationId: 42, model: '@cf/model',
      inputTokens: 100, outputTokens: 20, providerCostMicrousd: 25_000,
    };
    await recordManagedShipSpend(d1.db, spend, 11);
    await recordManagedShipSpend(d1.db, spend, 12);
    expect(d1.spend).toHaveLength(1);

    await expect(recordManagedShipSpend(d1.db, { ...spend, outputTokens: 21 }, 13))
      .rejects.toMatchObject({ code: 'spend-conflict' });
  });

  it('settles exactly once while provider cost is at most 25% of retail', async () => {
    const d1 = memoryD1();
    await reserveManagedRun(d1.db, 'run:a', 42, 10);
    await recordManagedShipSpend(d1.db, {
      runId: 'run:a', ship: 'reviewer', installationId: 42, model: '@cf/model',
      inputTokens: 1, outputTokens: 1, providerCostMicrousd: 250_000,
    }, 11);

    const settled = await settleManagedRun(d1.db, 'run:a', 12);
    const retry = await settleManagedRun(d1.db, 'run:a', 13);
    expect(settled.state).toBe('settled');
    expect(settled.providerCostMicrousd).toBe(250_000);
    expect(retry).toEqual(settled);
  });

  it('refuses settlement above the 75% gross-margin floor', async () => {
    const d1 = memoryD1();
    await reserveManagedRun(d1.db, 'run:a', 42, 10);
    await expect(recordManagedShipSpend(d1.db, {
      runId: 'run:a', ship: 'reviewer', installationId: 42, model: '@cf/model',
      inputTokens: 1, outputTokens: 1, providerCostMicrousd: 250_001,
    }, 11)).rejects.toMatchObject({ code: 'margin-exceeded' });

    await expect(settleManagedRun(d1.db, 'run:a', 12))
      .rejects.toMatchObject({ code: 'margin-exceeded' });
    expect(d1.reservations[0].state).toBe('reserved');
  });

  it('releases only an unspent reservation and is idempotent', async () => {
    const d1 = memoryD1();
    await reserveManagedRun(d1.db, 'run:a', 42, 10);
    const released = await releaseManagedRun(d1.db, 'run:a', 11);
    const retry = await releaseManagedRun(d1.db, 'run:a', 12);
    expect(released.state).toBe('released');
    expect(retry).toEqual(released);

    await expect(reserveManagedRun(d1.db, 'run:a', 42, 13))
      .rejects.toMatchObject({ code: 'reservation-terminal' });
  });
});
