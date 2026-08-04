/**
 * Port Daddy Relay v0 — Cloudflare Worker entry point (ADR-0049)
 *
 * Routes:
 *   GET  /health
 *   POST /v1/handshake
 *   GET  /v1/subscribe/:session_id          (SSE)
 *   POST /v1/publish
 *   POST /v1/github/webhook                  (GitHub webhook ingress; HMAC-gated)
 *   GET  /v1/fleet/config                     (operator; fleet control-plane read)
 *   POST /v1/fleet/validate                   (operator; deterministic YAML validate)
 *   POST /v1/fleet/smoke-test                 (operator; run one ship on Workers AI)
 *   POST /v1/fleet/optimize-prompt            (operator; rewrite a ship prompt)
 *   POST /v1/fleet/save                       (operator; commit to new branch + PR)
 *   POST /v1/fleet/pause                       (operator; toggle fleet kill switch)
 *   GET  /v1/fleet/activity                    (operator; recent fleet runs)
 *   GET  /v1/fleet/health                      (operator; paused flag + last-run age)
 *   GET  /v1/fleet/runs/:id                    (operator; one run + transcript)
 *   GET  /fleet/runs/:id                        (HTML run page; HMAC capability
 *                                                token or operator; ADR-0101)
 *   GET  /account/runs                          (HTML runs index; session +
 *                                                GitHub repo ACL; ADR-0101)
 *   POST /billing/checkout                     (session; Stripe Checkout for a credit pack)
 *   POST /billing/webhook                      (Stripe-Signature HMAC; credit ledger writes)
 *   GET  /billing/balance/:installationId      (operator or session; prepaid balance)
 *   POST /billing/portal                       (session; Stripe Billing Portal link)
 *   POST /v1/exchange                        (OIDC → PD card)
 *   POST /v1/revoke
 *   POST /v1/revoke-by-issuer               (operator; acceptance criterion #2)
 *   GET  /v1/chain-head/:sender/:channel
 *   GET  /v1/keys/:harbor_fingerprint
 *   PUT  /v1/config/issuers/:issuer_id      (operator; acceptance criterion #1)
 *   DELETE /v1/cache/jwks/:issuer_id        (operator; acceptance criterion #3)
 *   GET  /v1/audit                           (operator; acceptance criterion #4)
 */

import type { Env } from './types.js';
import { HarborChannel } from './harbor-channel.js';
import {
  handleHealth,
  handleHandshake,
  handleSubscribe,
  handlePublish,
  handleExchange,
  handleRevoke,
  handleRevokeByIssuer,
  handleChainHead,
  handleKeys,
  handleSetIssuer,
  handleInvalidateJwks,
  handleAudit,
} from './handlers.js';
import { handleGithubWebhook } from './github-webhook.js';
import {
  handleFleetConfig,
  handleFleetValidate,
  handleFleetSmokeTest,
  handleFleetOptimizePrompt,
  handleFleetSave,
} from './fleet-control.js';
import {
  handleFleetActivity,
  handleFleetRun,
  handleFleetHealth,
  handleFleetPause,
  handleDeleteFleetRun,
} from './fleet-observability.js';
import { handleFleetRunPage } from './fleet-run-page.js';
import { runRetentionSweep } from './retention-sweep.js';
import {
  handleGithubLogin,
  handleGithubCallback,
  handleAuthMe,
  handleLogout,
  handleAccountExport,
  handleAccountDelete,
} from './auth-github.js';
import { handleLoginPage, handleAccountPage } from './account-page.js';
import { handleRunsPage } from './runs-page.js';
import { handleDeviceStart, handleDeviceToken, handleWhoami } from './device-flow.js';
import {
  handleCreateCheckout,
  handleStripeWebhook,
  handleBillingBalance,
  handlePortalLink,
} from './billing.js';

// Re-export Durable Object class for wrangler to pick up
export { HarborChannel };

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return new Response(response.body, { status: response.status, headers });
}

