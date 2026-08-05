/**
 * Inbound GitHub Webhook Route
 *
 * Closes the receiver → daemon → fleet-dispatch loop. The Cloudflare Worker
 * in `apps/github-app-receiver/` verifies the GitHub `X-Hub-Signature-256`
 * HMAC, normalizes the payload into an envelope, and forwards it here. This
 * route authenticates the forwarder, normalizes the event, and publishes it
 * onto the daemon messaging bus so the fleet engine's channel subscriptions
 * (lib/fleet-engine.ts) fire the ships a repo declares in its pd-fleet.yml.
 *
 * Channels published (UNSCOPED / global — subscribe with a `global:` prefix
 * in pd-fleet.yml, e.g. `trigger: global:github:webhook:pull_request`):
 *   - github:webhook:<event>                e.g. github:webhook:pull_request
 *   - github:webhook:<event>:<action>       e.g. github:webhook:pull_request:opened
 *   - github:<owner>/<repo>:<event>         e.g. github:curiositech/port-daddy:pull_request
 *
 * Per-project channel scoping (so ONLY the installed repo's fleet fires): when
 * a `repoRegistry` dep is supplied, the route resolves the webhook's
 * `owner/repo` to the project that claims it (lib/github-repo-registry.ts) and
 * ADDITIONALLY publishes project-scoped channels:
 *   - project:<slug>:<hash>:github:webhook:<event>
 *   - project:<slug>:<hash>:github:webhook:<event>:<action>
 * A ship in that project subscribes with a BARE trigger (the fleet channel
 * resolver project-scopes it by default), so it fires only for its own repo.
 * The global channels above stay published for backward compatibility, so
 * existing `global:`-prefixed ships keep working.
 *
 * Authentication (any configured method that passes wins):
 *   - Bearer:  Authorization: Bearer <PD_GITHUB_FORWARD_TOKEN>  (receiver path)
 *   - HMAC:    X-Hub-Signature-256 over the raw body, keyed by
 *              PD_GITHUB_WEBHOOK_SECRET                          (direct GitHub path)
 *   - Dev:     PD_GITHUB_WEBHOOK_ALLOW_UNAUTH=1 disables auth    (local only)
 * If none are configured, every request is rejected with 401.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getSecret } from '../lib/secret-env.js';

/**
 * Minimal shape the route needs from lib/github-repo-registry.ts. Kept local
 * (structural) so the route does not hard-depend on the registry module — the
 * dep is optional, and when absent the route behaves exactly as before
 * (global channels only).
 */
interface RepoRegistryLike {
  resolve(repoFullName: string): { scope: string; projectDir: string } | null;
}

interface GithubWebhookRouteDeps {
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: { errors: number; messages_published?: number };
  messaging: {
    publish(channel: string, payload: unknown, opts: { sender?: string; expires?: unknown }): Record<string, unknown>;
  };
  /**
   * Optional repo→project registry. When supplied, the route resolves the
   * webhook's owner/repo to the owning project and publishes project-scoped
   * channels in addition to the global ones, so only that project's fleet
   * fires. When absent, only the global channels are published (legacy).
   */
  repoRegistry?: RepoRegistryLike;
}

interface RawBodyRequest extends FastifyRequest {
  rawBody?: string;
}

interface GithubRepository {
  full_name?: string;
  [key: string]: unknown;
}

interface GithubActor {
  login?: string;
  [key: string]: unknown;
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * How a request authenticated.
 *   - `hmac-direct`: GitHub posted straight here; the `X-Hub-Signature-256`
 *     HMAC over the raw body already proves GitHub origin.
 *   - `bearer`: a forwarder (the receiver Worker / relay) presented the shared
 *     forward token. This proves the forwarder is trusted to TRANSPORT events —
 *     it does NOT prove the events came from GitHub. Origin must be
 *     re-established separately (see `verifyForwardedOrigin`).
 *   - `unauth`: dev-only bypass.
 */
type AuthMethod = 'hmac-direct' | 'bearer' | 'unauth';

interface AuthResult {
  ok: boolean;
  method?: AuthMethod;
  reason?: string;
}

function authenticate(request: RawBodyRequest): AuthResult {
  const forwardToken = getSecret('PD_GITHUB_FORWARD_TOKEN')?.trim();
  const webhookSecret = getSecret('PD_GITHUB_WEBHOOK_SECRET')?.trim();
  const allowUnauth = process.env.PD_GITHUB_WEBHOOK_ALLOW_UNAUTH === '1';

  // HMAC signature (direct GitHub webhook path) — strongest, proves origin.
  // Checked first so a request that carries a valid GitHub signature is
  // recognized as origin-proven even if it also carries a bearer token.
  if (webhookSecret) {
    const sig = request.headers['x-hub-signature-256'];
    if (typeof sig === 'string' && sig.startsWith('sha256=')) {
      const raw = request.rawBody ?? '';
      const expected = 'sha256=' + createHmac('sha256', webhookSecret).update(raw).digest('hex');
      if (safeEqual(sig, expected)) {
        return { ok: true, method: 'hmac-direct' };
      }
    }
  }

  // Bearer token (receiver-forwarded path). Transport-only: origin is
  // re-verified downstream from the carried envelope signature.
  if (forwardToken) {
    const header = request.headers['authorization'];
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      if (safeEqual(header.slice('Bearer '.length).trim(), forwardToken)) {
        return { ok: true, method: 'bearer' };
      }
    }
  }

