/**
 * A9/A10 daemon-route smoke for GET /safe/scan (ADR-0088 Phase A). This is the
 * surface the MCP `safe_scan` tool proxies to (the tool is a thin
 * `GET('/safe/scan')` in mcp/server.ts), so verifying the route's contract here
 * verifies the MCP tool's contract too.
 *
 * Asserts:
 *   - 200 + { success: true, report } with a 0-100 score, a green/amber/red
 *     state, and the VERBATIM HONEST_LIMITS footer.
 *   - the payload NEVER carries a raw secret value (only path/line/ruleId/last4).
 *   - the A5 trust ledger schema boots from the route's register step (the
 *     ledger is built once at register, not per-request).
 *
 * The route runs the REAL read-only sensors over an isolated empty $HOME so the
 * scan is hermetic (no operator dotfiles, no real codesign of host processes —
 * `ps`/`nettop`/`codesign` simply return nothing useful in this sandbox). The
 * ledger is a real better-sqlite3 :memory: handle (structurally identical to the
 * daemon's bun:sqlite handle for the TrustLedger's prepared statements); the
 * bun:sqlite-specific behaviour is pinned separately in
 * tests/bun/safe-trust-ledger-bun-sqlite.test.ts.
 */
import { describe, it, expect } from '@jest/globals';
import Fastify from 'fastify';
import Database from '../../lib/sqlite-runtime.js';
import { HONEST_LIMITS } from '../../lib/coast-guard.js';
import { safePlugin } from '../../routes/safe.js';

async function buildApp() {
  const app = Fastify();
  const db = new Database(':memory:');
  await app.register(safePlugin, { deps: { db, logger: { warn: () => {} } } });
  await app.ready();
  return { app, db };
}

describe('GET /safe/scan', () => {
  it('returns a valid posture report (200, score, state, verbatim HONEST_LIMITS)', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/safe/scan' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    const r = body.report;
    expect(typeof r.score).toBe('number');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(['green', 'amber', 'red']).toContain(r.state);
    // The load-bearing honesty check: footer is HONEST_LIMITS, verbatim.
    expect(r.honestLimits).toBe(HONEST_LIMITS);
    await app.close();
  });

  it('NEVER returns a raw secret value in the payload', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/safe/scan' });
    const blob = JSON.stringify(res.json());
    // A leak would surface as a value/secret/raw key. Findings carry only
    // path/line/ruleId/last4/entropy.
    expect(blob).not.toContain('"value":');
    expect(blob).not.toContain('"secret":');
    expect(blob).not.toContain('"rawValue":');
    await app.close();
  });

  it('builds the A5 trust-ledger schema at register (table exists)', async () => {
    const { app, db } = await buildApp();
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='safe_trust_ledger'")
      .get();
    expect(row).toBeTruthy();
    await app.close();
  });

  it('still returns a report when no ledger db is supplied (degrades, never fails)', async () => {
    const app = Fastify();
    await app.register(safePlugin, { deps: { logger: { warn: () => {} } } });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/safe/scan' });
    expect(res.statusCode).toBe(200);
    expect(res.json().report.honestLimits).toBe(HONEST_LIMITS);
    await app.close();
  });
});
