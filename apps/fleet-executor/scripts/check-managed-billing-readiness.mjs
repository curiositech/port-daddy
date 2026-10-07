import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const EXPECTED_RESERVATION_COLUMNS='run_id:TEXT:0:1|installation_id:INTEGER:1:0|retail_microusd:INTEGER:1:0|provider_cost_cap_microusd:INTEGER:1:0|provider_cost_microusd:INTEGER:0:0|state:TEXT:1:0|created_at:INTEGER:1:0|updated_at:INTEGER:1:0|settled_at:INTEGER:0:0|released_at:INTEGER:0:0|lease_owner:TEXT:0:0|lease_fence:INTEGER:1:0|lease_expires_at:INTEGER:0:0';
export const EXPECTED_AUTHORIZATION_COLUMNS='authorization_id:TEXT:0:1|run_id:TEXT:1:0|lease_fence:INTEGER:1:0|call_sequence:INTEGER:1:0|attempt_id:TEXT:1:0|ship:TEXT:1:0|model:TEXT:1:0|max_input_tokens:INTEGER:1:0|max_output_tokens:INTEGER:1:0|authorized_cost_microusd:INTEGER:1:0|actual_cost_microusd:INTEGER:0:0|state:TEXT:1:0|created_at:INTEGER:1:0|reconciled_at:INTEGER:0:0';
export const EXPECTED_ENTITLEMENT_COLUMNS='installation_id:INTEGER:0:1|state:TEXT:1:0|retail_balance_microusd:INTEGER:1:0|run_retail_microusd:INTEGER:1:0|source_ref:TEXT:1:0|created_at:INTEGER:1:0|updated_at:INTEGER:1:0';
export const EXPECTED_SERVED_COLUMNS='installation_id:INTEGER:0:1|state:TEXT:1:0|source_ref:TEXT:1:0|created_at:INTEGER:1:0|updated_at:INTEGER:1:0';
export const EXPECTED_SPEND_COLUMNS='run_id:TEXT:1:1|ship:TEXT:1:2|installation_id:INTEGER:1:0|model:TEXT:1:0|input_tokens:INTEGER:1:0|output_tokens:INTEGER:1:0|provider_cost_microusd:INTEGER:1:0|created_at:INTEGER:1:0';
export const EXPECTED_FOREIGN_KEYS='authorization.run_id:fleet_run_reservations:run_id|reservation.installation_id:fleet_managed_entitlements:installation_id|served.installation_id:fleet_managed_entitlements:installation_id|spend.installation_id:fleet_managed_entitlements:installation_id|spend.run_id:fleet_run_reservations:run_id';
export const EXPECTED_INDEXES='fleet_run_call_authorizations_run_idx|fleet_run_reservations_installation_state_idx|fleet_run_spend_v2_installation_created_idx';
export const EXPECTED_GUARDS='fleet_call_auth_integer_insert|fleet_call_auth_integer_update|fleet_reservation_lease_integer_insert|fleet_reservation_lease_integer_update|fleet_spend_v2_integer_insert|fleet_spend_v2_integer_update';

export function validateTariffWitness(now=Date.now(), witnessOverride) {
  const witness=witnessOverride??JSON.parse(readFileSync(new URL('../config/workers-ai-tariff-witness.json',import.meta.url),'utf8'));
  const registry=readFileSync(new URL('../../shared/model-registry.generated.ts',import.meta.url));
  const digest=createHash('sha256').update(registry).digest('hex');
  if(witness.schemaVersion!==1||witness.sourceArtifact!=='apps/shared/model-registry.generated.ts'||typeof witness.verifiedAt!=='string'||!/^(\d{4})-(\d{2})-(\d{2})$/.test(witness.verifiedAt)) throw new Error('deployment blocked: committed tariff evidence has an invalid version, source, or date');
  const stamp=Date.parse(`${witness.verifiedAt}T00:00:00Z`);
  const age=(now-stamp)/86_400_000;
  const canonicalDate=Number.isFinite(stamp)?new Date(stamp).toISOString().slice(0,10):'';
  if(witness.registrySha256!==digest||canonicalDate!==witness.verifiedAt||age<0||age>31) throw new Error('deployment blocked: committed tariff evidence is absent, mismatched, invalid, future-dated, or older than 31 days');
  return witness;
}

