/**
 * GitHub App Webhook Receiver + Cloud Fleet Executor — Cloudflare Worker
 *
 * Receives GitHub webhook POSTs, verifies the HMAC-SHA256 signature, and
 * dispatches fleet ships entirely in the cloud using Cloudflare Workers AI.
 *
 * No tunnel. No local daemon. No Anthropic API key.
 *
 * Ships that do pure analysis (code-reviewer, qa, red-team) run via Workers
 * AI (Qwen/Llama). Ships that need execution (file writes, npm test) are
 * dispatched as GitHub Actions workflows.
 *
 * Response codes:
 *   202 - webhook accepted; fleet dispatch running in background (ctx.waitUntil)
 *   400 - malformed JSON body or missing required GitHub headers
 *   401 - missing or invalid X-Hub-Signature-256
 *   405 - non-POST request
 *   500 - worker misconfigured (missing required env vars)
 *
 * Environment (wrangler.toml vars + wrangler secret):
 *   GITHUB_WEBHOOK_SECRET   (secret) HMAC shared secret with the GitHub App
 *   GITHUB_APP_ID           (var)    numeric App ID
 *   GITHUB_APP_PRIVATE_KEY  (secret) RSA private key PEM (raw or base64)
 */

import { buildEnvelope } from './forward.js';
import { executeFleet } from './execute.js';
import { handleRoadmapCommand } from './roadmap.js';

export interface ExecutorEnv {
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  AI: Ai;
}

const SIGNATURE_HEADER = 'x-hub-signature-256';
const EVENT_HEADER = 'x-github-event';
const DELIVERY_HEADER = 'x-github-delivery';

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

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function handleRequest(request: Request, env: ExecutorEnv, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  if (!env.GITHUB_WEBHOOK_SECRET) {
    return new Response('worker misconfigured: GITHUB_WEBHOOK_SECRET unset', { status: 500 });
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

  const envelope = buildEnvelope({ event, delivery, payload: parsed, rawPayload: rawBody, signature });

  // Respond immediately; dispatch runs in the background
  if (env.AI && env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
    ctx.waitUntil(
      executeFleet(envelope, env).catch(err =>
        console.error('fleet-executor error', err instanceof Error ? err.message : String(err)),
      ),
    );
  }

  // Route issue_comment events to the roadmap command handler (no AI binding needed)
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
    ctx.waitUntil(
      handleRoadmapCommand(envelope, env).catch(err =>
        console.error('roadmap-command error', err instanceof Error ? err.message : String(err)),
      ),
    );
  }

  return new Response(null, { status: 202 });
}

const worker: ExportedHandler<ExecutorEnv> = {
  async fetch(request, env, ctx): Promise<Response> {
    return handleRequest(request as unknown as Request, env, ctx);
  },
};

export default worker;
