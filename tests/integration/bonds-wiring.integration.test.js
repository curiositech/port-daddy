/**
 * Integration tests for Bonds + Budget-Guard HTTP wiring (Track 1b).
 *
 * Exercises the HTTP state machine end-to-end:
 *   1. Wallet top-up credits the project balance.
 *   2. Manual slash transitions a bond to state=slashed.
 *   3. GET /bonds?state=slashed filter honored.
 *
 * Broadcast assertions (fleet:throttle / fleet:kill on cost-tracker hook)
 * are TODO-gated because the in-daemon hook depends on cost-tracker→guard
 * wiring that may land in a sibling branch.
 */

import http from 'node:http';
import Database from 'better-sqlite3';
import { request, getDaemonState } from '../helpers/integration-setup.js';

const PROJECT = 'bonds-wiring-test-' + Date.now();
const AGENT = 'a1-' + Date.now();

function collectSSE(channel, ms) {
  const { sockPath } = getDaemonState();
  return new Promise((resolve) => {
    const events = [];
    const req = http.request({
      socketPath: sockPath,
      path: `/msg/${encodeURIComponent(channel)}/subscribe`,
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    }, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString();
        const frames = buf.split('\n\n');
        buf = frames.pop();
        for (const frame of frames) {
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          // Skip the subscription-ack frame.
          try {
            const parsed = JSON.parse(payload);
            const keys = Object.keys(parsed);
            if (keys.length === 1 && keys[0] === 'channel') continue;
            events.push(parsed);
          } catch {
            events.push(payload);
          }
        }
      });
    });
    req.on('error', () => resolve(events));
    req.end();
    setTimeout(() => { try { req.destroy(); } catch {} resolve(events); }, ms);
  });
}

async function routeExists(method, path) {
  const res = await request(path, { method });
  return res.status !== 404;
}

describe('Bonds + Budget-Guard HTTP wiring', () => {
  let hasBondsRoutes = false;
  let hasWalletRoutes = false;

  beforeAll(async () => {
    hasBondsRoutes = await routeExists('GET', '/bonds?limit=1');
    hasWalletRoutes = await routeExists('GET', '/wallets');
    if (!hasBondsRoutes || !hasWalletRoutes) {
      console.warn('[bonds-wiring] /bonds or /wallets not registered — sibling routes branch not merged yet.');
    }
  });

  test('wallet top-up credits the project balance', async () => {
    if (!hasWalletRoutes) return;
    const topUp = await request(`/wallets/${encodeURIComponent(PROJECT)}/top-up`, {
      method: 'POST',
      body: { usd: 10 },
    });
    expect(topUp.ok).toBe(true);

    const show = await request(`/wallets/${encodeURIComponent(PROJECT)}`);
    expect(show.ok).toBe(true);
    const wallet = show.data?.wallet || show.data;
    const balance = wallet?.balance_usd ?? wallet?.balanceUsd;
    expect(typeof balance).toBe('number');
    expect(balance).toBeGreaterThanOrEqual(10);
  });

  // Regression for #172: `pd wallet show` (GET /wallets/:project) and the
  // dashboard/MCP list (GET /wallets) must agree. They diverged once when the
  // list shape silently dropped budgetUsdPerDay (fixed in 8e3a6e3f). Lock the
  // parity so neither surface can drift again: same field set, same values.
  test('GET /wallets list entry matches GET /wallets/:project (shape + value parity)', async () => {
    if (!hasWalletRoutes) return;
    // Give the wallet both a balance AND a budget — budgetUsdPerDay is the field
    // that regressed, so it must be present and equal on BOTH surfaces.
    await request(`/wallets/${encodeURIComponent(PROJECT)}/top-up`, {
      method: 'POST',
      body: { usd: 10 },
    });
    await request(`/wallets/${encodeURIComponent(PROJECT)}/budget`, {
      method: 'POST',
      body: { usdPerDay: 7 },
    });

    const single = await request(`/wallets/${encodeURIComponent(PROJECT)}`);
    expect(single.ok).toBe(true);
    const sw = single.data?.wallet || single.data;

    const list = await request('/wallets');
    expect(list.ok).toBe(true);
    const lw = (list.data?.wallets || []).find((w) => w.project === PROJECT);
    expect(lw).toBeDefined();

    // Identical field set + identical values across both surfaces.
    for (const field of ['project', 'balanceUsd', 'commonsPoolUsd', 'budgetUsdPerDay']) {
      expect(lw[field]).toBe(sw[field]);
    }
    // The budget we set must survive on BOTH surfaces (not null / not dropped).
    expect(sw.budgetUsdPerDay).toBe(7);
    expect(lw.budgetUsdPerDay).toBe(7);
  });

  test('manual slash moves bond to slashed state', async () => {
    if (!hasBondsRoutes || !hasWalletRoutes) return;

    await request(`/wallets/${encodeURIComponent(PROJECT)}/top-up`, {
      method: 'POST',
      body: { usd: 5 },
    });

    const { dbPath } = getDaemonState();
    const db = new Database(dbPath);
    try {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='bond_escrow'"
      ).all();
      if (tables.length === 0) {
        console.warn('[bonds-wiring] bond_escrow missing — schema not landed.');
        return;
      }

      const info = db.prepare(`
        INSERT INTO bond_escrow (project, agent_id, archetype, bond_usd, state, escrowed_at)
        VALUES (?, ?, ?, ?, 'running', ?)
      `).run(PROJECT, AGENT, 'qa-sentinel', 0.25, Date.now());
      const bondId = info.lastInsertRowid;

      const throttlePromise = collectSSE('fleet:throttle', 1500);

      const slash = await request(`/bonds/${bondId}/slash`, {
        method: 'POST',
        body: { portion: 0.25, reason: 'budget-breach' },
      });
      expect(slash.ok).toBe(true);

      const get = await request(`/bonds/${bondId}`);
      expect(get.ok).toBe(true);
      const bond = get.data?.bond || get.data;
      expect(bond?.state).toBe('slashed');

      await throttlePromise;
    } finally {
      db.close();
    }
  });

  test('GET /bonds filters by state=slashed', async () => {
    if (!hasBondsRoutes) return;
    const list = await request(`/bonds?project=${encodeURIComponent(PROJECT)}&state=slashed&limit=50`);
    expect(list.ok).toBe(true);
    const bonds = Array.isArray(list.data) ? list.data : (list.data?.bonds ?? []);
    expect(Array.isArray(bonds)).toBe(true);
    if (bonds.length > 0) {
      expect(bonds.every((b) => b.state === 'slashed')).toBe(true);
    }
  });
});
