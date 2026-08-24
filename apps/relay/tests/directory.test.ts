/**
 * X5 directory + whois (src/directory.ts) — the D3 "no shadow index" gates.
 *
 * WHY A STATEFUL FAKE (parley-fixture idiom, not the pattern-match mock): the
 * node's CI gates are properties of WHERE clauses and of which queries RUN at
 * all — "no consent ⇒ no derivation" means the derivation path never touches
 * an event source, and "delist ⇒ rows dropped" means rows actually disappear.
 * A mock that ignored WHERE clauses would pass while proving nothing. This
 * fake evaluates the guards AND records every SQL statement issued, so both
 * the state outcome and the query-set are assertable.
 *
 * Gates covered (grand-plan-dag.md node directory-whois):
 *  1. after delist, zero derived rows survive the sweep;
 *  2. no-consent ⇒ no derivation (the derivation path never runs — asserted
 *     as zero event-source reads, not merely empty read results);
 *  3. cold start returns {results: [], reason} — never 404;
 *  4. a ranking-weight change appears in the audit log.
 */

import { describe, it, expect } from 'vitest';
import {
  handlePutHarborCard,
  handleDirectory,
  handleWhois,
  handleSetDirectoryWeights,
  refreshCapabilityIndex,
  cardCanonicalHash,
  getRankingWeights,
  tokenize,
  scoreDeclared,
  demonstratedSaturation,
  DEFAULT_RANKING_WEIGHTS,
  DIRECTORY_SIGNAL_RETENTION_DAYS,
} from '../src/directory.js';
import { runRetentionSweep } from '../src/retention-sweep.js';
import { signEd25519, pubKeyFromPrivKey } from '../src/crypto.js';
import type { Env } from '../src/types.js';

const BASE = 'https://relay.example';
const DAY = 24 * 60 * 60;
const OPERATOR_TOKEN = 'o'.repeat(40);

const PRIV = '11'.repeat(32);
const PUB = pubKeyFromPrivKey(PRIV);
const FP = 'ab'.repeat(32);
const FP_B = 'cd'.repeat(32);
const PRIV_B = '22'.repeat(32);
const PUB_B = pubKeyFromPrivKey(PRIV_B);

// ── Stateful fake D1 ──────────────────────────────────────────────────────────

interface IdentityRow {
  daemon_fingerprint: string;
  pub_key: string;
  proof_method: string;
  proof_metadata: string;
  expires_at: number | null;
  revoked: number;
  revoked_reason: string | null;
}

interface CardRow {
  daemon_fingerprint: string;
  display_name: string | null;
  capabilities_json: string;
  card_iat: number;
  card_sig: string;
  listed: number;
  listed_at: number | null;
  updated_at: number;
}

interface CapRow {
  daemon_fingerprint: string;
  capability: string;
  signal_kind: string;
  source: string;
  observed_at: number;
  weight: number;
}

interface FakeState {
  identities: Map<string, IdentityRow>;
  cards: Map<string, CardRow>;
  capabilityIndex: CapRow[];
  chainHeads: Array<{ sender: string; channel: string; issued_at: number }>;
  events: Array<{ sender: string; channel: string; iat: number }>;
  fleetRuns: Array<{ id: string; conclusion: string; created_at: number }>;
  auditLog: Array<{ daemon_fingerprint: string | null; action: string; target: string | null; detail: string | null }>;
  weights: null | { declared_weight: number; demonstrated_weight: number; half_life_days: number; confidence_floor: number };
}

function emptyState(): FakeState {
  return {
    identities: new Map(),
    cards: new Map(),
    capabilityIndex: [],
    chainHeads: [],
    events: [],
    fleetRuns: [],
    auditLog: [],
    weights: null,
  };
}

function seedIdentity(state: FakeState, fp: string, pub: string): void {
  state.identities.set(fp, {
    daemon_fingerprint: fp,
    pub_key: pub,
    proof_method: 'oidc',
    proof_metadata: '{}',
    expires_at: null,
    revoked: 0,
    revoked_reason: null,
  });
}

/**
 * Interpret exactly the SQL src/directory.ts + src/retention-sweep.ts issue,
 * honouring WHERE clauses. Records every executed statement in `log`.
 */
