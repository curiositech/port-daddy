/**
 * Tests for run-concluded reconciliation — POST /v1/fleet/run-report
 * (src/run-report.ts; grand-plan DAG node x7-mercy-hooks, slice 2).
 *
 * THE GATE, verbatim from the node: "reconciliation test: a dropped event
 * produces a nonzero gap metric" — pinned here with the REAL pipeline: a real
 * provisioned N2 identity, real signed envelopes through handlePublish (the
 * relay's real chain verification), one event deliberately never delivered,
 * and a real signed report. The relay must record claimed=3 / received=2 /
 * gap=1 — and append the `squid_reconciliation_gap` hook-ledger row the MERCY
 * hook aggregates — WITHOUT any of it touching the publish path's behavior.
 *
 * Also pinned: report auth is the full N2 discipline (unknown identity 401,
 * tampered claim BAD_SIG, wrong channel family rejected, stale report
 * refused), idempotent re-report (INSERT OR REPLACE, not a second data
 * point), and the cross-package canonical-hash known-answer vector shared
 * with apps/fleet-executor/tests/squid-events.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import worker from '../src/index.js';
import { handlePublish } from '../src/handlers.js';
import { handleProvisionFleetExecutor } from '../src/fleet-executor-identity.js';
import { handleRunReport, runReportHash } from '../src/run-report.js';
import {
  computeEventHash,
  signEd25519,
  pubKeyFromPrivKey,
  toHex,
  fromHex,
  ZERO_HASH,
} from '../src/crypto.js';
import type { Env, RelayEvent } from '../src/types.js';

// ── Stateful in-memory D1 (the fleet-executor-identity.test.ts idiom, plus
//    the reconciliation tables this route writes) ─────────────────────────────

interface EventRec {
  sender: string; channel: string; seq: number; prev_hash: string;
  this_hash: string; iat: number; ciphertext: string; sig: string;
}

interface ReconRec {
  run_id: string; channel: string; sender: string;
  claimed: number; received: number; gap: number; reported_at: number;
}

class MockD1 {
  identities = new Map<string, { daemon_fingerprint: string; pub_key: string; proof_method: string; proof_metadata: string; expires_at: number | null; revoked: number }>();
  revocations = new Map<string, { jti: string }>();
  events: EventRec[] = [];
  heads = new Map<string, Record<string, unknown>>();
  reconciliation = new Map<string, ReconRec>();
  hookEvents: Array<{ at: number; hook: string; severity: string; detail: string }> = [];

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
      this.identities.set(fp, { daemon_fingerprint: fp, pub_key: pub, proof_method: method, proof_metadata: meta, expires_at: exp, revoked: 0 });
      return undefined;
    }
    if (q.includes('FROM revocations')) {
      return this.revocations.get(args[0] as string) ?? null;
    }
    if (q.includes('COUNT(*)') && q.includes('FROM events')) {
      const [channel, sender] = args as [string, string];
      return { n: this.events.filter((e) => e.channel === channel && e.sender === sender).length };
    }
    if (q.includes('FROM events') && q.includes('ORDER BY seq DESC')) {
      const [sender, channel] = args as [string, string];
      const match = this.events
        .filter((e) => e.sender === sender && e.channel === channel)
        .sort((a, b) => b.seq - a.seq)[0];
      return match ? { seq: match.seq, this_hash: match.this_hash } : null;
    }
    if (q.includes('INSERT INTO events')) {
      const [sender, channel, seq, prev_hash, this_hash, iat, ciphertext, sig] =
        args as [string, string, number, string, string, number, string, string];
      if (this.events.some((e) => e.sender === sender && e.channel === channel && e.seq === seq)) {
        throw new Error('UNIQUE constraint failed: events.sender, events.channel, events.seq');
      }
      this.events.push({ sender, channel, seq, prev_hash, this_hash, iat, ciphertext, sig });
      return undefined;
    }
    if (q.includes('INSERT OR REPLACE INTO squid_run_reconciliation')) {
      const [run_id, channel, sender, claimed, received, gap, reported_at] =
        args as [string, string, string, number, number, number, number];
      this.reconciliation.set(run_id, { run_id, channel, sender, claimed, received, gap, reported_at });
      return undefined;
    }
    if (q.includes('INSERT INTO mercy_hook_events')) {
      const [at, hook, severity, detail] = args as [number, string, string, string];
      this.hookEvents.push({ at, hook, severity, detail });
      return undefined;
    }
    if (q.includes('INSERT INTO chain_heads')) {
      const [sender, channel] = args as [string, string];
      this.heads.set(`${sender}|${channel}`, { sender, channel });
      return undefined;
    }
    if (q.includes('FROM chain_heads')) {
      return mode === 'all' ? [] : null;
    }
    if (q.includes('INSERT INTO audit_log')) return undefined;
    if (q.includes('FROM harbor_members')) return mode === 'all' ? [] : null;
    if (q.includes('INSERT INTO mercy_slo_windows')) return undefined;
    if (mode === 'all') return [];
    return null;
  }
}

// ── Env + N2 fixtures ─────────────────────────────────────────────────────────

const OPERATOR_TOKEN = 'operator-token-0123456789abcdef-0123456789abcdef';
const RELAY_PRIV = '42'.repeat(32);
const RELAY_FP = toHex(sha256(fromHex(pubKeyFromPrivKey(RELAY_PRIV))));
const SEED = '11'.repeat(32);

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

async function provision(env: Env): Promise<{ fingerprint: string; card: string }> {
  const res = await handleProvisionFleetExecutor(
    new Request('https://relay.example/v1/fleet/executor-identity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPERATOR_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pub_key: pubKeyFromPrivKey(SEED), deployment: 'staging' }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { fingerprint: string; card: string };
}

interface LocalChain { seq: number; prev: string }

async function signedEnvelope(fingerprint: string, channel: string, chain: LocalChain): Promise<RelayEvent> {
  const seq = chain.seq + 1;
  const prev_hash = chain.prev;
  const iat = 1_717_000_000 + seq;
  const ciphertext = Buffer.from(JSON.stringify({ schema: 'squid/1', type: 'ship-verdict', payload: { seq } })).toString('base64url');
  const this_hash = computeEventHash({ prev_hash, sender: fingerprint, channel, seq, iat, ciphertext });
  const sig = await signEd25519(SEED, this_hash);
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

async function signedReport(
  fingerprint: string,
  card: string,
  channel: string,
  runId: string,
  eventsSent: number,
  overrides: { iat?: number; sigOverEventsSent?: number } = {},
): Promise<{ card: string; report: { run_id: string; channel: string; events_sent: number; iat: number }; sig: string }> {
  const iat = overrides.iat ?? Math.floor(Date.now() / 1000);
  const hash = runReportHash({
    sender: fingerprint,
    channel,
    runId,
    eventsSent: overrides.sigOverEventsSent ?? eventsSent,
    iat,
  });
  const sig = await signEd25519(SEED, hash);
  return { card, report: { run_id: runId, channel, events_sent: eventsSent, iat }, sig };
}

/** A cryptographically valid card minted by the daemon itself, not the relay. */
async function selfIssuedCard(fingerprint: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: fingerprint })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    hv: 2,
    sub: fingerprint,
    iss: fingerprint,
    aud: fingerprint,
    exp: now + 3_600,
    iat: now,
    jti: 'daemon-self-card',
    cap: [{ op: 'pub', channel: `${RELAY_FP}:fleet-cloud:*` }],
  })).toString('base64url');
  const signingHash = toHex(sha256(new TextEncoder().encode(`${header}.${payload}`)));
  const signature = Buffer.from(await signEd25519(SEED, signingHash), 'hex').toString('base64url');
  return `${header}.${payload}.${signature}`;
}

