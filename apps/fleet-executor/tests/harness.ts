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
  /** GitHub Reviews created via POST /pulls/{n}/reviews (inline comments). */
  reviews: Array<{
    event: string;
    body: string;
    comments: Array<{ path: string; line: number; body: string }>;
  }>;
  /** Override the PR diff body. Defaults to a single-file one-hunk diff. */
  prDiff?: string;
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
    reviews: [],
    prDiff: undefined,
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
    // --- create review (inline comments) ---
    if (/\/pulls\/\d+\/reviews$/.test(url) && method === 'POST') {
      const b = (body ?? {}) as {
        event?: string;
        body?: string;
        comments?: Array<{ path: string; line: number; body: string }>;
      };
      state.reviews.push({
        event: b.event ?? '',
        body: b.body ?? '',
        comments: (b.comments ?? []).map(c => ({ path: c.path, line: c.line, body: c.body })),
      });
      return json({ id: 7000 + state.reviews.length });
    }
    // --- PR diff (Accept: diff) ---
    if (/\/pulls\/\d+$/.test(url)) {
      return text(state.prDiff ?? 'diff --git a/src/x.ts b/src/x.ts\n+changed');
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

/**
 * Captured fleet_runs row (after any UPDATE applied).
 */
export interface CapturedRun {
  id: unknown;
  deliveryId: unknown;
  repo: unknown;
  prNumber: unknown;
  prUrl: unknown;
  headSha: unknown;
  shipsCsv: unknown;
  createdAt: unknown;
  conclusion: string;
  ms: number;
  // Cost/token telemetry stamped by the finalize UPDATE (null until finalized).
  inputTokens?: number | null;
  outputTokens?: number | null;
  neurons?: number | null;
  costUsd?: number | null;
  modelsCsv?: string | null;
}

/** Captured fleet_run_steps row. */
export interface CapturedStep {
  runId: unknown;
  seq: unknown;
  kind: string;
  ship: unknown;
  title: unknown;
  detail: unknown;
}

export interface D1Capture {
  db: D1Database;
  /** fleet_runs rows, in id order of first insert. */
  runs: CapturedRun[];
  /** fleet_run_steps rows, in insertion order. */
  steps: CapturedStep[];
  /** Set true to make EVERY `.run()` throw (transcript-write failure path). */
  failAll: boolean;
  /** Number of `.run()` calls attempted (including the ones that threw). */
  runCalls: number;
}

/**
 * Minimal in-memory D1 stub. Recognizes the three statements the executor uses
 * (INSERT OR REPLACE INTO fleet_runs / fleet_run_steps, UPDATE fleet_runs) by
 * keyword and records the bound parameters. Everything else is a no-op that
 * returns an empty result, so a stray query never blows up a test.
 */
export function memoryD1(): D1Capture {
  const runsById = new Map<string, CapturedRun>();
  const cap: D1Capture = {
    db: undefined as unknown as D1Database,
    get runs() {
      return [...runsById.values()];
    },
    steps: [],
    failAll: false,
    runCalls: 0,
  };

  const prepare = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      async run() {
        cap.runCalls += 1;
        if (cap.failAll) throw new Error('D1 unavailable');
        if (/INTO fleet_runs/i.test(sql)) {
          runsById.set(String(args[0]), {
            id: args[0],
            deliveryId: args[1],
            repo: args[2],
            prNumber: args[3],
            prUrl: args[4],
            headSha: args[5],
            shipsCsv: args[6],
            createdAt: args[7],
            conclusion: 'pending',
            ms: 0,
            inputTokens: null,
            outputTokens: null,
            neurons: null,
            costUsd: null,
            modelsCsv: null,
          });
        } else if (/INTO fleet_run_steps/i.test(sql)) {
          cap.steps.push({
            runId: args[0],
            seq: args[1],
            kind: String(args[2]),
            ship: args[3],
            title: args[4],
            detail: args[5],
          });
        } else if (/UPDATE fleet_runs/i.test(sql)) {
          // The finalize UPDATE binds the WHERE id LAST:
          //   SET conclusion=?, ms=?, input_tokens=?, output_tokens=?,
          //       neurons=?, cost_usd=?, models_csv=? WHERE id=?
          const row = runsById.get(String(args[args.length - 1]));
          if (row) {
            row.conclusion = String(args[0]);
            row.ms = Number(args[1]);
            row.inputTokens = args[2] == null ? null : Number(args[2]);
            row.outputTokens = args[3] == null ? null : Number(args[3]);
            row.neurons = args[4] == null ? null : Number(args[4]);
            row.costUsd = args[5] == null ? null : Number(args[5]);
            row.modelsCsv = args[6] == null ? null : String(args[6]);
          }
        }
        return { success: true, meta: {} };
      },
      async first() {
        return null;
      },
      async all() {
        return { results: [] };
      },
    }),
  });

  cap.db = { prepare } as unknown as D1Database;
  return cap;
}

