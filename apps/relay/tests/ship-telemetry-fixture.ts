/** Fixture-only recorded cloud history; never writes to a real Relay database. */
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export function seedShipTelemetry(sqlite: DatabaseSync, now = Math.floor(Date.now() / 1000)) {
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const run = sqlite.prepare('INSERT INTO fleet_runs (id,delivery_id,repo_full_name,pr_number,pr_url,head_sha,conclusion,ships_csv,ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  run.run('fixture-latest', 'fixture-latest', 'Owner/Repo', 42, 'https://github.com/owner/repo/pull/42', 'abc123', 'failure', 'purser,qa', 6000, now - 60);
  run.run('fixture-previous', 'fixture-previous', 'owner/repo', 41, 'https://github.com/owner/repo/pull/41', 'def456', 'success', 'purser', 5000, now - 86400);
  run.run('other-private', 'other-private', 'private/other', 99, '', 'xxx', 'failure', 'purser', 2000, now - 10);
  const spend = sqlite.prepare('INSERT INTO fleet_run_spend (run_id,ship,model,input_tokens,output_tokens,cost_usd,created_at) VALUES (?,?,?,?,?,?,?)');
  spend.run('fixture-latest', 'purser', '@cf/fixture-model', 4000, 500, 0.12, now - 60);
  spend.run('fixture-previous', 'purser', '@cf/fixture-model', 2000, 300, 0.06, now - 86400);
  spend.run('fixture-latest', 'qa', '@cf/no-usage', 0, 0, 0, now - 60);
  spend.run('other-private', 'purser', 'PRIVATE-MODEL', 9999, 9999, 99, now - 10);
  sqlite.prepare('INSERT INTO fleet_run_steps (run_id,seq,kind,ship,title,created_at) VALUES (?,?,?,?,?,?)').run('fixture-latest', 0, 'ship-error', 'purser', 'Sandbox test import failed; contract was not tested.', now - 30);
  sqlite.prepare('INSERT INTO fleet_run_transcripts (run_id,ship,attempt,r2_key,turns,bytes,incomplete,created_at) VALUES (?,?,?,?,?,?,?,?)').run('fixture-latest', 'purser', 2, 'private-key-never-rendered', 8, 2048, 1, now - 30);
  sqlite.prepare('INSERT INTO fleet_ai_call_stats (run_id,ship,calls,ok_calls,error_calls,timeout_calls,total_elapsed_ms,max_elapsed_ms,deadline_ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('fixture-latest', 'purser', 6, 4, 1, 1, 9000, 3000, 10000, now - 30);
}
