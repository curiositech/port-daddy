/**
 * Tests for the fleet-executor identity (grand-plan DAG node
 * n2-executor-identity; src/fleet-executor-identity.ts + the handlePublish
 * path it feeds).
 *
 * THE GATE, verbatim from docs/proposals/grand-plan-dag.md:
 *   - unit tests signing/verifying a squid/1 envelope end-to-end against the
 *     relay's chain verification;
 *   - a test proving a second writer on a concluded run's channel is detected
 *     (chain-head anomaly);
 *   - a revoke-by-issuer rotation test;
 *   - unattested_publish_attempts == 0 by construction — assert the bearer
 *     route's ABSENCE (an opaque bearer token is never a credential here and
 *     no token-ingest path exists in the router).
 *
 * The "executor" in these tests signs envelopes with the relay's own crypto
 * helpers — that is the point: the executor dialect IS the relay's canonical
 * formula, pinned against drift by a known-answer vector shared with
 * apps/fleet-executor/tests/squid-events.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import { handlePublish, handleRevokeByIssuer } from '../src/handlers.js';
import {
  handleProvisionFleetExecutor,
  detectChainHeadAnomalies,
  EXECUTOR_RATE_PER_MIN,
} from '../src/fleet-executor-identity.js';
import { listChainHeadsForChannel } from '../src/db.js';
import {
  computeEventHash,
  signEd25519,
  pubKeyFromPrivKey,
  toHex,
  fromHex,
  ZERO_HASH,
} from '../src/crypto.js';
import worker from '../src/index.js';
import type { Env, RelayEvent } from '../src/types.js';

// ── Stateful in-memory D1 mock ───────────────────────────────────────────────
// Implements exactly the tables/queries the provisioning + publish + revoke
// paths touch, with the real UNIQUE(sender,channel,seq) semantics so the
// relay's chain verification runs for real.

interface IdentityRec {
  daemon_fingerprint: string;
  pub_key: string;
  proof_method: string;
  proof_metadata: string;
  expires_at: number | null;
  revoked: number;
  revoked_reason: string | null;
}

interface EventRec {
  sender: string; channel: string; seq: number; prev_hash: string;
  this_hash: string; iat: number; ciphertext: string; sig: string;
}

interface HeadRec {
  sender: string; channel: string; tip_seq: number; tip_hash: string;
  issued_at: number; signed_head: string; anchors_json: string | null;
}

class MockD1 {
  identities = new Map<string, IdentityRec>();
  revocations = new Map<string, { jti: string; revoking_daemon: string; reason: string | null }>();
  events: EventRec[] = [];
  heads = new Map<string, HeadRec>(); // key: sender|channel
  auditRows = 0;
  eventInserts = 0;

  prepare(query: string) {
    const self = this;
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { args = a; return stmt; },
      async first<T>(): Promise<T | null> { return self.route(query, args, 'first') as T | null; },
      async all<T>(): Promise<{ results: T[] }> { return { results: self.route(query, args, 'all') as T[] }; },
      async run() { self.route(query, args, 'run'); return { success: true }; },
    };
    return stmt;
  }

  private route(q: string, args: unknown[], mode: 'first' | 'all' | 'run'): unknown {
    if (q.includes('FROM identities') && q.includes('WHERE daemon_fingerprint')) {
      return this.identities.get(args[0] as string) ?? null;
    }
    if (q.includes('INSERT INTO identities')) {
      const [fp, pub, method, meta, exp] = args as [string, string, string, string, number | null];
      const prev = this.identities.get(fp);
      this.identities.set(fp, {
        daemon_fingerprint: fp, pub_key: pub, proof_method: method,
        proof_metadata: meta, expires_at: exp,
        revoked: prev?.revoked ?? 0, revoked_reason: prev?.revoked_reason ?? null,
      });
      return undefined;
    }
    if (q.includes('FROM identities') && q.includes("proof_method IN")) {
      const rows = [...this.identities.values()]
        .filter((r) => r.proof_method === 'oidc' || r.proof_method === 'operator-provisioned')
        .sort((a, b) => a.daemon_fingerprint.localeCompare(b.daemon_fingerprint))
        .map((r) => ({ daemon_fingerprint: r.daemon_fingerprint, proof_metadata: r.proof_metadata }));
      const [limit, offset] = args as [number, number];
      return rows.slice(offset, offset + limit);
    }

    if (q.includes('INSERT OR IGNORE INTO revocations')) {
      const [jti, daemon, reason] = args as [string, string, string | null];
      if (!this.revocations.has(jti)) this.revocations.set(jti, { jti, revoking_daemon: daemon, reason });
      return undefined;
    }
    if (q.includes('FROM revocations')) {
      const rec = this.revocations.get(args[0] as string);
      return rec ? { jti: rec.jti } : null;
    }
    if (q.includes('FROM events') && q.includes('ORDER BY seq DESC')) {
      const [sender, channel] = args as [string, string];
      const match = this.events
        .filter((e) => e.sender === sender && e.channel === channel)
        .sort((a, b) => b.seq - a.seq)[0];
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
      this.eventInserts += 1;
      return undefined;
    }

    if (q.includes('INSERT INTO chain_heads')) {
      const [sender, channel, tip_seq, tip_hash, issued_at, signed_head, anchors_json] =
        args as [string, string, number, string, number, string, string | null];
      this.heads.set(`${sender}|${channel}`, { sender, channel, tip_seq, tip_hash, issued_at, signed_head, anchors_json });
      return undefined;
    }
    if (q.includes('FROM chain_heads') && q.includes('WHERE sender')) {
      const [sender, channel] = args as [string, string];
      return this.heads.get(`${sender}|${channel}`) ?? null;
    }
    if (q.includes('FROM chain_heads') && q.includes('WHERE channel')) {
      const channel = args[0] as string;
      return [...this.heads.values()]
        .filter((h) => h.channel === channel)
        .sort((a, b) => a.sender.localeCompare(b.sender));
    }
    if (q.includes('INSERT INTO audit_log')) {
      this.auditRows += 1;
      return undefined;
    }
    if (q.includes('FROM harbor_members')) {
      return mode === 'all' ? [] : null;
    }
    if (mode === 'all') return [];
    return null;
  }
}

// ── Test env ────────────────────────────────────────────────────────────────

const OPERATOR_TOKEN = 'operator-token-0123456789abcdef-0123456789abcdef';
const RELAY_PRIV = '42'.repeat(32);
const RELAY_FP = toHex(sha256(fromHex(pubKeyFromPrivKey(RELAY_PRIV))));

function makeEnv(db: MockD1): Env {
  return {
    DB: db as unknown as D1Database,
    HARBOR_CHANNEL: {
      idFromName: () => ({}),
      get: () => ({
        fetch: async (url: string) =>
          String(url).includes('rate-check')
            ? Response.json({ allowed: true })
            : new Response('{}', { status: 200 }),
      }),
    } as unknown as DurableObjectNamespace,
    KV: {} as KVNamespace,
    RELAY_OPERATOR_TOKEN: OPERATOR_TOKEN,
    RELAY_ED25519_PRIVATE_KEY_HEX: RELAY_PRIV,
    RELAY_VERSION: '0.0.0-test',
    EVENT_RETENTION_DAYS: '7',
    SESSION_TTL_SECONDS: '3600',
    JWKS_CACHE_TTL_SECONDS: '300',
    JWKS_FAIL_SOFT_SECONDS: '600',
    REVOCATION_BROADCAST_TIMEOUT_MS: '5000',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as unknown as Env;
}

// ── The executor dialect, exercised with the relay's own crypto ──────────────

interface ProvisionResult {
  fingerprint: string;
  relay_fingerprint: string;
  card: string;
  jti: string;
  exp: number;
  issuer: string;
  cap: { op: string; channel: string; rate_per_min: number }[];
}

async function provision(env: Env, seedHex: string, deployment: string): Promise<ProvisionResult> {
  const pubKey = pubKeyFromPrivKey(seedHex);
  const res = await handleProvisionFleetExecutor(
    new Request('https://relay.example/v1/fleet/executor-identity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPERATOR_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pub_key: pubKey, deployment }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  return await res.json() as ProvisionResult;
}

interface LocalChain { seq: number; prev: string; }

/** Build + sign one squid/1 envelope exactly the way the executor does. */
async function signedEnvelope(
  seedHex: string,
  fingerprint: string,
  channel: string,
  chain: LocalChain,
  squidBody: Record<string, unknown>,
): Promise<RelayEvent> {
  const seq = chain.seq + 1;
  const prev_hash = chain.prev;
  const iat = 1_717_000_000 + seq;
  const ciphertext = Buffer.from(JSON.stringify({ schema: 'squid/1', ...squidBody })).toString('base64url');
  const this_hash = computeEventHash({ prev_hash, sender: fingerprint, channel, seq, iat, ciphertext });
  const sig = await signEd25519(seedHex, this_hash);
  chain.seq = seq;
  chain.prev = this_hash;
  return { v: 1, sender: fingerprint, channel, seq, prev_hash, this_hash, iat, ciphertext, sig };
}

