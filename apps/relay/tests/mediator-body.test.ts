/**
 * MEDIATOR BODY tests (grand-plan DAG node mediator-body; src/mediator-body.ts
 * + the expiry defaults in src/parleys.ts). The gate, verbatim:
 *
 *   - summons→ack ROUND-TRIP TEST OVER THE CHAIN: the convene (which IS the
 *     summons) and the daemon's response are both real signed envelopes,
 *     verified and persisted by the actual handlePublish path, and the
 *     summons ledger records both events' chain coordinates;
 *   - gate state-machine tests (Approve/Modify/Reject + the Modify
 *     re-injection payload);
 *   - expiry test showing the HELM DEFAULT applied (first claimant proceeds,
 *     second rebases, recorded in outcome_json);
 *   - kill-flag test: mediator fully inert when flagged;
 *   - plus: the ≥0.7 confidence floor enforced SERVER-side, the
 *     one-open-parley-per-PR-pair invariant, honest CANNOT_CONVENE on
 *     unresolvable authors, and sender pinning on summons responses.
 *
 * Idiom: the same full-crypto approach as fleet-executor-identity.test.ts —
 * real relay key, real provisioning, real event hashing/signing through the
 * relay's own crypto helpers, stateful MockD1 with real chain semantics —
 * extended with the parley/summons/gate/pair/helm tables.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import {
  handleMediatorConvene,
  handleMediatorSummonsRespond,
  handleMediatorToggle,
  renderGateVerdict,
  validateConveneBody,
  MEDIATOR_CONFIDENCE_FLOOR,
} from '../src/mediator-body.js';
import { applyParleyExpiries, lapseOneExpiredParley } from '../src/parleys.js';
import { handleProvisionFleetExecutor } from '../src/fleet-executor-identity.js';
import {
  KILL_MEDIATOR_KEY,
  FLEET_PAUSED_KEY,
  mediatorReinjectionKey,
  type ParleyGateRow,
  type ParleyRow,
  type UserRow,
} from '../src/db.js';
import {
  computeEventHash,
  signEd25519,
  pubKeyFromPrivKey,
  toHex,
  fromHex,
  ZERO_HASH,
} from '../src/crypto.js';
import type { Env, RelayEvent } from '../src/types.js';

// ── Stateful in-memory D1 (chain semantics + parley tables) ─────────────────

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

interface ParleyRec {
  id: string; harbor_id: string; subject: string; proposer_id: string;
  proposer_label: string; state: string; deadline_at: number; created_at: number;
  resolved_at: number | null; convened_by: string; outcome_json: string | null;
}

interface PositionRec {
  parley_id: string; party_kind: string; party_id: string; party_label: string;
  tier: string; is_party: number; stance: string | null; position: string | null;
  signed_at: number | null; claim_rank: number | null;
}

interface PairRec {
  repo: string; pr_lo: number; pr_hi: number; first_pr: number; parley_id: string;
  confidence: number; symbols_json: string; created_at: number;
}

interface SummonsRec {
  id: string; parley_id: string; party_kind: string; party_id: string;
  party_label: string; daemon_fingerprint: string | null; summons_channel: string;
  summons_seq: number; summons_hash: string; issued_at: number; state: string;
  response_channel: string | null; response_seq: number | null;
  response_hash: string | null; responded_at: number | null; escalated_at: number | null;
}

interface GateRec {
  parley_id: string; action: string; state: string; verdict_by: string | null;
  verdict_by_label: string | null; verdict_at: number | null;
  modify_text: string | null; created_at: number;
}

interface HelmRec {
  harbor_id: string; holder_kind: string | null; holder_id: string | null;
  holder_label: string | null; succession_json: string; state: string;
  vacant_flagged: number; seq: number; updated_at: number; updated_by: string;
  parley_expiry_default: string;
}

class MockD1 {
  identities = new Map<string, IdentityRec>();
  events: EventRec[] = [];
  heads = new Map<string, { sender: string; channel: string; tip_seq: number }>();
  users: Array<{ id: string; login: string; deleted_at: number | null }> = [
    { id: 'u_alice', login: 'alice', deleted_at: null },
    { id: 'u_bob', login: 'bob', deleted_at: null },
  ];
  harbors: Array<{ id: string; namespace: string; name: string; pubkey: string; created_by: string; created_at: number }> = [
    { id: 'h_dock', namespace: 'alice', name: 'dock', pubkey: 'ab'.repeat(32), created_by: 'u_alice', created_at: 1000 },
  ];
  memberships: Array<{ harbor_id: string; member_kind: string; member_id: string; role: string }> = [
    { harbor_id: 'h_dock', member_kind: 'user', member_id: 'u_alice', role: 'owner' },
    { harbor_id: 'h_dock', member_kind: 'user', member_id: 'u_bob', role: 'member' },
  ];
  parleys: ParleyRec[] = [];
  positions: PositionRec[] = [];
  pairs: PairRec[] = [];
  summonses: SummonsRec[] = [];
  gates: GateRec[] = [];
  helms = new Map<string, HelmRec>();
  eventInserts = 0;

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

  async batch(stmts: Array<{ run(): Promise<unknown> }>) {
    const out: unknown[] = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }

  // eslint-disable-next-line complexity
  private route(q: string, args: unknown[], mode: 'first' | 'all' | 'run'): unknown {
    // ── identity / chain (verbatim semantics from the N2 suite) ────────────
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
    if (q.includes('FROM revocations')) return null;
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
      const [sender, channel, tip_seq] = args as [string, string, number];
      this.heads.set(`${sender}|${channel}`, { sender, channel, tip_seq });
      return undefined;
    }
    if (q.includes('FROM chain_heads')) return mode === 'all' ? [] : null;
    if (q.includes('INSERT INTO audit_log')) return undefined;
    // NB: matched BEFORE the memberships query below would be — and pinned to
    // the S6 shape, because 'FROM harbor_members' is a substring of
    // 'FROM harbor_memberships'.
    if (q.includes('FROM harbor_members WHERE daemon_fingerprint')) return mode === 'all' ? [] : null;

    // ── users / harbors / memberships ──────────────────────────────────────
    if (q.includes('FROM users WHERE login')) {
      const login = (args[0] as string).toLowerCase();
      return this.users.find((u) => u.login.toLowerCase() === login && u.deleted_at === null) ?? null;
    }
    if (q.includes('FROM harbors WHERE namespace = ? AND name = ?')) {
      return this.harbors.find((h) => h.namespace === args[0] && h.name === args[1]) ?? null;
    }
    if (q.includes('SELECT role FROM harbor_memberships')) {
      const m = this.memberships.find(
        (x) => x.harbor_id === args[0] && x.member_kind === args[1] && x.member_id === args[2],
      );
      return m ? { role: m.role } : null;
    }
    if (q.includes('FROM harbor_helms WHERE harbor_id')) {
      return this.helms.get(args[0] as string) ?? null;
    }

    // ── parleys ────────────────────────────────────────────────────────────
    if (q.includes('INSERT INTO parleys')) {
      const [id, harbor_id, subject, proposer_id, proposer_label, deadline_at, created_at, convened_by] =
        args as [string, string, string, string, string, number, number, string];
      this.parleys.push({
        id, harbor_id, subject, proposer_id, proposer_label,
        state: 'open', deadline_at, created_at, resolved_at: null,
        convened_by: convened_by ?? 'user', outcome_json: null,
      });
      return undefined;
    }
    if (q.includes('FROM parleys WHERE id = ?')) {
      return this.parleys.find((p) => p.id === args[0]) ?? null;
    }
    if (q.includes("state = 'open' AND deadline_at <") && q.includes('SELECT')) {
      const [harbor_id, now] = args as [string, number];
      return this.parleys.filter(
        (p) => p.harbor_id === harbor_id && p.state === 'open' && p.deadline_at < (now as number),
      );
    }
    if (q.includes("SET state = 'lapsed', resolved_at = ?, outcome_json")) {
      const [at, outcome, id] = args as [number, string, string];
      const row = this.parleys.find((p) => p.id === id && p.state === 'open');
      if (!row) return 0;
      row.state = 'lapsed';
      row.resolved_at = at;
      row.outcome_json = outcome;
      return 1;
    }
    if (q.includes('UPDATE parleys SET state = ?, resolved_at = ? WHERE id = ?')) {
      const [state, at, id] = args as [string, number, string];
      const row = this.parleys.find((p) => p.id === id && p.state === 'open');
      if (!row) return 0;
      row.state = state;
      row.resolved_at = at;
      return 1;
    }
    if (q.includes("UPDATE parleys SET state = 'lapsed'") && q.includes('WHERE harbor_id')) {
      const [at, harbor_id, now] = args as [number, string, number];
      let n = 0;
      for (const p of this.parleys) {
        if (p.harbor_id === harbor_id && p.state === 'open' && p.deadline_at < now) {
          p.state = 'lapsed';
          p.resolved_at = at;
          n += 1;
        }
      }
      return n;
    }

    // ── parley positions ───────────────────────────────────────────────────
    if (q.includes('INSERT INTO parley_positions')) {
      const [parley_id, party_kind, party_id, party_label, tier, is_party, claim_rank] =
        args as [string, string, string, string, string, number, number | null];
      this.positions.push({
        parley_id, party_kind, party_id, party_label, tier, is_party,
        stance: null, position: null, signed_at: null, claim_rank: claim_rank ?? null,
      });
      return undefined;
    }
    if (q.includes('FROM parley_positions WHERE parley_id = ?')) {
      return this.positions
        .filter((p) => p.parley_id === args[0])
        .sort((a, b) => b.is_party - a.is_party || a.party_kind.localeCompare(b.party_kind) || a.party_id.localeCompare(b.party_id));
    }
    if (q.includes('UPDATE parley_positions SET position = ?')) {
      const [note, parley_id] = args as [string, string];
      const row = this.positions.find(
        (p) => p.parley_id === parley_id && p.party_kind === 'mediator' && p.is_party === 0 && p.signed_at === null,
      );
      if (!row) return 0;
      row.position = note;
      return 1;
    }

    // ── mediator pairs ─────────────────────────────────────────────────────
    if (q.includes('INSERT INTO mediator_pairs')) {
      const [repo, pr_lo, pr_hi, first_pr, parley_id, confidence, symbols_json, created_at] =
        args as [string, number, number, number, string, number, string, number];
      this.pairs.push({ repo, pr_lo, pr_hi, first_pr, parley_id, confidence, symbols_json, created_at });
      return undefined;
    }
    if (q.includes('FROM mediator_pairs mp')) {
      const [repo, pr_lo, pr_hi] = args as [string, number, number];
      const open = this.pairs.find((mp) => {
        if (mp.repo !== repo || mp.pr_lo !== pr_lo || mp.pr_hi !== pr_hi) return false;
        const p = this.parleys.find((x) => x.id === mp.parley_id);
        return p?.state === 'open';
      });
      return open ? { parley_id: open.parley_id } : null;
    }
    if (q.includes('FROM mediator_pairs WHERE parley_id')) {
      return this.pairs.find((mp) => mp.parley_id === args[0]) ?? null;
    }

    // ── summonses ──────────────────────────────────────────────────────────
    if (q.includes('INSERT INTO parley_summonses')) {
      const [id, parley_id, party_kind, party_id, party_label, daemon_fingerprint,
        summons_channel, summons_seq, summons_hash, issued_at, state,
        response_channel, response_seq, response_hash, responded_at, escalated_at] =
        args as [string, string, string, string, string, string | null, string, number, string, number, string,
          string | null, number | null, string | null, number | null, number | null];
      this.summonses.push({
        id, parley_id, party_kind, party_id, party_label, daemon_fingerprint,
        summons_channel, summons_seq, summons_hash, issued_at, state,
        response_channel, response_seq, response_hash, responded_at, escalated_at,
      });
      return undefined;
    }
    if (q.includes('FROM parley_summonses WHERE id = ?')) {
      return this.summonses.find((s) => s.id === args[0]) ?? null;
    }
    if (q.includes('FROM parley_summonses WHERE parley_id = ?')) {
      return this.summonses
        .filter((s) => s.parley_id === args[0])
        .sort((a, b) => a.issued_at - b.issued_at || a.id.localeCompare(b.id));
    }
    if (q.includes('UPDATE parley_summonses SET')) {
      const [state, response_channel, response_seq, response_hash, responded_at, escalated_at, id] =
        args as [string, string, number, string, number, number | null, string];
      const row = this.summonses.find((s) => s.id === id && s.state === 'summoned');
      if (!row) return 0;
      row.state = state;
      row.response_channel = response_channel;
      row.response_seq = response_seq;
      row.response_hash = response_hash;
      row.responded_at = responded_at;
      row.escalated_at = escalated_at;
      return 1;
    }

    // ── gates ──────────────────────────────────────────────────────────────
    if (q.includes('INSERT INTO parley_gates')) {
      const [parley_id, action, created_at] = args as [string, string, number];
      this.gates.push({
        parley_id, action, state: 'pending', verdict_by: null, verdict_by_label: null,
        verdict_at: null, modify_text: null, created_at,
      });
      return undefined;
    }
    if (q.includes('FROM parley_gates WHERE parley_id')) {
      return this.gates.find((g) => g.parley_id === args[0]) ?? null;
    }
    if (q.includes('UPDATE parley_gates SET')) {
      const [state, verdict_by, verdict_by_label, verdict_at, modify_text, parley_id] =
        args as [string, string, string, number, string | null, string];
      const row = this.gates.find((g) => g.parley_id === parley_id && g.state === 'pending');
      if (!row) return 0;
      row.state = state;
      row.verdict_by = verdict_by;
      row.verdict_by_label = verdict_by_label;
      row.verdict_at = verdict_at;
      row.modify_text = modify_text;
      return 1;
    }

    if (mode === 'all') return [];
    return null;
  }
}

// ── KV mock (kill flag, pause flag, re-injection handoff) ────────────────────

function makeKv(store: Map<string, string>): KVNamespace {
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as unknown as KVNamespace;
}

// ── Env + provisioning + envelopes (the N2 suite's idiom) ────────────────────

const OPERATOR_TOKEN = 'operator-token-0123456789abcdef-0123456789abcdef';
const RELAY_PRIV = '42'.repeat(32);
const RELAY_FP = toHex(sha256(fromHex(pubKeyFromPrivKey(RELAY_PRIV))));

function makeEnv(db: MockD1, kvStore: Map<string, string>): Env {
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
    KV: makeKv(kvStore),
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

/** Build + sign one mediator/1 envelope exactly the way the executor does. */
async function signedEnvelope(
  seedHex: string,
  fingerprint: string,
  channel: string,
  chain: LocalChain,
  body: Record<string, unknown>,
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

const EXEC_SEED = '11'.repeat(32);
const DAEMON_SEED = '22'.repeat(32);

/** A valid convene body: alice's PR #1 (earlier) vs bob's PR #2. */
function conveneBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'mediator/1',
    type: 'convene',
    harbor: 'alice/dock',
    repo: 'octo/repo',
    prA: { number: 1, author: 'alice', createdAt: 5000 },
    prB: { number: 2, author: 'bob', createdAt: 6000 },
    symbols: [{ file: 'src/billing.ts', symbol: 'computeTotals' }],
    confidence: 0.7,
    action: 'merge',
    ...over,
  };
}