function makeFakeDb(state: FakeState): { db: D1Database; log: string[] } {
  const log: string[] = [];

  const firstImpl = (sql: string, b: unknown[]): unknown => {
    if (sql.includes('FROM identities WHERE daemon_fingerprint')) {
      return state.identities.get(b[0] as string) ?? null;
    }
    if (sql.includes('FROM harbor_cards WHERE daemon_fingerprint')) {
      return state.cards.get(b[0] as string) ?? null;
    }
    if (sql.includes('FROM directory_ranking_weights')) {
      return state.weights;
    }
    throw new Error(`fake D1 first(): unhandled SQL: ${sql}`);
  };

  const allImpl = (sql: string, b: unknown[]): unknown[] => {
    if (sql.includes('FROM harbor_cards WHERE listed = 1')) {
      return [...state.cards.values()]
        .filter((c) => c.listed === 1)
        .sort((x, y) => (y.listed_at ?? 0) - (x.listed_at ?? 0));
    }
    if (sql.includes('FROM chain_heads WHERE sender')) {
      return state.chainHeads
        .filter((h) => h.sender === b[0] && h.issued_at >= (b[1] as number))
        .map((h) => ({ channel: h.channel, issued_at: h.issued_at }));
    }
    if (sql.includes('FROM events WHERE sender')) {
      const byChannel = new Map<string, number>();
      for (const e of state.events) {
        if (e.sender !== b[0] || e.iat < (b[1] as number)) continue;
        if (!e.channel.includes('fleet-cloud')) continue;
        byChannel.set(e.channel, Math.max(byChannel.get(e.channel) ?? 0, e.iat));
      }
      return [...byChannel.entries()].map(([channel, iat]) => ({ channel, iat }));
    }
    if (sql.includes('FROM fleet_runs WHERE id IN')) {
      // Last bind is the consent floor (`AND created_at >= ?`).
      const since = b[b.length - 1] as number;
      const ids = b.slice(0, -1) as string[];
      return state.fleetRuns.filter((r) => ids.includes(r.id) && r.created_at >= since);
    }
    if (sql.includes('SELECT daemon_fingerprint, observed_at, weight FROM capability_index')) {
      return state.capabilityIndex.map((r) => ({
        daemon_fingerprint: r.daemon_fingerprint,
        observed_at: r.observed_at,
        weight: r.weight,
      }));
    }
    throw new Error(`fake D1 all(): unhandled SQL: ${sql}`);
  };

  const runImpl = (sql: string, b: unknown[]): number => {
    if (sql.includes('INSERT INTO harbor_cards')) {
      const [fp, displayName, capsJson, iat, sig, listed, listedAt, updatedAt] = b as [
        string, string | null, string, number, string, number, number | null, number,
      ];
      state.cards.set(fp, {
        daemon_fingerprint: fp,
        display_name: displayName,
        capabilities_json: capsJson,
        card_iat: iat,
        card_sig: sig,
        listed,
        listed_at: listedAt,
        updated_at: updatedAt,
      });
      return 1;
    }
    if (sql.includes('INSERT OR REPLACE INTO capability_index')) {
      const [fp, capability, kind, source, observedAt, weight] = b as [string, string, string, string, number, number];
      state.capabilityIndex = state.capabilityIndex.filter(
        (r) => !(r.daemon_fingerprint === fp && r.capability === capability && r.signal_kind === kind && r.source === source),
      );
      state.capabilityIndex.push({ daemon_fingerprint: fp, capability, signal_kind: kind, source, observed_at: observedAt, weight });
      return 1;
    }
    if (sql.includes('DELETE FROM capability_index WHERE daemon_fingerprint NOT IN')) {
      const listed = new Set([...state.cards.values()].filter((c) => c.listed === 1).map((c) => c.daemon_fingerprint));
      const before = state.capabilityIndex.length;
      state.capabilityIndex = state.capabilityIndex.filter((r) => listed.has(r.daemon_fingerprint));
      return before - state.capabilityIndex.length;
    }
    if (sql.includes('DELETE FROM capability_index WHERE daemon_fingerprint')) {
      const before = state.capabilityIndex.length;
      state.capabilityIndex = state.capabilityIndex.filter((r) => r.daemon_fingerprint !== b[0]);
      return before - state.capabilityIndex.length;
    }
    if (sql.includes('DELETE FROM capability_index WHERE observed_at <')) {
      const before = state.capabilityIndex.length;
      state.capabilityIndex = state.capabilityIndex.filter((r) => r.observed_at >= (b[0] as number));
      return before - state.capabilityIndex.length;
    }
    if (sql.includes('INSERT INTO directory_ranking_weights')) {
      const [dw, mw, hl, cf] = b as [number, number, number, number];
      state.weights = { declared_weight: dw, demonstrated_weight: mw, half_life_days: hl, confidence_floor: cf };
      return 1;
    }
    if (sql.includes('INSERT INTO audit_log')) {
      const [fp, action, target, , detail] = b as [string | null, string, string | null, string | null, string | null];
      state.auditLog.push({ daemon_fingerprint: fp, action, target, detail });
      return 1;
    }
    if (sql.startsWith('DELETE FROM')) {
      return 0; // other sweep deletes (events, runs, sessions…) — no-op here
    }
    throw new Error(`fake D1 run(): unhandled SQL: ${sql}`);
  };

  const prepare = (sql: string) => {
    let binds: unknown[] = [];
    const s = {
      bind(...v: unknown[]) { binds = v; return s; },
      async first() { log.push(sql); return firstImpl(sql, binds); },
      async all() { log.push(sql); return { results: allImpl(sql, binds) }; },
      async run() { log.push(sql); return { success: true, meta: { changes: runImpl(sql, binds) } }; },
    };
    return s as unknown as D1PreparedStatement;
  };
  return { db: { prepare } as unknown as D1Database, log };
}

