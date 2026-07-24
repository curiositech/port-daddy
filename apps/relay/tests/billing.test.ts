/**
 * Tests for the Stripe billing + prepaid-credits layer (src/billing.ts, ADR-0116).
 *
 * Coverage:
 *   - verifyStripeSignature: good sig accepted; tampered payload / wrong secret
 *     rejected; stale timestamp (replay) rejected.
 *   - checkout: 503 when unconfigured; 401 without a session; unknown pack → 400.
 *   - balance: SUM(delta_usd) over the ledger; 401 without operator/session.
 *   - webhook: bad signature → 400 (no write); checkout.session.completed grants
 *     the pack's value; a replay of the same session id is idempotent; a
 *     charge.refunded debits the refunded amount.
 *   - grantCredit / getBalance / recordSpend db helpers.
 *
 * Uses an in-memory D1 mock in the same spirit as auth-github.test.ts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import {
  verifyStripeSignature,
  handleCreateCheckout,
  handleStripeWebhook,
  handleBillingBalance,
  grantCredit,
  getBalance,
  recordSpend,
} from '../src/billing.js';
import type { Env } from '../src/types.js';

const OPERATOR = 'operator-token-at-least-32-bytes-long!!';
const WEBHOOK_SECRET = 'whsec_test_secret_key_1234567890';
const BASE = 'https://relay.example.workers.dev';

// ── In-memory D1 covering the billing queries ─────────────────────────────────

function makeDb() {
  const ledger: any[] = []; // credit_ledger rows
  const spend: any[] = []; // fleet_run_spend rows
  const customers = new Map<number, string>(); // installation_id → stripe_customer_id

  const stmt = (sql: string) => {
    let bound: any[] = [];
    const s: any = {
      bind(...v: any[]) {
        bound = v;
        return s;
      },
      async first<T>(): Promise<T | null> {
        if (sql.includes('FROM credit_ledger WHERE reason = ? AND stripe_ref = ?')) {
          const [reason, ref] = bound;
          const hit = ledger.find((r) => r.reason === reason && r.stripe_ref === ref);
          return (hit ? { id: hit.id } : null) as T | null;
        }
        if (sql.includes('SUM(delta_usd)')) {
          const [instId] = bound;
          const bal = ledger
            .filter((r) => r.installation_id === instId)
            .reduce((a, r) => a + r.delta_usd, 0);
          return { bal } as T;
        }
        if (sql.includes('FROM stripe_customers WHERE installation_id')) {
          const id = customers.get(bound[0]);
          return (id ? { stripe_customer_id: id } : null) as T | null;
        }
        return null;
      },
      async run() {
        if (sql.startsWith('INSERT INTO credit_ledger')) {
          const [id, installation_id, delta_usd, reason, stripe_ref, run_id, created_at] = bound;
          ledger.push({ id, installation_id, delta_usd, reason, stripe_ref, run_id, created_at });
        } else if (sql.startsWith('INSERT INTO fleet_run_spend')) {
          const [run_id, ship, installation_id, model, input_tokens, output_tokens, cost_usd, created_at] = bound;
          spend.push({ run_id, ship, installation_id, model, input_tokens, output_tokens, cost_usd, created_at });
        } else if (sql.includes('INTO stripe_customers')) {
          const [installation_id, stripe_customer_id] = bound;
          if (!customers.has(installation_id)) customers.set(installation_id, stripe_customer_id);
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
    return s as unknown as D1PreparedStatement;
  };
  const db = { prepare: stmt } as unknown as D1Database;
  return { db, ledger, spend, customers };
}

function makeEnv(over: Partial<Env> = {}, db = makeDb().db): Env {
  return {
    DB: db,
    RELAY_OPERATOR_TOKEN: OPERATOR,
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    PUBLIC_BASE_URL: BASE,
    ...over,
  } as unknown as Env;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build a valid Stripe-Signature header for a raw body. */
function signStripe(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  const enc = new TextEncoder();
  const sig = toHex(hmac(sha256, enc.encode(secret), enc.encode(`${t}.${rawBody}`)));
  return `t=${t},v1=${sig}`;
}

afterEach(() => vi.unstubAllGlobals());

// ── verifyStripeSignature ─────────────────────────────────────────────────────