// ── Suite state ──────────────────────────────────────────────────────────────

let db: MockD1;
let kvStore: Map<string, string>;
let env: Env;

beforeEach(() => {
  db = new MockD1();
  kvStore = new Map();
  env = makeEnv(db, kvStore);
});

/** Provision executor + daemon, add the daemon as a harbor member. */
async function setupIdentities(): Promise<{ execFp: string; execCard: string; daemonFp: string; daemonCard: string }> {
  const exec = await provision(env, EXEC_SEED, 'prod');
  const daemon = await provision(env, DAEMON_SEED, 'alice-daemon');
  db.memberships.push({ harbor_id: 'h_dock', member_kind: 'daemon', member_id: daemon.fingerprint, role: 'member' });
  return { execFp: exec.fingerprint, execCard: exec.card, daemonFp: daemon.fingerprint, daemonCard: daemon.card };
}

async function convene(
  ids: { execFp: string; execCard: string },
  chain: LocalChain,
  bodyOver: Record<string, unknown> = {},
): Promise<Response> {
  const channel = `${RELAY_FP}:fleet-cloud:mediator:octo-repo:1-2`;
  const event = await signedEnvelope(EXEC_SEED, ids.execFp, channel, chain, conveneBody(bodyOver));
  return handleMediatorConvene(post('/v1/mediator/convene', { card: ids.execCard, event }), env);
}

