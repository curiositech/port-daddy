/**
 * GitHub App Webhook Receiver — Cloudflare Worker
 *
 * Receives webhook POSTs from GitHub, verifies the HMAC-SHA256 signature
 * against GITHUB_WEBHOOK_SECRET (constant-time compare), normalizes the
 * payload into an envelope, and forwards to the operator's Port Daddy
 * daemon via DAEMON_FORWARD_URL.
 *
 * The daemon-side fleet generalization (see PR #137) subscribes to
 * `github:webhook:<event-type>` tube channels and dispatches the relevant
 * ships defined in the target repo's pd-fleet.yml.
 *
 * Response codes:
 *   204 - signature verified, envelope forwarded successfully
 *   400 - malformed JSON body or missing required headers
 *   401 - missing or invalid X-Hub-Signature-256
 *   405 - non-POST request
 *   502 - forward to daemon failed (after retry)
 *
 * Environment (bound via wrangler.toml / wrangler secret):
 *   GITHUB_WEBHOOK_SECRET   (secret) HMAC shared secret with the GitHub App
 *   DAEMON_FORWARD_URL      (var)    HTTPS URL the daemon (or its tunnel) listens on
 *   FORWARD_AUTH_TOKEN      (secret) REQUIRED bearer token the daemon validates
 *   FORWARD_TIMEOUT_MS      (var)    optional, default 8000
 */

import {
  buildEnvelope,
  forwardEnvelope,
  type WebhookEnvelope,
} from './forward.js';

export interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  DAEMON_FORWARD_URL: string;
  FORWARD_AUTH_TOKEN: string;
  FORWARD_TIMEOUT_MS?: string;
}

const SIGNATURE_HEADER = 'x-hub-signature-256';
const EVENT_HEADER = 'x-github-event';
const DELIVERY_HEADER = 'x-github-delivery';

/**
 * Constant-time string comparison.
 *
 * Both inputs must be the same length to avoid early-exit timing leaks.
 * If lengths differ we still walk the longer string so the time-to-false
 * does not depend on where the mismatch occurs.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= ca ^ cb;
  }
  return mismatch === 0;
}

/**
 * Compute the expected GitHub signature for a raw body string.
 *
 * GitHub prefixes the hex digest with `sha256=`. The HMAC key is the
 * webhook secret encoded as UTF-8.
 */
export async function computeSignature(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const bytes = new Uint8Array(sigBuf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `sha256=${hex}`;
}

/**
 * Verify the X-Hub-Signature-256 header.
 *
 * Returns true only if the header is present and matches the HMAC of the
 * raw body computed under the shared secret.
 */
export async function verifySignature(
  secret: string,
  body: string,
  headerValue: string | null,
): Promise<boolean> {
  if (!headerValue) return false;
  if (!headerValue.startsWith('sha256=')) return false;
  const expected = await computeSignature(secret, body);
  return timingSafeEqual(headerValue, expected);
}

interface ParsedPayload {
  parsed: Record<string, unknown>;
  raw: string;
}

function parseJson(raw: string): ParsedPayload | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return { parsed: parsed as Record<string, unknown>, raw };
  } catch {
    return null;
  }
}

/**
 * Inner request handler — pure of the ExportedHandler shape so it can be
 * unit-tested with a plain Fetch API Request (no need to construct a
 * Cloudflare-specific IncomingRequest type).
 */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  // Only forward to /msg/* — reject everything else so the daemon's other
  // routes are not reachable through this public-facing Worker.
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/msg/')) {
    return new Response('not found', { status: 404 });
  }

  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  if (!env.GITHUB_WEBHOOK_SECRET) {
    return new Response('worker misconfigured: GITHUB_WEBHOOK_SECRET unset', {
      status: 500,
    });
  }
  if (!env.DAEMON_FORWARD_URL) {
    return new Response('worker misconfigured: DAEMON_FORWARD_URL unset', {
      status: 500,
    });
  }
  if (!env.FORWARD_AUTH_TOKEN) {
    return new Response('worker misconfigured: FORWARD_AUTH_TOKEN unset', {
      status: 500,
    });
  }

  const event = request.headers.get(EVENT_HEADER);
  const delivery = request.headers.get(DELIVERY_HEADER);
  const signature = request.headers.get(SIGNATURE_HEADER);

  if (!event || !delivery) {
    return new Response('missing required GitHub headers', { status: 400 });
  }

  const rawBody = await request.text();
  const ok = await verifySignature(env.GITHUB_WEBHOOK_SECRET, rawBody, signature);
  if (!ok) {
    return new Response('invalid signature', { status: 401 });
  }

  const parsed = parseJson(rawBody);
  if (!parsed) {
    return new Response('malformed JSON', { status: 400 });
  }

  const envelope: WebhookEnvelope = buildEnvelope({
    event,
    delivery,
    payload: parsed.parsed,
  });

  const forwardTimeoutMs = Number(env.FORWARD_TIMEOUT_MS ?? '8000');
  const result = await forwardEnvelope(envelope, {
    url: env.DAEMON_FORWARD_URL,
    authToken: env.FORWARD_AUTH_TOKEN,
    timeoutMs: Number.isFinite(forwardTimeoutMs) ? forwardTimeoutMs : 8000,
    fetcher: globalThis.fetch.bind(globalThis),
  });

  if (!result.ok) {
    return new Response(`forward failed: ${result.error}`, { status: 502 });
  }

  return new Response(null, { status: 204 });
}

/**
 * Worker entrypoint.
 */
const worker: ExportedHandler<Env> = {
  async fetch(request, env, _ctx): Promise<Response> {
    return handleRequest(request as unknown as Request, env);
  },
};

export default worker;