function makeEnv(db: D1Database): Env {
  return { DB: db, RELAY_OPERATOR_TOKEN: OPERATOR_TOKEN, EVENT_RETENTION_DAYS: '7' } as unknown as Env;
}

/** SQL statements that read an EVENT SOURCE (what D3 forbids pre-consent). */
const eventSourceReads = (log: string[]): string[] =>
  log.filter((sql) => sql.startsWith('SELECT') && /chain_heads|FROM events|fleet_runs/.test(sql));

// ── Card helpers ──────────────────────────────────────────────────────────────

interface CardInput {
  fingerprint: string;
  capabilities: string[];
  displayName: string | null;
  iat: number;
  listing: 'private' | 'public';
}

async function signedCard(priv: string, over: Partial<CardInput> = {}): Promise<Record<string, unknown>> {
  const card: CardInput = {
    fingerprint: FP,
    capabilities: ['rust refactoring', 'gpui shaders'],
    displayName: null,
    iat: Math.floor(Date.now() / 1000),
    listing: 'public',
    ...over,
  };
  const sig = await signEd25519(priv, cardCanonicalHash(card));
  return { ...card, sig };
}

function putCard(body: unknown): Request {
  return new Request(`${BASE}/v1/harbor/card`, { method: 'PUT', body: JSON.stringify(body) });
}

function whois(q: string | null): Request {
  const qs = q === null ? '' : `?q=${encodeURIComponent(q)}`;
  return new Request(`${BASE}/v1/harbor/whois${qs}`, { method: 'GET' });
}

// ── Gate 3: cold start returns {results: [], reason} — never 404 ─────────────

