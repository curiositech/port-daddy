/**
 * Port Daddy Relay — Stripe billing + prepaid credits (ADR-0116).
 *
 * The relay is the BILLING AUTHORITY. It holds STRIPE_SECRET_KEY and talks to
 * the Stripe REST API directly over `fetch` (form-encoded bodies, Bearer auth) —
 * the `stripe` npm SDK is deliberately NOT a dependency, because a Cloudflare
 * Worker cannot ship its Node built-ins and every call we need is a single POST.
 *
 * Money model: one-time CREDIT PACKS. A customer buys a pack via Stripe Checkout;
 * on `checkout.session.completed` we append a POSITIVE `credit_ledger` row; on
 * `charge.refunded` we append a NEGATIVE one. An installation's balance is simply
 * SUM(delta_usd) over its ledger. Fleet runs meter token spend into
 * `fleet_run_spend` and mirror it as a negative ledger entry (reason='fleet:spend').
 *
 * Endpoints:
 *   POST /billing/checkout            — session-authed; body {installationId, pack} → {url}
 *   POST /billing/webhook             — Stripe-Signature HMAC gate; ledger writes
 *   GET  /billing/balance/:id         — operator OR session; {installationId, balanceUsd}
 *   POST /billing/portal              — session-authed; Stripe Billing Portal {url}
 *
 * Fail CLOSED: unconfigured billing → 503; bad webhook signature → 400, no write.
 */

import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { timingSafeEqual, toHex, randomHex } from './crypto.js';
import { operatorOnly } from './handlers.js';
import { resolveSession, userOwnsInstallation } from './auth-github.js';
import type { Env, RelayError } from './types.js';

// ── Credit packs (predefined; amounts in USD dollars) ─────────────────────────
//
// value_usd is what a purchase grants to the ledger (== the price charged). The
// "credits-cents" framing in the ADR is just value_usd * 100. Packs are a closed
// enum the caller can only pick from — never a caller-supplied amount.
export interface CreditPack {
  id: string;
  label: string;
  valueUsd: number; // dollars granted == charged
}

export const CREDIT_PACKS: Record<string, CreditPack> = {
  starter: { id: 'starter', label: 'Starter — $20 credit', valueUsd: 20 },
  pro: { id: 'pro', label: 'Pro — $50 credit', valueUsd: 50 },
  team: { id: 'team', label: 'Team — $200 credit', valueUsd: 200 },
};

// ── Response helpers ──────────────────────────────────────────────────────────

function err(code: string, detail: string, status = 400): Response {
  const body: RelayError = { error: detail, code };
  return Response.json(body, { status });
}

/**
 * An Env in which Stripe billing is fully configured. `billingConfigured`
 * narrows Env to this so downstream reads the two secrets as `string`.
 */
type ConfiguredBillingEnv = Env & {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
};

