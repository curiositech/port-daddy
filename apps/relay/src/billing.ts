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
import {
  CREDIT_LEDGER_POINTER,
  harborQuotaKey,
  resolveQuotaSettings,
  type QuotaStatus,
} from './harbor-quota.js';
import { resolveSession, userOwnsInstallation, isSameOrigin } from './auth-github.js';
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

export function billingConfigured(env: Env): env is ConfiguredBillingEnv {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

// ── Browser-form dialect (script-free /account/billing page) ──────────────────
//
// The billing page ships under a script-free CSP, so its buy/manage buttons are
// plain HTML <form method="post"> posts (application/x-www-form-urlencoded).
// The SAME endpoints serve both dialects: a JSON body keeps the existing
// {url}/RelayError JSON contract untouched; a form body gets 303 redirects —
// success straight to Stripe, failures back to /account/billing?notice=<code>
// (except a missing session, which goes to /login). Form posts additionally
// pass the isSameOrigin CSRF guard (defense-in-depth over the SameSite=Lax
// cookie, same layering as /account/delete).

function isFormPost(request: Request): boolean {
  return (request.headers.get('Content-Type') ?? '').includes('application/x-www-form-urlencoded');
}

function redirect303(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

/** Form-dialect failure: bounce back to the billing page with a notice code. */
function formFail(code: string): Response {
  if (code === 'UNAUTHENTICATED') return redirect303('/login');
  return redirect303(`/account/billing?notice=${encodeURIComponent(code.toLowerCase())}`);
}

/**
 * Read {installationId, pack} out of either dialect's body. Returns null on an
 * unreadable body (the caller maps that to BAD_JSON / a notice redirect).
 */
async function readBillingBody(
  request: Request,
  form: boolean,
): Promise<{ installationId: unknown; pack: unknown } | null> {
  if (form) {
    const params = new URLSearchParams(await request.text());
    return { installationId: params.get('installationId'), pack: params.get('pack') };
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;
  return { installationId: body.installationId, pack: body.pack };
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

/**
 * An installation's billing status, with the SAME semantics the fleet
 * executor's spend circuit-breaker reads (ADR-0116/0117): `enrolled` is true
 * only when the ledger has rows for this installation. No rows ⇒ free tier /
 * fail-open (runs proceed, nothing metered against a balance); rows with
 * balance <= 0 ⇒ out of credit (the executor skips runs).
 */
export interface InstallationBillingStatus {
  balanceUsd: number;
  enrolled: boolean;
}

export async function getBillingStatus(
  db: D1Database,
  installationId: number,
): Promise<InstallationBillingStatus> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(delta_usd), 0) AS bal FROM credit_ledger WHERE installation_id = ?',
    )
    .bind(installationId)
    .first<{ n: number; bal: number }>();
  const n = Number(row?.n) || 0;
  return { balanceUsd: Number(row?.bal) || 0, enrolled: n > 0 };
}

/** An installation's prepaid balance = SUM(delta_usd) over its ledger. */
export async function getBalance(db: D1Database, installationId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(delta_usd), 0) AS bal FROM credit_ledger WHERE installation_id = ?')
    .bind(installationId)
    .first<{ bal: number }>();
  return row?.bal ?? 0;
}

/** Row cap for the billing page's ledger-history table (mirrors the
 *  MAX_INSTALLATIONS / MAX_REPO_CHECKS idiom elsewhere on this page). */
export const MAX_LEDGER_ROWS = 50;

/** One rendered ledger-history row, newest first. */
export interface LedgerEntryView {
  id: string;
  deltaUsd: number;
  reason: string;
  createdAt: number;
  /** Prepaid balance immediately AFTER this entry (i.e. as of its timestamp). */
  runningBalance: number;
}

export interface LedgerHistoryView {
  /** Newest-first, capped at MAX_LEDGER_ROWS. */
  entries: LedgerEntryView[];
  /** True when older rows exist beyond the cap — an honest "older rows exist" note. */
  truncated: boolean;
}