async function publish(env: Env, card: string, event: RelayEvent): Promise<Response> {
  return handlePublish(
    new Request('https://relay.example/v1/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ card, event }),
    }),
    env,
  );
}

const SEED_A = '11'.repeat(32);
const SEED_B = '22'.repeat(32);
const RUN_CHANNEL = () => `${RELAY_FP}:fleet-cloud:run:d-1`;

describe('provisioning — POST /v1/fleet/executor-identity', () => {
  it('requires the operator token', async () => {
    const env = makeEnv(new MockD1());
    const res = await handleProvisionFleetExecutor(
      new Request('https://relay.example/v1/fleet/executor-identity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pub_key: pubKeyFromPrivKey(SEED_A), deployment: 'staging' }),
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('registers an operator-provisioned identity row and mints the N2 capability card', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const out = await provision(env, SEED_A, 'staging');

    const row = db.identities.get(out.fingerprint);
    expect(row).toBeDefined();
    expect(row!.proof_method).toBe('operator-provisioned');
    const meta = JSON.parse(row!.proof_metadata) as { issuer: string; jti: string; iat: number };
    expect(meta.issuer).toBe('operator:fleet-executor@staging');
    expect(meta.jti).toBe(out.jti);

    expect(out.relay_fingerprint).toBe(RELAY_FP);
    expect(out.cap).toEqual([
      {
        op: 'pub',
        channel: `${RELAY_FP}:fleet-cloud:*`,
        rate_per_min: EXECUTOR_RATE_PER_MIN,
        max_payload_bytes: 65536,
      },
    ]);

    // The card decodes: kid = relay fp (relay-issued), hv:2, sub = executor fp.
    const [h, p] = out.card.split('.');
    const header = JSON.parse(Buffer.from(h!, 'base64url').toString()) as { alg: string; kid: string };
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString()) as { hv: number; sub: string; iss: string };
    expect(header.alg).toBe('EdDSA');
    expect(header.kid).toBe(RELAY_FP);
    expect(payload.hv).toBe(2);
    expect(payload.sub).toBe(out.fingerprint);
    expect(payload.iss).toBe(RELAY_FP);
  });

  it('rejects malformed pub_key and deployment', async () => {
    const env = makeEnv(new MockD1());
    const mk = (body: unknown) =>
      new Request('https://relay.example/v1/fleet/executor-identity', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPERATOR_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await handleProvisionFleetExecutor(mk({ pub_key: 'nope', deployment: 'staging' }), env)).status).toBe(400);
    expect((await handleProvisionFleetExecutor(mk({ pub_key: pubKeyFromPrivKey(SEED_A), deployment: 'Bad Deployment!' }), env)).status).toBe(400);
  });
});

describe('GATE 1 — squid/1 envelope end-to-end against the relay chain verification', () => {
  it('accepts a correctly chained, correctly signed run lifecycle and advances the chain head', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { card, fingerprint } = await provision(env, SEED_A, 'staging');
    const channel = RUN_CHANNEL();
    const chain: LocalChain = { seq: 0, prev: ZERO_HASH };

    for (const type of ['run-started', 'ship-verdict', 'run-concluded']) {
      const ev = await signedEnvelope(SEED_A, fingerprint, channel, chain, {
        sender: 'fleet-executor@staging',
        type,
        payload: { repo: 'o/r', pr: 7, runId: 'run:d-1' },
      });
      const res = await publish(env, card, ev);
      const body = await res.json() as { ok?: boolean; seq?: number; code?: string };
      expect(body.ok, `publish ${type} failed: ${JSON.stringify(body)}`).toBe(true);
      expect(body.seq).toBe(ev.seq);
    }

    expect(chain.seq).toBe(3);
    const heads = await listChainHeadsForChannel(env.DB, channel);
    expect(heads).toHaveLength(1);
    expect(heads[0]!.sender).toBe(fingerprint);
    expect(heads[0]!.tip_seq).toBe(3);
    expect(heads[0]!.tip_hash).toBe(chain.prev);
  });

  it('rejects altered ciphertext, wrong-key signatures, and mismatched senders', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { card, fingerprint } = await provision(env, SEED_A, 'staging');
    const channel = RUN_CHANNEL();
    const chain: LocalChain = { seq: 0, prev: ZERO_HASH };
    const ev = await signedEnvelope(SEED_A, fingerprint, channel, chain, { type: 'run-started' });

    // Altered ciphertext: the canonical hash no longer matches.
    const altered = { ...ev, ciphertext: Buffer.from(JSON.stringify({ other: true })).toString('base64url') };
    const alteredRes = await publish(env, card, altered);
    expect(await alteredRes.text()).toContain('HASH_MISMATCH');

    // A different key signs the (correct) hash: BAD_SIG.
    const badSig = { ...ev, sig: await signEd25519(SEED_B, ev.this_hash) };
    const badSigRes = await publish(env, card, badSig);
    expect(await badSigRes.text()).toContain('BAD_SIG');

    // sender field not matching the card sub: SENDER_MISMATCH.
    const wrongSender = { ...ev, sender: 'ff'.repeat(32) };
    const wrongSenderRes = await publish(env, card, wrongSender);
    expect(await wrongSenderRes.text()).toContain('SENDER_MISMATCH');

    // Nothing landed.
    expect(db.eventInserts).toBe(0);
  });

  it('KNOWN-ANSWER VECTOR — shared with the executor suite so the two formulas cannot drift', () => {
    expect(
      computeEventHash({
        prev_hash: '0'.repeat(64),
        sender: 'aa',
        channel: 'h:ch',
        seq: 1,
        iat: 1717000000,
        ciphertext: 'aabbcc',
      }),
    ).toBe('276464292b650ab5985097ccdbef76bb4e3eb8842500dd5a05027890b5efa957');
  });
});