describe('whois cold start', () => {
  it('returns 200 {results: [], reason} when nobody has consented to listing', async () => {
    const { db } = makeFakeDb(emptyState());
    const res = await handleWhois(whois('rust refactoring'), makeEnv(db));
    expect(res.status).toBe(200); // NEVER 404
    const body = (await res.json()) as { results: unknown[]; reason?: string };
    expect(body.results).toEqual([]);
    expect(body.reason).toContain('cold-start');
  });

  it('rejects a missing/empty q with 400 (bad request, not empty results)', async () => {
    const { db } = makeFakeDb(emptyState());
    const res = await handleWhois(whois(null), makeEnv(db));
    expect(res.status).toBe(400);
  });

  it('directory listing is also a stated empty, never 404', async () => {
    const { db } = makeFakeDb(emptyState());
    const res = await handleDirectory(makeEnv(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { harbors: unknown[]; reason?: string };
    expect(body.harbors).toEqual([]);
    expect(body.reason).toContain('cold-start');
  });
});

// ── Card authentication (no bearer path; fail closed) ────────────────────────

describe('PUT /v1/harbor/card', () => {
  it('refuses an unknown identity (403), fail closed', async () => {
    const { db } = makeFakeDb(emptyState()); // no identities registered
    const res = await handlePutHarborCard(putCard(await signedCard(PRIV)), makeEnv(db));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('UNKNOWN_IDENTITY');
  });

  it('refuses a revoked identity (403)', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    state.identities.get(FP)!.revoked = 1;
    const { db } = makeFakeDb(state);
    const res = await handlePutHarborCard(putCard(await signedCard(PRIV)), makeEnv(db));
    expect(res.status).toBe(403);
  });

  it('refuses a signature that does not verify against the registered key (403)', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    const { db } = makeFakeDb(state);
    // Signed with the WRONG key for this fingerprint.
    const res = await handlePutHarborCard(putCard(await signedCard(PRIV_B)), makeEnv(db));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('BAD_SIGNATURE');
  });

  it('refuses a tampered listing tier — the consent crossing is inside the signature', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    const { db } = makeFakeDb(state);
    const body = await signedCard(PRIV, { listing: 'private' });
    body.listing = 'public'; // tamper the consent AFTER signing
    const res = await handlePutHarborCard(putCard(body), makeEnv(db));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('BAD_SIGNATURE');
  });

  it('refuses a stale iat (replay bound) with 400', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    const { db } = makeFakeDb(state);
    const res = await handlePutHarborCard(
      putCard(await signedCard(PRIV, { iat: Math.floor(Date.now() / 1000) - 3600 })),
      makeEnv(db),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('STALE_CARD');
  });
});

// ── Gate 2: no consent ⇒ NO DERIVATION (the path never runs) ─────────────────

