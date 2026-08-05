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
  completed: Array<{ id: number; conclusion: string; summary: string; detailsUrl?: string }>;
  /** details_url values sent on check-run CREATE (undefined when omitted). */
  createdDetailsUrls: Array<string | undefined>;
  /** GitHub Reviews created via POST /pulls/{n}/reviews (inline comments). */
  reviews: Array<{
    event: string;
    body: string;
    comments: Array<{ path: string; line: number; body: string }>;
  }>;
  /** Override the PR diff body. Defaults to a single-file one-hunk diff. */
  prDiff?: string;
  /** Authoritative current PR head returned by GET /pulls/{n}. */
  prHeadSha: string;
  /**
   * The rest of the authoritative PR body returned by GET /pulls/{n}.
   *
   * buildPRContext reads head.ref / base.ref / the two repo full_names from the
   * LIVE PR fetch, never from the webhook payload — so a stub that omits them
   * silently yields headRef === '' and every stacking guard short-circuits on
   * "PR head branch unknown" before reaching the behavior under test. Tests that
   * need a fork or a ref-less PR override these fields rather than the payload.
   */
  prHeadRef: string | undefined;
  prBaseRef: string;
  /** head.repo.full_name — differs from prBaseRepo to simulate a fork PR. */
  prHeadRepo: string;
  prBaseRepo: string;
  /** Other open PRs returned by the list endpoint (Lookout's cross-PR tool). */
  openPRs: Array<{ number: number; title: string; draft?: boolean; head?: { ref: string }; base?: { ref: string }; html_url?: string }>;
  /** Branch names returned by the branches endpoint (Lookout's branch tool). */
  branches: Array<{ name: string }>;
  /** if set, the first N installation-token mints return 401-ish failure. */
  failTokenMintTimes: number;
  /** if set, the first N contents fetches of pd-fleet.yml return 401. */
  failConfig401: number;
  /** if set, the first N check-run CREATE (POST) calls return 500 (no id). */
  failCreateCheckRun: number;

  // --- Git Data API + stacked-PR surface (purser) --------------------------
  /** branch name → commit sha, as maintained by the git refs endpoints. */
  gitRefs: Map<string, string>;
  blobsCreated: number;
  treesCreated: number;
  commitsCreated: number;
  /** POST /git/refs successes (new branch). */
  refCreates: number;
  /** PATCH /git/refs/heads/... successes (force-update). */
  refUpdates: number;
  /** PRs created via POST /pulls. */
  stackedPrs: Array<{ number: number; head: string; base: string; title: string; body: string }>;
  /** PATCH /pulls/{n} bodies (retargets carry `base`; refreshes carry title/body). */
  prPatches: Array<{ number: number; base?: string; title?: string; body?: string }>;
  /** Labels applied via POST /issues/{n}/labels. */
  labelPosts: Array<{ number: number; labels: string[] }>;
  /** When true, EVERY Git Data write (blobs/trees/commits/refs) returns 403. */
  failGitWrites403: boolean;

  // --- Fleet self-identity (self-review guard) -----------------------------
  /**
   * Slug returned by `GET /app`, i.e. this App's identity. `null` makes the
   * endpoint 404 so `resolveFleetAppLogin` yields null (the unresolvable case).
   */
  appSlug: string | null;
  /** `user` block on the live PR fetch — who authored the PR under review. */
  prAuthor: { login: string; type: string } | null;
  /**
   * `state` / `merged` on the live PR fetch — the PR's lifecycle.
   *
   * `undefined` OMITS the key entirely, reproducing a payload where GitHub
   * gave us nothing, which the lifecycle gate must fail OPEN on.
   */
  prState: string | undefined;
  prMerged: boolean | undefined;
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
    createdDetailsUrls: [],
    completed: [],
    reviews: [],
    prDiff: undefined,
    prHeadSha: 'HEADSHA',
    prHeadRef: 'feat/widget',
    prBaseRef: 'main',
    prHeadRepo: 'erichowens/port-daddy',
    prBaseRepo: 'erichowens/port-daddy',
    openPRs: [],
    branches: [],
    failTokenMintTimes: 0,
    failConfig401: 0,
    failCreateCheckRun: 0,
    gitRefs: new Map(),
    blobsCreated: 0,
    treesCreated: 0,
    commitsCreated: 0,
    refCreates: 0,
    refUpdates: 0,
    stackedPrs: [],
    prPatches: [],
    labelPosts: [],
    failGitWrites403: false,
    appSlug: 'port-daddy',
    prAuthor: { login: 'a-human', type: 'User' },
    prState: 'open',
    prMerged: false,
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

    // --- App self-identity (resolveFleetAppLogin) ---
    if (url === 'https://api.github.com/app' && method === 'GET') {
      if (!state.appSlug) return text('not found', 404);
      return json({ slug: state.appSlug });
    }

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

    // --- Git Data API (purser stacked-PR machinery) ---
    if (/\/git\/blobs$/.test(url) && method === 'POST') {
      if (state.failGitWrites403) return text('Resource not accessible by integration', 403);
      state.blobsCreated += 1;
      return json({ sha: `blob-${state.blobsCreated}` });
    }
    if (/\/git\/commits\/[^/?]+$/.test(url) && method === 'GET') {
      const sha = url.slice(url.lastIndexOf('/') + 1);
      return json({ sha, tree: { sha: `tree-of-${sha}` } });
    }
    if (/\/git\/trees$/.test(url) && method === 'POST') {
      if (state.failGitWrites403) return text('Resource not accessible by integration', 403);
      state.treesCreated += 1;
      return json({ sha: `tree-${state.treesCreated}` });
    }
    if (/\/git\/commits$/.test(url) && method === 'POST') {
      if (state.failGitWrites403) return text('Resource not accessible by integration', 403);
      state.commitsCreated += 1;
      return json({ sha: `commit-${state.commitsCreated}` });
    }
    if (/\/git\/refs$/.test(url) && method === 'POST') {
      if (state.failGitWrites403) return text('Resource not accessible by integration', 403);
      const b = (body ?? {}) as { ref?: string; sha?: string };
      const branch = (b.ref ?? '').replace(/^refs\/heads\//, '');
      if (state.gitRefs.has(branch)) return text('Reference already exists', 422);
      state.gitRefs.set(branch, b.sha ?? '');
      state.refCreates += 1;
      return json({ ref: b.ref, object: { sha: b.sha } }, 201);
    }
    const refPatch = url.match(/\/git\/refs\/heads\/(.+)$/);
    if (refPatch && method === 'PATCH') {
      if (state.failGitWrites403) return text('Resource not accessible by integration', 403);
      const branch = decodeURIComponent(refPatch[1]);
      state.gitRefs.set(branch, ((body ?? {}) as { sha?: string }).sha ?? '');
      state.refUpdates += 1;
      return json({ ref: `refs/heads/${branch}` });
    }

    // --- create PR (purser stacked test PR) ---
    if (/\/pulls$/.test(url) && method === 'POST') {
      const b = (body ?? {}) as { head?: string; base?: string; title?: string; body?: string };
      const number = 8000 + state.stackedPrs.length + 1;
      state.stackedPrs.push({
        number,
        head: b.head ?? '',
        base: b.base ?? '',
        title: b.title ?? '',
        body: b.body ?? '',
      });
      // Future open-PR lookups find it (openStackedPr idempotency).
      state.openPRs.push({
        number,
        title: b.title ?? '',
        draft: false,
        head: { ref: b.head ?? '' },
        base: { ref: b.base ?? '' },
        html_url: `https://github.com/test/pr/${number}`,
      });
      return json({ number, html_url: `https://github.com/test/pr/${number}` }, 201);
    }
    // --- update PR (openStackedPr refresh / retargetPrBase) ---
    const prPatch = url.match(/\/pulls\/(\d+)$/);
    if (prPatch && method === 'PATCH') {
      const b = (body ?? {}) as { base?: string; title?: string; body?: string };
      state.prPatches.push({ number: Number(prPatch[1]), base: b.base, title: b.title, body: b.body });
      return json({ number: Number(prPatch[1]) });
    }
    // --- add labels ---
    const labelPost = url.match(/\/issues\/(\d+)\/labels$/);
    if (labelPost && method === 'POST') {
      const b = (body ?? {}) as { labels?: string[] };
      state.labelPosts.push({ number: Number(labelPost[1]), labels: b.labels ?? [] });
      return json([]);
    }

    // --- list open PRs (Lookout cross-PR tool + openStackedPr lookup) ---
    if (/\/pulls\?/.test(url) && method === 'GET') {
      return json(state.openPRs);
    }
    // --- list branches (Lookout branch tool) ---
    if (/\/branches\?/.test(url) && method === 'GET') {
      return json(state.branches);
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
    // --- live PR metadata or diff, selected by Accept ---
    if (/\/pulls\/\d+$/.test(url)) {
      const headers = new Headers(init?.headers);
      if (headers.get('Accept')?.includes('diff')) {
        return text(state.prDiff ?? 'diff --git a/src/x.ts b/src/x.ts\n+changed');
      }
      return json({
        number: 7,
        title: 'Test PR',
        body: '',
        ...(state.prAuthor ? { user: state.prAuthor } : {}),
        ...(state.prState === undefined ? {} : { state: state.prState }),
        ...(state.prMerged === undefined ? {} : { merged: state.prMerged }),
        head: {
          sha: state.prHeadSha,
          // undefined prHeadRef omits the key entirely, reproducing a PR whose
          // head branch GitHub did not report (the degrade-don't-misbase case).
          ...(state.prHeadRef === undefined ? {} : { ref: state.prHeadRef }),
          repo: { full_name: state.prHeadRepo },
        },
        base: { sha: 'BASESHA', ref: state.prBaseRef, repo: { full_name: state.prBaseRepo } },
      });
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
      state.createdDetailsUrls.push((body as { details_url?: string })?.details_url);
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
        detailsUrl: (body as { details_url?: string })?.details_url,
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

/** Captured fleet_run_spend row (one per ship that ran). */
export interface CapturedSpend {
  runId: unknown;
  ship: unknown;
  installationId: unknown;
  model: unknown;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** A seeded credit_ledger row (the relay writes these; the executor only reads). */
export interface LedgerRow {
  installationId: number;
  deltaUsd: number;
}

export interface D1Capture {
  db: D1Database;
  /** fleet_runs rows, in id order of first insert. */
  runs: CapturedRun[];
  /** fleet_run_steps rows, in insertion order. */
  steps: CapturedStep[];
  /** fleet_run_spend rows, in insertion order. */
  spend: CapturedSpend[];
  /**
   * Seeded credit_ledger rows the circuit-breaker SELECT reads. Empty ⇒ the
   * installation has no ledger rows (fail-open, run proceeds). Populate to
   * simulate a configured / negative balance.
   */
  ledger: LedgerRow[];
  /**
   * When true, any `credit_ledger` read throws (simulates the table not existing
   * yet — billing not deployed). The breaker must fail-OPEN and run anyway.
   */
  creditTableMissing: boolean;
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
    spend: [],
    ledger: [],
    creditTableMissing: false,
    failAll: false,
    runCalls: 0,
  };

  const prepare = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      async run() {
        cap.runCalls += 1;
        if (cap.failAll) throw new Error('D1 unavailable');
        if (/INTO fleet_run_spend/i.test(sql)) {
          cap.spend.push({
            runId: args[0],
            ship: args[1],
            installationId: args[2],
            model: args[3],
            inputTokens: Number(args[4]),
            outputTokens: Number(args[5]),
            costUsd: Number(args[6]),
          });
        } else if (/INTO fleet_runs/i.test(sql)) {
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
          const row = runsById.get(String(args[2]));
          if (row) {
            row.conclusion = String(args[0]);
            row.ms = Number(args[1]);
          }
        }
        return { success: true, meta: {} };
      },
      async first() {
        // Circuit-breaker balance read: COUNT(*) + SUM(delta_usd) for one install.
        if (/FROM credit_ledger/i.test(sql)) {
          if (cap.creditTableMissing) throw new Error('no such table: credit_ledger');
          const installId = args[0];
          const rows = cap.ledger.filter(r => r.installationId === installId);
          const bal = rows.reduce((acc, r) => acc + r.deltaUsd, 0);
          return { n: rows.length, bal } as unknown as Record<string, unknown>;
        }
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
  /**
   * Optional Workers AI `usage` block returned on every run() so cost/token
   * tests can assert on it. Omitted by default (existing tests see no usage).
   */
  usage?: { prompt_tokens: number; completion_tokens: number; cached_tokens?: number };
}): AiStub {
  const calls: AiStub['calls'] = [];
  const withUsage = (response: string): Record<string, unknown> =>
    opts.usage ? { response, usage: opts.usage } : { response };

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
      pull_request: {
        number: 7,
        title: 'x',
        body: 'y',
        head: { sha: 'HEADSHA', repo: { full_name: 'erichowens/port-daddy' } },
        base: { sha: 'BASESHA', ref: 'main', repo: { full_name: 'erichowens/port-daddy' } },
      },
    },
    ...over,
  };
}
