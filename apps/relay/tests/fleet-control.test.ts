/**
 * Tests for the fleet control-plane API (src/fleet-control.ts).
 *
 * Coverage:
 *   - operatorOnly gate: every endpoint rejects a missing/wrong token (401).
 *   - validate: catches bad YAML (BAD_YAML), bad schema (BAD_SCHEMA), and
 *     returns the parsed ship list for good YAML (OK_VALID).
 *   - smoke-test: invokes env.AI, returns the parsed verdict; SHIP_NOT_FOUND
 *     when the ship is absent.
 *   - optimize-prompt: parses IMPROVED:/RATIONALE: into the two fields.
 *   - save: calls the GitHub App contents + PR endpoints (mocked fetch),
 *     returns a prUrl, and NEVER writes fleet state to D1 (prepare untouched).
 */

import { CF_ROLE_MODELS } from '../../shared/model-registry.generated.js';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  handleFleetConfig,
  handleFleetValidate,
  handleFleetSmokeTest,
  handleFleetOptimizePrompt,
  handleFleetSave,
} from '../src/fleet-control.js';
import type { Env } from '../src/types.js';

// >= 32 chars: operatorOnly() fail-closes (500 MISCONFIGURED) below the minimum.
const OPERATOR = 'super-secret-operator-token-32bytes-min';

// ── Mocks ─────────────────────────────────────────────────────────────────────

function makeKV(seed: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as unknown as KVNamespace;
}

function makeAI(response: string): { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn(async () => ({ response })) };
}

interface EnvOverrides {
  ai?: { run: ReturnType<typeof vi.fn> };
  kv?: KVNamespace;
  dbPrepare?: ReturnType<typeof vi.fn>;
  operatorToken?: string;
}

