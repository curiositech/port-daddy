import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = join(APP_ROOT, 'migrations');
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter(name => name.endsWith('.sql'))
  .sort();

// The chain's order IS the sort above, so the filenames carry the order and a
// name without a date silently jumps the queue: `add-work-notes.sql` sorts
// before every dated migration and would run ahead of the baseline that
// creates the tables it references. Every one of the migrations here is
// ISO-prefixed today, and two days already use a letter after the date
// (`-x3-`, `-y1-`, `-z-`) to fix order within one day, so the convention is
// real and relied upon -- it was simply never asserted.
const undated = migrations.filter(name => !/^\d{4}-\d{2}-\d{2}-/.test(name));
if (undated.length > 0) {
  throw new Error(
    'every relay migration must start with an ISO date, because the apply order is the ' +
      `filename sort and an undated name runs first: ${undated.join(', ')}`,
  );
}

const baseline = '2026-08-08-relay-baseline.sql';
const firstDependent = '2026-08-09-executor-identity.sql';
if (!migrations.includes(baseline) || migrations.indexOf(baseline) >= migrations.indexOf(firstDependent)) {
  throw new Error(`${baseline} must exist and sort before ${firstDependent}`);
}

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');

for (const name of migrations) {
  const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
  try {
    db.exec('BEGIN');
    db.exec(sql);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    throw new Error(`relay migration chain failed at ${name}: ${String(error)}`, { cause: error });
  }
}

function requireTable(name) {
  const row = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name);
  if (!row) throw new Error(`relay migration chain did not create required table ${name}`);
  return String(row.sql ?? '');
}

function requireColumn(table, column) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name));
  if (!columns.includes(column)) {
    throw new Error(`relay migration chain did not create required column ${table}.${column}`);
  }
}

