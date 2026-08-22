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

const tableCount = Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type = 'table'").get().n);
console.log(`relay migration chain PASS: ${migrations.length} files, ${tableCount} tables`);

db.close();