  if (allowUnauth) return { ok: true, method: 'unauth' };

  if (!forwardToken && !webhookSecret) {
    return { ok: false, reason: 'no webhook auth configured (set PD_GITHUB_FORWARD_TOKEN or PD_GITHUB_WEBHOOK_SECRET)' };
  }
  return { ok: false, reason: 'invalid webhook credentials' };
}

type OriginResult =
  | { verified: true; method: 'hmac-direct' | 'forwarded-hmac' }
  | { verified: false; reason: string };

/**
 * Re-establish that a forwarded webhook genuinely originated at GitHub.
 *
 * A trusted forwarder (the receiver Worker / relay) authenticates with the
 * shared forward token, but that token only proves "this forwarder is allowed
 * to deliver events" — NOT "GitHub sent this event". Without this check, anyone
 * who obtains the forward token (or a relay publish capability) could forge
 * `push` / `pull_request` envelopes and trigger fleet ships on attacker-chosen
 * payloads — RCE-by-webhook. We close that by having the forwarder carry the
 * exact bytes GitHub signed (`raw_payload`) plus GitHub's `signature`, and
 * re-verifying the HMAC here against our own `PD_GITHUB_WEBHOOK_SECRET`.
 *
 * Returns verified:true only when a real GitHub signature checks out. The
 * forwarder's token can never substitute for it.
 */
function verifyForwardedOrigin(request: FastifyRequest): OriginResult {
  const webhookSecret = getSecret('PD_GITHUB_WEBHOOK_SECRET')?.trim();
  if (!webhookSecret) {
    return { verified: false, reason: 'PD_GITHUB_WEBHOOK_SECRET not set; cannot re-verify GitHub origin' };
  }

  const body = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
  const rawPayload = body.raw_payload;
  const signature = body.signature;
  if (typeof rawPayload !== 'string' || typeof signature !== 'string') {
    return { verified: false, reason: 'forwarded envelope missing raw_payload/signature for origin re-verification' };
  }
  if (!signature.startsWith('sha256=')) {
    return { verified: false, reason: 'forwarded signature not a sha256= HMAC' };
  }

  const expected = 'sha256=' + createHmac('sha256', webhookSecret).update(rawPayload).digest('hex');
  if (!safeEqual(signature, expected)) {
    return { verified: false, reason: 'forwarded GitHub origin HMAC mismatch' };
  }
  return { verified: true, method: 'forwarded-hmac' };
}

interface NormalizedWebhook {
  event: string;
  action: string | null;
  delivery: string | null;
  repository: GithubRepository | null;
  sender: string | null;
  installation_id: number | null;
  payload: Record<string, unknown>;
  received_at: string;
}

/**
 * Accepts either the receiver envelope (event/action/repository at the top
 * level, raw GitHub payload under `payload`) or a raw GitHub webhook (event in
 * the `X-GitHub-Event` header, everything else in the body).
 */
function normalize(request: FastifyRequest): NormalizedWebhook | null {
  const body = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
  const headerEvent = request.headers['x-github-event'];

  const isEnvelope = typeof body.payload === 'object' && body.payload !== null;
  const ghData = (isEnvelope ? body.payload : body) as Record<string, unknown>;

  const event = (typeof headerEvent === 'string' && headerEvent)
    || (typeof body.event === 'string' && body.event)
    || null;
  if (!event) return null;

  const repository = (body.repository as GithubRepository | undefined)
    ?? (ghData.repository as GithubRepository | undefined)
    ?? null;
  const senderObj = (body.sender as GithubActor | undefined) ?? (ghData.sender as GithubActor | undefined);
  const action = (typeof body.action === 'string' && body.action)
    || (typeof ghData.action === 'string' && ghData.action)
    || null;
  const delivery = (typeof body.delivery === 'string' && body.delivery)
    || (typeof request.headers['x-github-delivery'] === 'string' && (request.headers['x-github-delivery'] as string))
    || null;
  const installation = (body.installation_id as number | undefined)
    ?? ((ghData.installation as { id?: number } | undefined)?.id)
    ?? null;

  return {
    event,
    action,
    delivery,
    repository,
    sender: senderObj?.login ?? null,
    installation_id: typeof installation === 'number' ? installation : null,
    payload: ghData,
    received_at: new Date().toISOString(),
  };
}

interface RoutedChannels {
  /** Channels actually published. */
  channels: string[];
  /** The project the repo resolved to, if any (for logging/diagnostics). */
  routedProjectDir: string | null;
}