describe('GATE 2 — a second writer on a concluded run channel is detected', () => {
  it('flags the foreign chain head and the post-conclusion advance', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const channel = RUN_CHANNEL();

    // Writer A runs the run to conclusion (tip_seq = 2).
    const a = await provision(env, SEED_A, 'staging');
    const chainA: LocalChain = { seq: 0, prev: ZERO_HASH };
    await publish(env, a.card, await signedEnvelope(SEED_A, a.fingerprint, channel, chainA, { type: 'run-started' }));
    await publish(env, a.card, await signedEnvelope(SEED_A, a.fingerprint, channel, chainA, { type: 'run-concluded' }));
    const concludedTip = chainA.seq;

    // Live-and-honest baseline: one head, the expected writer, no anomaly.
    let heads = await listChainHeadsForChannel(env.DB, channel);
    expect(detectChainHeadAnomalies(heads, a.fingerprint, concludedTip).anomalous).toBe(false);

    // A second provisioned key writes to the SAME run channel. The relay
    // accepts it (chains are per-sender: no chain rule is violated) — which
    // is exactly why detection is a chain-head anomaly, not a publish error.
    const b = await provision(env, SEED_B, 'staging');
    const chainB: LocalChain = { seq: 0, prev: ZERO_HASH };
    const resB = await publish(env, b.card, await signedEnvelope(SEED_B, b.fingerprint, channel, chainB, { type: 'run-started' }));
    expect(((await resB.json()) as { ok?: boolean }).ok).toBe(true);

    heads = await listChainHeadsForChannel(env.DB, channel);
    expect(heads).toHaveLength(2);
    const report = detectChainHeadAnomalies(heads, a.fingerprint, concludedTip);
    expect(report.anomalous).toBe(true);
    expect(report.foreignWriters.map((h) => h.sender)).toEqual([b.fingerprint]);
    expect(report.advancedPastConclusion).toBe(false);
  });

  it('flags the expected writer advancing past its own run-concluded tip', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const channel = RUN_CHANNEL();
    const a = await provision(env, SEED_A, 'staging');
    const chainA: LocalChain = { seq: 0, prev: ZERO_HASH };
    await publish(env, a.card, await signedEnvelope(SEED_A, a.fingerprint, channel, chainA, { type: 'run-started' }));
    const concludedTip = chainA.seq; // pretend the run concluded at seq 1

    await publish(env, a.card, await signedEnvelope(SEED_A, a.fingerprint, channel, chainA, { type: 'ship-verdict' }));
    const heads = await listChainHeadsForChannel(env.DB, channel);
    const report = detectChainHeadAnomalies(heads, a.fingerprint, concludedTip);
    expect(report.anomalous).toBe(true);
    expect(report.advancedPastConclusion).toBe(true);
    expect(report.foreignWriters).toHaveLength(0);
  });

  it('a stale prev_hash / reused seq from the SAME writer is refused with a 409 chain error', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const channel = RUN_CHANNEL();
    const a = await provision(env, SEED_A, 'staging');
    const chainA: LocalChain = { seq: 0, prev: ZERO_HASH };
    await publish(env, a.card, await signedEnvelope(SEED_A, a.fingerprint, channel, chainA, { type: 'run-started' }));

    // Correctly signed by A's key, but restarting the chain at seq 1 — the
    // relay's chain continuity check refuses it.
    const stale: LocalChain = { seq: 0, prev: ZERO_HASH };
    const restarted = await signedEnvelope(SEED_A, a.fingerprint, channel, stale, { type: 'run-started' });
    const res = await publish(env, a.card, restarted);
    expect(res.status).toBe(409);
  });
});