function notFound(): Response {
  return Response.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname, method } = { pathname: url.pathname, method: request.method };

    // CORS preflight
    if (method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    let response: Response = notFound();

    try {
    // ── Health ──────────────────────────────────────────────────────────────
    if (pathname === '/health' && method === 'GET') {
      response = handleHealth(env);
    }

    // ── Handshake ───────────────────────────────────────────────────────────
    else if (pathname === '/v1/handshake' && method === 'POST') {
      response = await handleHandshake(request, env);
    }

    // ── Subscribe (SSE) ─────────────────────────────────────────────────────
    else if (pathname.startsWith('/v1/subscribe/') && method === 'GET') {
      const sessionId = pathname.slice('/v1/subscribe/'.length);
      response = await handleSubscribe(request, env, sessionId);
    }

    // ── Publish ─────────────────────────────────────────────────────────────
    else if (pathname === '/v1/publish' && method === 'POST') {
      response = await handlePublish(request, env);
    }

    // ── GitHub webhook ingress ───────────────────────────────────────────────
    else if (pathname === '/v1/github/webhook' && method === 'POST') {
      response = await handleGithubWebhook(request, env);
    }

    // ── Fleet control-plane (operator-gated) ─────────────────────────────────
    else if (pathname === '/v1/fleet/config' && method === 'GET') {
      response = await handleFleetConfig(request, env);
    }
    else if (pathname === '/v1/fleet/validate' && method === 'POST') {
      response = await handleFleetValidate(request, env);
    }
    else if (pathname === '/v1/fleet/smoke-test' && method === 'POST') {
      response = await handleFleetSmokeTest(request, env);
    }
    else if (pathname === '/v1/fleet/optimize-prompt' && method === 'POST') {
      response = await handleFleetOptimizePrompt(request, env);
    }
    else if (pathname === '/v1/fleet/save' && method === 'POST') {
      response = await handleFleetSave(request, env);
    }

    // ── Fleet observability + kill switch (operator-gated) ───────────────────
    else if (pathname === '/v1/fleet/pause' && method === 'POST') {
      response = await handleFleetPause(request, env);
    }
    else if (pathname === '/v1/fleet/activity' && method === 'GET') {
      response = await handleFleetActivity(request, env);
    }
    else if (pathname === '/v1/fleet/health' && method === 'GET') {
      response = await handleFleetHealth(request, env);
    }
    else if (pathname.startsWith('/v1/fleet/runs/') && method === 'GET') {
      const runId = decodeURIComponent(pathname.slice('/v1/fleet/runs/'.length));
      response = await handleFleetRun(request, env, runId);
    }
    // DELETE one run + transcript (ADR-0101 export/delete per-tier, repo tier).
    else if (pathname.startsWith('/v1/fleet/runs/') && method === 'DELETE') {
      const runId = decodeURIComponent(pathname.slice('/v1/fleet/runs/'.length));
      response = await handleDeleteFleetRun(request, env, runId);
    }

    // ── Fleet run page (HTML; check-run details_url target, ADR-0101) ────────
    else if (pathname.startsWith('/fleet/runs/') && method === 'GET') {
      const runId = decodeURIComponent(pathname.slice('/fleet/runs/'.length));
      response = await handleFleetRunPage(request, env, runId);
    }

    // ── Storefront account surfaces (ADR-0101 Phase 1) ───────────────────────
    // Root lands the operator on their account (which redirects to /login when
    // signed out) instead of a bare 404.
    else if (pathname === '/' && method === 'GET') {
      response = new Response(null, { status: 302, headers: { Location: '/account' } });
    }
    else if (pathname === '/login' && method === 'GET') {
      response = handleLoginPage();
    }
    else if (pathname === '/account' && method === 'GET') {
      response = await handleAccountPage(request, env);
    }
    // Per-account fleet-runs index (session + GitHub repo ACL; ADR-0101).
    else if (pathname === '/account/runs' && method === 'GET') {
      response = await handleRunsPage(request, env);
    }

    // ── GitHub login BFF (ADR-0101 Phase 1) ──────────────────────────────────
    else if (pathname === '/auth/github/login' && method === 'GET') {
      response = await handleGithubLogin(request, env);
    }
    else if (pathname === '/auth/github/callback' && method === 'GET') {
      response = await handleGithubCallback(request, env);
    }
    else if (pathname === '/auth/me' && method === 'GET') {
      response = await handleAuthMe(request, env);
    }
    // Device-flow login for CLI / FleetBar / pd-console (ADR-0101 Phase 1).
    else if (pathname === '/auth/device/start' && method === 'POST') {
      response = await handleDeviceStart(request, env);
    }
    else if (pathname === '/auth/device/token' && method === 'POST') {
      response = await handleDeviceToken(request, env);
    }
    else if (pathname === '/auth/whoami' && method === 'GET') {
      response = await handleWhoami(request, env);
    }
    else if (pathname === '/auth/logout' && method === 'POST') {
      response = await handleLogout(request, env);
    }
    // Self-service account export + erasure (ADR-0101 team-tier export/delete).
    else if (pathname === '/account/export' && method === 'GET') {
      response = await handleAccountExport(request, env);
    }
    else if (pathname === '/account/delete' && method === 'POST') {
      response = await handleAccountDelete(request, env);
    }

    // ── Stripe billing + prepaid credits (ADR-0116) ──────────────────────────
    else if (pathname === '/billing/checkout' && method === 'POST') {
      response = await handleCreateCheckout(request, env);
    }
    else if (pathname === '/billing/webhook' && method === 'POST') {
      response = await handleStripeWebhook(request, env);
    }
    else if (pathname.startsWith('/billing/balance/') && method === 'GET') {
      const installationId = decodeURIComponent(pathname.slice('/billing/balance/'.length));
      response = await handleBillingBalance(request, env, installationId);
    }
    else if (pathname === '/billing/portal' && method === 'POST') {
      response = await handlePortalLink(request, env);
    }

    // ── OIDC exchange ────────────────────────────────────────────────────────
    else if (pathname === '/v1/exchange' && method === 'POST') {
      response = await handleExchange(request, env);
    }

    // ── Revoke ───────────────────────────────────────────────────────────────
    else if (pathname === '/v1/revoke' && method === 'POST') {
      response = await handleRevoke(request, env);
    }

    // ── Bulk revoke by issuer (acceptance criterion #2) ──────────────────────
    else if (pathname === '/v1/revoke-by-issuer' && method === 'POST') {
      response = await handleRevokeByIssuer(request, env);
    }

    // ── Chain head ────────────────────────────────────────────────────────────
    else if (pathname.startsWith('/v1/chain-head/') && method === 'GET') {
      const rest = pathname.slice('/v1/chain-head/'.length);
      const lastSlash = rest.lastIndexOf('/');
      if (lastSlash < 0) { response = notFound(); }
      else {
        const sender = rest.slice(0, lastSlash);
        const channel = rest.slice(lastSlash + 1);
        response = await handleChainHead(env, sender, channel);
      }
    }

    // ── Keys ──────────────────────────────────────────────────────────────────
    else if (pathname.startsWith('/v1/keys/') && method === 'GET') {
      const harborFp = pathname.slice('/v1/keys/'.length);
      response = await handleKeys(env, harborFp);
    }

    // ── Issuer config (acceptance criterion #1) ───────────────────────────────
    else if (pathname.startsWith('/v1/config/issuers/') && method === 'PUT') {
      const issuerId = decodeURIComponent(pathname.slice('/v1/config/issuers/'.length));
      response = await handleSetIssuer(request, env, issuerId);
    }

    // ── JWKS cache invalidation (acceptance criterion #3) ─────────────────────
    else if (pathname.startsWith('/v1/cache/jwks/') && method === 'DELETE') {
      const issuerId = decodeURIComponent(pathname.slice('/v1/cache/jwks/'.length));
      response = await handleInvalidateJwks(request, env, issuerId);
    }

    // ── Audit log (acceptance criterion #4) ──────────────────────────────────
    else if (pathname === '/v1/audit' && method === 'GET') {
      response = await handleAudit(request, env);
    }

    else {
      response = notFound();
    }
    } catch (e) {
      // Global fail-closed boundary: any uncaught throw (D1/KV/Durable Object
      // infra error) becomes a controlled {error,code} envelope, never a raw
      // runtime 500. Matches the contract every handler already uses.
      response = Response.json(
        { error: 'internal relay error', code: 'INTERNAL_ERROR' },
        { status: 500 },
      );
    }

    return cors(response);
  },

  // Cron Trigger (ADR-0101; runtime-verification-for-agents). The Worker has no
  // long-running Arbiter loop, so retention + session-reaping + erasure-
  // completion run here on a schedule. Best-effort: the sweep never throws.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runRetentionSweep(env, Math.floor(Date.now() / 1000)).then((r) => {
        if (r.errors.length) console.error('[relay] retention sweep errors:', r.errors.join('; '));
        else
          console.log(
            `[relay] retention sweep: pruned ${r.runStepsPruned} steps / ${r.runsPruned} runs / ` +
              `${r.eventsPruned} events, reaped ${r.sessionsReaped} sessions, hard-deleted ${r.usersHardDeleted} users`,
          );
      }),
    );
  },
} satisfies ExportedHandler<Env>;