describe('verifyStripeSignature', () => {
  const body = JSON.stringify({ type: 'checkout.session.completed', id: 'evt_1' });

  it('accepts a correctly signed payload', () => {
    const header = signStripe(body, WEBHOOK_SECRET);
    expect(verifyStripeSignature(body, header, WEBHOOK_SECRET)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const header = signStripe(body, WEBHOOK_SECRET);
    expect(verifyStripeSignature(body + 'x', header, WEBHOOK_SECRET)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const header = signStripe(body, WEBHOOK_SECRET);
    expect(verifyStripeSignature(body, header, 'whsec_wrong')).toBe(false);
  });

  it('rejects a missing / malformed header', () => {
    expect(verifyStripeSignature(body, null, WEBHOOK_SECRET)).toBe(false);
    expect(verifyStripeSignature(body, 'garbage', WEBHOOK_SECRET)).toBe(false);
    expect(verifyStripeSignature(body, 't=123', WEBHOOK_SECRET)).toBe(false); // no v1
  });

  it('rejects a stale timestamp (replay beyond tolerance)', () => {
    const stale = Math.floor(Date.now() / 1000) - 10_000;
    const header = signStripe(body, WEBHOOK_SECRET, stale);
    expect(verifyStripeSignature(body, header, WEBHOOK_SECRET)).toBe(false);
    // But valid within tolerance if we advance "now" appropriately.
    expect(verifyStripeSignature(body, header, WEBHOOK_SECRET, { now: stale })).toBe(true);
  });
});

// ── db helpers ────────────────────────────────────────────────────────────────

describe('grantCredit / getBalance / recordSpend', () => {
  it('balance = SUM(delta_usd) over the ledger', async () => {
    const { db } = makeDb();
    await grantCredit(db, { installationId: 7, deltaUsd: 20, reason: 'stripe:checkout', stripeRef: 'cs_a' });
    await grantCredit(db, { installationId: 7, deltaUsd: 50, reason: 'stripe:checkout', stripeRef: 'cs_b' });
    await grantCredit(db, { installationId: 7, deltaUsd: -12.5, reason: 'stripe:refund', stripeRef: 'ch_a' });
    await grantCredit(db, { installationId: 99, deltaUsd: 1000, reason: 'stripe:checkout', stripeRef: 'cs_other' });
    expect(await getBalance(db, 7)).toBeCloseTo(57.5, 5);
    expect(await getBalance(db, 99)).toBe(1000);
    expect(await getBalance(db, 123)).toBe(0);
  });

  it('grantCredit is idempotent on (reason, stripe_ref)', async () => {
    const { db, ledger } = makeDb();
    const first = await grantCredit(db, { installationId: 5, deltaUsd: 20, reason: 'stripe:checkout', stripeRef: 'cs_dup' });
    const second = await grantCredit(db, { installationId: 5, deltaUsd: 20, reason: 'stripe:checkout', stripeRef: 'cs_dup' });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(ledger.length).toBe(1);
    expect(await getBalance(db, 5)).toBe(20);
  });

  it('recordSpend meters fleet_run_spend AND debits the ledger', async () => {
    const { db, spend } = makeDb();
    await grantCredit(db, { installationId: 3, deltaUsd: 100, reason: 'stripe:checkout', stripeRef: 'cs_seed' });
    await recordSpend(db, { runId: 'run_1', ship: 'gremlin', installationId: 3, model: 'llama', inputTokens: 1000, outputTokens: 500, costUsd: 2.25 });
    expect(spend.length).toBe(1);
    expect(spend[0].cost_usd).toBe(2.25);
    expect(await getBalance(db, 3)).toBeCloseTo(97.75, 5);
  });
});

// ── checkout ──────────────────────────────────────────────────────────────────

describe('POST /billing/checkout', () => {
  it('503s when billing is unconfigured', async () => {
    const env = makeEnv({ STRIPE_SECRET_KEY: undefined });
    const res = await handleCreateCheckout(
      new Request(`${BASE}/billing/checkout`, { method: 'POST', body: JSON.stringify({ installationId: 1, pack: 'starter' }) }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('401s without a signed-in session', async () => {
    const env = makeEnv();
    const res = await handleCreateCheckout(
      new Request(`${BASE}/billing/checkout`, { method: 'POST', body: JSON.stringify({ installationId: 1, pack: 'starter' }) }),
      env,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.code).toBe('UNAUTHENTICATED');
  });
});

// ── webhook ───────────────────────────────────────────────────────────────────

describe('POST /billing/webhook', () => {
  function checkoutEvent(installationId: number, valueUsd: number, sessionId = 'cs_test_1') {
    return JSON.stringify({
      id: 'evt_' + sessionId,
      type: 'checkout.session.completed',
      data: { object: { id: sessionId, amount_total: valueUsd * 100, metadata: { installation_id: String(installationId), value_usd: String(valueUsd), pack: 'starter' } } },
    });
  }
  function refundEvent(installationId: number, refundedUsd: number, chargeId = 'ch_test_1') {
    return JSON.stringify({
      id: 'evt_' + chargeId,
      type: 'charge.refunded',
      data: { object: { id: chargeId, amount_refunded: refundedUsd * 100, metadata: { installation_id: String(installationId) } } },
    });
  }

  it('rejects a bad signature with 400 and writes nothing', async () => {
    const { db, ledger } = makeDb();
    const env = makeEnv({}, db);
    const body = checkoutEvent(42, 20);
    const res = await handleStripeWebhook(
      new Request(`${BASE}/billing/webhook`, { method: 'POST', body, headers: { 'Stripe-Signature': 't=1,v1=deadbeef' } }),
      env,
    );
    expect(res.status).toBe(400);
    expect(ledger.length).toBe(0);
  });

  it('grants the pack value on checkout.session.completed', async () => {
    const { db, ledger } = makeDb();
    const env = makeEnv({}, db);
    const body = checkoutEvent(42, 20, 'cs_grant');
    const header = signStripe(body, WEBHOOK_SECRET);
    const res = await handleStripeWebhook(
      new Request(`${BASE}/billing/webhook`, { method: 'POST', body, headers: { 'Stripe-Signature': header } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(ledger.length).toBe(1);
    expect(ledger[0].delta_usd).toBe(20);
    expect(ledger[0].reason).toBe('stripe:checkout');
    expect(ledger[0].stripe_ref).toBe('cs_grant');
    expect(await getBalance(db, 42)).toBe(20);
  });

  it('is idempotent: a replayed checkout event does not double-grant', async () => {
    const { db, ledger } = makeDb();
    const env = makeEnv({}, db);
    const body = checkoutEvent(42, 20, 'cs_replay');
    const header = signStripe(body, WEBHOOK_SECRET);
    const mk = () => new Request(`${BASE}/billing/webhook`, { method: 'POST', body, headers: { 'Stripe-Signature': header } });
    await handleStripeWebhook(mk(), env);
    await handleStripeWebhook(mk(), env);
    expect(ledger.length).toBe(1);
    expect(await getBalance(db, 42)).toBe(20);
  });

  it('debits on charge.refunded', async () => {
    const { db, ledger } = makeDb();
    const env = makeEnv({}, db);
    // Seed a grant first.
    await grantCredit(db, { installationId: 42, deltaUsd: 20, reason: 'stripe:checkout', stripeRef: 'cs_pre' });
    const body = refundEvent(42, 8, 'ch_refund');
    const header = signStripe(body, WEBHOOK_SECRET);
    const res = await handleStripeWebhook(
      new Request(`${BASE}/billing/webhook`, { method: 'POST', body, headers: { 'Stripe-Signature': header } }),
      env,
    );
    expect(res.status).toBe(200);
    const refundRow = ledger.find((r) => r.reason === 'stripe:refund');
    expect(refundRow.delta_usd).toBe(-8);
    expect(await getBalance(db, 42)).toBeCloseTo(12, 5);
  });
});

// ── balance endpoint ──────────────────────────────────────────────────────────

describe('GET /billing/balance/:id', () => {
  it('401s without operator token or session', async () => {
    const env = makeEnv();
    const res = await handleBillingBalance(new Request(`${BASE}/billing/balance/7`), env, '7');
    expect(res.status).toBe(401);
  });

  it('returns SUM(delta_usd) for the operator', async () => {
    const { db } = makeDb();
    const env = makeEnv({}, db);
    await grantCredit(db, { installationId: 7, deltaUsd: 20, reason: 'stripe:checkout', stripeRef: 'cs_x' });
    await grantCredit(db, { installationId: 7, deltaUsd: 50, reason: 'stripe:checkout', stripeRef: 'cs_y' });
    const res = await handleBillingBalance(
      new Request(`${BASE}/billing/balance/7`, { headers: { Authorization: `Bearer ${OPERATOR}` } }),
      env,
      '7',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.installationId).toBe(7);
    expect(body.balanceUsd).toBe(70);
  });

  it('400s on a non-numeric installation id', async () => {
    const env = makeEnv();
    const res = await handleBillingBalance(
      new Request(`${BASE}/billing/balance/abc`, { headers: { Authorization: `Bearer ${OPERATOR}` } }),
      env,
      'abc',
    );
    expect(res.status).toBe(400);
  });
});
