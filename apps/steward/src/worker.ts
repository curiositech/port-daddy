import { StewardDO } from './steward.js';
import type { Env } from './types.js';

export { StewardDO };

/**
 * Worker entry for the Steward's seat — the authentication and addressing
 * layer in front of the per-repo Durable Objects.
 *
 * DESIGN: the Worker owns exactly two concerns, so the seat itself never
 * touches credentials or naming. (1) AUTH: every route requires the shared
 * bearer token; an unset token means the seat is not commissioned and every
 * request gets a 503 — fail closed, never open, and say why. (2) ADDRESSING:
 * `/steward/:owner/:repo/<action>` maps deterministically to the DO named
 * `steward:owner/repo`, the Single-Writer Kernel rule made concrete — the
 * platform guarantees one live instance per name, so merge authority for a
 * repo can never fork.
 */
export default {
  /**
   * Route an external request to the right seat.
   *
   * WHY NORMALIZE THE PATH: the DO sees only `/wake`, `/status`, `/charter`
   * plus the `x-steward-repo` header — keeping the external URL shape out of
   * the DO means the console can later change addressing without touching
   * seat logic.
   *
   * @param request - The inbound HTTP request.
   * @param env - Worker bindings (DO namespace, D1, admin token).
   * @returns The seat's response, or 401/503/404 from the gate itself.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.STEWARD_ADMIN_TOKEN) {
      return new Response(
        JSON.stringify({ error: 'seat not commissioned: STEWARD_ADMIN_TOKEN is unset' }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    }
    const auth = request.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${env.STEWARD_ADMIN_TOKEN}`) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    // ship-it carries its PR number in the path so the grant's target is in
    // the audit trail (access logs, curl history), never only in a body.
    const m = url.pathname.match(
      /^\/steward\/([^/]+)\/([^/]+)\/(wake|status|charter|ship-it\/\d+|clusterfudge\/ack)$/,
    );
    if (!m) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    const [, owner, repo, action] = m;
    const fullName = `${owner}/${repo}`;
    const id = env.STEWARD.idFromName(`steward:${fullName}`);
    const stub = env.STEWARD.get(id);

    const headers = new Headers(request.headers);
    headers.set('x-steward-repo', fullName);
    // Buffer the body rather than forwarding the stream: seat bodies are small
    // JSON, and a buffered string constructs identically under workerd and
    // Node (whose fetch demands a duplex option for stream bodies in tests).
    const body = request.method === 'POST' ? await request.text() : null;
    return stub.fetch(
      new Request(new URL(`/${action}`, 'https://steward.internal').toString(), {
        method: request.method,
        headers,
        ...(body !== null ? { body } : {}),
      }),
    );
  },
};