describe('D3: consent gates derivation, not just the read', () => {
  it('a private card PUT issues ZERO event-source reads and derives ZERO rows', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    // Event sources are FULL of activity for this fingerprint…
    const now = Math.floor(Date.now() / 1000);
    state.chainHeads.push({ sender: FP, channel: 'ch-1', issued_at: now });
    state.events.push({ sender: FP, channel: 'relayfp:fleet-cloud:run:d1', iat: now });
    state.fleetRuns.push({ id: 'run:d1', conclusion: 'success', created_at: now });

    const { db, log } = makeFakeDb(state);
    const res = await handlePutHarborCard(putCard(await signedCard(PRIV, { listing: 'private' })), makeEnv(db));
    expect(res.status).toBe(200);

    // …and yet the derivation path never touched any of them.
    expect(eventSourceReads(log)).toEqual([]);
    expect(state.capabilityIndex).toEqual([]);
    expect(log.some((sql) => sql.includes('INSERT OR REPLACE INTO capability_index'))).toBe(false);
  });

  it('refreshCapabilityIndex REFUSES for an unlisted operator before any event-source query', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    state.cards.set(FP, {
      daemon_fingerprint: FP,
      display_name: null,
      capabilities_json: '["rust refactoring"]',
      card_iat: 0,
      card_sig: 'ff',
      listed: 0,
      listed_at: null,
      updated_at: 0,
    });
    state.chainHeads.push({ sender: FP, channel: 'ch-1', issued_at: Math.floor(Date.now() / 1000) });

    const { db, log } = makeFakeDb(state);
    const outcome = await refreshCapabilityIndex(makeEnv(db), FP, Math.floor(Date.now() / 1000));
    expect(outcome).toEqual({ ok: false, refused: 'not-listed' });
    expect(eventSourceReads(log)).toEqual([]);
    expect(state.capabilityIndex).toEqual([]);
  });

  it('treats listed_at === 0 as a VALID consent instant, not as unlisted', async () => {
    // listed_at is number | null; 0 is a real (epoch) timestamp. The guard must
    // refuse on `listed !== 1 || listed_at === null` — never on falsiness.
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    state.cards.set(FP, {
      daemon_fingerprint: FP,
      display_name: null,
      capabilities_json: '["rust refactoring"]',
      card_iat: 0,
      card_sig: 'ff',
      listed: 1,
      listed_at: 0,
      updated_at: 0,
    });
    const now = Math.floor(Date.now() / 1000);
    state.chainHeads.push({ sender: FP, channel: 'ch-epoch', issued_at: now });

    const { db, log } = makeFakeDb(state);
    const outcome = await refreshCapabilityIndex(makeEnv(db), FP, now);
    expect(outcome).toEqual({ ok: true, signals: 1 });
    expect(eventSourceReads(log).length).toBeGreaterThan(0);
    expect(state.capabilityIndex.map((r) => r.source)).toEqual(['ch-epoch']);
  });

  it('refuses a LISTED card whose listed_at is null (fail closed, no unfloored derivation)', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    state.cards.set(FP, {
      daemon_fingerprint: FP,
      display_name: null,
      capabilities_json: '["rust refactoring"]',
      card_iat: 0,
      card_sig: 'ff',
      listed: 1,
      listed_at: null, // anomalous row: listed without a consent instant
      updated_at: 0,
    });
    state.chainHeads.push({ sender: FP, channel: 'ch-1', issued_at: Math.floor(Date.now() / 1000) });

    const { db, log } = makeFakeDb(state);
    const outcome = await refreshCapabilityIndex(makeEnv(db), FP, Math.floor(Date.now() / 1000));
    expect(outcome).toEqual({ ok: false, refused: 'not-listed' });
    expect(eventSourceReads(log)).toEqual([]);
    expect(state.capabilityIndex).toEqual([]);
  });

  it('a run CREATED pre-consent yields NO verdict signal, even when its event is post-consent', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    const now = Math.floor(Date.now() / 1000);
    // The signed event lands AFTER consent, but the run it names predates it.
    state.events.push({ sender: FP, channel: 'relayfp:fleet-cloud:run:old', iat: now + 5 });
    state.fleetRuns.push({ id: 'run:old', conclusion: 'success', created_at: now - 10_000 });
    // Control: a genuinely post-consent run IS derived.
    state.events.push({ sender: FP, channel: 'relayfp:fleet-cloud:run:new', iat: now + 5 });
    state.fleetRuns.push({ id: 'run:new', conclusion: 'success', created_at: now + 5 });

    const { db } = makeFakeDb(state);
    const res = await handlePutHarborCard(putCard(await signedCard(PRIV, { listing: 'public' })), makeEnv(db));
    expect(res.status).toBe(200);

    const verdictSources = state.capabilityIndex
      .filter((r) => r.signal_kind === 'run-verdict')
      .map((r) => r.source);
    expect(verdictSources).toEqual(['run:new']);
  });

  it('derivation covers only POST-consent events (floored at listed_at)', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    const now = Math.floor(Date.now() / 1000);
    // One chain head from BEFORE the consent instant, one from after.
    state.chainHeads.push({ sender: FP, channel: 'pre-consent-channel', issued_at: now - 10_000 });
    state.chainHeads.push({ sender: FP, channel: 'post-consent-channel', issued_at: now + 5 });

    const { db } = makeFakeDb(state);
    const res = await handlePutHarborCard(putCard(await signedCard(PRIV, { listing: 'public' })), makeEnv(db));
    expect(res.status).toBe(200);

    const sources = state.capabilityIndex.map((r) => r.source);
    expect(sources).toContain('post-consent-channel');
    expect(sources).not.toContain('pre-consent-channel');
  });
});

// ── Gate 1: delist ⇒ zero derived rows (at the write AND after the sweep) ────

