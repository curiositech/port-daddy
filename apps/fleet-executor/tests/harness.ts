/**
 * Shared test harness: a fake GitHub API over `globalThis.fetch`, an in-memory
 * KV, and a stub Workers AI. Records every call so tests can assert on the
 * exact refs passed to the contents API (the zero-trust invariant), comment
 * posts, check-run lifecycle, and token mints.
 */

import { vi } from 'vitest';
import type { ExecutorEnv, FleetRunJob } from '../src/env.js';

export interface FetchRecord {
  method: string;
  url: string;
  body: unknown;
}

export interface GitHubState {
  records: FetchRecord[];
  /** ref query param seen on every /contents/ fetch, in order. */
  contentsRefs: Array<{ path: string; ref: string }>;
  /** files present on the default branch, keyed by `${ref}:${path}`. */
  files: Map<string, string>;
  tokenMints: number;
  commentPosts: number;
  commentPatches: number;
  existingComments: Array<{ id: number; body: string }>;
  checkRunsCreated: number;
  /** existing check runs returned by the commit check-runs lookup. */
  existingCheckRuns: Array<{ id: number; name: string }>;
  completed: Array<{ id: number; conclusion: string; summary: string }>;
  /** if set, the first N installation-token mints return 401-ish failure. */
  failTokenMintTimes: number;
  /** if set, the first N contents fetches of pd-fleet.yml return 401. */
  failConfig401: number;
  /** if set, the first N check-run CREATE (POST) calls return 500 (no id). */
  failCreateCheckRun: number;
}