// ── Convene: intake + summons issuance ───────────────────────────────────────

describe('POST /v1/mediator/convene', () => {
  it('materializes the parley: authors as ranked claimants, summonses on the chain, pending gate', async () => {
    const ids = await setupIdentities();
    const res = await convene(ids, { seq: 0, prev: ZERO_HASH }, {
      daemons: { alice: ids.daemonFp },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      parleyId: string;
      summons: { seq: number; hash: string; channel: string };
      summonses: Array<{ party: string; daemon: string | null; state: string }>;
      gate: { action: string; state: string } | null;
    };

    // The convene event entered the chain through the real publish gate.
    expect(db.eventInserts).toBe(1);
    expect(db.events[0]!.this_hash).toBe(body.summons.hash);

    // The parley: mediator-convened, proposer = FIRST CLAIMANT (earlier PR).
    const parley = db.parleys[0]!;
    expect(parley.convened_by).toBe('mediator');
    expect(parley.proposer_label).toBe('alice');
    expect(parley.state).toBe('open');
    expect(parley.subject).toContain('PR #1');
    expect(parley.subject).toContain('PR #2');

    // Claim ranks: alice (createdAt 5000) rank 1, bob (6000) rank 2.
    const alice = db.positions.find((p) => p.party_label === 'alice')!;
    const bob = db.positions.find((p) => p.party_label === 'bob')!;
    expect(alice.claim_rank).toBe(1);
    expect(bob.claim_rank).toBe(2);

    // The mediator observer seat carries the DETERMINISTIC prediction note
    // (structurally still is_party=0 with signed_at NULL — not a signature).
    const seat = db.positions.find((p) => p.party_kind === 'mediator')!;
    expect(seat.is_party).toBe(0);
    expect(seat.signed_at).toBeNull();
    expect(seat.position).toContain('Predicted symbol collision');
    expect(seat.position).toContain('src/billing.ts:computeTotals');

    // Pair registry row.
    expect(db.pairs[0]).toMatchObject({ repo: 'octo/repo', pr_lo: 1, pr_hi: 2, first_pr: 1 });

    // Summonses: alice has a declared daemon ⇒ 'summoned' (agent-first, D11);
    // bob has none ⇒ 'escalated' immediately (human woken honestly). Both are
    // pinned to the convene event's chain coordinates.
    const smAlice = db.summonses.find((s) => s.party_label === 'alice')!;
    const smBob = db.summonses.find((s) => s.party_label === 'bob')!;
    expect(smAlice.state).toBe('summoned');
    expect(smAlice.daemon_fingerprint).toBe(ids.daemonFp);
    expect(smAlice.summons_hash).toBe(db.events[0]!.this_hash);
    expect(smBob.state).toBe('escalated');
    expect(smBob.daemon_fingerprint).toBeNull();
    expect(smBob.escalated_at).not.toBeNull();

    // The human gate exists because the convene named an irreversible action.
    expect(db.gates[0]).toMatchObject({ action: 'merge', state: 'pending' });
    expect(body.gate).toEqual({ action: 'merge', state: 'pending' });
  });

  it('enforces the ≥0.7 floor SERVER-side: 0.69 → 422 BELOW_FLOOR, nothing published', async () => {
    const ids = await setupIdentities();
    const res = await convene(ids, { seq: 0, prev: ZERO_HASH }, { confidence: 0.69 });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('BELOW_FLOOR');
    expect(db.eventInserts).toBe(0);
    expect(db.parleys).toHaveLength(0);
  });

  it('KILL FLAG: 409 MEDIATOR_KILLED before any read or write', async () => {
    const ids = await setupIdentities();
    kvStore.set(KILL_MEDIATOR_KEY, JSON.stringify({ killed: true, killedAt: 1 }));
    const res = await convene(ids, { seq: 0, prev: ZERO_HASH });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('MEDIATOR_KILLED');
    expect(db.eventInserts).toBe(0);
    expect(db.parleys).toHaveLength(0);
  });

  it('ONE OPEN PARLEY PER PAIR: a second convene is idempotent (200 existing, no new event)', async () => {
    const ids = await setupIdentities();
    const chain = { seq: 0, prev: ZERO_HASH };
    expect((await convene(ids, chain)).status).toBe(201);
    const second = await convene(ids, chain);
    expect(second.status).toBe(200);
    const body = (await second.json()) as { existing: boolean; parleyId: string };
    expect(body.existing).toBe(true);
    expect(body.parleyId).toBe(db.parleys[0]!.id);
    expect(db.parleys).toHaveLength(1);
    expect(db.eventInserts).toBe(1); // the duplicate never reached the chain
  });

  it('refuses honestly when an author has no relay account (422 CANNOT_CONVENE, no event)', async () => {
    const ids = await setupIdentities();
    const res = await convene(ids, { seq: 0, prev: ZERO_HASH }, {
      prB: { number: 2, author: 'stranger', createdAt: 6000 },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('CANNOT_CONVENE');
    expect(body.error).toContain('stranger');
    expect(db.eventInserts).toBe(0);
  });

  it('an undeclared/unregistered daemon mapping degrades to escalation, never a ghost summons', async () => {
    const ids = await setupIdentities();
    const res = await convene(ids, { seq: 0, prev: ZERO_HASH }, {
      daemons: { alice: 'ff'.repeat(32) }, // not a registered identity
    });
    expect(res.status).toBe(201);
    const smAlice = db.summonses.find((s) => s.party_label === 'alice')!;
    expect(smAlice.daemon_fingerprint).toBeNull();
    expect(smAlice.state).toBe('escalated');
  });

  it('validateConveneBody rejects non-irreversible actions and malformed shapes', () => {
    expect(validateConveneBody(conveneBody({ action: 'comment' }))).toContain('irreversible');
    expect(validateConveneBody(conveneBody({ symbols: [] }))).toContain('symbols');
    expect(validateConveneBody(conveneBody({ prB: { number: 1, author: 'x', createdAt: 1 } }))).toContain('different');
    expect(typeof validateConveneBody(conveneBody())).toBe('object');
  });
});

// ── Summons → ack round trip over the chain ──────────────────────────────────

describe('POST /v1/mediator/summons/respond — the delivery acknowledgment', () => {
  async function convened() {
    const ids = await setupIdentities();
    const res = await convene(ids, { seq: 0, prev: ZERO_HASH }, { daemons: { alice: ids.daemonFp } });
    expect(res.status).toBe(201);
    const summonsId = db.summonses.find((s) => s.party_label === 'alice')!.id;
    return { ids, summonsId };
  }

  async function respond(
    ids: { daemonFp: string; daemonCard: string },
    chain: LocalChain,
    summonsId: string,
    response: string,
    seed = DAEMON_SEED,
    senderFp?: string,
  ): Promise<Response> {
    const channel = `${RELAY_FP}:fleet-cloud:daemon-acks`;
    const event = await signedEnvelope(seed, senderFp ?? ids.daemonFp, channel, chain, {
      schema: 'mediator/1',
      type: 'summons-response',
      summonsId,
      response,
    });
    return handleMediatorSummonsRespond(post('/v1/mediator/summons/respond', { card: ids.daemonCard, event }), env);
  }

  it('summons → ack round-trips over the chain: both events persisted, ledger pins both hashes', async () => {
    const { ids, summonsId } = await convened();
    const res = await respond(ids, { seq: 0, prev: ZERO_HASH }, summonsId, 'ack');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; humanWoken: boolean; ack: { hash: string; seq: number } };
    expect(body.state).toBe('acked');
    expect(body.humanWoken).toBe(false); // D11: an ack means the agents try first

    // Two chain events now exist: the summons (executor's chain) and the ack
    // (daemon's chain) — the ROUND TRIP, independently verifiable.
    expect(db.eventInserts).toBe(2);
    const summons = db.summonses.find((s) => s.id === summonsId)!;
    const ackEvent = db.events.find((e) => e.sender === ids.daemonFp)!;
    expect(summons.state).toBe('acked');
    expect(summons.response_hash).toBe(ackEvent.this_hash);
    expect(summons.response_seq).toBe(ackEvent.seq);
    expect(summons.summons_hash).toBe(db.events.find((e) => e.sender !== ids.daemonFp)!.this_hash);
    expect(summons.escalated_at).toBeNull();
  });

  it('a daemon REFUSE wakes the human (D11)', async () => {
    const { ids, summonsId } = await convened();
    const res = await respond(ids, { seq: 0, prev: ZERO_HASH }, summonsId, 'refuse');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; humanWoken: boolean };
    expect(body.state).toBe('refused');
    expect(body.humanWoken).toBe(true);
    expect(db.summonses.find((s) => s.id === summonsId)!.escalated_at).not.toBeNull();
  });

  it('sender pinning: only the DECLARED daemon may answer (403, nothing published)', async () => {
    const { ids, summonsId } = await convened();
    const before = db.eventInserts;
    // The EXECUTOR's key tries to answer alice's summons — refused pre-publish.
    const res = await respond(
      { daemonFp: ids.daemonFp, daemonCard: ids.execCard },
      { seq: 100, prev: ZERO_HASH },
      summonsId,
      'ack',
      EXEC_SEED,
      ids.execFp,
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_YOUR_SUMMONS');
    expect(db.eventInserts).toBe(before);
  });

  it('responses are write-once: a second response 409s', async () => {
    const { ids, summonsId } = await convened();
    const chain = { seq: 0, prev: ZERO_HASH };
    expect((await respond(ids, chain, summonsId, 'ack')).status).toBe(200);
    const second = await respond(ids, chain, summonsId, 'refuse');
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code: string }).code).toBe('ALREADY_RESPONDED');
    expect(db.summonses.find((s) => s.id === summonsId)!.state).toBe('acked');
  });

  it('kill flag makes the respond route inert too', async () => {
    const { ids, summonsId } = await convened();
    kvStore.set(KILL_MEDIATOR_KEY, 'true');
    const res = await respond(ids, { seq: 0, prev: ZERO_HASH }, summonsId, 'ack');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('MEDIATOR_KILLED');
  });
});