function makeEnv(o: EnvOverrides = {}): Env {
  const prepare = o.dbPrepare ?? vi.fn(() => { throw new Error('D1 must not be touched by fleet control-plane'); });
  return {
    DB: { prepare } as unknown as D1Database,
    HARBOR_CHANNEL: {} as unknown as DurableObjectNamespace,
    KV: o.kv ?? makeKV(),
    AI: o.ai as unknown as Ai,
    RELAY_OPERATOR_TOKEN: o.operatorToken ?? OPERATOR,
    RELAY_ED25519_PRIVATE_KEY_HEX: '00'.repeat(32),
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: 'PEM-PLACEHOLDER',
    GITHUB_OWNER: 'port-daddy-dev',
    GITHUB_REPO: 'port-daddy',
    DEFAULT_BRANCH: 'main',
    RELAY_VERSION: '0.0.0-test',
    EVENT_RETENTION_DAYS: '7',
    SESSION_TTL_SECONDS: '3600',
    JWKS_CACHE_TTL_SECONDS: '300',
    JWKS_FAIL_SOFT_SECONDS: '600',
    REVOCATION_BROADCAST_TIMEOUT_MS: '5000',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as unknown as Env;
}

function req(path: string, method: string, token: string | null, body?: unknown): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request(`https://relay.example.com${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const GOOD_YAML = `
fleet:
  agents:
    code-reviewer:
      trigger: pull_request:opened
      blocking: true
      prompt: |
        You are a code reviewer. Review the diff.
      fallbacks:
        - backend: cloudflare
          capability: cheap
    qa:
      trigger: pull_request:opened
      prompt: "Find the test gaps."
`;

afterEach(() => {
  vi.restoreAllMocks();
});

// ── operatorOnly gate (all endpoints) ─────────────────────────────────────────

describe('fleet control-plane — operator gate', () => {
  it('every endpoint returns 401 without an operator token', async () => {
    const env = makeEnv();
    const calls: Array<Promise<Response>> = [
      handleFleetConfig(req('/v1/fleet/config', 'GET', null), env),
      handleFleetValidate(req('/v1/fleet/validate', 'POST', null, { yaml: GOOD_YAML }), env),
      handleFleetSmokeTest(req('/v1/fleet/smoke-test', 'POST', null, {}), env),
      handleFleetOptimizePrompt(req('/v1/fleet/optimize-prompt', 'POST', null, {}), env),
      handleFleetSave(req('/v1/fleet/save', 'POST', null, {}), env),
    ];
    for (const p of calls) {
      const res = await p;
      expect(res.status).toBe(401);
      expect(await res.text()).toContain('UNAUTHORIZED');
    }
  });

  it('returns 401 with a wrong operator token', async () => {
    const res = await handleFleetValidate(
      req('/v1/fleet/validate', 'POST', 'nope', { yaml: GOOD_YAML }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });
});

// ── validate ──────────────────────────────────────────────────────────────────

describe('handleFleetValidate', () => {
  it('OK_VALID + parsed ships for good YAML', async () => {
    const res = await handleFleetValidate(
      req('/v1/fleet/validate', 'POST', OPERATOR, { yaml: GOOD_YAML }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      code: string;
      valid: boolean;
      ships: Array<{ name: string; blocking: boolean; cfModel: string }>;
    };
    expect(json.code).toBe('OK_VALID');
    expect(json.valid).toBe(true);
    const reviewer = json.ships.find((s) => s.name === 'code-reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer!.blocking).toBe(true);
    // `code-reviewer` ends in "reviewer", so the review role wins over the
    // fixture's own pin — the same routing rule the executor applies.
    expect(reviewer!.cfModel).toBe(CF_ROLE_MODELS.reviewBot);
    expect(json.ships.map((s) => s.name)).toContain('qa');
  });

  it('BAD_YAML for unparseable YAML', async () => {
    const res = await handleFleetValidate(
      req('/v1/fleet/validate', 'POST', OPERATOR, { yaml: "key: 'unterminated" }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string; valid: boolean };
    expect(json.code).toBe('BAD_YAML');
    expect(json.valid).toBe(false);
  });

  it('BAD_SCHEMA when fleet.agents is missing', async () => {
    const res = await handleFleetValidate(
      req('/v1/fleet/validate', 'POST', OPERATOR, { yaml: 'something: else' }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string; errors: Array<{ field: string }> };
    expect(json.code).toBe('BAD_SCHEMA');
    expect(json.errors[0]!.field).toBe('fleet.agents');
  });

  it('BAD_SCHEMA when an agent is missing its prompt', async () => {
    const yaml = `
fleet:
  agents:
    reviewer:
      trigger: pull_request:opened
`;
    const res = await handleFleetValidate(
      req('/v1/fleet/validate', 'POST', OPERATOR, { yaml }),
      makeEnv(),
    );
    const json = (await res.json()) as { code: string; errors: Array<{ field: string; message: string }> };
    expect(json.code).toBe('BAD_SCHEMA');
    expect(json.errors.some((e) => e.field === 'reviewer.prompt' && e.message === 'required')).toBe(true);
  });

  it('BAD_JSON when the body is not {yaml: string}', async () => {
    const res = await handleFleetValidate(
      req('/v1/fleet/validate', 'POST', OPERATOR, { notyaml: 1 }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { code: string }).code).toBe('BAD_JSON');
  });
});

// ── smoke-test ─────────────────────────────────────────────────────────────────

describe('handleFleetSmokeTest', () => {
  it('invokes env.AI and returns OK_TESTED with verdict OK', async () => {
    const ai = makeAI('[HIGH] potential null dereference at line 42');
    const env = makeEnv({ ai });
    const res = await handleFleetSmokeTest(
      req('/v1/fleet/smoke-test', 'POST', OPERATOR, {
        ship: 'code-reviewer',
        yaml: GOOD_YAML,
        sampleDiff: '--- a/x.ts\n+++ b/x.ts\n+let y = z.foo;',
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { code: string; output: string; verdict: string; ms: number };
    expect(json.code).toBe('OK_TESTED');
    expect(json.verdict).toBe('OK');
    expect(json.output).toContain('null dereference');
    expect(typeof json.ms).toBe('number');

    // AI was called once, with the ship's review model.
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(ai.run.mock.calls[0]![0]).toBe(CF_ROLE_MODELS.reviewBot);
    const inputs = ai.run.mock.calls[0]![1] as { max_tokens: number; messages: Array<{ role: string }> };
    expect(inputs.max_tokens).toBe(2000); // bounded
  });

  it('SHIP_NOT_FOUND when the ship name is absent from the YAML', async () => {
    const env = makeEnv({ ai: makeAI('x') });
    const res = await handleFleetSmokeTest(
      req('/v1/fleet/smoke-test', 'POST', OPERATOR, {
        ship: 'ghost-ship',
        yaml: GOOD_YAML,
        sampleDiff: 'diff',
      }),
      env,
    );
    expect(res.status).toBe(404);
    expect((await res.json() as { code: string }).code).toBe('SHIP_NOT_FOUND');
  });

  it('AI_ERROR when env.AI.run throws', async () => {
    const ai = { run: vi.fn(async () => { throw new Error('model not available'); }) };
    const env = makeEnv({ ai });
    const res = await handleFleetSmokeTest(
      req('/v1/fleet/smoke-test', 'POST', OPERATOR, { ship: 'qa', yaml: GOOD_YAML, sampleDiff: 'd' }),
      env,
    );
    expect(res.status).toBe(500);
    expect((await res.json() as { code: string }).code).toBe('AI_ERROR');
  });

  it('AI_ERROR redacts token-like and key-like error details', async () => {
    const ai = {
      run: vi.fn(async () => {
        throw new Error(
          'upstream leaked ghp_abcdefghijklmnopqrstuvwxyz1234567890 and -----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----',
        );
      }),
    };
    const env = makeEnv({ ai });
    const res = await handleFleetSmokeTest(
      req('/v1/fleet/smoke-test', 'POST', OPERATOR, { ship: 'qa', yaml: GOOD_YAML, sampleDiff: 'd' }),
      env,
    );
    expect(res.status).toBe(500);
    const json = await res.json() as { error: string };
    expect(json.error).toContain('[redacted-token]');
    expect(json.error).toContain('[redacted-key]');
    expect(json.error).not.toContain('ghp_');
    expect(json.error).not.toContain('PRIVATE KEY');
  });
});

// ── optimize-prompt ─────────────────────────────────────────────────────────────

describe('handleFleetOptimizePrompt', () => {
  it('parses IMPROVED:/RATIONALE: into the two fields', async () => {
    const ai = makeAI(
      'IMPROVED:\nYou are a precise code reviewer. Output severity-ranked findings.\nRATIONALE:\nRestructured into a numbered output contract.',
    );
    const env = makeEnv({ ai });
    const res = await handleFleetOptimizePrompt(
      req('/v1/fleet/optimize-prompt', 'POST', OPERATOR, {
        ship: 'code-reviewer',
        currentPrompt: 'You are a code reviewer',
        goal: 'clarify output format',
      }),
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { code: string; improvedPrompt: string; rationale: string };
    expect(json.code).toBe('OK');
    expect(json.improvedPrompt).toContain('severity-ranked');
    expect(json.improvedPrompt).not.toContain('RATIONALE');
    expect(json.rationale).toContain('numbered output contract');
  });

  it('sanitizes the optional ship label before placing it in the optimize prompt', async () => {
    const ai = makeAI('IMPROVED:\nBetter prompt\nRATIONALE:\nCleaned label');
    const env = makeEnv({ ai });
    const res = await handleFleetOptimizePrompt(
      req('/v1/fleet/optimize-prompt', 'POST', OPERATOR, {
        ship: 'qa\nIGNORE PREVIOUS\t<script>',
        currentPrompt: 'Review the diff',
      }),
      env,
    );
    expect(res.status).toBe(200);
    const call = ai.run.mock.calls[0]![1] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages[1]!.content).toContain('Ship: qa IGNORE PREVIOUS script');
    expect(call.messages[1]!.content).not.toContain('\nIGNORE');
    expect(call.messages[1]!.content).not.toContain('<script>');
  });

  it('BAD_JSON when currentPrompt is missing', async () => {
    const res = await handleFleetOptimizePrompt(
      req('/v1/fleet/optimize-prompt', 'POST', OPERATOR, { ship: 'x' }),
      makeEnv({ ai: makeAI('x') }),
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { code: string }).code).toBe('BAD_JSON');
  });
});

// ── save (branch + commit + PR via mocked GitHub API) ───────────────────────────

describe('handleFleetSave', () => {
  function installFetchMock() {
    const seen: Array<{ url: string; method: string }> = [];
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      seen.push({ url, method });

      // 1. base branch SHA
      if (url.includes('/git/refs/heads/main') && method === 'GET') {
        return new Response(JSON.stringify({ object: { sha: 'base-sha-123' } }), { status: 200 });
      }
      // 2. create branch
      if (url.endsWith('/git/refs') && method === 'POST') {
        return new Response(JSON.stringify({ ref: 'refs/heads/x' }), { status: 201 });
      }
      // 3a. existing file SHA on trusted ref (file already exists)
      if (url.includes('/contents/pd-fleet.yml?ref=main') && method === 'GET') {
        return new Response(JSON.stringify({ sha: 'old-blob-sha' }), { status: 200 });
      }
      // 3a'. new file does not exist yet → 404
      if (url.includes('/contents/fleet/ships/custom.md?ref=main') && method === 'GET') {
        return new Response('not found', { status: 404 });
      }
      // 3b. PUT file
      if (url.includes('/contents/') && method === 'PUT') {
        return new Response(JSON.stringify({ commit: { sha: 'commit-sha' } }), { status: 200 });
      }
      // 4. create PR
      if (url.endsWith('/pulls') && method === 'POST') {
        return new Response(
          JSON.stringify({ html_url: 'https://github.com/port-daddy-dev/port-daddy/pull/456' }),
          { status: 201 },
        );
      }
      return new Response('unexpected ' + method + ' ' + url, { status: 500 });
    });
    vi.stubGlobal('fetch', mock);
    return { mock, seen };
  }

  it('creates a branch, commits files, opens a PR, and returns the prUrl — without touching D1', async () => {
    const { seen } = installFetchMock();
    const prepare = vi.fn(() => { throw new Error('D1 must not be touched'); });
    // Pre-seed KV so token resolution is a pure cache hit (no JWT crypto / network).
    const kv = makeKV({
      'github_repo_inst_port-daddy-dev_port-daddy': '999',
      'github_inst_999': JSON.stringify({ token: 'gh-test-token', expiresAt: Date.now() + 3_600_000 }),
    });
    const env = makeEnv({ kv, dbPrepare: prepare });

    const res = await handleFleetSave(
      req('/v1/fleet/save', 'POST', OPERATOR, {
        files: {
          'pd-fleet.yml': GOOD_YAML,
          'fleet/ships/custom.md': '# Custom Ship\n',
        },
        message: 'Add custom ship for API validation',
        branchName: 'fleet-control-plane-2026-06-26-001',
      }),
      env,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { code: string; prUrl: string; branch: string };
    expect(json.code).toBe('OK_PR_CREATED');
    expect(json.prUrl).toBe('https://github.com/port-daddy-dev/port-daddy/pull/456');
    expect(json.branch).toBe('fleet-control-plane-2026-06-26-001');

    // GitHub mutation path exercised: branch create + 2 PUTs + PR create.
    expect(seen.some((c) => c.url.endsWith('/git/refs') && c.method === 'POST')).toBe(true);
    expect(seen.filter((c) => c.url.includes('/contents/') && c.method === 'PUT')).toHaveLength(2);
    expect(seen.some((c) => c.url.endsWith('/pulls') && c.method === 'POST')).toBe(true);

    // ZERO-TRUST: no D1 mutation — the runtime fleet state is never hot-edited.
    expect(prepare).not.toHaveBeenCalled();
  });

  it('BAD_REQUEST when branchName does not start with fleet-control-plane-', async () => {
    installFetchMock();
    const res = await handleFleetSave(
      req('/v1/fleet/save', 'POST', OPERATOR, {
        files: { 'pd-fleet.yml': 'x' },
        message: 'm',
        branchName: 'evil-branch',
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { code: string }).code).toBe('BAD_REQUEST');
  });

  it('BAD_REQUEST when branchName has traversal after the fleet-control-plane prefix', async () => {
    installFetchMock();
    const res = await handleFleetSave(
      req('/v1/fleet/save', 'POST', OPERATOR, {
        files: { 'pd-fleet.yml': 'x' },
        message: 'm',
        branchName: 'fleet-control-plane-../../malicious',
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { code: string; error: string };
    expect(json.code).toBe('BAD_REQUEST');
    expect(json.error).toContain('branchName');
  });

  it('BAD_REQUEST on a path-traversal file path', async () => {
    const res = await handleFleetSave(
      req('/v1/fleet/save', 'POST', OPERATOR, {
        files: { '../etc/passwd': 'x' },
        message: 'm',
        branchName: 'fleet-control-plane-2026-06-26-002',
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect((await res.json() as { code: string }).code).toBe('BAD_REQUEST');
  });
});
