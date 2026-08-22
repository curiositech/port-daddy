/**
 * Port Daddy Relay — Route handlers (ADR-0049)
 *
 * Each handler is a pure function: (request, env, ctx) → Response.
 * Routing is in index.ts.
 *
 * Security fixes applied (red-team round 1):
 *   S1  Operator token comparison now timing-safe (timingSafeEqual)
 *   S2  Capability check in handleHandshake uses matchCapability (not ad-hoc prefix)
 *   S3  Card issuer key resolved from header.kid — relay-issued cards use relay's key
 *   S4  Revocation broadcast wired: handleRevoke fans out to harbor DOs
 *   S5  OIDC JTI deduplication: oidc_exchanges table, one-time-use enforced
 *   S6  Harbor-binding check: card.iss/aud must match channel harbor_fingerprint prefix
 *   S7  n/a here — ServerHello verification is in relay-client.ts
 *   S8  handleExchange: body.cap server-side attenuated; admin op rejected
 */

import {
  computeEventHash,
  randomHex,
  signServerHello,
  signChainHead,
  pubKeyFromPrivKey,
  verifyEd25519,
  hashHex,
  fromHex,
  toHex,
  timingSafeEqual,
} from './crypto.js';
import {
  getIdentity,
  upsertIdentity,
  createSession,
  getSession,
  getChainHead,
  upsertChainHead,
  insertRevocation,
  revokeByIssuer,
  getIssuer,
  setIssuerDisabled,
  appendAudit,
  queryAuditLog,
  insertEvent,
  ChainError,
} from './db.js';
import { verifyCard, extractCardSub, extractBearerToken, CardError, matchCapability } from './auth.js';
import { tryDecodeTransitEnvelope } from './envelope.js';
import { fetchJwks, verifyOidcToken, invalidateJwksCache, OidcError } from './oidc.js';
import { harborChannelKey } from './harbor-channel.js';
import {
  harborQuotaKey,
  quotaGateResponse,
  resolveQuotaSettings,
  type QuotaCheckRequest,
  type QuotaVerdict,
} from './harbor-quota.js';
import { recordHookEvent } from './mercy-hooks.js';
import type {
  Env,
  ClientHello,
  ServerHello,
  SubscriptionStatus,
  RelayEvent,
  PublishRequest,
  OidcExchangeRequest,
  OidcExchangeResponse,
  RevokeRequest,
  RevokeByIssuerRequest,
  RelayError,
  ChainHead,
  CapabilityEntry,
} from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(code: string, detail: string, status = 400): Response {
  const body: RelayError = { error: detail, code };
  return Response.json(body, { status });
}