/**
 * Read an installation's recent `credit_ledger` transaction history for the
 * billing page's ledger table (grand-plan §billing-ledger-history). No schema
 * change: `credit_ledger` is append-only and already carries everything the
 * page needs (delta_usd, reason, created_at) — this is a read-only query
 * layered on top of the existing balance math in {@link getBalance}.
 *
 * The running balance is derived, not stored: since `credit_ledger` is
 * append-only and the CURRENT total balance is exactly SUM(delta_usd) over
 * EVERY row (including any older than the cap), walking the newest-first
 * page backwards from the total and undoing each row's delta as we pass it
 * yields the exact balance as of every visible row — without a second query
 * over the full (unbounded) history. Motivation: an operator staring at a
 * ledger wants "what was my balance right after this happened", not just a
 * bare delta list; deriving it here keeps that answer honest (it is
 * arithmetic on real numbers, not a guess) while keeping the query itself
 * O(cap) instead of O(all-time history).
 *
 * @param db D1 handle (relay's control-plane database).
 * @param installationId The GitHub App installation whose ledger to read.
 *   Callers MUST have already established tenant ownership (userOwnsInstallation
 *   / listUserInstallations) before calling this — it trusts the id it's given.
 * @param limit Row cap; defaults to {@link MAX_LEDGER_ROWS}.
 * @returns The capped, newest-first entry list plus a truncation flag. Throws
 *   on a D1 read failure — callers render that as an honest "unknown" panel,
 *   never a fabricated empty ledger (D12).
 */