function reportRequest(body: unknown): Request {
  return new Request('https://relay.example/v1/fleet/run-report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const RUN_ID = 'run:d-9';
const CHANNEL = `${RELAY_FP}:fleet-cloud:${RUN_ID}`;

// ── THE GATE: a dropped event produces a nonzero gap metric ───────────────────

describe('run-concluded reconciliation', () => {
  it('a dropped event produces a nonzero gap metric (claimed 3, received 2, gap 1)', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { fingerprint, card } = await provision(env);

    // The executor signs three events; the network eats the third — it is
    // never delivered (fire-and-forget: nothing notices, nothing retries).
    const chain: LocalChain = { seq: 0, prev: ZERO_HASH };
    expect((await publish(env, card, await signedEnvelope(fingerprint, CHANNEL, chain))).status).toBe(200);
    expect((await publish(env, card, await signedEnvelope(fingerprint, CHANNEL, chain))).status).toBe(200);
    await signedEnvelope(fingerprint, CHANNEL, chain); // signed, counted, DROPPED

    // The out-of-band report claims what the executor's chain actually sent.
    const res = await handleRunReport(reportRequest(await signedReport(fingerprint, card, CHANNEL, RUN_ID, 3)), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claimed: number; received: number; gap: number };
    expect(body).toMatchObject({ claimed: 3, received: 2, gap: 1 });

    // The gap is DURABLE: a reconciliation row + a hook-ledger row the MERCY
    // `squid_reconciliation` hook aggregates.
    const row = db.reconciliation.get(RUN_ID)!;
    expect(row).toMatchObject({ claimed: 3, received: 2, gap: 1, channel: CHANNEL, sender: fingerprint });
    expect(row.gap).not.toBe(0);
    expect(db.hookEvents).toHaveLength(1);
    expect(db.hookEvents[0]!.hook).toBe('squid_reconciliation_gap');
    expect(db.hookEvents[0]!.severity).toBe('warn');
    expect(db.hookEvents[0]!.detail).toContain('claimed 3');
    expect(db.hookEvents[0]!.detail).toContain('received 2');
  });

  it('a lossless run reconciles to gap 0 with NO hook-ledger noise', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { fingerprint, card } = await provision(env);
    const chain: LocalChain = { seq: 0, prev: ZERO_HASH };
    expect((await publish(env, card, await signedEnvelope(fingerprint, CHANNEL, chain))).status).toBe(200);
    expect((await publish(env, card, await signedEnvelope(fingerprint, CHANNEL, chain))).status).toBe(200);

    const res = await handleRunReport(reportRequest(await signedReport(fingerprint, card, CHANNEL, RUN_ID, 2)), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed: 2, received: 2, gap: 0 });
    expect(db.hookEvents).toHaveLength(0);
  });

  it('re-reporting a run REPLACES its row — idempotent, never a second data point', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { fingerprint, card } = await provision(env);
    const chain: LocalChain = { seq: 0, prev: ZERO_HASH };
    expect((await publish(env, card, await signedEnvelope(fingerprint, CHANNEL, chain))).status).toBe(200);

    expect((await handleRunReport(reportRequest(await signedReport(fingerprint, card, CHANNEL, RUN_ID, 1)), env)).status).toBe(200);
    expect((await handleRunReport(reportRequest(await signedReport(fingerprint, card, CHANNEL, RUN_ID, 1)), env)).status).toBe(200);
    expect(db.reconciliation.size).toBe(1);
    expect(db.reconciliation.get(RUN_ID)!.gap).toBe(0);
  });

  it('routes through the worker with an X-Request-Id header', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { fingerprint, card } = await provision(env);
    const chain: LocalChain = { seq: 0, prev: ZERO_HASH };
    expect((await publish(env, card, await signedEnvelope(fingerprint, CHANNEL, chain))).status).toBe(200);

    const res = await worker.fetch(
      reportRequest(await signedReport(fingerprint, card, CHANNEL, RUN_ID, 1)),
      env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-Id')).toMatch(/^req_[0-9a-f]{16}$/);
  });
});