const identitiesSql = requireTable('identities');
if (!identitiesSql.includes('operator-provisioned')) {
  throw new Error('relay migration chain did not widen identities.proof_method');
}
requireTable('fleet_run_intents');
requireTable('fleet_runs');
requireTable('fleet_run_steps');
requireTable('events');
requireTable('users');
const fleetAccountsSql = requireTable('fleet_accounts');
const fleetMembersSql = requireTable('fleet_account_members');
const fleetTenantRepositoriesSql = requireTable('fleet_tenant_repositories');
for (const column of ['id', 'status', 'created_at', 'updated_at']) requireColumn('fleet_accounts', column);
for (const column of ['tenant_account_id', 'user_id', 'role']) requireColumn('fleet_account_members', column);
for (const column of [
  'tenant_account_id', 'installation_id', 'repository_id', 'github_account_id', 'active',
]) requireColumn('fleet_tenant_repositories', column);
if (!fleetAccountsSql.includes("'active'") || !fleetAccountsSql.includes("'suspended'")) {
  throw new Error('fleet_accounts.status lost its closed lifecycle CHECK');
}
if (!fleetMembersSql.includes("'owner'") || !fleetMembersSql.includes("'member'")) {
  throw new Error('fleet_account_members.role lost its closed role CHECK');
}
for (const id of ['installation_id', 'repository_id', 'github_account_id']) {
  if (!fleetTenantRepositoriesSql.includes(`typeof(${id}) = 'integer'`)
    || !fleetTenantRepositoriesSql.includes(`${id} > 0`)) {
    throw new Error(`fleet_tenant_repositories.${id} lost its positive-integer CHECK`);
  }
}
const activeTenantIdentityIndex = db.prepare(
  "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = 'fleet_tenant_repositories_active_identity_idx'",
).get();
if (!String(activeTenantIdentityIndex?.sql ?? '').includes('WHERE active = 1')) {
  throw new Error('fleet tenant identity lost its one-active-binding unique index');
}
for (const trigger of [
  'fleet_accounts_immutable_id',
  'fleet_account_members_immutable_ids',
  'fleet_tenant_repositories_immutable_ids',
]) {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'trigger' AND name = ?").get(trigger)) {
    throw new Error(`relay migration chain did not create immutable identity trigger ${trigger}`);
  }
}
const onboardingSql = requireTable('fleet_repository_onboarding');
const proposalsSql = requireTable('fleet_configuration_proposals');
for (const column of [
  'tenant_account_id', 'installation_id', 'repository_id', 'requested_by_user_id',
  'desired_outcomes_json', 'customer_budget_microusd', 'provider_cost_cap_microusd',
  'margin_floor_bps', 'config_status', 'execution_status',
]) requireColumn('fleet_repository_onboarding', column);
for (const column of ['tenant_account_id', 'installation_id', 'repository_id', 'proposal_json', 'status']) {
  requireColumn('fleet_configuration_proposals', column);
}
if (!onboardingSql.includes("execution_status = 'blocked_pending_executor'")) {
  throw new Error('fleet onboarding can activate without executor tenant validation');
}
if (!onboardingSql.includes('margin_floor_bps BETWEEN 7500 AND 10000')) {
  throw new Error('fleet onboarding lost the platform 75 percent margin floor');
}
if (!onboardingSql.includes('provider_cost_cap_microusd * 10000')) {
  throw new Error('fleet onboarding lost the budget-to-provider-cost constraint');
}
if (!proposalsSql.includes("'accepted'") || !proposalsSql.includes("'superseded'")) {
  throw new Error('fleet proposal lifecycle lost its closed status set');
}
if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = 'fleet_configuration_proposals_one_accepted_idx'").get()) {
  throw new Error('fleet proposals lost their one-accepted-per-repository index');
}
for (const trigger of [
  'fleet_repository_onboarding_immutable_scope',
  'fleet_configuration_proposals_immutable_scope',
]) {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'trigger' AND name = ?").get(trigger)) {
    throw new Error(`fleet onboarding lost immutable authority trigger ${trigger}`);
  }
}
requireColumn('parleys', 'convened_by');
requireColumn('parleys', 'outcome_json');
requireColumn('harbor_helms', 'parley_expiry_default');
requireColumn('mercy_health', 'hooks_json');

// Managed Fleet stop-loss: explicit entitlement, one deterministic reservation
// per run, integer micro-USD, and a fresh v2 spend identity. Do not retrofit a
// uniqueness constraint onto the legacy spend table: deployed history may have
// duplicate retry rows.
const managedEntitlementsSql = requireTable('fleet_managed_entitlements');
const managedReservationsSql = requireTable('fleet_run_reservations');
const managedSpendSql = requireTable('fleet_run_spend_v2');
requireTable('fleet_run_call_authorizations');
requireTable('fleet_served_installations');
for (const column of ['retail_balance_microusd', 'run_retail_microusd', 'source_ref']) {
  requireColumn('fleet_managed_entitlements', column);
}
for (const column of [
  'retail_microusd', 'provider_cost_cap_microusd', 'provider_cost_microusd',
  'state', 'settled_at', 'released_at',
]) requireColumn('fleet_run_reservations', column);
requireColumn('fleet_run_spend_v2', 'provider_cost_microusd');
if (!managedEntitlementsSql.includes("'active'") || !managedReservationsSql.includes("'settled'")) {
  throw new Error('managed billing state enums are not storage-enforced');
}
if (!managedReservationsSql.includes('provider_cost_cap_microusd * 4 <= retail_microusd')) {
  throw new Error('managed billing lost the 75% gross-margin floor');
}
for (const sql of [managedEntitlementsSql, managedReservationsSql, managedSpendSql]) {
  if (!sql.includes("typeof(") || !sql.includes("'integer'")) {
    throw new Error('managed billing money/token fields must be storage-enforced integers');
  }
}
db.exec(`INSERT INTO fleet_managed_entitlements
  (installation_id, state, retail_balance_microusd, run_retail_microusd, source_ref, created_at, updated_at)
 VALUES (4242, 'active', 2000000, 1000000, 'migration-check', 1, 1)`);