describe('GATE 3 — revoke-by-issuer rotation', () => {
  it('revoking the operator issuer kills the old card; a fresh provision restores publishing', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const channel = RUN_CHANNEL();

    // Key A publishes happily.
    const a = await provision(env, SEED_A, 'staging');
    const chainA: LocalChain = { seq: 0, prev: ZERO_HASH };
    const ok1 = await publish(env, a.card, await signedEnvelope(SEED_A, a.fingerprint, channel, chainA, { type: 'run-started' }));
    expect(((await ok1.json()) as { ok?: boolean }).ok).toBe(true);

    // Operator rotates: bulk-revoke everything the staging issuer granted.
    const now = Math.floor(Date.now() / 1000);
    const revokeRes = await handleRevokeByIssuer(
      new Request('https://relay.example/v1/revoke-by-issuer', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPERATOR_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ issuer: 'operator:fleet-executor@staging', iat_min: now - 3600, iat_max: now + 3600 }),
      }),
      env,
    );
    const revoked = await revokeRes.json() as { ok: boolean; revoked_count: number; revoked_jtis: string[] };
    expect(revoked.ok).toBe(true);
    expect(revoked.revoked_jtis).toContain(a.jti);

    // The old card no longer verifies: the jti check inside verifyCard fires.
    const afterRevoke = await publish(env, a.card, await signedEnvelope(SEED_A, a.fingerprint, channel, chainA, { type: 'ship-verdict' }));
    expect(afterRevoke.status).toBe(401);
    expect(await afterRevoke.text()).toContain('REVOKED');

    // A NEW keypair provisions cleanly and starts its own chain at seq 1.
    const b = await provision(env, SEED_B, 'staging');
    const chainB: LocalChain = { seq: 0, prev: ZERO_HASH };
    const ok2 = await publish(env, b.card, await signedEnvelope(SEED_B, b.fingerprint, channel, chainB, { type: 'run-started' }));
    const ok2Body = await ok2.json() as { ok?: boolean; seq?: number };
    expect(ok2Body.ok).toBe(true);
    expect(ok2Body.seq).toBe(1);
  });
});

