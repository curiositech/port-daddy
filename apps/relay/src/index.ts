/**
 * Port Daddy Relay v0 — Cloudflare Worker entry point (ADR-0049)
 *
 * Routes:
 *   GET  /health
 *   POST /v1/handshake
 *   GET  /v1/subscribe/:session_id          (SSE)
 *   POST /v1/publish
 *   POST /v1/github/webhook                  (GitHub webhook ingress; HMAC-gated)
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
} satisfies ExportedHandler<Env>;