function isQuotaVerdict(value: unknown): value is QuotaVerdict {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const verdict = value as Record<string, unknown>;
  if (typeof verdict.allowed !== 'boolean') return false;
  if (verdict.shadow !== undefined && typeof verdict.shadow !== 'boolean') return false;
  if (
    verdict.retryAfterSeconds !== undefined &&
    (!Number.isSafeInteger(verdict.retryAfterSeconds) || (verdict.retryAfterSeconds as number) <= 0)
  ) {
    return false;
  }
  if (verdict.allowed) {
    return verdict.code === undefined && verdict.retryAfterSeconds === undefined;
  }
  return (
    (verdict.code === 'RATE_LIMITED' || verdict.code === 'QUOTA_EXHAUSTED') &&
    typeof verdict.retryAfterSeconds === 'number'
  );
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

// S1: timing-safe operator token check.
// Exported so the fleet control-plane handlers (fleet-control.ts) reuse the
// exact same gate rather than re-implementing the token comparison.
export function operatorOnly(request: Request, env: Env): Response | null {
  // Fail-closed: a missing or too-short operator token means the deployment is
  // misconfigured. Reject every request rather than silently comparing against
  // an empty/undefined secret (which would let a blank token through).
  if (!env.RELAY_OPERATOR_TOKEN || env.RELAY_OPERATOR_TOKEN.length < 32) {
    return err(
      'MISCONFIGURED',
      'RELAY_OPERATOR_TOKEN is not configured or shorter than the 32-character minimum',
      500
    );
  }
  const auth = request.headers.get('Authorization');
  const token = auth?.replace(/^Bearer\s+/i, '') ?? '';
  if (!timingSafeEqual(token, env.RELAY_OPERATOR_TOKEN)) {
    return err('UNAUTHORIZED', 'Operator token required', 401);
  }
  return null;
}

// S3: resolve the issuer pubkey for a harbor card.
// Relay-issued cards (from /v1/exchange) have kid = relay fingerprint.
// Daemon-issued Phase 2 cards have kid = daemon fingerprint (same as sub).
// Returns the key to pass to verifyCard(), or null if unknown issuer.
async function resolveIssuerKey(
  env: Env,
  cardKid: string | undefined,
  daemonPubKey: string
): Promise<string | null> {
  const { sha256 } = await import('@noble/hashes/sha256');
  const relayPubKey = pubKeyFromPrivKey(env.RELAY_ED25519_PRIVATE_KEY_HEX);
  const relayFp = toHex(sha256(fromHex(relayPubKey)));

  if (cardKid === relayFp) {
    // Relay-issued card (from /v1/exchange)
    return relayPubKey;
  }
  // Daemon-issued Phase 2 card: use the daemon's own pubkey
  return daemonPubKey;
}

// ── GET /health ───────────────────────────────────────────────────────────────

export function handleHealth(env: Env): Response {
  return Response.json({ status: 'ok', version: env.RELAY_VERSION });
}

// ── POST /v1/handshake ────────────────────────────────────────────────────────

export async function handleHandshake(
  request: Request,
  env: Env
): Promise<Response> {
  let body: ClientHello;
  try {
    body = await request.json() as ClientHello;
  } catch {
    return err('BAD_JSON', 'Request body must be JSON');
  }

  if (!body.card || !body.nonce_c || !body.sig) {
    return err('MISSING_FIELDS', 'card, nonce_c, sig required');
  }

  // Decode card to get sub+iss+jti
  let sub: string, iss: string, jti: string;
  let cardKid: string | undefined;
  try {
    ({ sub, iss, jti } = extractCardSub(body.card));
    // Also read kid from header for issuer key resolution (S3)
    const headerPart = body.card.split('.')[0];
    if (headerPart) {
      const dec = new TextDecoder();
      const { base64UrlDecode } = await import('./crypto.js');
      const hdr = JSON.parse(dec.decode(base64UrlDecode(headerPart))) as { alg?: string; kid?: string };
      cardKid = hdr.kid;
    }
  } catch {
    return err('MALFORMED_CARD', 'Cannot decode card');
  }

  // Look up daemon's pubkey in identity registry
  const identity = await getIdentity(env.DB, sub);
  if (!identity) return err('UNKNOWN_IDENTITY', 'Daemon not in identity registry', 401);
  if (identity.revoked) return err('REVOKED', 'Daemon identity revoked', 401);

  // S3: resolve correct issuer key
  const issuerKey = await resolveIssuerKey(env, cardKid, identity.pub_key);
  if (!issuerKey) return err('UNKNOWN_ISSUER_KEY', 'Cannot resolve issuer key for card', 401);

  // Verify card signature
  const verifiedCard = await (async () => {
    try {
      return await verifyCard(body.card, env.DB, issuerKey, 'sub', '*');
    } catch (e) {
      return e instanceof CardError ? e : new CardError('VERIFY_ERROR', String(e));
    }
  })();
  if (verifiedCard instanceof CardError) {
    return err(verifiedCard.code, verifiedCard.message, 401);
  }

  // Verify ClientHello signature: sig over SHA256(card + nonce_c), using daemon's own key
  const helloMsg = hashHex(body.card + body.nonce_c);
  const sigValid = await verifyEd25519(identity.pub_key, helloMsg, body.sig);
  if (!sigValid) return err('BAD_SIG', 'ClientHello signature invalid', 401);

  // Compute relay fingerprint once for harbor-binding checks below
  const { sha256: sha256hs } = await import('@noble/hashes/sha256');
  const relayFp = toHex(sha256hs(fromHex(pubKeyFromPrivKey(env.RELAY_ED25519_PRIVATE_KEY_HEX))));

  // Resolve subscriptions
  const accepted: SubscriptionStatus[] = [];
  const rejected: SubscriptionStatus[] = [];

  for (const channel of (body.subscriptions ?? [])) {
    // S2: use matchCapability (correct prefix semantics, no ad-hoc re-implementation)
    const capMatch = matchCapability(verifiedCard.cap ?? [], 'sub', channel);

    if (!capMatch) {
      rejected.push({ channel, tip_seq: null, tip_hash: null, reason: 'INSUFFICIENT_CAP' });
      continue;
    }

    // S6 (strengthened): harbor-binding via D1 membership for daemon-issued cards,
    // card.iss comparison for relay-issued cards.
    const channelHarborFp = channel.split(':')[0] ?? '';
    if (cardKid === relayFp) {
      // Relay-issued card: iss is relay-authoritative
      if (channelHarborFp !== verifiedCard.iss && channelHarborFp !== verifiedCard.aud) {
        rejected.push({ channel, tip_seq: null, tip_hash: null, reason: 'HARBOR_MISMATCH' });
        continue;
      }
    } else {
      // Daemon-issued card: verify membership in D1
      const member = await env.DB.prepare(
        'SELECT 1 FROM harbor_members WHERE daemon_fingerprint = ? AND harbor_fingerprint = ?'
      ).bind(sub, channelHarborFp).first();
      if (!member) {
        rejected.push({ channel, tip_seq: null, tip_hash: null, reason: 'HARBOR_NOT_MEMBER' });
        continue;
      }
    }

    const head = await getChainHead(env.DB, sub, channel);
    accepted.push({
      channel,
      tip_seq: head?.tip_seq ?? null,
      tip_hash: head?.tip_hash ?? null,
    });
  }

  // Mint session
  const sessionId = randomHex(16);
  const nonceS = randomHex(32);
  const now = Math.floor(Date.now() / 1000);
  const sessionTtl = parseInt(env.SESSION_TTL_SECONDS, 10);

  await env.DB.prepare(`
    INSERT INTO sessions (session_id, fingerprint, nonce_c, nonce_s, subs_json, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sessionId, sub, body.nonce_c, nonceS,
    JSON.stringify(accepted.map((s) => s.channel)),
    now, now + sessionTtl,
  ).run();

  // Sign ServerHello
  const relayPrivKey = env.RELAY_ED25519_PRIVATE_KEY_HEX;
  const relaySig = await signServerHello(relayPrivKey, sessionId, body.nonce_c, nonceS);
  const relayPubKey = pubKeyFromPrivKey(relayPrivKey);

  const serverHello: ServerHello = {
    v: 1,
    server_hello: true,
    session_id: sessionId,
    nonce_c: body.nonce_c,
    nonce_s: nonceS,
    accepted_subs: accepted,
    rejected_subs: rejected,
    sig: relaySig,
    relay_pub_key: relayPubKey,
  };

  await appendAudit(env.DB, {
    daemon_fingerprint: sub,
    action: 'handshake',
    target: sessionId,
    ip: clientIp(request),
  });

  return Response.json(serverHello);
}

// ── GET /v1/subscribe/:session_id (SSE) ───────────────────────────────────────

export async function handleSubscribe(
  request: Request,
  env: Env,
  sessionId: string
): Promise<Response> {
  // SSRF guard: sessionId is interpolated into the Durable Object fetch URL
  // below. Validate its shape before it touches any query or URL so a crafted
  // value cannot inject extra path/query segments into the DO request.
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) {
    return err('INVALID_SESSION', 'Invalid session_id format', 400);
  }
  const session = await env.DB.prepare(
    'SELECT * FROM sessions WHERE session_id = ?'
  ).bind(sessionId).first<{
    session_id: string; fingerprint: string; nonce_c: string; nonce_s: string;
    subs_json: string; created_at: number; expires_at: number;
  }>();
  if (!session) return err('UNKNOWN_SESSION', 'Session not found', 404);

  const now = Math.floor(Date.now() / 1000);
  if (now > session.expires_at) return err('SESSION_EXPIRED', 'Session has expired', 401);

  const accept = request.headers.get('Accept') ?? '';
  if (!accept.includes('text/event-stream')) {
    return err('WRONG_ACCEPT', 'Accept: text/event-stream required');
  }

  const subs: string[] = JSON.parse(session.subs_json);
  if (subs.length === 0) {
    return err('NO_SUBSCRIPTIONS', 'No accepted subscriptions in session');
  }

  const firstChannel = subs[0];
  const colonIdx = firstChannel?.indexOf(':') ?? -1;
  const harborFp = colonIdx >= 0 ? firstChannel!.slice(0, colonIdx) : '';
  const channelName = colonIdx >= 0 ? firstChannel!.slice(colonIdx + 1) : firstChannel ?? '';

  if (!harborFp) {
    return err('BAD_CHANNEL', 'Channel must be harbor_fingerprint:name');
  }

  const doKey = harborChannelKey(harborFp, channelName);
  const doId = env.HARBOR_CHANNEL.idFromName(doKey);
  const stub = env.HARBOR_CHANNEL.get(doId);

  const fromSeq = parseInt(
    new URL(request.url).searchParams.get('from_seq') ?? '0',
    10
  );

  // If fromSeq > 0, fetch missed events from D1 and prepend them to the live SSE stream.
  // This closes the replay gap: a reconnecting subscriber with last_seq=N gets events N+1..tip
  // before the live stream opens, preventing silent event loss.
  if (fromSeq > 0) {
    const missedEvents = await env.DB.prepare(
      `SELECT sender, channel, seq, prev_hash, this_hash, iat, ciphertext, sig
       FROM events WHERE channel = ? AND seq > ? ORDER BY seq ASC LIMIT 500`
    ).bind(firstChannel, fromSeq).all<{
      sender: string; channel: string; seq: number; prev_hash: string; this_hash: string;
      iat: number; ciphertext: string; sig: string;
    }>();

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();

    // Write backfill events synchronously before handing off to DO
    const backfillPromise = (async () => {
      for (const row of missedEvents.results) {
        const ev = { v: 1 as const, ...row };
        const msg = { type: 'event' as const, payload: JSON.stringify(ev) };
        await writer.write(enc.encode(`data: ${JSON.stringify(msg)}\n\n`));
      }
      // Pipe the DO live stream into the remainder
      const doUrl = `http://do/${encodeURIComponent(doKey)}?action=subscribe&session_id=${encodeURIComponent(sessionId)}&from_seq=${encodeURIComponent(fromSeq)}`;
      const doResp = await stub.fetch(doUrl);
      if (!doResp.ok || !doResp.body) {
        throw new Error(`DO subscribe failed with status ${doResp.status}`);
      }

      const reader = doResp.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.close();
    })();

    // Don't await backfillPromise — it writes into the stream asynchronously while the
    // Response streams to the client. Unhandled rejection on backfill closes the stream.
    backfillPromise.catch(() => writer.abort());

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  const doUrl = `http://do/${encodeURIComponent(doKey)}?action=subscribe&session_id=${encodeURIComponent(sessionId)}&from_seq=${encodeURIComponent(fromSeq)}`;
  return stub.fetch(doUrl);
}