describe('D3: derived rows die with the consent', () => {
  async function listWithSignals(): Promise<{ state: FakeState; env: Env }> {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    const now = Math.floor(Date.now() / 1000);
    state.chainHeads.push({ sender: FP, channel: 'active-channel', issued_at: now + 1 });
    state.events.push({ sender: FP, channel: 'relayfp:fleet-cloud:run:d9', iat: now + 1 });
    state.fleetRuns.push({ id: 'run:d9', conclusion: 'success', created_at: now + 1 });
    const { db } = makeFakeDb(state);
    const env = makeEnv(db);
    const res = await handlePutHarborCard(putCard(await signedCard(PRIV, { listing: 'public' })), env);
    expect(res.status).toBe(200);
    expect(state.capabilityIndex.length).toBeGreaterThan(0);
    return { state, env };
  }

  it('derives chain-head AND run-verdict signals at listing consent', async () => {
    const { state } = await listWithSignals();
    const kinds = new Set(state.capabilityIndex.map((r) => r.signal_kind));
    expect(kinds).toEqual(new Set(['chain-head', 'run-verdict']));
    const verdict = state.capabilityIndex.find((r) => r.signal_kind === 'run-verdict')!;
    expect(verdict.source).toBe('run:d9'); // full run id, colons included
    expect(verdict.weight).toBe(1.0); // success
  });

  it('a delist PUT drops the derived rows at the write itself', async () => {
    const { state, env } = await listWithSignals();
    const res = await handlePutHarborCard(putCard(await signedCard(PRIV, { listing: 'private' })), env);
    expect(res.status).toBe(200);
    expect(state.capabilityIndex.filter((r) => r.daemon_fingerprint === FP)).toEqual([]);
    expect(state.auditLog.some((a) => a.action === 'directory.delisted')).toBe(true);
  });

  it('GATE: after delist, zero derived rows survive the sweep — even if the delist write missed them', async () => {
    const { state, env } = await listWithSignals();
    // Simulate the pathological path D3 guards against: the card is unlisted
    // but derived rows were left behind (crash between the two writes).
    state.cards.get(FP)!.listed = 0;
    state.cards.get(FP)!.listed_at = null;
    expect(state.capabilityIndex.length).toBeGreaterThan(0);

    const result = await runRetentionSweep(env, Math.floor(Date.now() / 1000));
    expect(result.directoryDelistDropped).toBeGreaterThan(0);
    expect(state.capabilityIndex.filter((r) => r.daemon_fingerprint === FP)).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('sweep retention-bounds derived signals for LISTED operators too', async () => {
    const { state, env } = await listWithSignals();
    const now = Math.floor(Date.now() / 1000);
    // Age one signal past the retention bound.
    state.capabilityIndex.push({
      daemon_fingerprint: FP,
      capability: '*',
      signal_kind: 'chain-head',
      source: 'ancient-channel',
      observed_at: now - (DIRECTORY_SIGNAL_RETENTION_DAYS + 1) * DAY,
      weight: 1.0,
    });
    const result = await runRetentionSweep(env, now);
    expect(result.directorySignalsPruned).toBeGreaterThanOrEqual(1);
    expect(state.capabilityIndex.some((r) => r.source === 'ancient-channel')).toBe(false);
    // Fresh post-consent signals survive.
    expect(state.capabilityIndex.some((r) => r.source === 'active-channel')).toBe(true);
  });
});

// ── listed_at propagation: consent windows never widen silently ───────────────

describe('listed_at propagation on re-PUT / re-list', () => {
  it('a re-PUT while LISTED preserves the original consent instant', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    const { db } = makeFakeDb(state);
    const env = makeEnv(db);

    const first = await handlePutHarborCard(putCard(await signedCard(PRIV, { listing: 'public' })), env);
    expect(first.status).toBe(200);
    const originalListedAt = state.cards.get(FP)!.listed_at;
    expect(originalListedAt).not.toBeNull();

    // Backdate the stored consent instant so preservation is distinguishable
    // from "just wrote now again".
    state.cards.get(FP)!.listed_at = originalListedAt! - 5000;

    const second = await handlePutHarborCard(
      putCard(await signedCard(PRIV, { listing: 'public', capabilities: ['metal shaders'] })),
      env,
    );
    expect(second.status).toBe(200);
    expect(state.cards.get(FP)!.listed_at).toBe(originalListedAt! - 5000);
    const body = (await second.json()) as { card: { listedAt: number } };
    expect(body.card.listedAt).toBe(originalListedAt! - 5000);
  });

  it('listed_at from a NON-listed prior row is never propagated — re-listing starts a NEW window', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    const now = Math.floor(Date.now() / 1000);
    const stale = now - 100_000;
    // Anomalous prior row: unlisted BUT with a leftover listed_at (crash
    // remnant / imported data). Propagating it would silently widen the
    // consent window by 100k seconds.
    state.cards.set(FP, {
      daemon_fingerprint: FP,
      display_name: null,
      capabilities_json: '["rust refactoring"]',
      card_iat: 0,
      card_sig: 'ff',
      listed: 0,
      listed_at: stale,
      updated_at: 0,
    });
    // An event inside the stale window but before the new consent instant.
    state.chainHeads.push({ sender: FP, channel: 'pre-new-consent', issued_at: stale + 10 });

    const { db } = makeFakeDb(state);
    const res = await handlePutHarborCard(putCard(await signedCard(PRIV, { listing: 'public' })), makeEnv(db));
    expect(res.status).toBe(200);

    const card = state.cards.get(FP)!;
    expect(card.listed).toBe(1);
    expect(card.listed_at).toBeGreaterThanOrEqual(now); // fresh window, not `stale`
    // And derivation is floored at the NEW instant — the stale-window event is out.
    expect(state.capabilityIndex.map((r) => r.source)).not.toContain('pre-new-consent');
  });

  it('a listed row that lost its listed_at is repaired to now on re-PUT (never left null)', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    const now = Math.floor(Date.now() / 1000);
    state.cards.set(FP, {
      daemon_fingerprint: FP,
      display_name: null,
      capabilities_json: '["rust refactoring"]',
      card_iat: 0,
      card_sig: 'ff',
      listed: 1,
      listed_at: null, // anomalous: listed without a consent instant
      updated_at: 0,
    });

    const { db } = makeFakeDb(state);
    const res = await handlePutHarborCard(putCard(await signedCard(PRIV, { listing: 'public' })), makeEnv(db));
    expect(res.status).toBe(200);
    const card = state.cards.get(FP)!;
    expect(card.listed).toBe(1);
    expect(card.listed_at).not.toBeNull();
    expect(card.listed_at).toBeGreaterThanOrEqual(now);
  });
});

