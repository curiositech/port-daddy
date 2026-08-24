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
 *   POST /v1/fleet/executor-identity           (operator; provision the fleet
 *                                               executor's Ed25519 identity +
 *                                               hv:2 card; plan N2)
 *   POST /v1/fleet/run-report                  (signed under the N2 card;
 *                                               run-concluded reconciliation —
 *                                               claimed-vs-received totals; X7)
 *   GET  /v1/fleet/activity                    (operator; recent fleet runs)
 *   GET  /v1/fleet/health                      (operator; paused flag + last-run age)
 *   GET  /v1/fleet/runs/:id                    (operator; one run + transcript)
 *   GET  /fleet/runs/:id                        (HTML run page; HMAC capability
 *                                                token or operator; ADR-0101)
 *   GET  /account/runs                          (HTML runs index; session +
 *                                                GitHub repo ACL; ADR-0101)
 *   GET  /account/repos                         (HTML per-repo settings screen;
 *                                                session; sitrep dial)
 *   POST /account/repos/set                     (plain form upsert; session +
 *                                                GitHub repo ACL)
 *   POST /account/repos/remove                  (plain form delete; session)
 *   GET  /v1/repo-settings                      (device read path; pdu_ bearer
 *                                                or session cookie)
 *   GET  /account/parleys                       (HTML; session; → a harbor's list)
 *   GET  /account/parleys/:ns/:name             (HTML parley list; session + member)
 *   GET  /account/parleys/:ns/:name/:id         (HTML parley detail; session + member)
 *   POST /account/parleys/:ns/:name/:id/sign    (plain form sign; same-origin)
 *   GET  /account/seamanship                    (HTML skill catalog; session;
 *                                                read live from the operator's
 *                                                own repos via their GitHub App
 *                                                installation; G'3)
 *   POST /account/seamanship/publish            (session, same-origin; sync the
 *                                                operator's public listing to
 *                                                what their SKILL.md files say)
 *   POST /v1/seamanship/publish                 (same, JSON envelope)
 *   POST /account/seamanship/suggest            (session, same-origin; queue an
 *                                                Engineman suggestion run for
 *                                                one repo; G'4)
 *   POST /account/seamanship/approve            (session, same-origin; THE HUMAN
 *                                                ACT — mints the single-use
 *                                                build capability; G'6)
 *   POST /account/seamanship/dismiss            (session, same-origin; revokes an
 *                                                unspent build capability)
 *   GET  /v1/seamanship/suggestions?repo=       (session; own suggestion rows)
 *   GET  /account/seamanship/chat               (HTML Engineman chat; session;
 *                                                nonce-scoped CSP; G'5)
 *   GET  /v1/snipe/history                      (session; own chat history)
 *   POST /v1/snipe/chat                         (session; capped turn, SSE)
 *   POST /v1/snipe/clear                        (session; delete own history)
 *   GET  /skills                                (PUBLIC directory; names +
 *                                                descriptions of opted-in
 *                                                skills ONLY; G'7)
 *   GET  /v1/skills                             (same, JSON)
 *   GET  /skills/@:login/:id                    (one published skill; the full
 *                                                SKILL.md body needs a session
 *                                                AND visibility: public)
 *   GET  /v1/skills/@:login/:id                 (same, JSON)
 *   GET  /account/shipwright                    (HTML Shipwright chat; session;
 *                                                the ONE page with inline JS —
 *                                                nonce-scoped CSP)
 *   GET  /v1/shipwright/history                 (session; own chat history)
 *   POST /v1/shipwright/chat                    (session; Workers AI, SSE)
 *   POST /v1/shipwright/clear                   (session; delete own history)
 *   POST /v1/shipwright/open-pr                 (session; PR into the user's own
 *                                                installation's repo — validated
 *                                                rosters only, server re-checks)
 *   GET  /account/billing                       (HTML billing page; session +
 *                                                GitHub installation ownership; ADR-0116)
 *   POST /billing/checkout                     (session; Stripe Checkout for a credit pack)
 *   POST /billing/webhook                      (Stripe-Signature HMAC; credit ledger writes)
 *   GET  /billing/balance/:installationId      (operator or session; prepaid balance)
 *   POST /billing/portal                       (session; Stripe Billing Portal link)
 *   GET  /auth/status                          (session cookie → {login, avatarUrl};
 *                                               credentialed CORS for portdaddy.dev)
 *   PUT  /v1/roadmap/snapshot                  (session/pdu; daemon pushes one
 *                                               repo's roadmap mirror — full
 *                                               replace; operator mandate
 *                                               2026-08-22, PR 1)
 *   GET  /v1/roadmap/mirror?repo=              (session/pdu; own mirror read —
 *                                               board / item detail / activity)
 *   POST /v1/harbors                           (session/pdu; create a remote harbor — client-supplied pubkey)
 *   GET  /v1/harbors                           (session/pdu; harbors I belong to)
 *   GET  /v1/harbors/:namespace/:name          (member-gated; detail + members)
 *   POST /v1/harbors/:namespace/:name/members  (owner-gated; add a member)
 *   POST /v1/harbors/:namespace/:name/invites  (member-gated; mint a single-use invite)
 *   GET  /v1/harbors/:namespace/:name/invites  (member-gated; list invites + lifecycle)
 *   POST /v1/harbors/:namespace/:name/invites/:jti/revoke (inviter-or-owner; revoke)
 *   POST /v1/harbors/:namespace/:name/join     (authed; redeem an invite → member + epoch tick)
 *   POST /v1/harbors/:namespace/:name/presence (member-gated; presence heartbeat, TTL ~90s)
 *   GET  /v1/harbors/:namespace/:name/presence (member-gated; who is online + identity tier)
 *   PUT  /v1/harbors/:namespace/:name/helm     (owner-gated; set helm holder + succession)
 *   GET  /v1/harbors/:namespace/:name/helm     (member-gated; read helm — runs dead-man check)
 *   POST /v1/harbors/:namespace/:name/parleys  (member-gated; convene a parley)
 *   GET  /v1/harbors/:namespace/:name/parleys  (member-gated; list parleys — lazy expiry)
 *   GET  /v1/harbors/:namespace/:name/parleys/:id          (member-gated; detail + positions)
 *   POST /v1/harbors/:namespace/:name/parleys/:id/respond  (named-party-gated; sign a position)
 *   PUT  /v1/harbor/card                     (signed self-report of declared capabilities; X5)
 *   GET  /v1/harbor/directory                (public; listed/consented harbors only; X5)
 *   GET  /v1/harbor/whois?q=                 (public; TF-IDF + demonstrated ranking; X5)
 *   PUT  /v1/harbor/directory/weights        (operator; ranking weights — audit-logged; X5)
 *   POST /v1/exchange                        (OIDC → PD card)
 *   POST /v1/revoke
 *   POST /v1/revoke-by-issuer               (operator; acceptance criterion #2)
 *   GET  /v1/chain-head/:sender/:channel
 *   GET  /v1/keys/:harbor_fingerprint
 *   PUT  /v1/config/issuers/:issuer_id      (operator; acceptance criterion #1)
 *   DELETE /v1/cache/jwks/:issuer_id        (operator; acceptance criterion #3)
 *   GET  /v1/audit                           (operator; acceptance criterion #4)
 *   GET  /v1/quotas/:harbor_fingerprint      (operator; X8 quota counters + shadow-vs-enforce delta)
 */

import type { Env } from './types.js';
import { HarborChannel } from './harbor-channel.js';
import { HarborQuota } from './harbor-quota.js';
import { CoordinationRoom } from './coordination-room.js';
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
import { handleProvisionFleetExecutor } from './fleet-executor-identity.js';
import { handleRunReport } from './run-report.js';
import { recordSloSample } from './mercy-hooks.js';
import { randomHex } from './crypto.js';
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
import {
  handleFleetRunPage,
  handleFleetRunTranscript,
  handleFleetRunTranscriptIndex,
  handleFleetRunTranscriptPage,
} from './fleet-run-page.js';
import {
  handleFleetAppleTouchIcon,
  handleFleetIcon192,
  handleFleetIcon512,
  handleFleetManifest,
} from './fleet-pwa.js';
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
  handleSeamanshipPage,
  handleSeamanshipPublishForm,
  handlePublicSkillsPage,
  handlePublicSkillPage,
} from './seamanship-page.js';
import {
  handleSeamanshipPublish,
  handlePublicSkillsListing,
  handlePublicSkillBody,
} from './seamanship.js';
import {
  handleSnipeApprove,
  handleSnipeDismiss,
  handleSnipeSuggest,
  handleSnipeSuggestionList,
} from './snipe-builder.js';
import { handleSnipeChat, handleSnipeClear, handleSnipeHistory } from './snipe-chat.js';
import { handleSnipeChatPage } from './snipe-chat-page.js';
import { makeD1CatalogReader, runSnipeSuggestionSweep } from './snipe-suggestions.js';
import { runSnipeBuildSweep } from './snipe-builder.js';
import {
  handleParleysIndex,
  handleParleyListPage,
  handleParleyDetailPage,
  handleParleySignForm,
  handleParleyVerdictForm,
} from './parleys-page.js';
import {
  handleMediatorConvene,
  handleMediatorSummonsRespond,
  handleMediatorToggle,
} from './mediator-body.js';
import { handleRunsPage } from './runs-page.js';
import {
  handleRepoSettingsPage,
  handleRepoSettingsSet,
  handleRepoSettingsRemove,
  handleRepoSettingsApi,
} from './repo-settings-page.js';
import { handleShipwrightPage } from './shipwright-page.js';
import {
  handleShipwrightChat,
  handleShipwrightHistory,
  handleShipwrightClear,
  handleShipwrightOpenPr,
} from './shipwright.js';
import { handleBillingPage } from './billing-page.js';
import { handleDeviceStart, handleDeviceToken, handleWhoami } from './device-flow.js';
import {
  handleCreateCheckout,
  handleStripeWebhook,
  handleBillingBalance,
  handlePortalLink,
  handleQuotaStatus,
} from './billing.js';
import {
  handleCreateHarbor,
  handleListMyHarbors,
  handleGetHarbor,
  handleAddHarborMember,
} from './harbors.js';
import {
  handleMintHarborInvite,
  handleListHarborInvites,
  handleRevokeHarborInvite,
  handleJoinHarbor,
} from './invites.js';
import {
  handlePresenceBeat,
  handleGetPresence,
  handleSetHelm,
  handleGetHelm,
} from './presence.js';
import {
  handlePutHarborCard,
  handleDirectory,
  handleWhois,
  handleSetDirectoryWeights,
} from './directory.js';
import {
  handleCreateParley,
  handleListParleys,
  handleGetParley,
  handleRespondParley,
} from './parleys.js';
import { handleRoadmapSnapshotPut, handleRoadmapMirrorGet } from './roadmap-mirror.js';
import {
  handleCoordinationGrant,
  handleCoordinationSync,
  parseCoordinationProject,
} from './coordination.js';

// Re-export Durable Object classes for wrangler to pick up
export { HarborChannel };
export { HarborQuota };
export { CoordinationRoom };

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

/**
 * Decode one URL path segment FAIL-CLOSED, for the transcript-family routes.
 *
 * WHY: malformed percent-encoding (`%zz`) makes decodeURIComponent throw, and
 * the global boundary would surface that as a 500 — but everything under
 * /fleet/runs/:id answers one indistinguishable 404 to every failure, and a
 * malformed id must not be the single input that earns a distinguishable
 * answer. Returning '' fails the handlers' RUN_ID_RE / ship-name validation,
 * which IS that 404.
 *
 * @param segment The raw (still-encoded) path segment from the route match.
 * @returns The decoded segment, or '' when the encoding is malformed.
 */
function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

function notFound(): Response {
  return Response.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });
}

/**
 * requestId threading (x7-mercy-hooks slice 3), done at the ONE choke point
 * every module's response passes through instead of rewriting ~20 handler
 * signatures: every response gains an `X-Request-Id` header, and every JSON
 * ERROR envelope (status ≥ 400) additionally gains a `requestId` field — so a
 * caller quoting an error can always hand the operator a correlatable id,
 * whichever module produced the envelope. Success bodies (including SSE
 * streams) pass through untouched.
 */
async function withRequestId(response: Response, requestId: string): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set('X-Request-Id', requestId);
  if (response.status >= 400 && (headers.get('Content-Type') ?? '').includes('application/json')) {
    try {
      const body = (await response.clone().json()) as unknown;
      if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
        (body as Record<string, unknown>).requestId = requestId;
        return new Response(JSON.stringify(body), { status: response.status, headers });
      }
    } catch {
      // Header claimed JSON but the body was not — header-only threading.
    }
  }
  return new Response(response.body, { status: response.status, headers });
}

async function finalizeResponse(
  response: Response,
  requestId: string,
  pathname: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const correlated = await withRequestId(response, requestId);
  const sloSample = recordSloSample(env.DB, Date.now(), correlated.status >= 500);
  try {
    ctx.waitUntil(sloSample);
  } catch {
    void sloSample;
  }
  return CREDENTIALED_CORS_PATHS.has(pathname)
    ? corsCredentialed(correlated)
    : cors(correlated);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // One id per request, minted before any routing so even the INTERNAL_ERROR
    // path carries it. The `req_` prefix keeps it recognizable in logs.
    const requestId = `req_${randomHex(8)}`;
    const url = new URL(request.url);
    const { pathname, method } = { pathname: url.pathname, method: request.method };

    // CORS preflight
    if (method === 'OPTIONS') {
      const preflight = new Response(null, { status: 204 });
      return finalizeResponse(preflight, requestId, pathname, env, ctx);
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

    // ── ADR-0092 cloud coordination peer ───────────────────────────────────
    // The project is a DO routing key, not an authority boundary. Authority is
    // the macaroon's project + actor + coordination-sync caveats.
    else if (pathname.startsWith('/v1/coordination/')) {
      const rest = pathname.slice('/v1/coordination/'.length);
      const slash = rest.lastIndexOf('/');
      const project = slash > 0 ? parseCoordinationProject(rest.slice(0, slash)) : null;
      const action = slash > 0 ? rest.slice(slash + 1) : '';
      if (!project) {
        response = Response.json({ error: 'Invalid coordination project', code: 'VALIDATION_ERROR' }, { status: 400 });
      } else if (action === 'grant' && method === 'POST') {
        response = await handleCoordinationGrant(request, env, project);
      } else if (action === 'sync' && method === 'POST') {
        response = await handleCoordinationSync(request, env, project);
      } else {
        response = notFound();
      }
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
    // Fleet-executor identity provisioning (operator; plan N2). The ONLY way
    // an executor identity or card comes to exist — there is deliberately no
    // bearer-token publish ingest anywhere in this router.
    else if (pathname === '/v1/fleet/executor-identity' && method === 'POST') {
      response = await handleProvisionFleetExecutor(request, env);
    }
    // Run-concluded reconciliation (x7-mercy-hooks slice 2): the executor
    // reports its per-run event totals under its N2 card; the relay records
    // claimed-vs-received. Signed like a publish — no bearer dialect here
    // either.
    else if (pathname === '/v1/fleet/run-report' && method === 'POST') {
      response = await handleRunReport(request, env);
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

    // ── PWA static assets (public app metadata, no authz — Phase 5 of
    //    docs/FLEET-SESSION-TRANSCRIPTS.md; src/fleet-pwa.ts) ────────────────
    else if (pathname === '/fleet/manifest.webmanifest' && method === 'GET') {
      response = handleFleetManifest();
    }
    else if (pathname === '/fleet/apple-touch-icon.png' && method === 'GET') {
      response = handleFleetAppleTouchIcon();
    }
    else if (pathname === '/fleet/icon-192.png' && method === 'GET') {
      response = handleFleetIcon192();
    }
    else if (pathname === '/fleet/icon-512.png' && method === 'GET') {
      response = handleFleetIcon512();
    }

    // ── Transcript LEDGER (machine JSON index of every captured ship/attempt;
    //    same capability scheme; Phase 3 of the RFC) ──────────────────────────
    else if (
      pathname.startsWith('/fleet/runs/') &&
      method === 'GET' &&
      /^\/fleet\/runs\/.+\/transcripts\.json$/.test(pathname)
    ) {
      const m = pathname.match(/^\/fleet\/runs\/(.+)\/transcripts\.json$/);
      response = await handleFleetRunTranscriptIndex(request, env, safeDecodeSegment(m?.[1] ?? ''));
    }

    // ── Raw ship session transcript (pd-transcript.v1 JSONL; same capability
    //    scheme as the run page — docs/FLEET-SESSION-TRANSCRIPTS.md) ─────────
    else if (
      pathname.startsWith('/fleet/runs/') &&
      method === 'GET' &&
      /^\/fleet\/runs\/.+\/transcript\/[^/]+\.jsonl$/.test(pathname)
    ) {
      const m = pathname.match(/^\/fleet\/runs\/(.+)\/transcript\/([^/]+)\.jsonl$/);
      response = await handleFleetRunTranscript(
        request,
        env,
        safeDecodeSegment(m?.[1] ?? ''),
        safeDecodeSegment(m?.[2] ?? ''),
      );
    }

    // ── Transcript VIEWER (HTML turn-card timeline over the same capture;
    //    same capability scheme; Phase 2 of the RFC) ─────────────────────────
    else if (
      pathname.startsWith('/fleet/runs/') &&
      method === 'GET' &&
      /^\/fleet\/runs\/.+\/transcript\/[^/]+$/.test(pathname)
    ) {
      const m = pathname.match(/^\/fleet\/runs\/(.+)\/transcript\/([^/]+)$/);
      response = await handleFleetRunTranscriptPage(
        request,
        env,
        safeDecodeSegment(m?.[1] ?? ''),
        safeDecodeSegment(m?.[2] ?? ''),
      );
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
    // Per-repo agent settings screen (session + GitHub repo ACL; the sitrep
    // dial lives here; src/repo-settings-page.ts).
    else if (pathname === '/account/repos' && method === 'GET') {
      response = await handleRepoSettingsPage(request, env);
    }
    else if (pathname === '/account/repos/set' && method === 'POST') {
      response = await handleRepoSettingsSet(request, env);
    }
    else if (pathname === '/account/repos/remove' && method === 'POST') {
      response = await handleRepoSettingsRemove(request, env);
    }
    // Device-facing read path for per-repo settings (pdu_ bearer or cookie).
    else if (pathname === '/v1/repo-settings' && method === 'GET') {
      response = await handleRepoSettingsApi(request, env);
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
    // ── Seamanship: the operator's skill catalog + the opt-in public listing ─
    // The catalog is READ LIVE from the operator's own repos through their
    // GitHub App installation — the repo is the source of truth and this Worker
    // never mirrors the corpus. Every path that exposes a skill to anyone but
    // its owner goes through the ONE predicate, isPublishableSkill
    // (src/seamanship.ts, re-exporting lib/shipwright/skill-visibility.ts).
    else if (pathname === '/account/seamanship' && method === 'GET') {
      response = await handleSeamanshipPage(request, env);
    }
    else if (pathname === '/account/seamanship/publish' && method === 'POST') {
      response = await handleSeamanshipPublishForm(request, env);
    }
    else if (pathname === '/v1/seamanship/publish' && method === 'POST') {
      response = await handleSeamanshipPublish(request, env);
    }
    // ── Snipe (the Engineman): suggestions, the approval gate, and the chat ─
    // The gate is structural, not conventional: approving is the ONLY act that
    // mints a build capability (src/snipe-builder.ts), the builder's signature
    // requires one, and the capability is single-use. No approval ⇒ no build ⇒
    // no pull request, and a pull request the operator merges is the only way
    // anything reaches a catalog.
    else if (pathname === '/account/seamanship/suggest' && method === 'POST') {
      response = await handleSnipeSuggest(request, env);
    }
    else if (pathname === '/account/seamanship/approve' && method === 'POST') {
      response = await handleSnipeApprove(request, env);
    }
    else if (pathname === '/account/seamanship/dismiss' && method === 'POST') {
      response = await handleSnipeDismiss(request, env);
    }
    else if (pathname === '/v1/seamanship/suggestions' && method === 'GET') {
      response = await handleSnipeSuggestionList(request, env);
    }
    // The Engineman's chat. Runs on the SHARED turn engine (src/chat-engine.ts)
    // — the same session gate, streaming path and DAILY SPEND CAP as every
    // other chat surface, not a second implementation of any of them.
    else if (pathname === '/account/seamanship/chat' && method === 'GET') {
      response = await handleSnipeChatPage(request, env);
    }
    else if (pathname === '/v1/snipe/history' && method === 'GET') {
      response = await handleSnipeHistory(request, env);
    }
    else if (pathname === '/v1/snipe/chat' && method === 'POST') {
      response = await handleSnipeChat(request, env);
    }
    else if (pathname === '/v1/snipe/clear' && method === 'POST') {
      response = await handleSnipeClear(request, env);
    }
    // PUBLIC listing. `/skills` and `/v1/skills` serve the LISTED tier only
    // (names + descriptions). The `@login/id` forms serve a full SKILL.md body
    // and are gated on a session AND a live `visibility: public`.
    else if (pathname === '/skills' && method === 'GET') {
      response = await handlePublicSkillsPage(request, env);
    }
    else if (pathname === '/v1/skills' && method === 'GET') {
      response = await handlePublicSkillsListing(request, env);
    }
    else if (pathname.startsWith('/skills/') && method === 'GET') {
      const qualified = decodeURIComponent(pathname.slice('/skills/'.length));
      response = await handlePublicSkillPage(request, env, qualified);
    }
    else if (pathname.startsWith('/v1/skills/') && method === 'GET') {
      const qualified = decodeURIComponent(pathname.slice('/v1/skills/'.length));
      response = await handlePublicSkillBody(request, env, qualified);
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
      } else if (pns && pname && pid && seg.length === 4 && pverb === 'verdict' && method === 'POST') {
        response = await handleParleyVerdictForm(request, env, pns, pname, pid);
      } else {
        response = new Response('Not Found', { status: 404 });
      }
    }

    // ── Mediator body (grand-plan node mediator-body; src/mediator-body.ts) ──
    // Machine routes: signed chained envelopes only (delegated to the ONE
    // publish gate); the kill toggle is operator-gated like /v1/fleet/pause.
    else if (pathname === '/v1/mediator/convene' && method === 'POST') {
      response = await handleMediatorConvene(request, env);
    }
    else if (pathname === '/v1/mediator/summons/respond' && method === 'POST') {
      response = await handleMediatorSummonsRespond(request, env);
    }
    else if (pathname === '/v1/fleet/mediator' && method === 'POST') {
      response = await handleMediatorToggle(request, env);
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
    else if (pathname === '/v1/shipwright/open-pr' && method === 'POST') {
      response = await handleShipwrightOpenPr(request, env);
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

    // X8 quota counters + shadow-vs-enforce delta (operator; src/billing.ts)
    else if (pathname.startsWith('/v1/quotas/') && method === 'GET') {
      const harborFp = decodeURIComponent(pathname.slice('/v1/quotas/'.length));
      response = await handleQuotaStatus(request, env, harborFp, ctx);
    }
    else if (pathname === '/billing/portal' && method === 'POST') {
      response = await handlePortalLink(request, env);
    }

    // ── X5 directory + whois (consent-first, D3; src/directory.ts) ───────────
    else if (pathname === '/v1/harbor/card' && method === 'PUT') {
      response = await handlePutHarborCard(request, env);
    }
    else if (pathname === '/v1/harbor/directory' && method === 'GET') {
      response = await handleDirectory(env);
    }
    else if (pathname === '/v1/harbor/directory/weights' && method === 'PUT') {
      response = await handleSetDirectoryWeights(request, env);
    }
    else if (pathname === '/v1/harbor/whois' && method === 'GET') {
      response = await handleWhois(request, env);
    }

    // ── Roadmap command-center mirror (operator mandate 2026-08-22, PR 1;
    // src/roadmap-mirror.ts). The daemon pushes; the account reads its own. ──
    else if (pathname === '/v1/roadmap/snapshot' && method === 'PUT') {
      response = await handleRoadmapSnapshotPut(request, env);
    }
    else if (pathname === '/v1/roadmap/mirror' && method === 'GET') {
      response = await handleRoadmapMirrorGet(request, env);
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
      } else if (ns && name && parts.length === 3 && sub === 'invites' && method === 'POST') {
        response = await handleMintHarborInvite(request, env, ns, name);
      } else if (ns && name && parts.length === 3 && sub === 'invites' && method === 'GET') {
        response = await handleListHarborInvites(request, env, ns, name);
      } else if (ns && name && sub === 'invites' && parts.length === 5 && parts[3] && parts[4] === 'revoke' && method === 'POST') {
        response = await handleRevokeHarborInvite(request, env, ns, name, parts[3]);
      } else if (ns && name && parts.length === 3 && sub === 'join' && method === 'POST') {
        response = await handleJoinHarbor(request, env, ns, name);
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
      // runtime 500. Matches the contract every handler already uses. The
      // requestId in the log line is the same one the caller receives.
      console.error(`[relay] ${requestId} INTERNAL_ERROR ${method} ${pathname}:`, e);
      response = Response.json(
        { error: 'internal relay error', code: 'INTERNAL_ERROR' },
        { status: 500 },
      );
    }

    // x7 slice 3 — requestId on every response (and inside every JSON error
    // envelope), then one SLO burn sample per request via waitUntil so the
    // write never sits on the response path. 5xx only: a caller's 4xx is not
    // the relay burning its own budget. recordSloSample never rejects; test
    // harnesses may pass a bare object as ctx, hence the guard.
    return finalizeResponse(response, requestId, pathname, env, ctx);
  },

  /**
   * Cron Triggers (ADR-0101; runtime-verification-for-agents). The Worker has
   * no long-running Arbiter loop, so scheduled maintenance runs here — the
   * design intent is that BOTH sweeps stay best-effort and never throw, since
   * a failed cron must not shadow the next fire. Two crons share this one
   * handler, dispatched on `event.cron` (wrangler.deploy.toml):
   *   "*⁠/5 * * * *" — MERCY health sweep only (probes are cheap).
   *   "0 *⁠/6 * * *" — retention/session-reap/erasure sweep (+ a MERCY sweep,
   *                    since every fire takes vitals).
   *
   * @param event The controller carrying which cron expression fired.
   * @param env Worker bindings (D1, KV, R2, queues).
   * @param ctx Execution context — sweeps ride `waitUntil` past the response.
   * @returns Resolves once the sweeps are scheduled (not completed).
   */
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
    // Snipe drainers. These are QUEUE DRAINS, not polls of operator state: a
    // suggestion job exists because a person asked for one, and a build grant
    // exists because a person approved something. They ride every fire so an
    // approved suggestion becomes a pull request in minutes rather than hours;
    // when both queues are empty each costs one indexed SELECT. Both are
    // internally fail-safe and return counter structs.
    ctx.waitUntil(
      runSnipeSuggestionSweep(env, Math.floor(Date.now() / 1000), {
        catalog: makeD1CatalogReader(env.DB),
      }).then((r) => {
        if (r.jobsRun === 0 && r.stuckReaped === 0 && r.errors.length === 0) return;
        const line =
          `[relay] snipe suggestion sweep: ran=${r.jobsRun} skipped=${r.jobsSkipped} ` +
          `produced=${r.suggestionsProduced} reaped=${r.stuckReaped} abandoned=${r.stuckFailed}`;
        if (r.errors.length) console.error(`${line} errors: ${r.errors.join('; ')}`);
        else console.log(line);
      }),
    );
    ctx.waitUntil(
      runSnipeBuildSweep(env, Math.floor(Date.now() / 1000)).then((r) => {
        if (r.claimed === 0 && r.errors.length === 0) return;
        const line =
          `[relay] snipe build sweep: claimed=${r.claimed} built=${r.built} ` +
          `failed=${r.failed} released=${r.released}`;
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