// ── POST /v1/publish ──────────────────────────────────────────────────────────

export async function handlePublish(
  request: Request,
  env: Env
): Promise<Response> {
  let body: PublishRequest;
  try {
    body = await request.json() as PublishRequest;
  } catch {
    return err('BAD_JSON', 'Request body must be JSON');
  }

  const cardJwt = body.card ?? extractBearerToken(request.headers.get('Authorization'));
  if (!cardJwt) return err('MISSING_CARD', 'Harbor card required (Authorization: Bearer or body.card)', 401);

  const event = body.event;
  if (!event) return err('MISSING_EVENT', 'event required');

  // Decode card
  let sub: string, iss: string, jti: string;
  let cardKid: string | undefined;
  try {
    ({ sub, iss, jti } = extractCardSub(cardJwt));
    const headerPart = cardJwt.split('.')[0];
    if (headerPart) {
      const dec = new TextDecoder();
      const { base64UrlDecode } = await import('./crypto.js');
      const hdr = JSON.parse(dec.decode(base64UrlDecode(headerPart))) as { kid?: string };
      cardKid = hdr.kid;
    }
  } catch {
    return err('MALFORMED_CARD', 'Cannot decode card');
  }

  const identity = await getIdentity(env.DB, sub);
  if (!identity) return err('UNKNOWN_IDENTITY', 'Daemon not registered', 401);
  if (identity.revoked) return err('REVOKED', 'Daemon identity revoked', 401);

  const channelName = event.channel;
  const channelHarborFp = channelName.split(':')[0] ?? '';

  // S6 (strengthened): harbor-binding check using D1 membership, not card.iss.
  // card.iss is attacker-controlled for daemon-issued Phase 2 cards.
  // The authoritative source is harbor_members.
  const { sha256: sha256sync } = await import('@noble/hashes/sha256');
  const relayPubKeyForCheck = pubKeyFromPrivKey(env.RELAY_ED25519_PRIVATE_KEY_HEX);
  const relayFpForCheck = toHex(sha256sync(fromHex(relayPubKeyForCheck)));

  if (cardKid === relayFpForCheck) {
    // Relay-issued card: trust card.iss (relay set it deterministically from OIDC claims)
    if (channelHarborFp !== iss) {
      return err('HARBOR_MISMATCH', `Card iss ${iss} does not match channel harbor ${channelHarborFp}`, 403);
    }
  } else {
    // Daemon-issued Phase 2 card: verify membership in D1, not via card.iss
    const member = await env.DB.prepare(
      'SELECT 1 FROM harbor_members WHERE daemon_fingerprint = ? AND harbor_fingerprint = ?'
    ).bind(sub, channelHarborFp).first();
    if (!member) {
      return err('HARBOR_MISMATCH', `Daemon ${sub} is not a member of harbor ${channelHarborFp}`, 403);
    }
  }

  // S3: resolve correct issuer key
  const issuerKey = await resolveIssuerKey(env, cardKid, identity.pub_key);
  if (!issuerKey) return err('UNKNOWN_ISSUER_KEY', 'Cannot resolve issuer key for card', 401);

  let card;
  try {
    card = await verifyCard(cardJwt, env.DB, issuerKey, 'pub', channelName);
  } catch (e) {
    if (e instanceof CardError) return err(e.code, e.message, 401);
    throw e;
  }

  // Rate limit + daily budget check (X8: one round-trip to the per-harbor
  // aggregating HarborQuota DO, which carries BOTH the per-sender minute rate
  // limit and the per-harbor daily event/byte budgets on durable storage).
  const colonIdx = channelName.indexOf(':');
  const harborFp = colonIdx >= 0 ? channelName.slice(0, colonIdx) : '';
  const channelPart = colonIdx >= 0 ? channelName.slice(colonIdx + 1) : channelName;

  if (harborFp) {
    const capEntry = matchCapability(card.cap, 'pub', channelName);
    const rateLimit = capEntry?.rate_per_min ?? 60;
    if (env.HARBOR_QUOTA) {
      const settings = resolveQuotaSettings(env);
      // Measure decoded ciphertext bytes for the byte budget. A malformed
      // ciphertext falls back to string length here so the pre-existing error
      // ordering (sender mismatch fires before decode) is preserved; the
      // payload-size gate below still decodes strictly.
      const { base64UrlDecode: b64ForQuota } = await import('./crypto.js');
      let eventBytes: number;
      try {
        eventBytes = b64ForQuota(event.ciphertext).length;
      } catch {
        eventBytes = event.ciphertext.length;
      }
      const checkBody: QuotaCheckRequest = {
        sender: sub,
        ratePerMin: rateLimit,
        eventBytes,
        eventBudget: settings.eventBudget,
        byteBudget: settings.byteBudget,
        enforce: settings.enforce,
      };
      const quotaStub = env.HARBOR_QUOTA.get(env.HARBOR_QUOTA.idFromName(harborQuotaKey(harborFp)));
      let verdict: QuotaVerdict;
      try {
        const quotaResp = await quotaStub.fetch('http://do/?action=check', {
          method: 'POST',
          body: JSON.stringify(checkBody),
        });
        if (!quotaResp.ok) {
          return err('QUOTA_ERROR', 'Harbor quota gate unavailable or returned an invalid verdict', 503);
        }
        const candidate: unknown = await quotaResp.json();
        if (!isQuotaVerdict(candidate)) {
          return err('QUOTA_ERROR', 'Harbor quota gate unavailable or returned an invalid verdict', 503);
        }
        verdict = candidate;
      } catch {
        return err('QUOTA_ERROR', 'Harbor quota gate unavailable or returned an invalid verdict', 503);
      }
      // X8 mercy hooks (x7-mercy-hooks): budget verdicts feed the hook
      // ledger the sweep aggregates — an enforced 429 as `x8_quota_exhausted`,
      // a shadow-mode pass that enforcement WOULD have refused as
      // `x8_quota_shadow_denied` (the flip-decision signal). recordHookEvent
      // never throws; a plain rate-limit refusal predates X8 and is not one
      // of its hooks.
      const hookNow = Math.floor(Date.now() / 1000);
      if (verdict.shadow === true) {
        await recordHookEvent(env.DB, 'x8_quota_shadow_denied', 'warn', `harbor ${harborFp}: over daily budget, passed in shadow`, hookNow);
      }
      const refusal = quotaGateResponse(verdict, rateLimit);
      if (refusal) {
        if (verdict.code === 'QUOTA_EXHAUSTED') {
          await recordHookEvent(env.DB, 'x8_quota_exhausted', 'warn', `harbor ${harborFp}: publish refused 429 QUOTA_EXHAUSTED`, hookNow);
        }
        return refusal;
      }
    } else {
      // Deploy-order fallback: HARBOR_QUOTA binding not provisioned yet.
      // Rate limiting must never fail open, so the legacy in-memory
      // HarborChannel limiter keeps guarding until the binding ships.
      const doId = env.HARBOR_CHANNEL.idFromName(harborChannelKey(harborFp, channelPart));
      const stub = env.HARBOR_CHANNEL.get(doId);
      const rateResp = await stub.fetch(
        `http://do/?action=rate-check&sender=${sub}&limit=${rateLimit}`
      );
      const { allowed } = await rateResp.json() as { allowed: boolean };
      if (!allowed) {
        return err('RATE_LIMITED', `Rate limit ${rateLimit}/min exceeded`, 429);
      }
    }
  }

  // Sender must match the authenticated daemon (card.sub)
  if (event.sender !== sub) {
    return err('SENDER_MISMATCH', `event.sender ${event.sender} does not match authenticated daemon ${sub}`, 403);
  }

  // Payload size check — measure decoded bytes, not base64url string length
  const capEntry = matchCapability(card.cap, 'pub', channelName);
  const maxBytes = capEntry?.max_payload_bytes ?? 65536;
  const { base64UrlDecode: b64dec } = await import('./crypto.js');
  const ciphertextBytes = b64dec(event.ciphertext).length;
  if (ciphertextBytes > maxBytes) {
    return err('PAYLOAD_TOO_LARGE', `Payload exceeds ${maxBytes} bytes limit`, 413);
  }

  // Verify event hash
  const expectedHash = computeEventHash({
    prev_hash: event.prev_hash,
    sender: event.sender,
    channel: event.channel,
    seq: event.seq,
    iat: event.iat,
    ciphertext: event.ciphertext,
  });

  if (expectedHash !== event.this_hash) {
    return err('HASH_MISMATCH', 'event.this_hash does not match computed hash');
  }

  // Verify event signature: sig over this_hash, using daemon's own key
  const sigValid = await verifyEd25519(identity.pub_key, event.this_hash, event.sig);
  if (!sigValid) return err('BAD_SIG', 'Event signature invalid', 401);

  // N1 classification probe (ADR-0123 §6), detect-and-warn window: every
  // transit body must be a sealed|relay_readable envelope. A body without the
  // label (any pre-envelope daemon publish) is still accepted this release; the
  // audit row sizes the blast radius before this gate flips to reject.
  // Relay-produced events are gated harder at their producer
  // (github-webhook.ts: assertClassified on egress).
  if (!tryDecodeTransitEnvelope(event.ciphertext)) {
    await appendAudit(env.DB, {
      daemon_fingerprint: sub,
      action: 'publish_unclassified_envelope',
      target: channelName,
      detail: `seq=${event.seq} transit body carries no sealed|relay_readable classification`,
    }).catch(() => {});
  }

  // Persist event
  try {
    await insertEvent(env.DB, event);
  } catch (e) {
    if (e instanceof ChainError) return err(e.code, e.message, 409);
    throw e;
  }

  // Update chain head
  const head: ChainHead = {
    sender: event.sender,
    channel: event.channel,
    tip_seq: event.seq,
    tip_hash: event.this_hash,
    issued_at: Math.floor(Date.now() / 1000),
    signed_head: await signChainHead(
      env.RELAY_ED25519_PRIVATE_KEY_HEX,
      event.sender,
      event.channel,
      event.seq,
      event.this_hash
    ),
  };
  await upsertChainHead(env.DB, head);

  // Fan-out to DO subscribers
  if (harborFp) {
    const doId = env.HARBOR_CHANNEL.idFromName(harborChannelKey(harborFp, channelPart));
    const stub = env.HARBOR_CHANNEL.get(doId);
    void stub.fetch(`http://do/?action=publish`, {
      method: 'POST',
      body: JSON.stringify({ event: JSON.stringify(event) }),
    });
  }

  await appendAudit(env.DB, {
    daemon_fingerprint: sub,
    action: 'publish',
    target: channelName,
    ip: clientIp(request),
    detail: `seq=${event.seq}`,
  });

  return Response.json({ ok: true, seq: event.seq, this_hash: event.this_hash });
}

