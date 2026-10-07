import { describe,expect,it } from 'vitest';
// @ts-expect-error deployment preflight is intentionally executable ESM
import { assertRuntimeInventoryAuthority,EXPECTED_AUTHORIZATION_COLUMNS,EXPECTED_ENTITLEMENT_COLUMNS,EXPECTED_FOREIGN_KEYS,EXPECTED_GUARDS,EXPECTED_INDEXES,EXPECTED_RESERVATION_COLUMNS,EXPECTED_SERVED_COLUMNS,EXPECTED_SPEND_COLUMNS,READINESS_SQL,validateReadinessRow,validateTariffWitness } from '../scripts/check-managed-billing-readiness.mjs';
import { applyAllMigrations,makeDb } from '../../relay/tests/helpers/d1-sqlite.js';

const readyRow={
  entitlement_columns:EXPECTED_ENTITLEMENT_COLUMNS,
  reservation_columns:EXPECTED_RESERVATION_COLUMNS,
  served_columns:EXPECTED_SERVED_COLUMNS,
  spend_columns:EXPECTED_SPEND_COLUMNS,
  authorization_columns:EXPECTED_AUTHORIZATION_COLUMNS,
  foreign_keys:EXPECTED_FOREIGN_KEYS,
  indexes:EXPECTED_INDEXES,
  guards:EXPECTED_GUARDS,
  served_count:1,
  entitled_served:1,
};

describe('managed billing deploy readiness',()=>{
  it('accepts the committed current tariff witness',()=>expect(validateTariffWitness(Date.parse('2026-09-14T12:00:00Z'))).toMatchObject({verifiedAt:'2026-09-14'}));
  it('rejects a future or stale tariff witness',()=>{
    expect(()=>validateTariffWitness(Date.parse('2026-09-13T00:00:00Z'))).toThrow(/tariff evidence/);
    expect(()=>validateTariffWitness(Date.parse('2026-10-16T00:00:00Z'))).toThrow(/tariff evidence/);
  });
  it('rejects non-finite and calendar-invalid tariff dates',()=>{
    const valid=validateTariffWitness(Date.parse('2026-09-14T12:00:00Z'));
    expect(()=>validateTariffWitness(Date.now(),{...valid,verifiedAt:'not-a-date'})).toThrow(/invalid/);
    expect(()=>validateTariffWitness(Date.now(),{...valid,verifiedAt:'2026-02-31'})).toThrow(/invalid/);
  });
  it('requires exact schema witnesses and a nonempty fully entitled roster',()=>{
    expect(()=>validateReadinessRow(readyRow)).not.toThrow();
    expect(()=>validateReadinessRow({...readyRow,served_count:0,entitled_served:0})).toThrow(/schema\/entitlement/);
    expect(()=>validateReadinessRow({...readyRow,reservation_columns:'wrong'})).toThrow(/schema\/entitlement/);
    expect(()=>validateReadinessRow({...readyRow,foreign_keys:'wrong'})).toThrow(/schema\/entitlement/);
    expect(()=>validateReadinessRow({...readyRow,guards:'wrong'})).toThrow(/schema\/entitlement/);
  });
  it('fingerprints the real migration chain by exact columns, foreign keys, indexes, and guards',()=>{
    const real=makeDb(applyAllMigrations());
    real.exec(`INSERT INTO fleet_managed_entitlements VALUES(42,'active',2000000,1000000,'test',1,1);
      INSERT INTO fleet_served_installations VALUES(42,'served','github-installation-event:test',1,1)`);
    const row=real.raw.prepare(READINESS_SQL).get();
    expect(()=>validateReadinessRow(row)).not.toThrow();
    real.raw.close();
  });
  it('keeps activation closed until the runtime inventory writer and backfill exist',()=>{
    expect(()=>assertRuntimeInventoryAuthority()).toThrow(/lifecycle writer\/backfill/);
  });
});