function channelsFor(hook: NormalizedWebhook, repoRegistry?: RepoRegistryLike): RoutedChannels {
  const channels = [`github:webhook:${hook.event}`];
  if (hook.action) channels.push(`github:webhook:${hook.event}:${hook.action}`);
  const fullName = hook.repository?.full_name;
  if (typeof fullName === 'string' && fullName) {
    channels.push(`github:${fullName}:${hook.event}`);
  }

  // Per-project routing: if the repo claims a project, ALSO publish
  // project-scoped channels so only that project's fleet fires. A bare
  // `trigger: github:webhook:<event>` in the project's pd-fleet.yml is
  // project-scoped by the fleet channel resolver and matches these.
  let routedProjectDir: string | null = null;
  if (repoRegistry && typeof fullName === 'string' && fullName) {
    const entry = repoRegistry.resolve(fullName);
    if (entry) {
      routedProjectDir = entry.projectDir;
      channels.push(`${entry.scope}:github:webhook:${hook.event}`);
      if (hook.action) {
        channels.push(`${entry.scope}:github:webhook:${hook.event}:${hook.action}`);
      }
    }
  }

  return { channels, routedProjectDir };
}

export const githubWebhookPlugin: FastifyPluginAsync<{ deps: GithubWebhookRouteDeps }> = async (fastify, opts) => {
  const { logger, metrics, messaging, repoRegistry } = opts.deps;

  // Capture the raw body (encapsulated to this plugin) so HMAC verification
  // can hash the exact bytes GitHub signed, while still exposing parsed JSON.
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req: RawBodyRequest, body, done) => {
    req.rawBody = typeof body === 'string' ? body : body.toString('utf8');
    if (!req.rawBody) return done(null, {});
    try {
      done(null, JSON.parse(req.rawBody));
    } catch (err) {
      (err as Error & { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  // POST /webhooks/github - Inbound GitHub webhook (from receiver Worker or GitHub directly)
  fastify.post('/webhooks/github', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = authenticate(request as RawBodyRequest);
    if (!auth.ok) {
      reply.code(401);
      return { error: auth.reason ?? 'unauthorized' };
    }

    // Re-establish GitHub origin. Direct HMAC posts are already origin-proven by
    // authenticate(). For forwarded (bearer) requests, re-verify GitHub's HMAC
    // over the carried raw bytes so a leaked forward token / relay capability
    // cannot forge fleet-triggering events.
    const requireOrigin = process.env.PD_GITHUB_REQUIRE_ORIGIN_HMAC === '1';
    let originProven = auth.method === 'hmac-direct';
    if (auth.method === 'bearer') {
      const origin = verifyForwardedOrigin(request);
      if (!origin.verified) {
        // A carried-but-WRONG signature is always an attack/misconfig — reject
        // outright. A missing signature is rejected only in strict mode (so
        // not-yet-upgraded receivers keep working until the operator opts in).
        const carriedSignature = typeof (request.body as Record<string, unknown> | undefined)?.signature === 'string';
        if (carriedSignature || requireOrigin) {
          metrics.errors++;
          logger.error('github_webhook_origin_unverified', { reason: origin.reason });
          reply.code(401);
          return { error: `forwarded webhook failed GitHub origin verification: ${origin.reason}` };
        }
      } else {
        originProven = true;
      }
    }

    if (requireOrigin && !originProven) {
      metrics.errors++;
      logger.error('github_webhook_origin_required_but_unproven', { auth_method: auth.method });
      reply.code(401);
      return { error: 'GitHub origin could not be verified (PD_GITHUB_REQUIRE_ORIGIN_HMAC=1)' };
    }

    let hook: NormalizedWebhook | null;
    try {
      hook = normalize(request);
    } catch (error) {
      metrics.errors++;
      logger.error('github_webhook_normalize_failed', { error: (error as Error).message });
      reply.code(400);
      return { error: 'malformed webhook payload' };
    }

    if (!hook) {
      reply.code(400);
      return { error: 'could not determine GitHub event (set X-GitHub-Event header or envelope.event)' };
    }

    const { channels, routedProjectDir } = channelsFor(hook, repoRegistry);
    try {
      for (const channel of channels) {
        messaging.publish(channel, hook, { sender: hook.sender ?? undefined });
        if (typeof metrics.messages_published === 'number') metrics.messages_published++;
      }
    } catch (error) {
      metrics.errors++;
      logger.error('github_webhook_publish_failed', { error: (error as Error).message, channels });
      reply.code(500);
      return { error: 'failed to publish webhook to fleet bus' };
    }

    logger.info('github_webhook_received', {
      event: hook.event,
      action: hook.action,
      repository: hook.repository?.full_name,
      delivery: hook.delivery,
      channels,
      routed_project_dir: routedProjectDir,
    });

    reply.code(204);
    return null;
  });
};