// ── Gate 4: ranking-weight changes appear in the audit log ────────────────────

describe('ranking weights', () => {
  const putWeights = (body: unknown, token?: string): Request =>
    new Request(`${BASE}/v1/harbor/directory/weights`, {
      method: 'PUT',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    });

  it('is operator-gated (401 without the token)', async () => {
    const { db } = makeFakeDb(emptyState());
    const res = await handleSetDirectoryWeights(putWeights({ declaredWeight: 0.5 }), makeEnv(db));
    expect(res.status).toBe(401);
  });

  it('GATE: a weight change is written to the audit log with old AND new values', async () => {
    const state = emptyState();
    const { db } = makeFakeDb(state);
    const res = await handleSetDirectoryWeights(
      putWeights({ declaredWeight: 0.3, demonstratedWeight: 0.7 }, OPERATOR_TOKEN),
      makeEnv(db),
    );
    expect(res.status).toBe(200);

    const entry = state.auditLog.find((a) => a.action === 'directory.ranking-weights.change');
    expect(entry).toBeDefined();
    const detail = JSON.parse(entry!.detail!) as { old: { declaredWeight: number }; next: { declaredWeight: number } };
    expect(detail.old.declaredWeight).toBe(DEFAULT_RANKING_WEIGHTS.declaredWeight);
    expect(detail.next.declaredWeight).toBe(0.3);

    // And the change is live.
    const live = await getRankingWeights(db);
    expect(live.declaredWeight).toBe(0.3);
    expect(live.demonstratedWeight).toBe(0.7);
  });

  it('rejects unusable weights (fail closed, no silent zeroing)', async () => {
    const state = emptyState();
    const { db } = makeFakeDb(state);
    for (const bad of [
      { declaredWeight: -1 },
      { declaredWeight: 0, demonstratedWeight: 0 },
      { halfLifeDays: 0 },
      { confidenceFloor: 2 },
      { declaredWeight: 'lots' },
    ]) {
      const res = await handleSetDirectoryWeights(putWeights(bad, OPERATOR_TOKEN), makeEnv(db));
      expect(res.status).toBe(400);
    }
    expect(state.auditLog).toEqual([]); // refused changes are not "changes"
  });
});

// ── Ranking behavior: TF-IDF + demonstrated, refuse-to-route ─────────────────