db.exec(`INSERT INTO fleet_run_reservations
  (run_id, installation_id, retail_microusd, provider_cost_cap_microusd, state, created_at, updated_at)
 VALUES ('billing-check', 4242, 1000000, 250000, 'reserved', 1, 1)`);
db.exec(`INSERT INTO fleet_run_spend_v2
  (run_id, ship, installation_id, model, input_tokens, output_tokens, provider_cost_microusd, created_at)
 VALUES ('billing-check', 'reviewer', 4242, '@cf/check', 1, 1, 250000, 1)`);
for (const bad of [
  `INSERT INTO fleet_managed_entitlements
    (installation_id, state, retail_balance_microusd, run_retail_microusd, source_ref, created_at, updated_at)
   VALUES (4243, 'active', 1.5, 1, 'bad', 1, 1)`,
  `INSERT INTO fleet_run_reservations
    (run_id, installation_id, retail_microusd, provider_cost_cap_microusd, state, created_at, updated_at)
   VALUES ('billing-bad-margin', 4242, 100, 26, 'reserved', 1, 1)`,
  `INSERT INTO fleet_run_spend_v2
    (run_id, ship, installation_id, model, input_tokens, output_tokens, provider_cost_microusd, created_at)
   VALUES ('billing-check', 'bad', 4242, '@cf/check', 1, 1, 1.5, 1)`,
  `UPDATE fleet_run_reservations SET lease_fence = 1.5 WHERE run_id = 'billing-check'`,
  `INSERT INTO fleet_run_call_authorizations
    (authorization_id, run_id, lease_fence, call_sequence, attempt_id, ship, model,
     max_input_tokens, max_output_tokens, authorized_cost_microusd, state, created_at)
   VALUES ('billing-bad-call', 'billing-check', 1, 1, 'a', 'reviewer', '@cf/check', 1.5, 1, 1, 'authorized', 1)`,
]) {
  let rejected = false;
  try { db.exec(bad); } catch { rejected = true; }
  if (!rejected) throw new Error('managed billing constraints admitted invalid money state');
}
db.exec(`UPDATE fleet_run_reservations SET lease_fence = 1 WHERE run_id = 'billing-check'`);
db.exec(`UPDATE fleet_run_spend_v2 SET provider_cost_microusd = 1 WHERE run_id = 'billing-check'`);
let badSpendUpdateRejected = false;
try { db.exec(`UPDATE fleet_run_spend_v2 SET provider_cost_microusd = 1.5 WHERE run_id = 'billing-check'`); }
catch { badSpendUpdateRejected = true; }
if (!badSpendUpdateRejected) throw new Error('managed billing update guards admitted non-integer spend');

// repo_settings (/account/repos): the SITREP dial must stay a closed enum at
// the storage layer — the Worker trusts the CHECK as its last line of defense.
const repoSettingsSql = requireTable('repo_settings');
requireColumn('repo_settings', 'sitrep_end_of_turn');
requireColumn('repo_settings', 'settings_json');
for (const level of ['off', 'suggest', 'enforce']) {
  if (!repoSettingsSql.includes(`'${level}'`)) {
    throw new Error(`repo_settings.sitrep_end_of_turn CHECK is missing level '${level}'`);
  }
}
if (!repoSettingsSql.includes('json_valid')) {
  throw new Error('repo_settings.settings_json lost its json_valid CHECK');
}
// Prove both CHECKs bite at the storage layer, not just parse.
db.exec("INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_chk', 1, 'chk', 0)");
for (const bad of [
  `INSERT INTO repo_settings (user_id, repo_full_name, sitrep_end_of_turn, created_at, updated_at)
     VALUES ('u_chk', 'a/b', 'loudly', 0, 0)`,
  `INSERT INTO repo_settings (user_id, repo_full_name, settings_json, created_at, updated_at)
     VALUES ('u_chk', 'a/b', 'not json', 0, 0)`,
]) {
  let rejected = false;
  try { db.exec(bad); } catch { rejected = true; }
  if (!rejected) throw new Error('repo_settings CHECK constraints did not reject an invalid row');
}
db.exec("DELETE FROM repo_settings WHERE user_id = 'u_chk'");
db.exec("DELETE FROM users WHERE id = 'u_chk'");