// ── POST /v1/exchange (OIDC → PD card) ───────────────────────────────────────

// S8: allowed capability ops from OIDC exchange (no admin; channels scoped to harbor)
const MAX_OIDC_RATE_PER_MIN = 120;
const MAX_OIDC_PAYLOAD_BYTES = 65536;
const ALLOWED_OIDC_OPS = new Set(['pub', 'sub']);

function attenuateOidcCaps(
  requestedCaps: CapabilityEntry[],
  harborFp: string
): CapabilityEntry[] {
  return requestedCaps.map((c) => {
    if (!ALLOWED_OIDC_OPS.has(c.op)) {
      throw new CardError('FORBIDDEN_OP', `OIDC exchange does not allow op: ${c.op}`);
    }
    // Channel must be within the harbor fingerprint
    const channelPrefix = c.channel.split(':')[0] ?? '';
    if (c.channel !== '*' && channelPrefix !== harborFp) {
      throw new CardError('HARBOR_MISMATCH', `Channel ${c.channel} outside issuer harbor ${harborFp}`);
    }
    return {
      op: c.op,
      channel: c.channel,
      rate_per_min: Math.min(c.rate_per_min ?? MAX_OIDC_RATE_PER_MIN, MAX_OIDC_RATE_PER_MIN),
      max_payload_bytes: Math.min(c.max_payload_bytes ?? MAX_OIDC_PAYLOAD_BYTES, MAX_OIDC_PAYLOAD_BYTES),
    };
  });
}