describe('whois ranking', () => {
  async function twoListedCards(): Promise<{ state: FakeState; env: Env }> {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    seedIdentity(state, FP_B, PUB_B);
    const { db } = makeFakeDb(state);
    const env = makeEnv(db);
    let res = await handlePutHarborCard(
      putCard(await signedCard(PRIV, { fingerprint: FP, capabilities: ['rust refactoring', 'gpui shaders'] })),
      env,
    );
    expect(res.status).toBe(200);
    res = await handlePutHarborCard(
      putCard(await signedCard(PRIV_B, { fingerprint: FP_B, capabilities: ['react frontend', 'tailwind css'] })),
      env,
    );
    expect(res.status).toBe(200);
    return { state, env };
  }

  it('ranks the declared match first and excludes non-matching cards', async () => {
    const { env } = await twoListedCards();
    const res = await handleWhois(whois('rust gpui work'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: Array<{ fingerprint: string }> };
    expect(body.results.length).toBe(1);
    expect(body.results[0]!.fingerprint).toBe(FP);
  });

  it('demonstrated signals break declared ties (recency-decayed)', async () => {
    const state = emptyState();
    seedIdentity(state, FP, PUB);
    seedIdentity(state, FP_B, PUB_B);
    const now = Math.floor(Date.now() / 1000);
    // Only FP has post-consent signed activity.
    state.chainHeads.push({ sender: FP, channel: 'busy-channel', issued_at: now + 1 });
    const { db } = makeFakeDb(state);
    const env = makeEnv(db);
    await handlePutHarborCard(putCard(await signedCard(PRIV, { fingerprint: FP, capabilities: ['rust refactoring'] })), env);
    await handlePutHarborCard(putCard(await signedCard(PRIV_B, { fingerprint: FP_B, capabilities: ['rust refactoring'] })), env);

    const res = await handleWhois(whois('rust refactoring'), env);
    const body = (await res.json()) as { results: Array<{ fingerprint: string; confidence: number }> };
    expect(body.results.length).toBe(2);
    expect(body.results[0]!.fingerprint).toBe(FP);
    expect(body.results[0]!.confidence).toBeGreaterThan(body.results[1]!.confidence);
  });

  it('refuses to route below the confidence floor with {results: [], reason}', async () => {
    const { state, env } = await twoListedCards();
    state.weights = { declared_weight: 0.6, demonstrated_weight: 0.4, half_life_days: 14, confidence_floor: 0.99 };
    const res = await handleWhois(whois('rust'), env);
    expect(res.status).toBe(200); // refuse-to-route is NOT an error, never 404
    const body = (await res.json()) as { results: unknown[]; reason?: string };
    expect(body.results).toEqual([]);
    expect(body.reason).toContain('below-confidence-floor');
  });

  it('returns a stated no-match for a query nobody declares', async () => {
    const { env } = await twoListedCards();
    const res = await handleWhois(whois('underwater basket weaving'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; reason?: string };
    expect(body.results).toEqual([]);
    expect(body.reason).toContain('no-match');
  });

  it('the directory lists only consented cards', async () => {
    const { env } = await twoListedCards();
    // Delist B; the directory must shrink to A alone.
    await handlePutHarborCard(putCard(await signedCard(PRIV_B, { fingerprint: FP_B, capabilities: ['react frontend', 'tailwind css'], listing: 'private' })), env);
    const res = await handleDirectory(env);
    const body = (await res.json()) as { harbors: Array<{ fingerprint: string }> };
    expect(body.harbors.map((h) => h.fingerprint)).toEqual([FP]);
  });
});

// ── Pure scoring helpers ──────────────────────────────────────────────────────

describe('scoring primitives', () => {
  it('tokenize splits on non-word boundaries — no keyword lists anywhere', () => {
    expect(tokenize('Rust refactoring, GPUI!')).toEqual(['rust', 'refactoring', 'gpui']);
    expect(tokenize('c++ and c# and node.js')).toEqual(['c++', 'and', 'c#', 'and', 'node.js']);
  });

  it('scoreDeclared gives the matching doc a higher cosine than a non-match', () => {
    const docs = [['rust refactoring', 'gpui shaders'], ['react frontend']];
    const [a, b] = scoreDeclared('rust gpui', docs);
    expect(a!).toBeGreaterThan(0);
    expect(b!).toBe(0);
  });

  it('demonstratedSaturation decays with age and saturates below 1', () => {
    const now = 1_800_000_000;
    const fresh = demonstratedSaturation([{ observed_at: now, weight: 1 }], now, 14);
    const stale = demonstratedSaturation([{ observed_at: now - 28 * DAY, weight: 1 }], now, 14);
    expect(fresh).toBeGreaterThan(stale);
    expect(fresh).toBeLessThan(1);
    expect(demonstratedSaturation([], now, 14)).toBe(0);
    // Negative sums (failure-heavy) clamp to zero, never negative confidence.
    expect(demonstratedSaturation([{ observed_at: now, weight: -5 }], now, 14)).toBe(0);
  });
});
