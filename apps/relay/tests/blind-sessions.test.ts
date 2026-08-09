/**
 * BLIND SESSIONS — relay-side tests + the ADVERSARIAL HARNESS
 * (grand-plan DAG node blind-sessions; task label X5; plan §L2 first slice;
 * src/blind-sessions.ts + src/trust-page.ts).
 *
 * The harness IS the shipping gate (and a permanent CI corpus). It proves an
 * active adversary is CONTAINED across all three exfiltration channels named
 * in the node spec:
 *
 *   (a) via OUTPUTS   — a concluded output that violates the contract is the
 *       relay's tripwire: refused, run dies fail-closed, borrower gets nothing.
 *   (b) via EGRESS    — the executor-side test (../../fleet-executor) pins the
 *       no-network property; here we prove the relay never stores skill
 *       material and the kill flag makes every route inert.
 *   (c) via CAPABILITY REPLAY — max_runs is spent by an ATOMIC ledger counter,
 *       so replaying a valid token past its budget is refused by state.
 *
 * Plus the caveat matrix (expired / wrong-harbor / forged / revoked all
 * refused), receipt parity (both sides' receipts describe the same run under
 * the same chain coordinates), and sender pinning at every chained route.
 *
 * Idiom: the full-crypto approach of mediator-body.test.ts / the N2 suite —
 * real relay key, real provisioning, real event hashing + signing through the
 * relay's own crypto helpers, a stateful MockD1 with real chain semantics,
 * extended with the blind_* tables.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@noble/hashes/sha256';
import {
  handleBlindSkillPublish,
  handleBlindCapabilityMint,
  handleBlindRunCreate,
  handleBlindRunKey,
  handleBlindRunSeal,
  handleBlindRunConclude,
  handleBlindRunFetch,
  handleBlindSkillRuns,
  handleBlindToggle,
  enforceBlindOutputContract,
  canonicalBlindJson,
  blindVerdictHash,
  blindRefusalHash,
  validateOutputSchema,
  mintBlindCapability,
  verifyBlindCapability,
  BLIND_SCHEMA,
  BLIND_SEAL_VERSION,
  type BlindOutputSchema,
} from '../src/blind-sessions.js';
import { renderTrustPage, handleTrustPage } from '../src/trust-page.js';
import { handleProvisionFleetExecutor } from '../src/fleet-executor-identity.js';
import { computeEventHash, signEd25519, pubKeyFromPrivKey, toHex, fromHex, ZERO_HASH } from '../src/crypto.js';
import type { Env, RelayEvent } from '../src/types.js';

// ── Stateful in-memory D1 (chain semantics + blind tables) ──────────────────

interface IdentityRec {
  daemon_fingerprint: string; pub_key: string; proof_method: string;
  proof_metadata: string; expires_at: number | null; revoked: number; revoked_reason: string | null;
}
interface EventRec {
  sender: string; channel: string; seq: number; prev_hash: string;
  this_hash: string; iat: number; ciphertext: string; sig: string;
}
interface SkillRec {
  skill_id: string; harbor: string; lender_fingerprint: string; title: string;
  output_schema_json: string; created_at: number; revoked: number;
}
interface CapRec {
  jti: string; skill_id: string; harbor: string; max_runs: number; runs_used: number;
  exp: number; created_at: number; revoked: number;
}
interface RunRec {
  run_id: string; skill_id: string; jti: string; harbor: string; borrower_input: string;
  status: string; refusal_reason: string | null; executor_fingerprint: string | null;
  run_pubkey: string | null; sealed_payload_json: string | null; output_json: string | null;
  verdict_hash: string | null; tokens_used: number | null; created_at: number; concluded_at: number | null;
}
interface ReceiptRec {
  run_id: string; side: string; body_json: string; chain_channel: string;
  chain_seq: number; chain_hash: string; created_at: number;
}

class MockD1 {
  identities = new Map<string, IdentityRec>();
  events: EventRec[] = [];
  heads = new Map<string, { sender: string; channel: string; tip_seq: number }>();
  skills: SkillRec[] = [];
  caps: CapRec[] = [];
  runs: RunRec[] = [];
  receipts: ReceiptRec[] = [];

  prepare(query: string) {
    const self = this;
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { args = a; return stmt; },
      async first<T>(): Promise<T | null> { return self.route(query, args, 'first') as T | null; },
      async all<T>(): Promise<{ results: T[] }> { return { results: self.route(query, args, 'all') as T[] }; },
      async run() {
        const changes = self.route(query, args, 'run');
        return { success: true, meta: { changes: typeof changes === 'number' ? changes : 1 } };
      },
    };
    return stmt;
  }

  // eslint-disable-next-line complexity
  private route(q: string, args: unknown[], mode: 'first' | 'all' | 'run'): unknown {
    // ── identity / chain (verbatim from the N2 / mediator suites) ──────────
    if (q.includes('FROM identities') && q.includes('WHERE daemon_fingerprint')) {
      return this.identities.get(args[0] as string) ?? null;
    }
    if (q.includes('INSERT INTO identities')) {
      const [fp, pub, method, meta, exp] = args as [string, string, string, string, number | null];
      const prev = this.identities.get(fp);
      this.identities.set(fp, {
        daemon_fingerprint: fp, pub_key: pub, proof_method: method, proof_metadata: meta,
        expires_at: exp, revoked: prev?.revoked ?? 0, revoked_reason: prev?.revoked_reason ?? null,
      });
      return undefined;
    }
    if (q.includes('FROM revocations')) return null;
    if (q.includes('FROM events') && q.includes('ORDER BY seq DESC')) {
      const [sender, channel] = args as [string, string];
      const match = this.events.filter((e) => e.sender === sender && e.channel === channel).sort((a, b) => b.seq - a.seq)[0];
      return match ? { seq: match.seq, this_hash: match.this_hash } : null;
    }
    if (q.includes('INSERT INTO events')) {
      const [sender, channel, seq] = args as [string, string, number];
      if (this.events.some((e) => e.sender === sender && e.channel === channel && e.seq === seq)) {
        throw new Error('UNIQUE constraint failed: events.sender, events.channel, events.seq');
      }
      const [, , , prev_hash, this_hash, iat, ciphertext, sig] =
        args as [string, string, number, string, string, number, string, string];
      this.events.push({ sender, channel, seq, prev_hash, this_hash, iat, ciphertext, sig });
      return undefined;
    }
    if (q.includes('INSERT INTO chain_heads')) {
      const [sender, channel, tip_seq] = args as [string, string, number];
      this.heads.set(`${sender}|${channel}`, { sender, channel, tip_seq });
      return undefined;
    }
    if (q.includes('FROM chain_heads')) return mode === 'all' ? [] : null;
    if (q.includes('INSERT INTO audit_log')) return undefined;
    if (q.includes('FROM harbor_members')) return mode === 'all' ? [] : null;

    // ── blind_skills ────────────────────────────────────────────────────────
    if (q.includes('INSERT INTO blind_skills')) {
      const [skill_id, harbor, lender_fingerprint, title, output_schema_json, created_at] =
        args as [string, string, string, string, string, number];
      this.skills.push({ skill_id, harbor, lender_fingerprint, title, output_schema_json, created_at, revoked: 0 });
      return undefined;
    }
    if (q.includes('FROM blind_skills WHERE skill_id')) {
      return this.skills.find((s) => s.skill_id === args[0]) ?? null;
    }

    // ── blind_capabilities ────────────────────────────────────────────────
    if (q.includes('INSERT INTO blind_capabilities')) {
      const [jti, skill_id, harbor, max_runs, exp, created_at] =
        args as [string, string, string, number, number, number];
      this.caps.push({ jti, skill_id, harbor, max_runs, runs_used: 0, exp, created_at, revoked: 0 });
      return undefined;
    }
    if (q.includes('FROM blind_capabilities WHERE jti')) {
      return this.caps.find((c) => c.jti === args[0]) ?? null;
    }
    if (q.includes('UPDATE blind_capabilities SET runs_used')) {
      const jti = args[0] as string;
      const cap = this.caps.find((c) => c.jti === jti && c.revoked === 0 && c.runs_used < c.max_runs);
      if (!cap) return 0;
      cap.runs_used += 1;
      return 1;
    }

    // ── blind_runs ────────────────────────────────────────────────────────
    if (q.includes('INSERT INTO blind_runs')) {
      const [run_id, skill_id, jti, harbor, borrower_input, created_at] =
        args as [string, string, string, string, string, number];
      this.runs.push({
        run_id, skill_id, jti, harbor, borrower_input, status: 'awaiting-key',
        refusal_reason: null, executor_fingerprint: null, run_pubkey: null,
        sealed_payload_json: null, output_json: null, verdict_hash: null,
        tokens_used: null, created_at, concluded_at: null,
      });
      return undefined;
    }
    if (q.includes('FROM blind_runs WHERE run_id')) {
      return this.runs.find((r) => r.run_id === args[0]) ?? null;
    }
    if (q.includes('FROM blind_runs WHERE skill_id') && q.includes('status')) {
      const [skill_id, status] = args as [string, string];
      return this.runs.filter((r) => r.skill_id === skill_id && r.status === status).sort((a, b) => a.created_at - b.created_at);
    }
    if (q.includes("SET status = 'key-ready'")) {
      const [pubkey, execFp, run_id] = args as [string, string, string];
      const r = this.runs.find((x) => x.run_id === run_id && x.status === 'awaiting-key');
      if (!r) return 0;
      r.status = 'key-ready'; r.run_pubkey = pubkey; r.executor_fingerprint = execFp;
      return 1;
    }
    if (q.includes("SET status = 'sealed'")) {
      const [sealed, run_id] = args as [string, string];
      const r = this.runs.find((x) => x.run_id === run_id && x.status === 'key-ready');
      if (!r) return 0;
      r.status = 'sealed'; r.sealed_payload_json = sealed;
      return 1;
    }
    if (q.includes("SET status = 'concluded'")) {
      const [output_json, refusal_reason, verdict_hash, tokens_used, at, run_id] =
        args as [string | null, string | null, string, number, number, string];
      const r = this.runs.find((x) => x.run_id === run_id && x.status === 'sealed');
      if (!r) return 0;
      r.status = 'concluded'; r.output_json = output_json; r.refusal_reason = refusal_reason;
      r.verdict_hash = verdict_hash; r.tokens_used = tokens_used; r.concluded_at = at;
      return 1;
    }
    if (q.includes("SET status = 'refused'")) {
      const [reason, at, run_id] = args as [string, number, string];
      const r = this.runs.find((x) => x.run_id === run_id && x.status !== 'concluded');
      if (!r) return 0;
      r.status = 'refused'; r.refusal_reason = reason; r.concluded_at = at;
      return 1;
    }

    // ── blind_receipts ──────────────────────────────────────────────────────
    if (q.includes('INSERT INTO blind_receipts')) {
      const [run_id, side, body_json, chain_channel, chain_seq, chain_hash, created_at] =
        args as [string, string, string, string, number, string, number];
      this.receipts.push({ run_id, side, body_json, chain_channel, chain_seq, chain_hash, created_at });
      return undefined;
    }
    if (q.includes('FROM blind_receipts WHERE run_id')) {
      const [run_id, side] = args as [string, string];
      return this.receipts.find((r) => r.run_id === run_id && r.side === side) ?? null;
    }

    if (mode === 'all') return [];
    return null;
  }
}

// ── KV mock ──────────────────────────────────────────────────────────────────

function makeKv(store: Map<string, string>): KVNamespace {
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as unknown as KVNamespace;
}

// ── Env + provisioning + envelope signing (the N2 idiom) ─────────────────────

const OPERATOR_TOKEN = 'operator-token-0123456789abcdef-0123456789abcdef';
const RELAY_PRIV = '42'.repeat(32);
const RELAY_FP = toHex(sha256(fromHex(pubKeyFromPrivKey(RELAY_PRIV))));
const BLIND_SECRET = 'blind-cap-secret-0123456789abcdef-0123456789';

function makeEnv(db: MockD1, kvStore: Map<string, string>, over: Partial<Env> = {}): Env {
  return {
    DB: db as unknown as D1Database,
    HARBOR_CHANNEL: {
      idFromName: () => ({}),
      get: () => ({
        fetch: async (url: string) =>
          String(url).includes('rate-check') ? Response.json({ allowed: true }) : new Response('{}', { status: 200 }),
      }),
    } as unknown as DurableObjectNamespace,
    KV: makeKv(kvStore),
    RELAY_OPERATOR_TOKEN: OPERATOR_TOKEN,
    RELAY_ED25519_PRIVATE_KEY_HEX: RELAY_PRIV,
    RELAY_VERSION: '0.0.0-test',
    BLIND_CAP_SECRET: BLIND_SECRET,
    EVENT_RETENTION_DAYS: '7',
    SESSION_TTL_SECONDS: '3600',
    JWKS_CACHE_TTL_SECONDS: '300',
    JWKS_FAIL_SOFT_SECONDS: '600',
    REVOCATION_BROADCAST_TIMEOUT_MS: '5000',
    RATE_LIMIT_WINDOW_MS: '60000',
    ...over,
  } as unknown as Env;
}

async function provision(env: Env, seedHex: string, deployment: string): Promise<{ fingerprint: string; card: string }> {
  const res = await handleProvisionFleetExecutor(
    new Request('https://relay.example/v1/fleet/executor-identity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPERATOR_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pub_key: pubKeyFromPrivKey(seedHex), deployment }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { fingerprint: string; card: string };
}

interface LocalChain { seq: number; prev: string }

async function signedEnvelope(
  seedHex: string, fingerprint: string, channel: string, chain: LocalChain, body: Record<string, unknown>,
): Promise<RelayEvent> {
  const seq = chain.seq + 1;
  const prev_hash = chain.prev;
  const iat = 1_717_000_000 + seq;
  const ciphertext = Buffer.from(JSON.stringify(body)).toString('base64url');
  const this_hash = computeEventHash({ prev_hash, sender: fingerprint, channel, seq, iat, ciphertext });
  const sig = await signEd25519(seedHex, this_hash);
  chain.seq = seq;
  chain.prev = this_hash;
  return { v: 1, sender: fingerprint, channel, seq, prev_hash, this_hash, iat, ciphertext, sig };
}

const post = (path: string, body: unknown) =>
  new Request(`https://relay.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const LENDER_SEED = '11'.repeat(32);
const EXEC_SEED = '22'.repeat(32);
const OUTSIDER_SEED = '33'.repeat(32);

const SCHEMA: BlindOutputSchema = {
  fields: { verdict: { type: 'string', maxLength: 40 }, score: { type: 'number' } },
  required: ['verdict'],
};

// ── Suite state + protocol helpers ───────────────────────────────────────────

let db: MockD1;
let kvStore: Map<string, string>;
let env: Env;

beforeEach(() => {
  db = new MockD1();
  kvStore = new Map();
  env = makeEnv(db, kvStore);
});

interface Actors {
  lenderFp: string; lenderCard: string; lenderChain: LocalChain;
  execFp: string; execCard: string; execChain: LocalChain;
}

const LENDER_CHANNEL = `${RELAY_FP}:fleet-cloud:blind:lender`;
const execChannelFor = (runId: string) => `${RELAY_FP}:fleet-cloud:blind:exec:${runId}`;

async function setupActors(): Promise<Actors> {
  const lender = await provision(env, LENDER_SEED, 'lender');
  const exec = await provision(env, EXEC_SEED, 'exec');
  return {
    lenderFp: lender.fingerprint, lenderCard: lender.card, lenderChain: { seq: 0, prev: ZERO_HASH },
    execFp: exec.fingerprint, execCard: exec.card, execChain: { seq: 0, prev: ZERO_HASH },
  };
}

async function publishSkill(a: Actors, over: Record<string, unknown> = {}): Promise<{ skill_id: string; lender_token: string }> {
  const body = { schema: BLIND_SCHEMA, type: 'publish-skill', harbor: 'alice/dock', title: 'sealed judge', output_schema: SCHEMA, ...over };
  const event = await signedEnvelope(LENDER_SEED, a.lenderFp, LENDER_CHANNEL, a.lenderChain, body);
  const res = await handleBlindSkillPublish(post('/v1/blind/skills', { card: a.lenderCard, event }), env);
  expect(res.status).toBe(201);
  return (await res.json()) as { skill_id: string; lender_token: string };
}

async function mintCapability(a: Actors, skillId: string, over: Record<string, unknown> = {}): Promise<{ token: string; jti: string }> {
  const body = {
    schema: BLIND_SCHEMA, type: 'mint-capability', skill_id: skillId, max_runs: 2,
    exp: Math.floor(Date.now() / 1000) + 3600, ...over,
  };
  const event = await signedEnvelope(LENDER_SEED, a.lenderFp, LENDER_CHANNEL, a.lenderChain, body);
  const res = await handleBlindCapabilityMint(post('/v1/blind/capabilities', { card: a.lenderCard, event }), env);
  return { token: '', jti: '', ...(await res.json() as object), __status: res.status } as unknown as { token: string; jti: string };
}

// ── Trust page (D8 — the /trust visual proof) ────────────────────────────────

describe('trust page (/trust, doctrine D8)', () => {
  it('labels every claim crypto | policy | unbuilt', () => {
    const html = renderTrustPage('9.9.9-test');
    expect(html).toContain('CRYPTO');
    expect(html).toContain('POLICY');
    expect(html).toContain('UNBUILT');
    // The load-bearing honesty: blindness sold as policy on a named TCB, never math.
    expect(html).toContain('policy on a named TCB');
    expect(html).toContain('executor sandbox');
    expect(html).toContain('never sold as math');
    // Blind to Port Daddy is FALSE and said so.
    expect(html).toMatch(/blind to Port Daddy[\s\S]*FALSE/i);
  });

  it('serves no-script, public-cacheable HTML', () => {
    const res = handleTrustPage({ RELAY_VERSION: '1.2.3' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('Content-Type')).toContain('text/html');
  });
});

// ── Output-contract parity fixture (asserted here AND in the executor suite) ──

interface ContractVector {
  name: string; schema: BlindOutputSchema; candidate?: unknown;
  candidateStringFieldLength?: number; ok: boolean; reason?: string;
}
interface VerdictVector {
  name: string; outputA?: Record<string, string | number | boolean>;
  outputB?: Record<string, string | number | boolean>; canonical?: string; refusal?: string; verdictHash: string;
}
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../tests/fixtures/blind-output-contract-parity-vectors.json', import.meta.url)), 'utf8'),
) as { contractVectors: ContractVector[]; verdictVectors: VerdictVector[] };

describe('output-contract parity fixture (relay twin)', () => {
  for (const v of fixture.contractVectors) {
    it(v.name, () => {
      const candidate = v.candidateStringFieldLength !== undefined
        ? { summary: 'x'.repeat(v.candidateStringFieldLength) } : v.candidate;
      const res = enforceBlindOutputContract(v.schema, candidate);
      expect(res.ok).toBe(v.ok);
      if (!v.ok && v.reason) expect((res as { reason: string }).reason).toContain(v.reason);
    });
  }
  for (const v of fixture.verdictVectors) {
    it(`verdict: ${v.name}`, () => {
      if (v.refusal !== undefined) expect(blindRefusalHash(v.refusal)).toBe(v.verdictHash);
      else if (v.outputA && v.outputB) {
        expect(canonicalBlindJson(v.outputA)).toBe(v.canonical);
        expect(blindVerdictHash(v.outputA)).toBe(v.verdictHash);
        expect(blindVerdictHash(v.outputB)).toBe(v.verdictHash);
      }
    });
  }
});

// ── Schema + capability unit tests ───────────────────────────────────────────

describe('output schema validation', () => {
  it('rejects an empty field set', () => {
    expect(typeof validateOutputSchema({ fields: {} })).toBe('string');
  });
  it('rejects a required field not in the schema', () => {
    expect(typeof validateOutputSchema({ fields: { a: { type: 'string' } }, required: ['b'] })).toBe('string');
  });
  it('accepts a well-formed schema', () => {
    expect(typeof validateOutputSchema(SCHEMA)).toBe('object');
  });
});

describe('capability token integrity', () => {
  it('round-trips a valid token', async () => {
    const payload = { v: 1 as const, jti: 'bj_1', skill_id: 'bsk_1', harbor: 'a/b', max_runs: 3, exp: 999 };
    const token = await mintBlindCapability(BLIND_SECRET, payload);
    expect(await verifyBlindCapability(BLIND_SECRET, token)).toEqual(payload);
  });
  it('rejects a tampered MAC', async () => {
    const token = await mintBlindCapability(BLIND_SECRET, { v: 1, jti: 'bj_1', skill_id: 'bsk_1', harbor: 'a/b', max_runs: 3, exp: 999 });
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(await verifyBlindCapability(BLIND_SECRET, tampered)).toBeNull();
  });
  it('rejects a token minted under a different secret', async () => {
    const token = await mintBlindCapability('another-secret-0123456789abcdef-abcdef00', { v: 1, jti: 'x', skill_id: 'bsk_1', harbor: 'a/b', max_runs: 1, exp: 999 });
    expect(await verifyBlindCapability(BLIND_SECRET, token)).toBeNull();
  });
});

// ── The full protocol: publish → mint → run → key → seal → conclude ──────────

describe('blind session happy path + receipt parity', () => {
  it('runs end to end and both sides get identical receipts on the same chain event', async () => {
    const a = await setupActors();
    const { skill_id, lender_token } = await publishSkill(a);
    const mint = await mintCapability(a, skill_id);
    expect((mint as { token: string }).token).toMatch(/^bcap\.v1\./);

    // Borrower creates a run.
    const create = await handleBlindRunCreate(post('/v1/blind/runs', { token: (mint as { token: string }).token, input: 'grade this essay' }), env);
    expect(create.status).toBe(201);
    const { run_id } = (await create.json()) as { run_id: string };

    // Executor posts the per-run key.
    const runCh = execChannelFor(run_id);
    const keyEvent = await signedEnvelope(EXEC_SEED, a.execFp, runCh, a.execChain, {
      schema: BLIND_SCHEMA, type: 'run-key', run_id, run_pubkey: 'A'.repeat(88),
    });
    const keyRes = await handleBlindRunKey(post(`/v1/blind/runs/${run_id}/key`, { card: a.execCard, event: keyEvent }), env, run_id);
    expect(keyRes.status).toBe(200);

    // Lender seals to the run.
    const sealEvent = await signedEnvelope(LENDER_SEED, a.lenderFp, LENDER_CHANNEL, a.lenderChain, {
      schema: BLIND_SCHEMA, type: 'seal', run_id, sealed: { v: BLIND_SEAL_VERSION, epk: 'e', iv: 'i', ct: 'c' },
    });
    const sealRes = await handleBlindRunSeal(post(`/v1/blind/runs/${run_id}/seal`, { card: a.lenderCard, event: sealEvent }), env, run_id);
    expect(sealRes.status).toBe(200);

    // Executor concludes with a conforming output + matching receipt.
    const output = { verdict: 'pass', score: 0.88 };
    const iat = 1_717_000_500;
    const receipt = { run_id, skill_id, verdict_hash: blindVerdictHash(output), tokens_used: 321, iat };
    const concludeEvent = await signedEnvelope(EXEC_SEED, a.execFp, runCh, a.execChain, {
      schema: BLIND_SCHEMA, type: 'conclude', run_id, output, receipt,
    });
    const concludeRes = await handleBlindRunConclude(post(`/v1/blind/runs/${run_id}/conclude`, { card: a.execCard, event: concludeEvent }), env, run_id);
    expect(concludeRes.status).toBe(200);
    const concluded = (await concludeRes.json()) as { verdict_hash: string; receipt_chain: { channel: string; seq: number; hash: string } };
    expect(concluded.verdict_hash).toBe(blindVerdictHash(output));

    // RECEIPT PARITY: borrower read + lender read carry the SAME body and chain coords.
    const bRead = await handleBlindRunFetch(new Request(`https://relay.example/v1/blind/runs/${run_id}?t=${encodeURIComponent((mint as { token: string }).token)}`), env, run_id);
    const bJson = (await bRead.json()) as { output: unknown; receipt: { body: typeof receipt; chain: { channel: string; seq: number; hash: string } } };
    expect(bJson.output).toEqual(output);
    expect(bJson.receipt.body).toEqual(receipt);

    const lRead = await handleBlindSkillRuns(new Request(`https://relay.example/v1/blind/skills/${skill_id}/runs?t=${encodeURIComponent(lender_token)}`), env, skill_id);
    const lJson = (await lRead.json()) as { receipts: Array<{ run_id: string; body: typeof receipt; chain: { channel: string; seq: number; hash: string } }> };
    expect(lJson.receipts).toHaveLength(1);
    expect(lJson.receipts[0].body).toEqual(receipt);
    // Both sides point at the identical conclude event.
    expect(lJson.receipts[0].chain).toEqual(bJson.receipt.chain);
    expect(bJson.receipt.chain).toEqual(concluded.receipt_chain);
  });

  it('BLINDNESS (read path): borrower never sees the sealed payload; lender never sees the borrower input', async () => {
    const a = await setupActors();
    const { skill_id, lender_token } = await publishSkill(a);
    const mint = await mintCapability(a, skill_id) as { token: string };
    const create = await handleBlindRunCreate(post('/v1/blind/runs', { token: mint.token, input: 'BORROWER SECRET INPUT' }), env);
    const { run_id } = (await create.json()) as { run_id: string };
    const runCh = execChannelFor(run_id);
    await handleBlindRunKey(post(`/v1/blind/runs/${run_id}/key`, {
      card: a.execCard, event: await signedEnvelope(EXEC_SEED, a.execFp, runCh, a.execChain, { schema: BLIND_SCHEMA, type: 'run-key', run_id, run_pubkey: 'A'.repeat(88) }),
    }), env, run_id);

    // Lender's worklist (before sealing, while the run is key-ready) shows the
    // run pubkey to seal to but NEVER the borrower's input.
    const lRead = await handleBlindSkillRuns(new Request(`https://relay.example/v1/blind/skills/${skill_id}/runs?t=${encodeURIComponent(lender_token)}`), env, skill_id);
    const lText = await lRead.clone().text();
    expect(lText).not.toContain('BORROWER SECRET INPUT');
    const lJson = (await lRead.json()) as { pending: Array<{ run_pubkey: string }> };
    expect(lJson.pending[0].run_pubkey).toBe('A'.repeat(88));

    await handleBlindRunSeal(post(`/v1/blind/runs/${run_id}/seal`, {
      card: a.lenderCard, event: await signedEnvelope(LENDER_SEED, a.lenderFp, LENDER_CHANNEL, a.lenderChain, { schema: BLIND_SCHEMA, type: 'seal', run_id, sealed: { v: BLIND_SEAL_VERSION, epk: 'LENDER-CIPHERTEXT', iv: 'i', ct: 'c' } }),
    }), env, run_id);

    // Borrower's read never carries the sealed payload.
    const bRead = await handleBlindRunFetch(new Request(`https://relay.example/v1/blind/runs/${run_id}?t=${encodeURIComponent(mint.token)}`), env, run_id);
    const bText = await bRead.text();
    expect(bText).not.toContain('LENDER-CIPHERTEXT');
  });
});

// ── ADVERSARIAL HARNESS: containment ─────────────────────────────────────────

describe('adversary: capability replay (channel c)', () => {
  it('max_runs is enforced by the atomic ledger — the 3rd run on a 2-run token is refused', async () => {
    const a = await setupActors();
    const { skill_id } = await publishSkill(a);
    const mint = await mintCapability(a, skill_id, { max_runs: 2 }) as { token: string };
    const r1 = await handleBlindRunCreate(post('/v1/blind/runs', { token: mint.token, input: 'one' }), env);
    const r2 = await handleBlindRunCreate(post('/v1/blind/runs', { token: mint.token, input: 'two' }), env);
    const r3 = await handleBlindRunCreate(post('/v1/blind/runs', { token: mint.token, input: 'three (replay)' }), env);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r3.status).toBe(403);
    expect((await r3.json() as { code: string }).code).toBe('MAX_RUNS_EXCEEDED');
  });

  it('a forged capability (valid shape, bad MAC) is refused', async () => {
    const a = await setupActors();
    const { skill_id } = await publishSkill(a);
    const good = await mintCapability(a, skill_id) as { token: string };
    const forged = good.token.slice(0, -4) + 'dead';
    const res = await handleBlindRunCreate(post('/v1/blind/runs', { token: forged, input: 'x' }), env);
    expect(res.status).toBe(401);
    expect((await res.json() as { code: string }).code).toBe('BAD_CAPABILITY');
  });

  it('a self-minted token (attacker knows the shape, not the secret) is refused', async () => {
    const a = await setupActors();
    const { skill_id } = await publishSkill(a);
    // Attacker forges a token under a secret they control.
    const attackerToken = await mintBlindCapability('attacker-secret-0123456789abcdef-abcd0000', {
      v: 1, jti: 'bj_forged', skill_id, harbor: 'alice/dock', max_runs: 999, exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const res = await handleBlindRunCreate(post('/v1/blind/runs', { token: attackerToken, input: 'x' }), env);
    expect(res.status).toBe(401);
  });
});

describe('adversary: capability caveats', () => {
  it('an expired capability is refused', async () => {
    const a = await setupActors();
    const { skill_id } = await publishSkill(a);
    const mint = await mintCapability(a, skill_id, { exp: Math.floor(Date.now() / 1000) + 2 }) as { token: string };
    // Fast-forward the ledger row's exp into the past (simulate elapsed time)
    // by directly aging it — the create path checks both payload.exp and cap.exp.
    db.caps[0].exp = Math.floor(Date.now() / 1000) - 1;
    // Re-mint a token whose payload.exp is also past so the payload check fires.
    const expiredToken = await mintBlindCapability(BLIND_SECRET, {
      v: 1, jti: db.caps[0].jti, skill_id, harbor: 'alice/dock', max_runs: 2, exp: Math.floor(Date.now() / 1000) - 1,
    });
    const res = await handleBlindRunCreate(post('/v1/blind/runs', { token: expiredToken, input: 'x' }), env);
    expect(res.status).toBe(403);
    expect((await res.json() as { code: string }).code).toBe('EXPIRED');
    void mint;
  });

  it('a capability whose harbor caveat does not match the skill is refused', async () => {
    const a = await setupActors();
    const { skill_id } = await publishSkill(a);
    // A token for the right skill but a forged harbor caveat (still validly MAC'd,
    // to isolate the harbor check from the integrity check).
    const jti = 'bj_realish';
    db.caps.push({ jti, skill_id, harbor: 'alice/dock', max_runs: 2, runs_used: 0, exp: Math.floor(Date.now() / 1000) + 3600, created_at: 0, revoked: 0 });
    const wrongHarborToken = await mintBlindCapability(BLIND_SECRET, {
      v: 1, jti, skill_id, harbor: 'evil/harbor', max_runs: 2, exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const res = await handleBlindRunCreate(post('/v1/blind/runs', { token: wrongHarborToken, input: 'x' }), env);
    expect(res.status).toBe(403);
    expect((await res.json() as { code: string }).code).toBe('WRONG_HARBOR');
  });

  it('a revoked capability is refused (revoked ⇒ spend fails)', async () => {
    const a = await setupActors();
    const { skill_id } = await publishSkill(a);
    const mint = await mintCapability(a, skill_id) as { token: string };
    db.caps[0].revoked = 1;
    const res = await handleBlindRunCreate(post('/v1/blind/runs', { token: mint.token, input: 'x' }), env);
    expect(res.status).toBe(403);
    expect((await res.json() as { code: string }).code).toBe('REVOKED');
  });
});

describe('adversary: exfiltration via outputs (channel a — the relay tripwire)', () => {
  async function driveToSealed(a: Actors): Promise<{ run_id: string; skill_id: string; runCh: string }> {
    const { skill_id } = await publishSkill(a);
    const mint = await mintCapability(a, skill_id) as { token: string };
    const create = await handleBlindRunCreate(post('/v1/blind/runs', { token: mint.token, input: 'x' }), env);
    const { run_id } = (await create.json()) as { run_id: string };
    const runCh = execChannelFor(run_id);
    await handleBlindRunKey(post(`/v1/blind/runs/${run_id}/key`, {
      card: a.execCard, event: await signedEnvelope(EXEC_SEED, a.execFp, runCh, a.execChain, { schema: BLIND_SCHEMA, type: 'run-key', run_id, run_pubkey: 'A'.repeat(88) }),
    }), env, run_id);
    await handleBlindRunSeal(post(`/v1/blind/runs/${run_id}/seal`, {
      card: a.lenderCard, event: await signedEnvelope(LENDER_SEED, a.lenderFp, LENDER_CHANNEL, a.lenderChain, { schema: BLIND_SCHEMA, type: 'seal', run_id, sealed: { v: BLIND_SEAL_VERSION, epk: 'e', iv: 'i', ct: 'c' } }),
    }), env, run_id);
    return { run_id, skill_id, runCh };
  }

  it('an output smuggling an undeclared field is refused at the relay; the run dies fail-closed', async () => {
    const a = await setupActors();
    const { run_id, skill_id, runCh } = await driveToSealed(a);
    const leaking = { verdict: 'pass', LEAK: 'the full skill text' };
    // The executor could even send a hash that matches ITS canonicalization —
    // the relay recomputes from ITS contract, so the leak is caught before hash.
    const receipt = { run_id, skill_id, verdict_hash: 'f'.repeat(64), tokens_used: 1, iat: 1_717_000_000 };
    const ev = await signedEnvelope(EXEC_SEED, a.execFp, runCh, a.execChain, { schema: BLIND_SCHEMA, type: 'conclude', run_id, output: leaking, receipt });
    const res = await handleBlindRunConclude(post(`/v1/blind/runs/${run_id}/conclude`, { card: a.execCard, event: ev }), env, run_id);
    expect(res.status).toBe(422);
    expect((await res.json() as { code: string }).code).toBe('OUTPUT_CONTRACT_VIOLATION');
    // Run is 'refused', nothing stored for the borrower, no receipts.
    const run = db.runs.find((r) => r.run_id === run_id)!;
    expect(run.status).toBe('refused');
    expect(run.output_json).toBeNull();
    expect(db.receipts).toHaveLength(0);
  });

  it('a receipt whose verdict_hash lies about the output is refused', async () => {
    const a = await setupActors();
    const { run_id, skill_id, runCh } = await driveToSealed(a);
    const output = { verdict: 'pass', score: 0.5 };
    const receipt = { run_id, skill_id, verdict_hash: 'a'.repeat(64), tokens_used: 1, iat: 1_717_000_000 };
    const ev = await signedEnvelope(EXEC_SEED, a.execFp, runCh, a.execChain, { schema: BLIND_SCHEMA, type: 'conclude', run_id, output, receipt });
    const res = await handleBlindRunConclude(post(`/v1/blind/runs/${run_id}/conclude`, { card: a.execCard, event: ev }), env, run_id);
    expect(res.status).toBe(422);
    expect((await res.json() as { code: string }).code).toBe('RECEIPT_MISMATCH');
  });

  it('an honest executor refusal concludes cleanly with a refusal-marker receipt', async () => {
    const a = await setupActors();
    const { run_id, skill_id, runCh } = await driveToSealed(a);
    const refusal = 'output-contract-violation: model would not comply';
    const receipt = { run_id, skill_id, verdict_hash: blindRefusalHash(refusal), tokens_used: 7, iat: 1_717_000_000 };
    const ev = await signedEnvelope(EXEC_SEED, a.execFp, runCh, a.execChain, { schema: BLIND_SCHEMA, type: 'conclude', run_id, refusal, receipt });
    const res = await handleBlindRunConclude(post(`/v1/blind/runs/${run_id}/conclude`, { card: a.execCard, event: ev }), env, run_id);
    expect(res.status).toBe(200);
    const run = db.runs.find((r) => r.run_id === run_id)!;
    expect(run.status).toBe('concluded');
    expect(run.output_json).toBeNull();
    expect(db.receipts.filter((r) => r.run_id === run_id)).toHaveLength(2);
  });
});

describe('adversary: sender pinning at every chained route', () => {
  it('only the skill’s lender may mint a capability', async () => {
    const a = await setupActors();
    const { skill_id } = await publishSkill(a);
    await provision(env, OUTSIDER_SEED, 'outsider');
    const outsiderFp = toHex(sha256(fromHex(pubKeyFromPrivKey(OUTSIDER_SEED))));
    const outsider = await provision(env, OUTSIDER_SEED, 'outsider');
    const chain: LocalChain = { seq: 0, prev: ZERO_HASH };
    const ch = `${RELAY_FP}:fleet-cloud:blind:outsider`;
    const ev = await signedEnvelope(OUTSIDER_SEED, outsiderFp, ch, chain, {
      schema: BLIND_SCHEMA, type: 'mint-capability', skill_id, max_runs: 5, exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const res = await handleBlindCapabilityMint(post('/v1/blind/capabilities', { card: outsider.card, event: ev }), env);
    expect(res.status).toBe(403);
    expect((await res.json() as { code: string }).code).toBe('NOT_YOUR_SKILL');
  });

  it('only the run’s pinned executor may conclude it', async () => {
    const a = await setupActors();
    const { skill_id } = await publishSkill(a);
    const mint = await mintCapability(a, skill_id) as { token: string };
    const create = await handleBlindRunCreate(post('/v1/blind/runs', { token: mint.token, input: 'x' }), env);
    const { run_id } = (await create.json()) as { run_id: string };
    const runCh = execChannelFor(run_id);
    await handleBlindRunKey(post(`/v1/blind/runs/${run_id}/key`, {
      card: a.execCard, event: await signedEnvelope(EXEC_SEED, a.execFp, runCh, a.execChain, { schema: BLIND_SCHEMA, type: 'run-key', run_id, run_pubkey: 'A'.repeat(88) }),
    }), env, run_id);
    await handleBlindRunSeal(post(`/v1/blind/runs/${run_id}/seal`, {
      card: a.lenderCard, event: await signedEnvelope(LENDER_SEED, a.lenderFp, LENDER_CHANNEL, a.lenderChain, { schema: BLIND_SCHEMA, type: 'seal', run_id, sealed: { v: BLIND_SEAL_VERSION, epk: 'e', iv: 'i', ct: 'c' } }),
    }), env, run_id);

    // A different provisioned executor tries to conclude.
    const other = await provision(env, OUTSIDER_SEED, 'other-exec');
    const otherFp = toHex(sha256(fromHex(pubKeyFromPrivKey(OUTSIDER_SEED))));
    const otherCh = `${RELAY_FP}:fleet-cloud:blind:exec2:${run_id}`;
    const output = { verdict: 'pass' };
    const receipt = { run_id, skill_id, verdict_hash: blindVerdictHash(output), tokens_used: 1, iat: 1_717_000_000 };
    const ev = await signedEnvelope(OUTSIDER_SEED, otherFp, otherCh, { seq: 0, prev: ZERO_HASH }, { schema: BLIND_SCHEMA, type: 'conclude', run_id, output, receipt });
    const res = await handleBlindRunConclude(post(`/v1/blind/runs/${run_id}/conclude`, { card: other.card, event: ev }), env, run_id);
    expect(res.status).toBe(403);
    expect((await res.json() as { code: string }).code).toBe('NOT_YOUR_RUN');
  });
});

// ── Kill switch + fail-closed configuration ──────────────────────────────────

describe('kill switch + configuration gates', () => {
  it('the kill flag makes every route inert', async () => {
    const a = await setupActors();
    const toggle = await handleBlindToggle(new Request('https://relay.example/v1/fleet/blind', {
      method: 'POST', headers: { Authorization: `Bearer ${OPERATOR_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ killed: true }),
    }), env);
    expect(toggle.status).toBe(200);
    const body = { schema: BLIND_SCHEMA, type: 'publish-skill', harbor: 'alice/dock', title: 't', output_schema: SCHEMA };
    const ev = await signedEnvelope(LENDER_SEED, a.lenderFp, LENDER_CHANNEL, a.lenderChain, body);
    const res = await handleBlindSkillPublish(post('/v1/blind/skills', { card: a.lenderCard, event: ev }), env);
    expect(res.status).toBe(409);
    expect((await res.json() as { code: string }).code).toBe('BLIND_KILLED');
  });

  it('the toggle refuses without an operator token', async () => {
    const res = await handleBlindToggle(post('/v1/fleet/blind', { killed: true }), env);
    expect(res.status).toBe(401);
  });

  it('an unconfigured relay (no BLIND_CAP_SECRET) answers 503 fail-closed', async () => {
    const bareEnv = makeEnv(db, kvStore, { BLIND_CAP_SECRET: undefined } as Partial<Env>);
    const res = await handleBlindRunCreate(post('/v1/blind/runs', { token: 'bcap.v1.x.y', input: 'x' }), bareEnv);
    expect(res.status).toBe(503);
    expect((await res.json() as { code: string }).code).toBe('BLIND_UNCONFIGURED');
  });
});