// ── The human gate's verdict state machine ───────────────────────────────────

describe('renderGateVerdict — Approve / Modify / Reject', () => {
  const user: UserRow = { id: 'u_alice', login: 'alice' } as UserRow;
  const parley = { id: 'p_1' } as ParleyRow;

  function pendingGate(): ParleyGateRow {
    const gate: GateRec = {
      parley_id: 'p_1', action: 'merge', state: 'pending', verdict_by: null,
      verdict_by_label: null, verdict_at: null, modify_text: null, created_at: 1,
    };
    db.gates.push(gate);
    return gate as ParleyGateRow;
  }

  const base = (over: Partial<Parameters<typeof renderGateVerdict>[1]> = {}) => ({
    parley,
    gate: pendingGate(),
    viewerIsNamedParty: true,
    user,
    verdict: 'approve',
    modifyText: null,
    loserTarget: { repo: 'octo/repo', pr: 2 },
    now: 999,
    ...over,
  });

  it('approve: pending → approved, write-once, verdict recorded', async () => {
    expect(await renderGateVerdict(env, base())).toBe('approved');
    expect(db.gates[0]).toMatchObject({ state: 'approved', verdict_by: 'u_alice', verdict_by_label: 'alice', verdict_at: 999 });
    // A second verdict finds the gate decided.
    expect(await renderGateVerdict(env, { ...base(), gate: db.gates[0] as ParleyGateRow })).toBe('gate-decided');
  });

  it('reject: pending → rejected', async () => {
    expect(await renderGateVerdict(env, base({ verdict: 'reject' }))).toBe('rejected');
    expect(db.gates[0]!.state).toBe('rejected');
  });

  it('modify REQUIRES text', async () => {
    expect(await renderGateVerdict(env, base({ verdict: 'modify', modifyText: '   ' }))).toBe('modify-text-required');
    expect(db.gates[0]!.state).toBe('pending'); // nothing written
  });

  it('modify: records the text AND hands the re-injection payload to the LOSING PR', async () => {
    const text = 'Rebase onto PR #1 and drop the schema change.';
    expect(await renderGateVerdict(env, base({ verdict: 'modify', modifyText: text }))).toBe('modified');
    expect(db.gates[0]).toMatchObject({ state: 'modified', modify_text: text });

    const raw = kvStore.get(mediatorReinjectionKey('octo/repo', 2));
    expect(raw).toBeDefined();
    const payload = JSON.parse(raw!) as { pr: number; modifyText: string; decidedBy: string; action: string };
    expect(payload).toMatchObject({ pr: 2, modifyText: text, decidedBy: 'alice', action: 'merge' });
  });

  it('fleet paused ⇒ the verdict is REFUSED (the grayed buttons have a server-side twin)', async () => {
    kvStore.set(FLEET_PAUSED_KEY, JSON.stringify({ paused: true, pausedAt: 1 }));
    expect(await renderGateVerdict(env, base())).toBe('fleet-paused');
    expect(db.gates[0]!.state).toBe('pending');
  });

  it('kill flag ⇒ inert', async () => {
    kvStore.set(KILL_MEDIATOR_KEY, 'true');
    expect(await renderGateVerdict(env, base())).toBe('mediator-killed');
    expect(db.gates[0]!.state).toBe('pending');
  });

  it('non-parties cannot decide; garbage verdicts are refused; no gate is honest', async () => {
    expect(await renderGateVerdict(env, base({ viewerIsNamedParty: false }))).toBe('not-a-party');
    expect(await renderGateVerdict(env, { ...base(), verdict: 'yolo' })).toBe('bad-verdict');
    expect(await renderGateVerdict(env, { ...base(), gate: null })).toBe('no-gate');
  });
});