// Roadmap command-center mirror (operator mandate 2026-08-22, PR 1): the
// board's lane enum, the edge-type enum, and the JSON bags are all CHECK-
// enforced at the storage layer — the Worker trusts them as its last line of
// defense, so prove they exist AND that they bite (negative-insert probes).
requireTable('roadmap_mirrors');
requireColumn('roadmap_mirrors', 'generated_at');   // daemon-clock watermark (ms)
requireColumn('roadmap_mirrors', 'received_at');    // relay-clock arrival (s)
requireColumn('roadmap_mirrors', 'harbor_id');
const mirrorItemsSql = requireTable('roadmap_mirror_items');
requireColumn('roadmap_mirror_items', 'deleted_at'); // tombstones are data
for (const lane of ['now', 'backlog', 'parked', 'merge', 'done']) {
  if (!mirrorItemsSql.includes(`'${lane}'`)) {
    throw new Error(`roadmap_mirror_items.status CHECK is missing lane '${lane}'`);
  }
}
if ((mirrorItemsSql.match(/json_valid/g) ?? []).length < 2) {
  throw new Error('roadmap_mirror_items lost a json_valid CHECK (dependencies_json / notes_json)');
}
const mirrorEdgesSql = requireTable('roadmap_mirror_edges');
for (const et of ['parent_of', 'depends_on']) {
  if (!mirrorEdgesSql.includes(`'${et}'`)) {
    throw new Error(`roadmap_mirror_edges.edge_type CHECK is missing '${et}'`);
  }
}
const mirrorActivitySql = requireTable('roadmap_mirror_activity');
// `at` is the watermark AND part of the PK AND the tail/cap sort key — the
// CHECK that keeps a text or negative timestamp out is what makes the
// ordering hold, not cosmetic.
if (!mirrorActivitySql.includes("typeof(at) = 'integer'") || !mirrorActivitySql.includes('at > 0')) {
  throw new Error('roadmap_mirror_activity.at lost its typeof/positivity CHECK');
}
// Prove the CHECKs bite at the storage layer, not just parse.
db.exec("INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_rm_chk', 2, 'rmchk', 0)");
for (const bad of [
  // status outside the closed lane enum
  `INSERT INTO roadmap_mirror_items (user_id, repo_full_name, slug, harbor, status, summary_md, last_touched_at, created_at)
     VALUES ('u_rm_chk', 'a/b', 's1', 'h', 'someday', 'x', 0, 0)`,
  // dependencies_json must be valid JSON
  `INSERT INTO roadmap_mirror_items (user_id, repo_full_name, slug, harbor, status, summary_md, last_touched_at, created_at, dependencies_json)
     VALUES ('u_rm_chk', 'a/b', 's1', 'h', 'now', 'x', 0, 0, 'not json')`,
  // notes_json must be valid JSON
  `INSERT INTO roadmap_mirror_items (user_id, repo_full_name, slug, harbor, status, summary_md, last_touched_at, created_at, notes_json)
     VALUES ('u_rm_chk', 'a/b', 's1', 'h', 'now', 'x', 0, 0, 'not json')`,
  // edge_type outside the closed enum
  `INSERT INTO roadmap_mirror_edges (user_id, repo_full_name, scope, source_id, edge_type, target_id)
     VALUES ('u_rm_chk', 'a/b', 'roadmap', 's1', 'blocks', 's2')`,
  // activity `at` must be a POSITIVE INTEGER: a negative, zero, non-integer,
  // or text timestamp would corrupt the tail ordering and the cap prune.
  `INSERT INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind)
     VALUES ('u_rm_chk', 'a/b', -1, 's1', 'touch')`,
  `INSERT INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind)
     VALUES ('u_rm_chk', 'a/b', 0, 's1', 'touch')`,
  `INSERT INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind)
     VALUES ('u_rm_chk', 'a/b', 1.5, 's1', 'touch')`,
  `INSERT INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind)
     VALUES ('u_rm_chk', 'a/b', 'not-a-timestamp', 's1', 'touch')`,
]) {
  let rejected = false;
  try { db.exec(bad); } catch { rejected = true; }
  if (!rejected) throw new Error('roadmap mirror CHECK constraints did not reject an invalid row');
}
// And that well-formed rows (tombstone + a real activity timestamp) land.
db.exec(`INSERT INTO roadmap_mirror_items (user_id, repo_full_name, slug, harbor, status, summary_md, last_touched_at, created_at, deleted_at)
     VALUES ('u_rm_chk', 'a/b', 's1', 'h', 'done', 'x', 0, 0, 5)`);
