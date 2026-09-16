import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shipControlsDb } from './ship-controls-db.js';
import { seedShipTelemetry } from './ship-telemetry-fixture.js';
import { readRepoShipTelemetry, renderShipTelemetry } from '../src/repo-ship-telemetry.js';
import { readFileSync } from 'node:fs';

let store: ReturnType<typeof shipControlsDb>;
const now = 1788883200;
beforeEach(() => { store = shipControlsDb(); seedShipTelemetry(store.sqlite, now); });
afterEach(() => store.sqlite.close());

describe('repository ship telemetry', () => {
  it('scopes all evidence to the authorized case-insensitive repo, with linked transcript attempts', async () => {
    const data = await readRepoShipTelemetry(store.db, 'owner/repo', now);
    const html = renderShipTelemetry(data, 'purser');
    expect(data.available).toBe(true);
    expect(data.runs).toHaveLength(2);
    expect(html).toContain('$0.1800');
    expect(html).toContain('6800');
    expect(html).toContain('1 / 1');
    expect(html).toContain('1.5s');
    expect(html).toContain('Sandbox test import failed');
    expect(html).toContain('/fleet/runs/fixture-latest/transcript/purser?attempt=2');
    expect(html).toContain('8 turns · incomplete');
    expect(html).not.toContain('PRIVATE-MODEL');
    expect(html).not.toContain('private-key-never-rendered');
    expect(html).not.toContain('other-private');
  });
  it('does not call absent/zero cost free, or a configured-but-unseen ship running', async () => {
    const data = await readRepoShipTelemetry(store.db, 'owner/repo', now);
    const qa = renderShipTelemetry(data, 'qa');
    expect(qa).toContain('Not reported');
    expect(qa).not.toContain('$0.0000');
    expect(qa).not.toContain('Sandbox test import failed');
    expect(renderShipTelemetry(data, 'never-ran')).toContain('No recorded activity');
  });
  it('retains known failures while naming unavailable cost storage', async () => {
    store.sqlite.exec('DROP TABLE fleet_run_spend');
    const data = await readRepoShipTelemetry(store.db, 'owner/repo', now);
    expect(data.gaps).toContain('Cost ledger unavailable');
    expect(renderShipTelemetry(data, 'purser')).toContain('Sandbox test import failed');
    expect(renderShipTelemetry(data, 'purser')).toContain('Not reported');
  });
  it('escapes model and transcript output and keeps raw payloads out of the overview', async () => {
    store.sqlite.exec("UPDATE fleet_run_steps SET title = '<script>private()</script>'; UPDATE fleet_run_spend SET model = '<img src=x onerror=bad()>'");
    const html = renderShipTelemetry(await readRepoShipTelemetry(store.db, 'owner/repo', now), '*');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
  });
  it('bounds the snapshot and explicitly marks a clipped total', async () => {
    for (let i = 0; i < 205; i++) store.sqlite.prepare('INSERT INTO fleet_runs (id,delivery_id,repo_full_name,pr_number,pr_url,head_sha,conclusion,ships_csv,ms,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(`extra-${i}`, `extra-${i}`, 'owner/repo', i, '', 'a', 'neutral', 'purser', 0, now - i);
    const data = await readRepoShipTelemetry(store.db, 'owner/repo', now);
    expect(data.truncated).toBe(true);
    expect(data.runs).toHaveLength(200);
  });
  it('excludes old/future spend and bounds each independent evidence source', async () => {
    const spend = store.sqlite.prepare('INSERT INTO fleet_run_spend (run_id,ship,model,cost_usd,created_at) VALUES (?,?,?,?,?)');
    spend.run('fixture-latest', 'purser', 'outside-window', 999, now - 20 * 86400);
    spend.run('fixture-latest', 'purser', 'future', 999, now + 86400);
    let data = await readRepoShipTelemetry(store.db, 'owner/repo', now);
    expect(renderShipTelemetry(data, '*')).toContain('$0.1800');
    expect(data.spend).toHaveLength(3);
    for (let i = 0; i < 1005; i++) spend.run('fixture-latest', 'purser', 'bounded', 0.01, now - 1);
    data = await readRepoShipTelemetry(store.db, 'owner/repo', now);
    expect(data.spend).toHaveLength(1000);
    expect(data.truncated).toBe(true);
  });
  it('applies the additive migration twice and uses scoped indexes without losing history', () => {
    store.sqlite.exec('DROP INDEX fleet_runs_repo_created_idx; DROP INDEX fleet_run_spend_run_created_idx');
    const migration = readFileSync(new URL('../migrations/2026-09-08-repo-ship-telemetry.sql', import.meta.url), 'utf8');
    store.sqlite.exec(migration); store.sqlite.exec(migration);
    expect(store.sqlite.prepare('SELECT COUNT(*) AS n FROM fleet_runs').get()!.n).toBe(3);
    const plan = store.sqlite.prepare('EXPLAIN QUERY PLAN SELECT id FROM fleet_runs WHERE repo_full_name = ? COLLATE NOCASE AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 200').all('owner/repo', now - 14 * 86400, now);
    expect(JSON.stringify(plan)).toContain('fleet_runs_repo_created_idx');
  });
  it('labels missing binding or run schema unavailable, not empty healthy history', async () => {
    expect((await readRepoShipTelemetry(undefined, 'owner/repo', now)).available).toBe(false);
    store.sqlite.exec('DROP TABLE fleet_runs');
    const data = await readRepoShipTelemetry(store.db, 'owner/repo', now);
    expect(renderShipTelemetry(data, '*')).toContain('Run telemetry unavailable');
  });
});