// ── Expiry: the Helm default applied ─────────────────────────────────────────

describe('expiry defaults — deadline lapse applies the Helm outcome', () => {
  function seedMediatorParley(deadline: number): string {
    db.parleys.push({
      id: 'p_exp', harbor_id: 'h_dock', subject: 's', proposer_id: 'u_alice',
      proposer_label: 'alice', state: 'open', deadline_at: deadline, created_at: 1,
      resolved_at: null, convened_by: 'mediator', outcome_json: null,
    });
    db.positions.push(
      { parley_id: 'p_exp', party_kind: 'user', party_id: 'u_alice', party_label: 'alice', tier: 'human', is_party: 1, stance: null, position: null, signed_at: null, claim_rank: 1 },
      { parley_id: 'p_exp', party_kind: 'user', party_id: 'u_bob', party_label: 'bob', tier: 'human', is_party: 1, stance: null, position: null, signed_at: null, claim_rank: 2 },
      { parley_id: 'p_exp', party_kind: 'mediator', party_id: 'pd-mediator', party_label: 'pd-mediator', tier: 'mediator', is_party: 0, stance: null, position: null, signed_at: null, claim_rank: null },
    );
    db.pairs.push({ repo: 'octo/repo', pr_lo: 1, pr_hi: 2, first_pr: 1, parley_id: 'p_exp', confidence: 0.7, symbols_json: '[]', created_at: 1 });
    return 'p_exp';
  }

  function seedHelm(expiryDefault: string): void {
    db.helms.set('h_dock', {
      harbor_id: 'h_dock', holder_kind: 'user', holder_id: 'u_alice', holder_label: 'alice',
      succession_json: '[]', state: 'held', vacant_flagged: 0, seq: 1, updated_at: 1,
      updated_by: 'u_alice', parley_expiry_default: expiryDefault,
    });
  }

  it("'first-proceeds' records first-claimant-proceeds / second-rebases in outcome_json", async () => {
    seedHelm('first-proceeds');
    const id = seedMediatorParley(100);
    await applyParleyExpiries(env, 'h_dock', 200);

    const parley = db.parleys.find((p) => p.id === id)!;
    expect(parley.state).toBe('lapsed');
    expect(parley.resolved_at).toBe(200);
    const outcome = JSON.parse(parley.outcome_json!) as {
      default: string; source: string;
      proceeds: { party: string; pr: number }; rebases: { party: string; pr: number };
    };
    expect(outcome.default).toBe('first-claimant-proceeds');
    expect(outcome.source).toBe('helm-default');
    expect(outcome.proceeds).toEqual({ party: 'alice', pr: 1 });
    expect(outcome.rebases).toEqual({ party: 'bob', pr: 2 });
  });

  it("the default 'lapse' (and an unset helm) keeps v1's plain lapse — no outcome", async () => {
    seedHelm('lapse');
    const id = seedMediatorParley(100);
    await applyParleyExpiries(env, 'h_dock', 200);
    const parley = db.parleys.find((p) => p.id === id)!;
    expect(parley.state).toBe('lapsed');
    expect(parley.outcome_json).toBeNull();
  });

  it('a HUMAN-convened parley lapses plainly even under first-proceeds (no claim ranks, no invented winner)', async () => {
    seedHelm('first-proceeds');
    db.parleys.push({
      id: 'p_human', harbor_id: 'h_dock', subject: 's', proposer_id: 'u_alice',
      proposer_label: 'alice', state: 'open', deadline_at: 100, created_at: 1,
      resolved_at: null, convened_by: 'user', outcome_json: null,
    });
    db.positions.push(
      { parley_id: 'p_human', party_kind: 'user', party_id: 'u_alice', party_label: 'alice', tier: 'human', is_party: 1, stance: null, position: null, signed_at: null, claim_rank: null },
      { parley_id: 'p_human', party_kind: 'user', party_id: 'u_bob', party_label: 'bob', tier: 'human', is_party: 1, stance: null, position: null, signed_at: null, claim_rank: null },
    );
    await applyParleyExpiries(env, 'h_dock', 200);
    const parley = db.parleys.find((p) => p.id === 'p_human')!;
    expect(parley.state).toBe('lapsed');
    expect(parley.outcome_json).toBeNull();
  });

  it('an unexpired parley is untouched by the sweep', async () => {
    seedHelm('first-proceeds');
    const id = seedMediatorParley(10_000);
    await applyParleyExpiries(env, 'h_dock', 200);
    expect(db.parleys.find((p) => p.id === id)!.state).toBe('open');
  });

  it('lapseOneExpiredParley is CAS-safe: an already-lapsed parley is never rewritten', async () => {
    seedHelm('first-proceeds');
    const id = seedMediatorParley(100);
    const row = db.parleys.find((p) => p.id === id)!;
    row.state = 'lapsed';
    row.resolved_at = 150;
    await lapseOneExpiredParley(env, 'h_dock', row as unknown as ParleyRow, 200, 'first-proceeds');
    expect(row.resolved_at).toBe(150);
    expect(row.outcome_json).toBeNull();
  });
});