// ── Auth discipline ───────────────────────────────────────────────────────────

describe('run-report auth (full N2 discipline)', () => {
  it('401 UNKNOWN_IDENTITY for a reporter that was never provisioned', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    // Card decodes but the identity registry has no row.
    const envProvisioned = makeEnv(new MockD1());
    const { fingerprint, card } = await provision(envProvisioned);
    const res = await handleRunReport(reportRequest(await signedReport(fingerprint, card, CHANNEL, RUN_ID, 1)), env);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('UNKNOWN_IDENTITY');
  });

  it('401 BAD_SIG when the claimed total is tampered after signing', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { fingerprint, card } = await provision(env);
    // Signature covers events_sent=1 but the report claims 5.
    const body = await signedReport(fingerprint, card, CHANNEL, RUN_ID, 5, { sigOverEventsSent: 1 });
    const res = await handleRunReport(reportRequest(body), env);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('BAD_SIG');
    expect(db.reconciliation.size).toBe(0);
  });

  it('401 EXECUTOR_CARD_REQUIRED for a daemon-self-issued card', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { fingerprint } = await provision(env);
    const card = await selfIssuedCard(fingerprint);
    const res = await handleRunReport(
      reportRequest(await signedReport(fingerprint, card, CHANNEL, RUN_ID, 1)),
      env,
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('EXECUTOR_CARD_REQUIRED');
    expect(db.reconciliation.size).toBe(0);
  });

  it('403 EXECUTOR_IDENTITY_REQUIRED when the registry row is not executor-provisioned', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { fingerprint, card } = await provision(env);
    db.identities.get(fingerprint)!.proof_method = 'oidc';
    const res = await handleRunReport(
      reportRequest(await signedReport(fingerprint, card, CHANNEL, RUN_ID, 1)),
      env,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('EXECUTOR_IDENTITY_REQUIRED');
    expect(db.reconciliation.size).toBe(0);
  });

  it('400 BAD_CHANNEL when the channel is not the reported run\'s fleet-cloud channel', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { fingerprint, card } = await provision(env);
    const wrongChannel = `${RELAY_FP}:fleet-cloud:run:other`;
    const res = await handleRunReport(reportRequest(await signedReport(fingerprint, card, wrongChannel, RUN_ID, 1)), env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('BAD_CHANNEL');
  });

  it('400 BAD_CHANNEL for another relay\'s otherwise well-formed fleet-cloud channel', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { fingerprint, card } = await provision(env);
    const foreign = `${'ef'.repeat(32)}:fleet-cloud:${RUN_ID}`;
    const res = await handleRunReport(
      reportRequest(await signedReport(fingerprint, card, foreign, RUN_ID, 1)),
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('BAD_CHANNEL');
  });

  it('400 BAD_RUN_ID for malformed or oversized run ids', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { fingerprint, card } = await provision(env);
    for (const runId of ['delivery-without-prefix', 'run:bad space', `run:${'a'.repeat(129)}`]) {
      const channel = `${RELAY_FP}:fleet-cloud:${runId}`;
      const res = await handleRunReport(
        reportRequest(await signedReport(fingerprint, card, channel, runId, 1)),
        env,
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('BAD_RUN_ID');
    }
  });

  it('400 REPORT_STALE outside the ±1h skew window', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    const { fingerprint, card } = await provision(env);
    const stale = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
    const res = await handleRunReport(reportRequest(await signedReport(fingerprint, card, CHANNEL, RUN_ID, 1, { iat: stale })), env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('REPORT_STALE');
  });

  it('400 MISSING_FIELDS on malformed shapes (negative / non-integer totals included)', async () => {
    const db = new MockD1();
    const env = makeEnv(db);
    for (const bad of [
      null,
      [],
      {},
      { card: 'x', sig: 'y' },
      { card: 'x', sig: 'y', report: { run_id: RUN_ID, channel: CHANNEL, events_sent: -1, iat: 1 } },
      { card: 'x', sig: 'y', report: { run_id: RUN_ID, channel: CHANNEL, events_sent: 1.5, iat: 1 } },
    ]) {
      const res = await handleRunReport(reportRequest(bad), env);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('MISSING_FIELDS');
    }
  });
});

// ── Cross-package canonical-hash parity ───────────────────────────────────────

describe('run-report hash known-answer vector', () => {
  it('pins the canonical hash shared with the executor suite', () => {
    // The SAME vector is asserted by apps/fleet-executor/tests/
    // squid-events.test.ts against computeRunReportHash — drift on either
    // side breaks one of the two suites.
    expect(
      runReportHash({
        sender: 'ab'.repeat(32),
        channel: `${'cd'.repeat(32)}:fleet-cloud:run:kat-1`,
        runId: 'run:kat-1',
        eventsSent: 7,
        iat: 1_755_000_000,
      }),
    ).toBe('311980675485f76132a2aa0cb01d9dbdc1af8956c9a6992699c46c06c9284de6');
  });
});