export async function getLedgerHistory(
  db: D1Database,
  installationId: number,
  limit: number = MAX_LEDGER_ROWS,
): Promise<LedgerHistoryView> {
  const total = await getBalance(db, installationId);
  const res = await db
    .prepare(
      'SELECT id, delta_usd, reason, created_at FROM credit_ledger WHERE installation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    )
    .bind(installationId, limit + 1)
    .all<{ id: string; delta_usd: number; reason: string; created_at: number }>();
  const rows = res.results ?? [];
  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;

  const entries: LedgerEntryView[] = [];
  let running = total;
  for (const r of page) {
    entries.push({
      id: r.id,
      deltaUsd: r.delta_usd,
      reason: r.reason,
      createdAt: r.created_at,
      runningBalance: running,
    });
    running -= r.delta_usd; // step back to the balance BEFORE this row, for the next (older) one
  }
  return { entries, truncated };
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
 * caller can never pick an arbitrary price. JSON dialect returns { url } to
 * redirect to; the form dialect (billing page buttons) 303s straight there.
 */
export async function handleCreateCheckout(request: Request, env: Env): Promise<Response> {
  const form = isFormPost(request);
  const fail = (code: string, detail: string, status: number): Response =>
    form ? formFail(code) : err(code, detail, status);

  if (!billingConfigured(env)) {
    return fail('BILLING_UNCONFIGURED', 'Stripe billing is not configured', 503);
  }
  if (form && !isSameOrigin(request, env)) {
    return fail('CROSS_ORIGIN', 'cross-origin request refused', 403);
  }
  const session = await resolveSession(request, env);
  if (!session) return fail('UNAUTHENTICATED', 'A signed-in session is required', 401);

  const body = await readBillingBody(request, form);
  if (!body) return fail('BAD_JSON', 'Body must be JSON', 400);
  const installationId = Number(body.installationId);
  const packId = typeof body.pack === 'string' ? body.pack : '';
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return fail('BAD_REQUEST', 'installationId (positive integer) required', 400);
  }
  const pack = CREDIT_PACKS[packId];
  if (!pack) {
    return fail('BAD_PACK', `Unknown pack '${packId}'; choose one of ${Object.keys(CREDIT_PACKS).join(', ')}`, 400);
  }
  // Tenant-ownership gate: don't let a session seed a Stripe customer / credit
  // attribution for an installation it doesn't own.
  if (!(await userOwnsInstallation(env, session, installationId))) {
    return fail('FORBIDDEN', 'you do not own this installation', 403);
  }

  const customerId = await getOrCreateCustomer(env, installationId);
  if (!customerId) return fail('STRIPE_ERROR', 'Could not create a Stripe customer', 502);

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
    // Land buyers back on the real billing page (there is no GET /billing/*).
    success_url: `${base}/account/billing?notice=checkout-success`,
    cancel_url: `${base}/account/billing?notice=checkout-cancelled`,
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
    return fail('STRIPE_ERROR', 'Stripe checkout session creation failed', 502);
  }
  if (form) return redirect303(created.body.url);
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
 * installationId (body). JSON dialect returns { url }; the form dialect
 * (billing page "Manage" button) 303s straight there.
 */
export async function handlePortalLink(request: Request, env: Env): Promise<Response> {
  const form = isFormPost(request);
  const fail = (code: string, detail: string, status: number): Response =>
    form ? formFail(code) : err(code, detail, status);

  if (!billingConfigured(env)) {
    return fail('BILLING_UNCONFIGURED', 'Stripe billing is not configured', 503);
  }
  if (form && !isSameOrigin(request, env)) {
    return fail('CROSS_ORIGIN', 'cross-origin request refused', 403);
  }
  const session = await resolveSession(request, env);
  if (!session) return fail('UNAUTHENTICATED', 'A signed-in session is required', 401);

  const body = await readBillingBody(request, form);
  if (!body) return fail('BAD_JSON', 'Body must be JSON', 400);
  const installationId = Number(body.installationId);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return fail('BAD_REQUEST', 'installationId (positive integer) required', 400);
  }
  // Tenant-ownership gate: without this, any signed-in user could open ANOTHER
  // tenant's Stripe Billing Portal (invoices, payment methods) by id.
  if (!(await userOwnsInstallation(env, session, installationId))) {
    return fail('FORBIDDEN', 'you do not own this installation', 403);
  }

  const customer = await env.DB.prepare(
    'SELECT stripe_customer_id FROM stripe_customers WHERE installation_id = ?',
  )
    .bind(installationId)
    .first<{ stripe_customer_id: string }>();
  if (!customer) return fail('NO_CUSTOMER', 'No Stripe customer for this installation yet', 404);

  const base = (env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  const created = await stripePost(env.STRIPE_SECRET_KEY, '/billing_portal/sessions', {
    customer: customer.stripe_customer_id,
    return_url: `${base}/account/billing`,
  });
  if (!created.ok || !isRecord(created.body) || typeof created.body.url !== 'string') {
    return fail('STRIPE_ERROR', 'Stripe billing portal session creation failed', 502);
  }
  if (form) return redirect303(created.body.url);
  return Response.json({ url: created.body.url });
}

// ── X8: cached balance + the quota status surface ─────────────────────────────
//
// The credit ledger is read ASYNCHRONOUSLY where latency matters: the publish
// hot path never touches D1 for billing at all (its budget inputs are env
// vars fed to the HarborQuota DO), and surfaces that want a balance next to
// quota data read it through this KV cache — stale-while-revalidate, so a
// stale entry answers immediately while a background refresh (via
// ctx.waitUntil) brings it current. Enforcement against the balance is
// therefore EVENTUAL by design: at worst BILLING_STATUS_CACHE_TTL_SECONDS
// behind the ledger, and that trade is stated here rather than hidden.

/** How long a cached billing status is served without a background refresh. */
export const BILLING_STATUS_CACHE_TTL_SECONDS = 300;

interface CachedBillingStatusRecord {
  status: InstallationBillingStatus;
  fetchedAt: number; // unix seconds
}

/** A billing status read through the KV cache, labeled with its freshness. */
export interface CachedBillingStatus extends InstallationBillingStatus {
  /** Unix seconds the underlying D1 read happened. */
  cachedAt: number;
  /** True when the entry was older than the TTL (a refresh was scheduled). */
  stale: boolean;
}

const billingStatusCacheKey = (installationId: number): string =>
  `billing:status:${installationId}`;

/**
 * Read an installation's billing status through KV, keeping the D1 ledger
 * read OFF the caller's latency path after the first hit.
 *
 * - Cache hit, fresh: returns the cached value; D1 is not touched.
 * - Cache hit, stale: returns the cached value IMMEDIATELY and schedules a
 *   D1 refresh via `opts.waitUntil` (or best-effort fire-and-forget when the
 *   caller has no ExecutionContext, e.g. tests).
 * - Cache miss: one synchronous D1 read (first-reader cost, stated), cached.
 *
 * @param env Worker env (KV + DB bindings).
 * @param installationId Installation whose ledger balance to read. Callers
 *   MUST have already established tenant ownership or operator authority.
 * @param opts.waitUntil ExecutionContext.waitUntil, so a stale refresh
 *   outlives the response without delaying it.
 * @param opts.now Unix-seconds clock override for tests.
 */
export async function getCachedBillingStatus(
  env: Env,
  installationId: number,
  opts?: { waitUntil?: (p: Promise<unknown>) => void; now?: number },
): Promise<CachedBillingStatus> {
  const key = billingStatusCacheKey(installationId);
  const now = opts?.now ?? Math.floor(Date.now() / 1000);

  const cached = (await env.KV.get(key, 'json')) as CachedBillingStatusRecord | null;
  if (cached && typeof cached.fetchedAt === 'number' && cached.status) {
    const stale = now - cached.fetchedAt > BILLING_STATUS_CACHE_TTL_SECONDS;
    if (stale) {
      const refresh = (async () => {
        const fresh = await getBillingStatus(env.DB, installationId);
        await env.KV.put(key, JSON.stringify({ status: fresh, fetchedAt: now } satisfies CachedBillingStatusRecord));
      })();
      if (opts?.waitUntil) opts.waitUntil(refresh.catch(() => {}));
      else void refresh.catch(() => {});
    }
    return { ...cached.status, cachedAt: cached.fetchedAt, stale };
  }

  const fresh = await getBillingStatus(env.DB, installationId);
  await env.KV.put(key, JSON.stringify({ status: fresh, fetchedAt: now } satisfies CachedBillingStatusRecord));
  return { ...fresh, cachedAt: now, stale: false };
}

// ── GET /v1/quotas/:harborFp ──────────────────────────────────────────────────

/**
 * Operator-only view of one harbor's daily quota counters — the surface the
 * shadow-vs-enforce FLIP DECISION is read from (grand-plan §X8): today's
 * event/byte counts, the shadow-denied delta (what enforcement WOULD have
 * refused), the enforced-denied tally, the budgets and mode in force, and the
 * credit-ledger pointer a 429 hands out. Optional `?installation=<id>` pairs
 * the counters with that installation's CACHED balance (see
 * {@link getCachedBillingStatus}) so budget data and credit stand side by
 * side without a hot D1 read.
 */
export async function handleQuotaStatus(
  request: Request,
  env: Env,
  harborFp: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const reject = operatorOnly(request, env);
  if (reject) return reject;

  if (!/^[0-9a-f]{64}$/.test(harborFp)) {
    return err('BAD_REQUEST', 'harbor fingerprint must be 64 lowercase hex chars', 400);
  }
  if (!env.HARBOR_QUOTA) {
    return err('QUOTA_UNCONFIGURED', 'HARBOR_QUOTA Durable Object binding is not provisioned', 503);
  }

  const stub = env.HARBOR_QUOTA.get(env.HARBOR_QUOTA.idFromName(harborQuotaKey(harborFp)));
  const res = await stub.fetch('http://do/?action=status');
  if (!res.ok) {
    return err('QUOTA_ERROR', `quota DO returned HTTP ${res.status}`, 502);
  }
  const status = (await res.json()) as QuotaStatus;
  const settings = resolveQuotaSettings(env);

  let billing: CachedBillingStatus | null = null;
  const instRaw = new URL(request.url).searchParams.get('installation');
  if (instRaw !== null) {
    const installationId = Number(instRaw);
    if (!Number.isInteger(installationId) || installationId <= 0) {
      return err('BAD_REQUEST', 'installation must be a positive integer', 400);
    }
    billing = await getCachedBillingStatus(env, installationId, {
      waitUntil: ctx ? (p) => ctx.waitUntil(p) : undefined,
    });
  }

  return Response.json({
    harbor: harborFp,
    mode: settings.enforce ? 'enforce' : 'shadow',
    budgets: { dailyEvents: settings.eventBudget, dailyBytes: settings.byteBudget },
    day: status.day,
    counters: status.counters,
    credit_ledger: CREDIT_LEDGER_POINTER,
    billing,
  });
}
