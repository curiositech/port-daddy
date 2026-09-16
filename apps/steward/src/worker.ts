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
/**
 * Parse the `STEWARD_REPOS` roster into `owner/repo` names.
 *
 * STRICT ON PURPOSE: a typo'd entry is dropped rather than pulsed, because
 * `idFromName` accepts any string — a malformed name would silently create a
 * brand-new empty seat that pulses forever and serves nobody, which is a
 * quieter version of the exact bug this module exists to fix. Callers report
 * what was rejected; nothing is discarded without a log line.
 *
 * @param raw - The comma-separated var, possibly undefined or whitespace.
 * @returns `{repos, rejected}` — deduped valid names, and every entry refused.
 */
export function parseRepoRoster(raw: string | undefined): {
  repos: string[];
  rejected: string[];
} {
  const repos: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const entry of (raw ?? '').split(',')) {
    const name = entry.trim();
    if (!name) continue;
    if (!/^[^/\s]+\/[^/\s]+$/.test(name)) {
      rejected.push(name);
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    repos.push(name);
  }
  return { repos, rejected };
}

export default {
  /**
   * The outside clock — pulse every seat on the roster.
   *
   * WHY A CRON AT ALL: the seat's heartbeat re-arms itself, but only once it
   * has beaten a first time, and nothing else in this system ever asks it to.
   * P1 shipped deployed, commissioned, and silent for exactly that reason —
   * zero deck-log rows in production. A Durable Object cannot start its own
   * clock, so the starter has to come from outside it; a cron trigger is the
   * smallest thing that can. It doubles as the watchdog for a lost alarm,
   * which is likewise invisible from inside the seat (see `handlePulse`).
   *
   * WHY IT SKIPS THE BEARER GATE: `fetch` authenticates the outside world;
   * this handler *is* the inside. DO namespaces are not publicly addressable,
   * so the stub call below cannot be reached by anyone who is not already
   * running this Worker's code. Requiring the seat's own admin secret to talk
   * to itself would add a credential without adding a boundary.
   *
   * FAIL LOUD, NOT CLOSED: an empty or malformed roster means no seat gets a
   * pulse — the original bug, wearing a config typo as a disguise. It is
   * logged as an error rather than returning quietly, because "the cron ran
   * fine" and "the cron did nothing" must never look the same in the logs.
   *
   * @param _event - The cron event (cadence is config, not behavior).
   * @param env - Worker bindings (DO namespace + `STEWARD_REPOS` roster).
   * @returns Resolves once every seat on the roster has been pulsed.
   */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const { repos, rejected } = parseRepoRoster(env.STEWARD_REPOS);
    for (const bad of rejected) {
      console.error(`[steward] cron roster: ignoring malformed entry ${JSON.stringify(bad)}`);
    }
    if (repos.length === 0) {
      console.error(
        '[steward] cron pulse: STEWARD_REPOS is empty — NO seat was pulsed, so no deck-log ' +
          'entry will be written and the seat is indistinguishable from dead. Set it in ' +
          'wrangler.deploy.toml [vars].',
      );
      return;
    }
    for (const repo of repos) {
      // One seat's failure must not cost the rest their pulse — the whole
      // point of this handler is that a silent seat gets noticed, and an
      // unhandled throw here would silence every seat after the first bad one.
      try {
        const stub = env.STEWARD.get(env.STEWARD.idFromName(`steward:${repo}`));
        const res = await stub.fetch(
          new Request('https://steward.internal/pulse', {
            method: 'POST',
            headers: { 'x-steward-repo': repo },
          }),
        );
        console.log(`[steward] cron pulse repo=${repo} status=${res.status} ${await res.text()}`);
      } catch (err) {
        console.error(`[steward] cron pulse repo=${repo} FAILED: ${String(err)}`);
      }
    }
  },

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
      /^\/steward\/([^/]+)\/([^/]+)\/(wake|status|charter|pulse|ship-it\/\d+|clusterfudge\/ack)$/,
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