// ── Kill toggle route ────────────────────────────────────────────────────────

describe('POST /v1/fleet/mediator — the kill-mediator toggle', () => {
  it('is operator-gated', async () => {
    const res = await handleMediatorToggle(post('/v1/fleet/mediator', { killed: true }), env);
    expect(res.status).toBe(401);
    expect(kvStore.has(KILL_MEDIATOR_KEY)).toBe(false);
  });

  it('sets and clears the flag', async () => {
    const withAuth = (body: unknown) =>
      new Request('https://relay.example/v1/fleet/mediator', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPERATOR_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const on = await handleMediatorToggle(withAuth({ killed: true }), env);
    expect(on.status).toBe(200);
    expect(JSON.parse(kvStore.get(KILL_MEDIATOR_KEY)!)).toMatchObject({ killed: true });
    const off = await handleMediatorToggle(withAuth({ killed: false }), env);
    expect(off.status).toBe(200);
    expect(JSON.parse(kvStore.get(KILL_MEDIATOR_KEY)!)).toMatchObject({ killed: false });
    const bad = await handleMediatorToggle(withAuth({ killed: 'yes' }), env);
    expect(bad.status).toBe(400);
  });

  it('confidence floor constant matches the plan', () => {
    expect(MEDIATOR_CONFIDENCE_FLOOR).toBe(0.7);
  });
});
