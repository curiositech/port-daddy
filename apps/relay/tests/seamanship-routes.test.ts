/**
 * Router wiring for the Seamanship surfaces (src/index.ts).
 *
 * The two suites next door test the handlers directly. This one goes through
 * `worker.fetch`, because a correct handler behind an unreachable — or
 * mis-ordered — route is still a broken feature. In particular the public
 * routes come in exact/prefix pairs (`/skills` vs `/skills/…`, `/v1/skills` vs
 * `/v1/skills/…`) whose order decides whether the directory or the body handler
 * answers, and only a test at the router boundary can catch that being swapped.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index.js';
import type { Env } from '../src/types.js';
import { syncSkillListings } from '../src/seamanship.js';
import { resolveSession } from '../src/auth-github.js';
import {
  BASE,
  COOKIE_VALUE,
  LOGIN,
  makeSeamanshipFixture,
  req,
  skillMd,
} from './support/seamanship-fixture.js';

afterEach(() => vi.unstubAllGlobals());

const REPO = {
  fullName: 'curiositech/port-daddy',
  defaultBranch: 'main',
  skills: {
    'skill-architect': skillMd(
      ['name: skill-architect', 'description: Author a new skill from a brief.', 'visibility: public'].join('\n'),
      'PUBLIC BODY SENTINEL.\n',
    ),
    'harbor-quota-tuner': skillMd(
      ['name: harbor-quota-tuner', 'description: Tune per-harbor daily budgets.'].join('\n'),
      'PRIVATE BODY SENTINEL.\n',
    ),
  },
};

function makeCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext;
}

/** The fixture Env plus the bindings the router itself reaches for. */
function routable(env: Env): Env {
  return {
    ...env,
    HARBOR_CHANNEL: {
      idFromName: () => ({}),
      get: () => ({ fetch: async () => new Response('{}') }),
    },
    RELAY_OPERATOR_TOKEN: 'operator-token-0123456789abcdef-0123456789abcdef',
    RELAY_ED25519_PRIVATE_KEY_HEX: '42'.repeat(32),
    RELAY_VERSION: '0.0.0-test',
    SESSION_TTL_SECONDS: '3600',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as unknown as Env;
}

async function hit(path: string, env: Env, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`, init), routable(env), makeCtx());
}

async function published() {
  const fx = await makeSeamanshipFixture({ repos: [REPO] }, vi.stubGlobal);
  const s = await resolveSession(req('/account/seamanship'), fx.env);
  if (!s) throw new Error('fixture session did not resolve');
  await syncSkillListings(fx.env, s);
  return fx;
}

describe('router — /account/seamanship', () => {
  it('is registered and gates on a session', async () => {
    const { env } = await published();
    const res = await hit('/account/seamanship', env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('renders the catalog for a signed-in operator', async () => {
    const { env } = await published();
    const res = await hit('/account/seamanship', env, {
      headers: { Cookie: `__Host-pd_session=${COOKIE_VALUE}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Snipe, the Engineman');
  });
});

describe('router — the public listing', () => {
  it('serves /skills as HTML to an anonymous visitor', async () => {
    const { env } = await published();
    const res = await hit('/skills', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain(`@${LOGIN}/skill-architect`);
    expect(html).not.toContain('harbor-quota-tuner');
  });

  it('serves /v1/skills as the listed-tier JSON envelope', async () => {
    const { env } = await published();
    const res = await hit('/v1/skills', env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = (await res.json()) as { tier: string; count: number };
    expect(body.tier).toBe('listed');
    expect(body.count).toBe(1);
  });

  it('routes /skills/@login/id to the body page, not to the directory', async () => {
    const { env } = await published();
    const anon = await hit(`/skills/@${LOGIN}/skill-architect`, env);
    expect(anon.status).toBe(403); // the body page's account gate, not a 200 directory
    const signedIn = await hit(`/skills/@${LOGIN}/skill-architect`, env, {
      headers: { Cookie: `__Host-pd_session=${COOKIE_VALUE}` },
    });
    expect(signedIn.status).toBe(200);
    expect(await signedIn.text()).toContain('PUBLIC BODY SENTINEL');
  });

  it('routes /v1/skills/@login/id to the body API', async () => {
    const { env } = await published();
    const res = await hit(`/v1/skills/@${LOGIN}/skill-architect`, env, {
      headers: { Cookie: `__Host-pd_session=${COOKIE_VALUE}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skill: { body: string } };
    expect(body.skill.body).toContain('PUBLIC BODY SENTINEL');
  });

  it('404s an unpublished skill through the router too', async () => {
    const { env } = await published();
    const res = await hit(`/skills/@${LOGIN}/harbor-quota-tuner`, env);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('PRIVATE BODY SENTINEL');
  });

  it('handles a percent-encoded qualified id', async () => {
    const { env } = await published();
    const res = await hit(`/skills/%40${LOGIN}%2Fskill-architect`, env);
    expect(res.status).toBe(403); // resolved to the real skill, then account-gated
  });
});

describe('router — the publish endpoints', () => {
  it('401s an anonymous JSON publish', async () => {
    const { env } = await published();
    const res = await hit('/v1/seamanship/publish', env, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('302s an anonymous form publish to /login', async () => {
    const { env } = await published();
    const res = await hit('/account/seamanship/publish', env, { method: 'POST' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login');
  });

  it('accepts a same-origin form publish from a signed-in operator', async () => {
    const { env } = await published();
    const res = await hit('/account/seamanship/publish', env, {
      method: 'POST',
      headers: { Cookie: `__Host-pd_session=${COOKIE_VALUE}`, Origin: BASE },
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/account/seamanship?listed=1');
  });
});