export function freshState(): GitHubState {
  return {
    records: [],
    contentsRefs: [],
    files: new Map(),
    tokenMints: 0,
    commentPosts: 0,
    commentPatches: 0,
    existingComments: [],
    checkRunsCreated: 0,
    existingCheckRuns: [],
    completed: [],
    failTokenMintTimes: 0,
    failConfig401: 0,
    failCreateCheckRun: 0,
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function text(body: string, status = 200): Response {
  return new Response(body, { status });
}

let CHECK_ID_SEQ = 9000;

/**
 * Install a fake GitHub fetch. Returns nothing; inspect `state` afterwards.
 */
export function installGitHubFetch(state: GitHubState): void {
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    state.records.push({ method, url, body });

    // --- installation access token mint ---
    if (url.includes('/app/installations/') && url.includes('/access_tokens') && method === 'POST') {
      state.tokenMints += 1;
      if (state.failTokenMintTimes > 0) {
        state.failTokenMintTimes -= 1;
        return text('bad creds', 401);
      }
      return json({
        token: `tok-${state.tokenMints}`,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
    }

    // --- repo contents (config + ship contracts) ---
    const contents = url.match(/\/repos\/[^/]+\/[^/]+\/contents\/(.+?)\?ref=([^&]+)/);
    if (contents) {
      const path = decodeURIComponent(contents[1]);
      const ref = decodeURIComponent(contents[2]);
      state.contentsRefs.push({ path, ref });
      if (path === 'pd-fleet.yml' && state.failConfig401 > 0) {
        state.failConfig401 -= 1;
        return text('bad token', 401);
      }
      const fileBody = state.files.get(`${ref}:${path}`);
      if (fileBody === undefined) return text('not found', 404);
      return json({ encoding: 'base64', content: btoa(fileBody) });
    }

    // --- PR files ---
    if (/\/pulls\/\d+\/files/.test(url)) {
      return json([{ filename: 'src/x.ts', status: 'modified', additions: 3, deletions: 1 }]);
    }
    // --- PR diff (Accept: diff) ---
    if (/\/pulls\/\d+$/.test(url)) {
      return text('diff --git a/src/x.ts b/src/x.ts\n+changed');
    }

    // --- commit check-runs lookup (idempotency) ---
    if (/\/commits\/[^/]+\/check-runs/.test(url)) {
      return json({ check_runs: state.existingCheckRuns });
    }

    // --- list issue comments (edit-in-place lookup) ---
    if (/\/issues\/\d+\/comments\?per_page/.test(url) && method === 'GET') {
      return json(state.existingComments);
    }
    // --- post comment ---
    if (/\/issues\/\d+\/comments$/.test(url) && method === 'POST') {
      state.commentPosts += 1;
      return json({ id: 1000 + state.commentPosts });
    }
    // --- patch comment ---
    if (/\/issues\/comments\/\d+/.test(url) && method === 'PATCH') {
      state.commentPatches += 1;
      return json({ id: 1 });
    }

    // --- create check run ---
    if (/\/check-runs$/.test(url) && method === 'POST') {
      if (state.failCreateCheckRun > 0) {
        state.failCreateCheckRun -= 1;
        return text('check-run create failed', 500);
      }
      state.checkRunsCreated += 1;
      const id = ++CHECK_ID_SEQ;
      // Future lookups for this head SHA now find it.
      const headSha = (body as { head_sha?: string })?.head_sha ?? '';
      const name = (body as { name?: string })?.name ?? '';
      state.existingCheckRuns.push({ id, name });
      void headSha;
      return json({ id });
    }
    // --- complete check run ---
    const completeMatch = url.match(/\/check-runs\/(\d+)$/);
    if (completeMatch && method === 'PATCH') {
      state.completed.push({
        id: Number(completeMatch[1]),
        conclusion: (body as { conclusion?: string })?.conclusion ?? '',
        summary: (body as { output?: { summary?: string } })?.output?.summary ?? '',
      });
      return json({ ok: true });
    }

    return text('unhandled: ' + url, 500);
  };

  vi.stubGlobal('fetch', vi.fn(handler) as unknown as typeof fetch);
}

/** In-memory KV with the subset of methods the executor uses. */
export function memoryKV(): KVNamespace & { _store: Map<string, string>; _gets: number } {
  const store = new Map<string, string>();
  let gets = 0;
  const kv = {
    _store: store,
    get _gets() {
      return gets;
    },
    async get(key: string) {
      gets += 1;
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace & { _store: Map<string, string>; _gets: number };
  return kv;
}

export interface AiStub {
  ai: Ai;
  calls: Array<{ model: string }>;
}

/**
 * Workers AI stub. `outputs` maps a marker substring of the system prompt to a
 * response; we route by ship name embedded in the prompt. `fleetParser` is the
 * response returned for the parseFleetShips meta-call (model qwen3-30b).
 */
export function aiStub(opts: {
  perShip: Record<string, string>;
  fleetParser?: string;
  throwForShip?: string;
}): AiStub {
  const calls: Array<{ model: string }> = [];
  const run = async (model: string, args: { messages: Array<{ role: string; content: string }> }) => {
    calls.push({ model });
    const sys = args.messages.find(m => m.role === 'system')?.content ?? '';
    const user = args.messages.find(m => m.role === 'user')?.content ?? '';

    // parseFleetShips uses a single user message asking to "Extract all ships".
    if (!sys && /Extract all ships/.test(user)) {
      return { response: opts.fleetParser ?? '[]' };
    }

    for (const [ship, out] of Object.entries(opts.perShip)) {
      // ship name appears in the contract path and prompt; match on "pd-<ship>"
      // or the bare ship name in the system prompt.
      if (sys.includes(ship)) {
        if (opts.throwForShip === ship) throw new Error('AI exploded');
        return { response: out };
      }
    }
    return { response: 'no match\n\nFLEET-VERDICT: PASS' };
  };
  const ai = { run: vi.fn(run) } as unknown as Ai;
  return { ai, calls };
}

export function makeEnv(over: Partial<ExecutorEnv> = {}): ExecutorEnv {
  return {
    GITHUB_APP_ID: '3810450',
    // A real RSA PKCS8 key is not needed: the token mint is faked by the fetch
    // stub, so signJwt never runs against this in the integration tests. The
    // token-cache test that does mint uses the fake fetch path too.
    GITHUB_APP_PRIVATE_KEY: 'unused-in-faked-fetch',
    DEFAULT_BRANCH: 'main',
    FLEET_TOKENS: memoryKV(),
    AI: aiStub({ perShip: {} }).ai,
    ...over,
  };
}

export function makeJob(over: Partial<FleetRunJob> = {}): FleetRunJob {
  return {
    deliveryId: 'delivery-abc',
    eventType: 'pull_request',
    action: 'opened',
    repoFullName: 'erichowens/port-daddy',
    installationId: 42,
    prNumber: 7,
    payloadMinimal: {
      pull_request: { number: 7, title: 'x', body: 'y', head: { sha: 'HEADSHA' }, base: { sha: 'BASESHA' } },
    },
    ...over,
  };
}