export function validateReadinessRow(row) {
  if(row.entitlement_columns!==EXPECTED_ENTITLEMENT_COLUMNS||row.reservation_columns!==EXPECTED_RESERVATION_COLUMNS||row.served_columns!==EXPECTED_SERVED_COLUMNS||row.spend_columns!==EXPECTED_SPEND_COLUMNS||row.authorization_columns!==EXPECTED_AUTHORIZATION_COLUMNS||row.foreign_keys!==EXPECTED_FOREIGN_KEYS||row.indexes!==EXPECTED_INDEXES||row.guards!==EXPECTED_GUARDS||Number(row.served_count)<1||Number(row.entitled_served)!==Number(row.served_count))
    throw new Error(`deployment blocked: exact managed billing schema/entitlement preflight failed (${JSON.stringify(row)})`);
}

const columnFingerprint=(table)=>`(SELECT GROUP_CONCAT(name||':'||type||':'||\"notnull\"||':'||pk,'|') FROM (SELECT * FROM pragma_table_info('${table}') ORDER BY cid))`;
export const READINESS_SQL=`SELECT ${columnFingerprint('fleet_managed_entitlements')} AS entitlement_columns,${columnFingerprint('fleet_run_reservations')} AS reservation_columns,${columnFingerprint('fleet_served_installations')} AS served_columns,${columnFingerprint('fleet_run_spend_v2')} AS spend_columns,${columnFingerprint('fleet_run_call_authorizations')} AS authorization_columns,(SELECT GROUP_CONCAT(kind||'.'||\"from\"||':'||\"table\"||':'||\"to\",'|') FROM (SELECT 'spend' AS kind,* FROM pragma_foreign_key_list('fleet_run_spend_v2') UNION ALL SELECT 'authorization' AS kind,* FROM pragma_foreign_key_list('fleet_run_call_authorizations') UNION ALL SELECT 'reservation' AS kind,* FROM pragma_foreign_key_list('fleet_run_reservations') UNION ALL SELECT 'served' AS kind,* FROM pragma_foreign_key_list('fleet_served_installations') ORDER BY kind,\"from\")) AS foreign_keys,(SELECT GROUP_CONCAT(name,'|') FROM (SELECT name FROM sqlite_master WHERE type='index' AND name IN ('fleet_run_reservations_installation_state_idx','fleet_run_spend_v2_installation_created_idx','fleet_run_call_authorizations_run_idx') ORDER BY name)) AS indexes,(SELECT GROUP_CONCAT(name,'|') FROM (SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('fleet_call_auth_integer_insert','fleet_call_auth_integer_update','fleet_reservation_lease_integer_insert','fleet_reservation_lease_integer_update','fleet_spend_v2_integer_insert','fleet_spend_v2_integer_update') ORDER BY name)) AS guards,(SELECT COUNT(*) FROM fleet_served_installations WHERE state='served') AS served_count,(SELECT COUNT(*) FROM fleet_served_installations s JOIN fleet_managed_entitlements e USING(installation_id) WHERE s.state='served' AND length(s.source_ref)>0 AND e.state='active' AND length(e.source_ref)>0 AND e.retail_balance_microusd>=e.run_retail_microusd) AS entitled_served`;

export function assertRuntimeInventoryAuthority() {
  throw new Error('deployment blocked: no durable GitHub-installation lifecycle writer/backfill yet proves fleet_served_installations is a complete runtime inventory; provision that authority before activation');
}

export function main() {
  validateTariffWitness();
  const raw=execFileSync('npx',['wrangler','d1','execute','port-daddy-relay','--remote','--config','wrangler.deploy.toml','--json','--command',READINESS_SQL],{encoding:'utf8'});
  const row=JSON.parse(raw).flatMap(x=>x?.results??x?.result?.[0]?.results??[])[0]??{};
  validateReadinessRow(row);
  assertRuntimeInventoryAuthority();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) main();
