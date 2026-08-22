/**
 * Port Daddy Relay v0 — Cloudflare Worker entry point (ADR-0049)
 *
 * Routes:
 *   GET  /health
 *   GET  /mercy                               (public MERCY status JSON; no secrets)
 *   GET  /account/mercy                       (session; HTML MERCY report card)
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
 *   GET  /account/parleys                       (HTML; session; → a harbor's list)
 *   GET  /account/parleys/:ns/:name             (HTML parley list; session + member)
 *   GET  /account/parleys/:ns/:name/:id         (HTML parley detail; session + member)
 *   POST /account/parleys/:ns/:name/:id/sign    (plain form sign; same-origin)
 *   GET  /account/shipwright                    (HTML Shipwright chat; session;
 *                                                the ONE page with inline JS —
 *                                                nonce-scoped CSP)
 *   GET  /v1/shipwright/history                 (session; own chat history)
 *   POST /v1/shipwright/chat                    (session; Workers AI, SSE)
 *   POST /v1/shipwright/clear                   (session; delete own history)
 *   GET  /account/billing                       (HTML billing page; session +
 *                                                GitHub installation ownership; ADR-0116)
 *   POST /billing/checkout                     (session; Stripe Checkout for a credit pack)
 *   POST /billing/webhook                      (Stripe-Signature HMAC; credit ledger writes)
 *   GET  /billing/balance/:installationId      (operator or session; prepaid balance)
 *   POST /billing/portal                       (session; Stripe Billing Portal link)
 *   GET  /auth/status                          (session cookie → {login, avatarUrl};
 *                                               credentialed CORS for portdaddy.dev)
 *   POST /v1/harbors                           (session/pdu; create a remote harbor — client-supplied pubkey)
 *   GET  /v1/harbors                           (session/pdu; harbors I belong to)
 *   GET  /v1/harbors/:namespace/:name          (member-gated; detail + members)
 *   POST /v1/harbors/:namespace/:name/members  (owner-gated; add a member)
 *   POST /v1/harbors/:namespace/:name/presence (member-gated; presence heartbeat, TTL ~90s)
 *   GET  /v1/harbors/:namespace/:name/presence (member-gated; who is online + identity tier)
 *   PUT  /v1/harbors/:namespace/:name/helm     (owner-gated; set helm holder + succession)
 *   GET  /v1/harbors/:namespace/:name/helm     (member-gated; read helm — runs dead-man check)
 *   POST /v1/harbors/:namespace/:name/parleys  (member-gated; convene a parley)
 *   GET  /v1/harbors/:namespace/:name/parleys  (member-gated; list parleys — lazy expiry)
 *   GET  /v1/harbors/:namespace/:name/parleys/:id          (member-gated; detail + positions)
 *   POST /v1/harbors/:namespace/:name/parleys/:id/respond  (named-party-gated; sign a position)
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
import { handleSessionIntelIngest, handleSessionIntelPending } from './session-intel.js';
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
import { runMercySweep, handleMercyStatus, handleMercyPage } from './mercy.js';
import {
  runInterruptionNagSweep,
  handleCreateInterruption,
  handleListInterruptions,
  handleAnswerInterruption,
  handleAckInterruption,
  handleInterruptionsPage,
} from './interruptions.js';
import {
  handleRegisterApnsDevice,
  handleUnregisterApnsDevice,
  handleListApnsDevices,
} from './push-apns.js';
import {
  handleGithubLogin,
  handleGithubCallback,
  handleAuthMe,
  handleAuthStatus,
  handleLogout,
  handleAccountExport,
  handleAccountDelete,
} from './auth-github.js';
import { handleLoginPage, handleAccountPage } from './account-page.js';
import {
  handleParleysIndex,
  handleParleyListPage,
  handleParleyDetailPage,
  handleParleySignForm,
} from './parleys-page.js';
import { handleRunsPage } from './runs-page.js';
import { handleShipwrightPage } from './shipwright-page.js';
import {
  handleShipwrightChat,
  handleShipwrightHistory,
  handleShipwrightClear,
} from './shipwright.js';
import { handleBillingPage } from './billing-page.js';
import { handleDeviceStart, handleDeviceToken, handleWhoami } from './device-flow.js';
import {
  handleCreateCheckout,
  handleStripeWebhook,
  handleBillingBalance,
  handlePortalLink,
} from './billing.js';
import {
  handleCreateHarbor,
  handleListMyHarbors,
  handleGetHarbor,
  handleAddHarborMember,
} from './harbors.js';
import {
  handlePresenceBeat,
  handleGetPresence,
  handleSetHelm,
  handleGetHelm,
} from './presence.js';
import {
  handleCreateParley,
  handleListParleys,
  handleGetParley,
  handleRespondParley,
} from './parleys.js';

// Re-export Durable Object class for wrangler to pick up
export { HarborChannel };

function cors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return new Response(response.body, { status: response.status, headers });
}

// The marketing site's header chip (portdaddy.dev) reads the signed-in state
// cross-origin WITH the session cookie. A wildcard Access-Control-Allow-Origin
// can never carry credentials (browsers reject `*` + credentials), so exactly
// these session-probe GETs answer with a pinned origin + credentials instead.
// Everything else keeps the wildcard, credential-less CORS above.
const WEB_ORIGIN = 'https://portdaddy.dev';
const CREDENTIALED_CORS_PATHS: ReadonlySet<string> = new Set(['/auth/whoami', '/auth/status']);

function corsCredentialed(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', WEB_ORIGIN);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  // The ACAO value differs per path; keep shared caches honest.
  headers.append('Vary', 'Origin');
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
      const preflight = new Response(null, { status: 204 });
      return CREDENTIALED_CORS_PATHS.has(pathname) ? corsCredentialed(preflight) : cors(preflight);
    }

    let response: Response = notFound();

    try {
    // ── Health ──────────────────────────────────────────────────────────────
    if (pathname === '/health' && method === 'GET') {
      response = handleHealth(env);
    }

    // ── MERCY status page (public, no secrets — src/mercy.ts) ────────────────
    else if (pathname === '/mercy' && method === 'GET') {
      response = await handleMercyStatus(env);
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

    // ── Session Intelligence cloud-mining ingest (operator-gated) ────────────
    else if (pathname === '/v1/session-intel/ingest' && method === 'POST') {
      response = await handleSessionIntelIngest(request, env);
    }
    else if (pathname === '/v1/session-intel/pending' && method === 'GET') {
      response = await handleSessionIntelPending(request, env);
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

    // ── Operator interruptions — HITL blocking asks (src/interruptions.ts) ──
    else if (pathname === '/v1/interruptions' && method === 'POST') {
      response = await handleCreateInterruption(request, env);
    }
    else if (pathname === '/v1/interruptions' && method === 'GET') {
      response = await handleListInterruptions(request, env);
    }
    else if (pathname.startsWith('/v1/interruptions/') && pathname.endsWith('/answer') && method === 'POST') {
      const id = decodeURIComponent(pathname.slice('/v1/interruptions/'.length, -'/answer'.length));
      response = await handleAnswerInterruption(request, env, id);
    }
    else if (pathname.startsWith('/v1/interruptions/') && pathname.endsWith('/ack') && method === 'POST') {
      const id = decodeURIComponent(pathname.slice('/v1/interruptions/'.length, -'/ack'.length));
      response = await handleAckInterruption(request, env, id);
    }

    // ── APNs device registry — iOS interruption pages (src/push-apns.ts) ─────
    else if (pathname === '/v1/push/apns/devices' && method === 'POST') {
      response = await handleRegisterApnsDevice(request, env);
    }
    else if (pathname === '/v1/push/apns/devices' && method === 'GET') {
      response = await handleListApnsDevices(request, env);
    }
    else if (pathname.startsWith('/v1/push/apns/devices/') && method === 'DELETE') {
      const deviceId = decodeURIComponent(pathname.slice('/v1/push/apns/devices/'.length));
      response = await handleUnregisterApnsDevice(request, env, deviceId);
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
    // Billing storefront (session + GitHub installation ownership; ADR-0116).
    else if (pathname === '/account/billing' && method === 'GET') {
      response = await handleBillingPage(request, env);
    }
    // MERCY report card (session-gated HTML; src/mercy.ts).
    else if (pathname === '/account/mercy' && method === 'GET') {
      response = await handleMercyPage(request, env);
    }
    // Operator interruptions list (session-gated HTML; src/interruptions.ts).
    else if (pathname === '/account/interruptions' && method === 'GET') {
      response = await handleInterruptionsPage(request, env);
    }
    // Shipwright chat page (session-gated HTML; src/shipwright-page.ts).
    else if (pathname === '/account/shipwright' && method === 'GET') {
      response = await handleShipwrightPage(request, env);
    }
    // ── Parley HTML surface (session + harbor-member gated; parleys-page.ts) ─
    // /account/parleys                     → redirect to a harbor (or empty state)
    // /account/parleys/:ns/:name           → that harbor's parley list
    // /account/parleys/:ns/:name/:id       → one parley in full
    // /account/parleys/:ns/:name/:id/sign  → POST, plain form, script-free page
    else if (pathname === '/account/parleys' && method === 'GET') {
      response = await handleParleysIndex(request, env);
    } else if (pathname.startsWith('/account/parleys/')) {
      const seg = pathname.slice('/account/parleys/'.length).split('/').filter(Boolean).map(decodeURIComponent);
      const [pns, pname, pid, pverb] = seg;
      if (pns && pname && seg.length === 2 && method === 'GET') {
        response = await handleParleyListPage(request, env, pns, pname);
      } else if (pns && pname && pid && seg.length === 3 && method === 'GET') {
        response = await handleParleyDetailPage(request, env, pns, pname, pid);
      } else if (pns && pname && pid && seg.length === 4 && pverb === 'sign' && method === 'POST') {
        response = await handleParleySignForm(request, env, pns, pname, pid);
      } else {
        response = new Response('Not Found', { status: 404 });
      }
    }

    // ── Shipwright chat API (session-scoped; src/shipwright.ts) ──────────────
    else if (pathname === '/v1/shipwright/history' && method === 'GET') {
      response = await handleShipwrightHistory(request, env);
    }
    else if (pathname === '/v1/shipwright/chat' && method === 'POST') {
      response = await handleShipwrightChat(request, env);
    }
    else if (pathname === '/v1/shipwright/clear' && method === 'POST') {
      response = await handleShipwrightClear(request, env);
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
    // Signed-in probe for the portdaddy.dev header chip (session cookie only;
    // returns {login, avatarUrl} and nothing else — no secrets).
    else if (pathname === '/auth/status' && method === 'GET') {
      response = await handleAuthStatus(request, env);
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

    // ── Remote harbors (grand-plan X2 v1; src/harbors.ts) ────────────────────
    else if (pathname === '/v1/harbors' && method === 'POST') {
      response = await handleCreateHarbor(request, env);
    }
    else if (pathname === '/v1/harbors' && method === 'GET') {
      response = await handleListMyHarbors(request, env);
    }
    else if (pathname.startsWith('/v1/harbors/')) {
      // :name is the qualified `namespace/name` — namespace/name detail, or a
      // sub-resource: /members (X2), /presence + /helm (X3, src/presence.ts),
      // /parleys[/:id[/respond]] (X4, src/parleys.ts).
      const parts = pathname.slice('/v1/harbors/'.length).split('/').map((p) => decodeURIComponent(p));
      const ns = parts[0];
      const name = parts[1];
      const sub = parts.length >= 3 ? parts[2] : undefined;
      const parleyId = parts.length >= 4 ? parts[3] : undefined;
      if (ns && name && parts.length === 2 && method === 'GET') {
        response = await handleGetHarbor(request, env, ns, name);
      } else if (ns && name && parts.length === 3 && sub === 'members' && method === 'POST') {
        response = await handleAddHarborMember(request, env, ns, name);
      } else if (ns && name && parts.length === 3 && sub === 'presence' && method === 'POST') {
        response = await handlePresenceBeat(request, env, ns, name);
      } else if (ns && name && parts.length === 3 && sub === 'presence' && method === 'GET') {
        response = await handleGetPresence(request, env, ns, name);
      } else if (ns && name && parts.length === 3 && sub === 'helm' && method === 'PUT') {
        response = await handleSetHelm(request, env, ns, name);
      } else if (ns && name && parts.length === 3 && sub === 'helm' && method === 'GET') {
        response = await handleGetHelm(request, env, ns, name);
      } else if (ns && name && parts.length === 3 && sub === 'parleys' && method === 'POST') {
        response = await handleCreateParley(request, env, ns, name);
      } else if (ns && name && parts.length === 3 && sub === 'parleys' && method === 'GET') {
        response = await handleListParleys(request, env, ns, name);
      } else if (ns && name && sub === 'parleys' && parleyId && parts.length === 4 && method === 'GET') {
        response = await handleGetParley(request, env, ns, name, parleyId);
      } else if (ns && name && sub === 'parleys' && parleyId && parts.length === 5 && parts[4] === 'respond' && method === 'POST') {
        response = await handleRespondParley(request, env, ns, name, parleyId);
      } else {
        response = notFound();
      }
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

    return CREDENTIALED_CORS_PATHS.has(pathname) ? corsCredentialed(response) : cors(response);
  },

  // Cron Triggers (ADR-0101; runtime-verification-for-agents). The Worker has
  // no long-running Arbiter loop, so scheduled maintenance runs here. Two crons
  // share one handler, dispatched on event.cron (wrangler.deploy.toml):
  //   "*/5 * * * *"  — MERCY health sweep only (probes are cheap).
  //   "0 */6 * * *"  — retention/session-reap/erasure sweep (+ a MERCY sweep,
  //                    since every fire takes vitals). Best-effort: neither
  //                    sweep ever throws.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const MERCY_CRON = '*/5 * * * *';
    if (event.cron !== MERCY_CRON) {
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
    }
    // MERCY takes vitals on every cron fire (the sweep is internally fail-safe).
    ctx.waitUntil(
      runMercySweep(env, Math.floor(Date.now() / 1000)).then((r) => {
        const line =
          `[relay] mercy sweep: overall=${r.overall} remoteHarbors=${r.remoteHarborsPossible} ` +
          `opened=${r.incidentsOpened} resolved=${r.incidentsResolved} paged=${r.pagesSent}`;
        if (r.errors.length) console.error(`${line} errors: ${r.errors.join('; ')}`);
        else console.log(line);
      }),
    );
    // HITL interruptions: the decay/nag engine rides the same 5-min cadence
    // (and the 6h fire — every fire nags what is due). Internally fail-safe.
    ctx.waitUntil(
      runInterruptionNagSweep(env, Math.floor(Date.now() / 1000)).then((r) => {
        const line =
          `[relay] interruption sweep: paused=${r.paused} breakerOpen=${r.breakerOpen} ` +
          `expired=${r.expired} nags=${r.nagsSent} gaveUp=${r.gaveUpSent} digests=${r.digestsSent}`;
        if (r.errors.length) console.error(`${line} errors: ${r.errors.join('; ')}`);
        else console.log(line);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