export async function handleExchange(
  request: Request,
  env: Env
): Promise<Response> {
  let body: OidcExchangeRequest;
  try {
    body = await request.json() as OidcExchangeRequest;
  } catch {
    return err('BAD_JSON', 'Request body must be JSON');
  }

  if (!body.oidc_token || !body.pub_key || !body.cap) {
    return err('MISSING_FIELDS', 'oidc_token, pub_key, cap required');
  }

  // Decode JWT header to find issuer
  const parts = body.oidc_token.split('.');
  if (parts.length !== 3) return err('MALFORMED_JWT', 'OIDC token must be 3-part JWT');

  let claims: { iss: string };
  try {
    const dec = new TextDecoder();
    const { base64UrlDecode } = await import('./crypto.js');
    claims = JSON.parse(dec.decode(base64UrlDecode(parts[1]!))) as { iss: string };
  } catch {
    return err('MALFORMED_JWT', 'Cannot decode OIDC token payload');
  }

  const issuerRow = await getIssuer(env.DB, claims.iss);
  if (!issuerRow) {
    return err('UNKNOWN_ISSUER', `Issuer ${claims.iss} not registered`, 401);
  }
  if (issuerRow.disabled) {
    return err('ISSUER_DISABLED', `Issuer ${claims.iss} has been disabled`, 401);
  }

  // Fetch + verify OIDC token
  let oidcClaims;
  try {
    const jwks = await fetchJwks(env, issuerRow);
    oidcClaims = await verifyOidcToken(env, body.oidc_token, issuerRow, jwks);
  } catch (e) {
    if (e instanceof OidcError) return err(e.code, e.message, 401);
    return err('OIDC_ERROR', String(e), 401);
  }

  // Compute fingerprints
  const { sha256 } = await import('@noble/hashes/sha256');
  const fingerprint = toHex(sha256(fromHex(body.pub_key)));
  const harborFp = toHex(sha256(new TextEncoder().encode(oidcClaims.repository_owner)));

  // S8: attenuate requested capabilities server-side (do this before JTI claim)
  let attenuatedCap: CapabilityEntry[];
  try {
    attenuatedCap = attenuateOidcCaps(body.cap as CapabilityEntry[], harborFp);
  } catch (e) {
    if (e instanceof CardError) return err(e.code, e.message, 403);
    throw e;
  }

  // S5 (TOCTOU fix): INSERT first — the UNIQUE PK constraint is the atomic gate.
  // Drop the SELECT; a concurrent race will hit SQLITE_CONSTRAINT on the second INSERT.
  // Only proceed to upsertIdentity and card minting after this INSERT succeeds.
  try {
    await env.DB.prepare(
      'INSERT INTO oidc_exchanges (oidc_jti, exchanged_at, daemon_fingerprint) VALUES (?, ?, ?)'
    ).bind(oidcClaims.jti, Math.floor(Date.now() / 1000), fingerprint).run();
  } catch (e: unknown) {
    // D1 raises a generic Error whose message contains "UNIQUE constraint failed"
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE constraint failed') || msg.includes('SQLITE_CONSTRAINT')) {
      return err('JTI_REUSED', 'OIDC token has already been exchanged', 409);
    }
    throw e;
  }

  // Register/update identity (only reached if JTI was fresh)
  await upsertIdentity(env.DB, {
    daemon_fingerprint: fingerprint,
    pub_key: body.pub_key,
    proof_method: 'oidc',
    proof_metadata: JSON.stringify({
      issuer: oidcClaims.iss,
      jti: oidcClaims.jti,
      iat: oidcClaims.iat,
      repository_owner: oidcClaims.repository_owner,
      repository: oidcClaims.repository,
    }),
    expires_at: oidcClaims.exp,
  });

  // Build harbor card JWT signed by relay's key
  const now = Math.floor(Date.now() / 1000);
  const cardExp = now + 3600;

  // S3: kid = relay fingerprint so verifiers know to use relay's key
  const relayPubKey = pubKeyFromPrivKey(env.RELAY_ED25519_PRIVATE_KEY_HEX);
  const relayFp = toHex(sha256(fromHex(relayPubKey)));

  const cardHeader = { alg: 'EdDSA', kid: relayFp };
  const cardPayload = {
    hv: 2,
    sub: fingerprint,
    iss: harborFp,
    aud: harborFp,
    exp: cardExp,
    iat: now,
    jti: randomHex(16),
    cap: attenuatedCap,
  };

  const headerB64 = btoa(JSON.stringify(cardHeader)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const payloadB64 = btoa(JSON.stringify(cardPayload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const msgHex = hashHex(`${headerB64}.${payloadB64}`);
  const sig = await (await import('./crypto.js')).signEd25519(env.RELAY_ED25519_PRIVATE_KEY_HEX, msgHex);
  const sigBytes = fromHex(sig);
  const sigB64url = btoa(String.fromCharCode(...sigBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const card = `${headerB64}.${payloadB64}.${sigB64url}`;

  await appendAudit(env.DB, {
    daemon_fingerprint: fingerprint,
    action: 'oidc_exchange',
    target: oidcClaims.repository,
    ip: clientIp(request),
    detail: `issuer=${oidcClaims.iss}`,
  });

  const response: OidcExchangeResponse = { card, exp: cardExp };
  return Response.json(response);
}

// ── POST /v1/revoke ───────────────────────────────────────────────────────────

export async function handleRevoke(
  request: Request,
  env: Env
): Promise<Response> {
  let body: RevokeRequest;
  try {
    body = await request.json() as RevokeRequest;
  } catch {
    return err('BAD_JSON', 'Request body must be JSON');
  }

  if (!body.jti || !body.sig) return err('MISSING_FIELDS', 'jti, sig required');

  const cardJwt = extractBearerToken(request.headers.get('Authorization'));
  if (!cardJwt) return err('MISSING_CARD', 'Authorization: Bearer card required', 401);

  let sub: string;
  try {
    ({ sub } = extractCardSub(cardJwt));
  } catch {
    return err('MALFORMED_CARD', 'Cannot decode card');
  }

  const identity = await getIdentity(env.DB, sub);
  if (!identity) return err('UNKNOWN_IDENTITY', 'Daemon not registered', 401);

  const msgHex = hashHex('revoke:' + body.jti);
  const valid = await verifyEd25519(identity.pub_key, msgHex, body.sig);
  if (!valid) return err('BAD_SIG', 'Revocation signature invalid', 401);

  await insertRevocation(env.DB, body.jti, sub, body.reason);

  // S4: broadcast revocation to all harbor DOs this daemon is a member of
  const harborRows = await env.DB.prepare(
    'SELECT harbor_fingerprint FROM harbor_members WHERE daemon_fingerprint = ?'
  ).bind(sub).all<{ harbor_fingerprint: string }>();

  const broadcastAt = Math.floor(Date.now() / 1000);
  for (const row of harborRows.results) {
    const doId = env.HARBOR_CHANNEL.idFromName(
      harborChannelKey(row.harbor_fingerprint, '_relay:revocations')
    );
    const stub = env.HARBOR_CHANNEL.get(doId);
    void stub.fetch(`http://do/?action=revoke`, {
      method: 'POST',
      body: JSON.stringify({ jti: body.jti, revoked_at: broadcastAt }),
    });
  }

  await appendAudit(env.DB, {
    daemon_fingerprint: sub,
    action: 'revoke',
    target: body.jti,
    ip: clientIp(request),
    detail: body.reason,
  });

  return Response.json({ ok: true, jti: body.jti });
}

// ── POST /v1/revoke-by-issuer (acceptance criterion #2) ──────────────────────

export async function handleRevokeByIssuer(
  request: Request,
  env: Env
): Promise<Response> {
  const authErr = operatorOnly(request, env);
  if (authErr) return authErr;

  let body: RevokeByIssuerRequest;
  try {
    body = await request.json() as RevokeByIssuerRequest;
  } catch {
    return err('BAD_JSON', 'Request body must be JSON');
  }

  if (!body.issuer || !body.iat_min || !body.iat_max) {
    return err('MISSING_FIELDS', 'issuer, iat_min, iat_max required');
  }

  const revokedJtis = await revokeByIssuer(
    env.DB,
    body.issuer,
    body.iat_min,
    body.iat_max,
    body.reason ?? 'issuer-bulk-revoke'
  );

  // S4: broadcast all revocations to all harbor DOs
  // For bulk revoke, broadcast to the special _relay:revocations channel across known harbors.
  const allHarbors = await env.DB.prepare(
    'SELECT DISTINCT harbor_fingerprint FROM harbor_members'
  ).all<{ harbor_fingerprint: string }>();

  const broadcastAt = Math.floor(Date.now() / 1000);
  for (const row of allHarbors.results) {
    for (const jti of revokedJtis) {
      const doId = env.HARBOR_CHANNEL.idFromName(
        harborChannelKey(row.harbor_fingerprint, '_relay:revocations')
      );
      void env.HARBOR_CHANNEL.get(doId).fetch(`http://do/?action=revoke`, {
        method: 'POST',
        body: JSON.stringify({ jti, revoked_at: broadcastAt }),
      });
    }
  }

  await appendAudit(env.DB, {
    action: 'bulk_revoke_by_issuer',
    target: body.issuer,
    detail: `iat_min=${body.iat_min} iat_max=${body.iat_max} count=${revokedJtis.length}`,
  });

  return Response.json({ ok: true, revoked_count: revokedJtis.length, revoked_jtis: revokedJtis });
}

// ── GET /v1/chain-head/:sender/:channel ───────────────────────────────────────

export async function handleChainHead(
  env: Env,
  sender: string,
  channel: string
): Promise<Response> {
  const head = await getChainHead(env.DB, sender, channel);
  if (!head) return err('NOT_FOUND', 'No chain head for this sender+channel', 404);
  return Response.json(head);
}

// ── GET /v1/keys/:harbor_fingerprint ─────────────────────────────────────────

export async function handleKeys(env: Env, harborFp: string): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT i.daemon_fingerprint, i.pub_key
     FROM identities i
     JOIN harbor_members hm ON i.daemon_fingerprint = hm.daemon_fingerprint
     WHERE hm.harbor_fingerprint = ? AND i.revoked = 0`
  ).bind(harborFp).all<{ daemon_fingerprint: string; pub_key: string }>();

  return Response.json({
    harbor_fingerprint: harborFp,
    members: rows.results.map((r) => ({
      daemon_fingerprint: r.daemon_fingerprint,
      pub_key: r.pub_key,
    })),
  });
}

// ── PUT /v1/config/issuers/:issuer_id (acceptance criterion #1) ──────────────

export async function handleSetIssuer(
  request: Request,
  env: Env,
  issuerId: string
): Promise<Response> {
  const authErr = operatorOnly(request, env);
  if (authErr) return authErr;

  let body: { disabled: boolean };
  try {
    body = await request.json() as { disabled: boolean };
  } catch {
    return err('BAD_JSON', 'Request body must be JSON');
  }

  const issuer = await getIssuer(env.DB, issuerId);
  if (!issuer) return err('NOT_FOUND', `Issuer ${issuerId} not registered`, 404);

  await setIssuerDisabled(env.DB, issuerId, body.disabled);

  await appendAudit(env.DB, {
    action: body.disabled ? 'disable_issuer' : 'enable_issuer',
    target: issuerId,
    ip: clientIp(request),
  });

  return Response.json({ ok: true, issuer_id: issuerId, disabled: body.disabled });
}

// ── DELETE /v1/cache/jwks/:issuer_id (acceptance criterion #3) ───────────────

export async function handleInvalidateJwks(
  request: Request,
  env: Env,
  issuerId: string
): Promise<Response> {
  const authErr = operatorOnly(request, env);
  if (authErr) return authErr;

  await invalidateJwksCache(env, issuerId);

  await appendAudit(env.DB, {
    action: 'invalidate_jwks_cache',
    target: issuerId,
    ip: clientIp(request),
  });

  return Response.json({ ok: true, issuer_id: issuerId });
}

// ── GET /v1/audit (acceptance criterion #4) ──────────────────────────────────

export async function handleAudit(
  request: Request,
  env: Env
): Promise<Response> {
  const authErr = operatorOnly(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const fingerprint = url.searchParams.get('fingerprint');
  if (!fingerprint) return err('MISSING_PARAMS', 'fingerprint required');

  const fromTs = parseInt(url.searchParams.get('from') ?? '0', 10);
  const toTs = parseInt(url.searchParams.get('to') ?? String(Math.floor(Date.now() / 1000)), 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '500', 10), 1000);

  const rows = await queryAuditLog(env.DB, fingerprint, fromTs, toTs, limit);
  return Response.json({ fingerprint, rows });
}

export { randomHex };