export interface AiStub {
  ai: Ai;
  /** Every AI call: which model, the map/reduce phase, and the routed ship. */
  calls: Array<{ model: string; phase: 'map' | 'reduce'; ship: string | null; temperature?: number }>;
}

/**
 * Workers AI stub for the map-reduce executor.
 *
 * Routing: the ship is identified by its name appearing in the system prompt
 * (the ship prompt and the REDUCE manager prompt both embed it). The REDUCE
 * manager call is recognized by the `REDUCE manager` marker in its system
 * prompt and returns `managerOutput` (a global string, or a per-ship map).
 *
 * `perShip` is the per-CHUNK (MAP) response; `managerOutput` is the merged
 * (REDUCE) response. `throwForShip` makes that ship's call throw (used to
 * exercise the fail-closed path). `fleetParser` is accepted but ignored — the
 * deterministic YAML parser replaced the old LLM extraction call.
 */
export function aiStub(opts: {
  perShip: Record<string, string>;
  managerOutput?: string | Record<string, string>;
  throwForShip?: string;
  fleetParser?: string;
  /** Per-call Workers AI usage returned on every run() (default: 100 in / 20 out). */
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
}): AiStub {
  const calls: AiStub['calls'] = [];
  // Workers AI returns a `usage` block on every call; default to a fixed split
  // so cost/token telemetry tests can assert on it. `usage: null` omits it (to
  // exercise the missing-usage tolerance path).
  const usage = opts.usage === undefined ? { prompt_tokens: 100, completion_tokens: 20 } : opts.usage;
  const withUsage = (response: string) => (usage ? { response, usage } : { response });

  const matchShip = (sys: string): string | null => {
    for (const ship of Object.keys(opts.perShip)) {
      if (sys.includes(ship)) return ship;
    }
    return null;
  };

  const run = async (
    model: string,
    args: { messages: Array<{ role: string; content: string }>; temperature?: number },
  ) => {
    const sys = args.messages.find(m => m.role === 'system')?.content ?? '';
    const ship = matchShip(sys);

    // --- REDUCE manager call ---
    if (/REDUCE manager/.test(sys)) {
      calls.push({ model, phase: 'reduce', ship, temperature: args.temperature });
      if (ship && opts.throwForShip === ship) throw new Error('AI exploded (reduce)');
      const mgr = opts.managerOutput;
      const out =
        typeof mgr === 'string' ? mgr : ship && mgr ? mgr[ship] : undefined;
      return withUsage(out ?? (ship ? opts.perShip[ship] : 'merged\n\nFLEET-VERDICT: PASS'));
    }

    // --- MAP call ---
    calls.push({ model, phase: 'map', ship, temperature: args.temperature });
    if (ship) {
      if (opts.throwForShip === ship) throw new Error('AI exploded');
      return withUsage(opts.perShip[ship]);
    }
    return withUsage('no match\n\nFLEET-VERDICT: PASS');
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
    CONTROL_KV: memoryKV(),
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