db.exec(`INSERT INTO roadmap_mirror_activity (user_id, repo_full_name, at, slug, kind)
     VALUES ('u_rm_chk', 'a/b', 1755800000000, 's1', 'touch')`);
db.exec("DELETE FROM roadmap_mirror_activity WHERE user_id = 'u_rm_chk'");
db.exec("DELETE FROM roadmap_mirror_items WHERE user_id = 'u_rm_chk'");
db.exec("DELETE FROM users WHERE id = 'u_rm_chk'");

// Harbor Work Register task grants: browser approval stores no raw credential,
// and an exchange cannot be represented as half-minted state.
const registerGrantsSql = requireTable('work_register_grants');
for (const column of [
  'pairing_code_hash', 'token_hash', 'repo_full_name', 'agent', 'owner',
  'exchange_expires_at', 'exchanged_at', 'token_expires_at', 'revoked_at',
]) requireColumn('work_register_grants', column);
if (!registerGrantsSql.includes('token_expires_at > exchanged_at')) {
  throw new Error('work_register_grants lost the complete-exchange CHECK');
}
db.exec("INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_wrg_chk', 4, 'wrgchk', 0)");
for (const bad of [
  `INSERT INTO work_register_grants
     (id, user_id, repo_full_name, agent, owner, pairing_code_hash, created_at, exchange_expires_at)
   VALUES ('wrg_bad1', 'u_wrg_chk', 'a/b', '', '@wrgchk', 'pair1', 1, 2)`,
  `INSERT INTO work_register_grants
     (id, user_id, repo_full_name, agent, owner, pairing_code_hash, token_hash,
      created_at, exchange_expires_at)
   VALUES ('wrg_bad2', 'u_wrg_chk', 'a/b', 'task', '@wrgchk', 'pair2', 'token2', 1, 2)`,
]) {
  let rejected = false;
  try { db.exec(bad); } catch { rejected = true; }
  if (!rejected) throw new Error('work_register_grants CHECK constraints admitted invalid authority state');
}
db.exec(`INSERT INTO work_register_grants
  (id, user_id, repo_full_name, agent, owner, pairing_code_hash, created_at, exchange_expires_at)
 VALUES ('wrg_chk', 'u_wrg_chk', 'a/b', 'task', '@wrgchk', 'pair', 1, 2)`);
let duplicatePairRejected = false;
try {
  db.exec(`INSERT INTO work_register_grants
    (id, user_id, repo_full_name, agent, owner, pairing_code_hash, created_at, exchange_expires_at)
   VALUES ('wrg_chk2', 'u_wrg_chk', 'a/b', 'task2', '@wrgchk', 'pair', 1, 2)`);
} catch { duplicatePairRejected = true; }
if (!duplicatePairRejected) throw new Error('work_register_grants pairing hash is not unique');
db.exec("DELETE FROM work_register_grants WHERE user_id = 'u_wrg_chk'");
db.exec("DELETE FROM users WHERE id = 'u_wrg_chk'");