function billingConfigured(env: Env): env is ConfiguredBillingEnv {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

const STRIPE_API = 'https://api.stripe.com/v1';

/**
 * POST to the Stripe REST API with a form-encoded body + Bearer auth. Nested
 * params use Stripe's bracket convention (`a[b]=c`); `formEncode` builds those.
 */
async function stripePost(
  secretKey: string,
  path: string,
  params: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

// ── D1 helpers (ledger + spend + customer map) ────────────────────────────────

/**
 * Append a credit_ledger row. Idempotent on (reason, stripe_ref): a webhook
 * replay of the same Stripe event never double-grants. Returns true if a NEW row
 * was written, false if it was a duplicate that was skipped.
 */
export async function grantCredit(
  db: D1Database,
  entry: {
    installationId: number;
    deltaUsd: number;
    reason: string;
    stripeRef?: string | null;
    runId?: string | null;
    now?: number;
  },
): Promise<boolean> {
  const now = entry.now ?? Math.floor(Date.now() / 1000);
  if (entry.stripeRef) {
    const dup = await db
      .prepare('SELECT id FROM credit_ledger WHERE reason = ? AND stripe_ref = ? LIMIT 1')
      .bind(entry.reason, entry.stripeRef)
      .first<{ id: string }>();
    if (dup) return false; // already applied this Stripe event
  }
  await db
    .prepare(
      `INSERT INTO credit_ledger (id, installation_id, delta_usd, reason, stripe_ref, run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      'cl_' + randomHex(16),
      entry.installationId,
      entry.deltaUsd,
      entry.reason,
      entry.stripeRef ?? null,
      entry.runId ?? null,
      now,
    )
    .run();
  return true;
}

/** An installation's prepaid balance = SUM(delta_usd) over its ledger. */
export async function getBalance(db: D1Database, installationId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(delta_usd), 0) AS bal FROM credit_ledger WHERE installation_id = ?')
    .bind(installationId)
    .first<{ bal: number }>();
  return row?.bal ?? 0;
}

/**
 * Record per-run token spend AND mirror it as a negative ledger entry so the
 * balance stays authoritative. One call meters + debits.
 */
export async function recordSpend(
  db: D1Database,
  spend: {
    runId: string;
    ship?: string | null;
    installationId: number | null;
    model?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    costUsd: number;
    now?: number;
  },
): Promise<void> {
  const now = spend.now ?? Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO fleet_run_spend (run_id, ship, installation_id, model, input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      spend.runId,
      spend.ship ?? null,
      spend.installationId,
      spend.model ?? null,
      spend.inputTokens ?? 0,
      spend.outputTokens ?? 0,
      spend.costUsd,
      now,
    )
    .run();
  if (spend.installationId != null && spend.costUsd > 0) {
    await grantCredit(db, {
      installationId: spend.installationId,
      deltaUsd: -spend.costUsd,
      reason: 'fleet:spend',
      runId: spend.runId,
      now,
    });
  }
}

async function getOrCreateCustomer(
  env: ConfiguredBillingEnv,
  installationId: number,
): Promise<string | null> {
  const existing = await env.DB.prepare(
    'SELECT stripe_customer_id FROM stripe_customers WHERE installation_id = ?',
  )
    .bind(installationId)
    .first<{ stripe_customer_id: string }>();
  if (existing) return existing.stripe_customer_id;

  const created = await stripePost(env.STRIPE_SECRET_KEY, '/customers', {
    'metadata[installation_id]': String(installationId),
    description: `Port Daddy installation ${installationId}`,
  });
  if (!created.ok || !isRecord(created.body) || typeof created.body.id !== 'string') {
    return null;
  }
  const customerId = created.body.id;
  await env.DB.prepare(
    'INSERT OR IGNORE INTO stripe_customers (installation_id, stripe_customer_id, created_at) VALUES (?, ?, ?)',
  )
    .bind(installationId, customerId, Math.floor(Date.now() / 1000))
    .run();
  return customerId;
}

// ── POST /billing/checkout ────────────────────────────────────────────────────

/**
 * Create a Stripe Checkout Session for a one-time credit pack. Requires a live
 * __Host-pd_session (a signed-in operator/user); the pack is a closed enum so a
 * caller can never pick an arbitrary price. Returns { url } to redirect to.
 */
export async function handleCreateCheckout(request: Request, env: Env): Promise<Response> {
  if (!billingConfigured(env)) {
    return err('BILLING_UNCONFIGURED', 'Stripe billing is not configured', 503);
  }
  const session = await resolveSession(request, env);
  if (!session) return err('UNAUTHENTICATED', 'A signed-in session is required', 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('BAD_JSON', 'Body must be JSON', 400);
  }
  if (!isRecord(body)) return err('BAD_REQUEST', 'Body must be an object', 400);
  const installationId = Number(body.installationId);
  const packId = typeof body.pack === 'string' ? body.pack : '';
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return err('BAD_REQUEST', 'installationId (positive integer) required', 400);
  }
  const pack = CREDIT_PACKS[packId];
  if (!pack) {
    return err('BAD_PACK', `Unknown pack '${packId}'; choose one of ${Object.keys(CREDIT_PACKS).join(', ')}`, 400);
  }
  // Tenant-ownership gate: don't let a session seed a Stripe customer / credit
  // attribution for an installation it doesn't own.
  if (!(await userOwnsInstallation(env, session, installationId))) {
    return err('FORBIDDEN', 'you do not own this installation', 403);
  }

  const customerId = await getOrCreateCustomer(env, installationId);
  if (!customerId) return err('STRIPE_ERROR', 'Could not create a Stripe customer', 502);

  const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  // Optional preconfigured Price; else inline price_data at the pack's amount.
  const priceEnvKey = `STRIPE_PRICE_${pack.id.toUpperCase()}` as keyof Env;
  const configuredPrice = env[priceEnvKey];
  const lineItemParams: Record<string, string> =
    typeof configuredPrice === 'string' && configuredPrice
      ? { 'line_items[0][price]': configuredPrice, 'line_items[0][quantity]': '1' }
      : {
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][unit_amount]': String(Math.round(pack.valueUsd * 100)),
          'line_items[0][price_data][product_data][name]': pack.label,
          'line_items[0][quantity]': '1',
        };

  const created = await stripePost(env.STRIPE_SECRET_KEY, '/checkout/sessions', {
    mode: 'payment',
    customer: customerId,
    success_url: `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/billing/cancel`,
    'metadata[installation_id]': String(installationId),
    'metadata[pack]': pack.id,
    'metadata[value_usd]': String(pack.valueUsd),
    // Propagate identity to the underlying PaymentIntent/Charge so charge.refunded
    // carries the installation without a Stripe lookup.
    'payment_intent_data[metadata][installation_id]': String(installationId),
    'payment_intent_data[metadata][value_usd]': String(pack.valueUsd),
    ...lineItemParams,
  });
  if (!created.ok || !isRecord(created.body) || typeof created.body.url !== 'string') {
    return err('STRIPE_ERROR', 'Stripe checkout session creation failed', 502);
  }
  return Response.json({ url: created.body.url, sessionId: created.body.id ?? null });
}

// ── POST /billing/webhook ─────────────────────────────────────────────────────

/**
 * Verify a Stripe-Signature header. Format: `t=<unix>,v1=<hexhmac>[,v1=...]`.
 * The signed payload is the literal string `${t}.${rawBody}`; the HMAC-SHA256 of
 * that under STRIPE_WEBHOOK_SECRET must equal a provided v1 scheme signature.
 * Constant-time compare via the relay's timingSafeEqual. Returns false on any
 * malformation — fail closed.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  opts?: { toleranceSeconds?: number; now?: number },
): boolean {
  if (!header || !secret) return false;
  let t: string | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (k === 't') t = val;
    else if (k === 'v1') v1.push(val);
  }
  if (!t || v1.length === 0) return false;

  // Replay defense: reject timestamps outside the tolerance window.
  const tolerance = opts?.toleranceSeconds ?? 300;
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return false;

  const enc = new TextEncoder();
  const expected = toHex(hmac(sha256, enc.encode(secret), enc.encode(`${t}.${rawBody}`)));
  // Any of the provided v1 signatures matching (constant-time) is acceptance.
  let matched = false;
  for (const sig of v1) if (timingSafeEqual(sig, expected)) matched = true;
  return matched;
}

interface StripeEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

function parseStripeEvent(x: unknown): StripeEvent | null {
  if (!isRecord(x)) return null;
  if (typeof x.type !== 'string') return null;
  if (!isRecord(x.data) || !isRecord(x.data.object)) return null;
  return { type: x.type, data: { object: x.data.object } };
}

/** Read installation_id out of a Stripe object's metadata (string → number). */
function installationFromMetadata(obj: Record<string, unknown>): number | null {
  const md = isRecord(obj.metadata) ? obj.metadata : null;
  const raw = md && typeof md.installation_id === 'string' ? md.installation_id : null;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  if (!billingConfigured(env)) {
    return err('BILLING_UNCONFIGURED', 'Stripe billing is not configured', 503);
  }
  const rawBody = await request.text();
  const sigHeader = request.headers.get('Stripe-Signature');
  if (!verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET)) {
    return err('BAD_SIGNATURE', 'Stripe signature verification failed', 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return err('BAD_JSON', 'Webhook body is not valid JSON', 400);
  }
  const event = parseStripeEvent(parsed);
  if (!event) return err('BAD_EVENT', 'Unexpected Stripe event shape', 400);

  const now = Math.floor(Date.now() / 1000);

  if (event.type === 'checkout.session.completed') {
    const obj = event.data.object;
    const installationId = installationFromMetadata(obj);
    if (installationId == null) {
      // No installation to credit — acknowledge so Stripe stops retrying, but
      // record nothing.
      return Response.json({ received: true, credited: false });
    }
    // Prefer the pack's declared value; fall back to amount_total (cents → USD).
    const md = isRecord(obj.metadata) ? obj.metadata : {};
    let valueUsd =
      typeof md.value_usd === 'string' && Number.isFinite(Number(md.value_usd))
        ? Number(md.value_usd)
        : NaN;
    if (!Number.isFinite(valueUsd)) {
      valueUsd = typeof obj.amount_total === 'number' ? obj.amount_total / 100 : 0;
    }
    const stripeRef = typeof obj.id === 'string' ? obj.id : null;
    const applied = await grantCredit(env.DB, {
      installationId,
      deltaUsd: valueUsd,
      reason: 'stripe:checkout',
      stripeRef,
      now,
    });
    return Response.json({ received: true, credited: applied, deltaUsd: valueUsd });
  }

  if (event.type === 'charge.refunded') {
    const obj = event.data.object;
    const installationId = installationFromMetadata(obj);
    if (installationId == null) return Response.json({ received: true, debited: false });
    const refundedCents = typeof obj.amount_refunded === 'number' ? obj.amount_refunded : 0;
    const stripeRef = typeof obj.id === 'string' ? obj.id : null;
    const applied = await grantCredit(env.DB, {
      installationId,
      deltaUsd: -(refundedCents / 100),
      reason: 'stripe:refund',
      stripeRef,
      now,
    });
    return Response.json({ received: true, debited: applied, deltaUsd: -(refundedCents / 100) });
  }

  // Unhandled but well-formed event — acknowledge without acting.
  return Response.json({ received: true, ignored: event.type });
}

// ── GET /billing/balance/:installationId ──────────────────────────────────────

/**
 * Return an installation's prepaid balance. Authorized for the operator token OR
 * any signed-in session (the balance is not a secret; grants/refunds are gated
 * elsewhere). Fail closed only when NEITHER credential is present.
 */
export async function handleBillingBalance(
  request: Request,
  env: Env,
  installationIdRaw: string,
): Promise<Response> {
  const installationId = Number(installationIdRaw);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return err('BAD_REQUEST', 'installationId must be a positive integer', 400);
  }
  const operatorReject = operatorOnly(request, env);
  if (operatorReject) {
    // Not the operator — allow a signed-in session, but ONLY for an installation
    // GitHub confirms this user owns (else any session could enumerate every
    // tenant's balance/spend by installation id).
    const session = await resolveSession(request, env);
    if (!session) return err('UNAUTHENTICATED', 'operator token or session required', 401);
    if (!(await userOwnsInstallation(env, session, installationId))) {
      return err('FORBIDDEN', 'you do not own this installation', 403);
    }
  }
  const balanceUsd = await getBalance(env.DB, installationId);
  return Response.json({ installationId, balanceUsd });
}

// ── POST /billing/portal ──────────────────────────────────────────────────────

/**
 * Create a Stripe Billing Portal session for the caller's installation so they
 * can manage payment methods + view invoices. Requires a session and an
 * installationId (body). Returns { url }.
 */
export async function handlePortalLink(request: Request, env: Env): Promise<Response> {
  if (!billingConfigured(env)) {
    return err('BILLING_UNCONFIGURED', 'Stripe billing is not configured', 503);
  }
  const session = await resolveSession(request, env);
  if (!session) return err('UNAUTHENTICATED', 'A signed-in session is required', 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err('BAD_JSON', 'Body must be JSON', 400);
  }
  if (!isRecord(body)) return err('BAD_REQUEST', 'Body must be an object', 400);
  const installationId = Number(body.installationId);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return err('BAD_REQUEST', 'installationId (positive integer) required', 400);
  }
  // Tenant-ownership gate: without this, any signed-in user could open ANOTHER
  // tenant's Stripe Billing Portal (invoices, payment methods) by id.
  if (!(await userOwnsInstallation(env, session, installationId))) {
    return err('FORBIDDEN', 'you do not own this installation', 403);
  }

  const customer = await env.DB.prepare(
    'SELECT stripe_customer_id FROM stripe_customers WHERE installation_id = ?',
  )
    .bind(installationId)
    .first<{ stripe_customer_id: string }>();
  if (!customer) return err('NO_CUSTOMER', 'No Stripe customer for this installation yet', 404);

  const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  const created = await stripePost(env.STRIPE_SECRET_KEY, '/billing_portal/sessions', {
    customer: customer.stripe_customer_id,
    return_url: `${base}/billing`,
  });
  if (!created.ok || !isRecord(created.body) || typeof created.body.url !== 'string') {
    return err('STRIPE_ERROR', 'Stripe billing portal session creation failed', 502);
  }
  return Response.json({ url: created.body.url });
}