describe('GATE 4 — unattested_publish_attempts == 0 by construction', () => {
  it('an opaque bearer credential on /v1/publish is only ever read as a (malformed) card', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const res = await worker.fetch(
      new Request('https://relay.example/v1/publish', {
        method: 'POST',
        headers: { Authorization: 'Bearer some-opaque-shared-token', 'content-type': 'application/json' },
        body: JSON.stringify({ event: { channel: `${RELAY_FP}:fleet-cloud:run:d-1` } }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('MALFORMED_CARD');
    expect(db.eventInserts).toBe(0);
  });

  it('a publish with no credential at all never touches the event store', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const res = await worker.fetch(
      new Request('https://relay.example/v1/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: { channel: `${RELAY_FP}:fleet-cloud:run:d-1` } }),
      }),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('MISSING_CARD');
    expect(db.eventInserts).toBe(0);
  });

  it('no token-ingest route exists anywhere near the fleet surface (404, untouched store)', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    for (const path of ['/v1/fleet/events', '/v1/fleet/publish', '/v1/events', '/v1/ingest']) {
      const res = await worker.fetch(
        new Request(`https://relay.example${path}`, {
          method: 'POST',
          headers: { Authorization: 'Bearer some-opaque-shared-token', 'content-type': 'application/json' },
          body: JSON.stringify({ event: { channel: 'x' } }),
        }),
        env,
        {} as ExecutionContext,
      );
      expect(res.status, `${path} must not exist`).toBe(404);
    }
    expect(db.eventInserts).toBe(0);
  });
});
