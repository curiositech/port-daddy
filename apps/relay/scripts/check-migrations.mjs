import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = join(APP_ROOT, 'migrations');
const migrations = readdirSync(MIGRATIONS_DIR)
  .filter(name => name.endsWith('.sql'))
  .sort();

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
requireColumn('parleys', 'convened_by');
requireColumn('parleys', 'outcome_json');
requireColumn('harbor_helms', 'parley_expiry_default');
requireColumn('mercy_health', 'hooks_json');

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
// CHECK that keeps a text or negative timestamp out is load-bearing for
// ordering, not cosmetic.
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