// Harbor invites + the ADR-0122 §4 authority-epoch clock (2026-08-23):
// single-use is CAS on consumed_at IS NULL in the Worker, but the storage
// layer carries its own guarantees — prove each one bites, not just parses.
const invitesSql = requireTable('harbor_invites');
requireColumn('harbor_invites', 'token_hash');   // only the hash is ever stored
requireColumn('harbor_invites', 'consumed_at');  // the CAS column
requireColumn('harbor_invites', 'revoked_at');   // invariant I3: revocable
requireColumn('harbor_invites', 'expires_at');   // invariant I3: bounded by exp
requireColumn('harbors', 'authority_epoch');     // the membership-change clock
if (!invitesSql.includes("role = 'member'")) {
  throw new Error("harbor_invites.role lost its CHECK (role = 'member') — invariant I4");
}
db.exec("INSERT INTO users (id, github_user_id, login, created_at) VALUES ('u_hi_chk', 3, 'hichk', 0)");
db.exec("INSERT INTO harbors (id, namespace, name, pubkey, created_by, created_at) VALUES ('h_hi_chk', 'hichk', 'dock', 'ab', 'u_hi_chk', 0)");
// A harbor row inserted WITHOUT naming the new column lands at epoch 1 — a
// rolled-back Worker keeps writing harbors and every row still has a clock.
const epoch = db.prepare("SELECT authority_epoch AS e FROM harbors WHERE id = 'h_hi_chk'").get().e;
if (Number(epoch) !== 1) throw new Error(`harbors.authority_epoch default is ${epoch}, expected 1`);
for (const bad of [
  // an invite may only ever grant plain membership (invariant I4)
  `INSERT INTO harbor_invites (jti, harbor_id, token_hash, invited_by, role, created_at, expires_at)
     VALUES ('hi_bad', 'h_hi_chk', 'th_bad', 'u_hi_chk', 'owner', 0, 10)`,
  // an invite without an expiry is unmintable (invariant I3)
  `INSERT INTO harbor_invites (jti, harbor_id, token_hash, invited_by, created_at)
     VALUES ('hi_bad2', 'h_hi_chk', 'th_bad2', 'u_hi_chk', 0)`,
]) {
  let rejected = false;
  try { db.exec(bad); } catch { rejected = true; }
  if (!rejected) throw new Error('harbor_invites CHECK/NOT NULL constraints did not reject an invalid row');
}
// token_hash is UNIQUE: two invites can never share a bearer token.
db.exec(`INSERT INTO harbor_invites (jti, harbor_id, token_hash, invited_by, created_at, expires_at)
     VALUES ('hi_chk1', 'h_hi_chk', 'th_chk', 'u_hi_chk', 0, 10)`);
let dupRejected = false;
try {
  db.exec(`INSERT INTO harbor_invites (jti, harbor_id, token_hash, invited_by, created_at, expires_at)
     VALUES ('hi_chk2', 'h_hi_chk', 'th_chk', 'u_hi_chk', 0, 10)`);
} catch { dupRejected = true; }
if (!dupRejected) throw new Error('harbor_invites.token_hash UNIQUE did not reject a duplicate');
db.exec("DELETE FROM harbor_invites WHERE harbor_id = 'h_hi_chk'");
db.exec("DELETE FROM harbors WHERE id = 'h_hi_chk'");
db.exec("DELETE FROM users WHERE id = 'u_hi_chk'");

const tableCount = Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type = 'table'").get().n);
console.log(`relay migration chain PASS: ${migrations.length} files, ${tableCount} tables`);

db.close();
