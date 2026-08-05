/**
 * Shared test fixture for the X4 parley HTML surface (src/parleys-page.ts) and
 * the mediator's body (src/mediator.ts).
 *
 * WHY A SHARED FIXTURE HERE, when the repo's idiom is a per-file D1 mock: both
 * suites need the SAME stateful database, and — critically — both need it to
 * honour the WHERE clauses of the parley writes rather than just pattern-match
 * on the SQL. The mediator's core safety claims ("it cannot sign", "it cannot
 * alter another party's row") are properties of a WHERE clause, so a mock that
 * ignored WHERE clauses would let those tests pass while proving nothing. This
 * fake evaluates the guards, so a regression that widened
 * recordMediatorObservation's SET list or dropped its `party_kind='mediator'`
 * conjunct would actually turn a test red.
 *
 * Sessions are modelled too (web_sessions + users), because the HTML surface is
 * session-gated where the JSON API accepts a pdu_ bearer — the page's gate has
 * to be exercised through the real resolveSession path to be worth anything.
 */

import { hashHex } from '../../src/crypto.js';
import type { Env } from '../../src/types.js';

export const BASE = 'https://relay.example';

/** Session cookie name the relay sets (auth-github.ts SESSION_COOKIE). */
export const SESSION_COOKIE = '__Host-pd_session';

export const ALICE_TOKEN = `pdu_${'a'.repeat(64)}`;
export const BOB_TOKEN = `pdu_${'b'.repeat(64)}`;
export const CAROL_TOKEN = `pdu_${'c'.repeat(64)}`;
export const MALLORY_TOKEN = `pdu_${'d'.repeat(64)}`;

/** Session cookie values, one per principal. */
export const ALICE_SESSION = 'sess-alice';
export const BOB_SESSION = 'sess-bob';
export const CAROL_SESSION = 'sess-carol';
export const MALLORY_SESSION = 'sess-mallory';

export const DAEMON_FP = 'ab'.repeat(32);

export interface FakeUser {
  id: string;
  github_user_id: number;
  login: string;
  display_name: string | null;
  avatar_url: string | null;
  primary_email: string | null;
  email_verified: number;
  created_at: number;
  last_login_at: number | null;
  deleted_at: number | null;
}

const mkUser = (id: string, ghId: number, login: string): FakeUser => ({
  id,
  github_user_id: ghId,
  login,
  display_name: null,
  avatar_url: null,
  primary_email: null,
  email_verified: 1,
  created_at: 1000,
  last_login_at: null,
  deleted_at: null,
});

export interface FakeHarbor {
  id: string;
  namespace: string;
  name: string;
  pubkey: string;
  created_by: string;
  created_at: number;
}

export interface FakeMembership {
  harbor_id: string;
  member_kind: 'user' | 'daemon';
  member_id: string;
  role: 'owner' | 'member';
  added_at: number;
  added_by: string;
}

export interface FakeParley {
  id: string;
  harbor_id: string;
  subject: string;
  proposer_id: string;
  proposer_label: string;
  state: 'open' | 'agreed' | 'lapsed';
  deadline_at: number;
  created_at: number;
  resolved_at: number | null;
}

export interface FakePosition {
  parley_id: string;
  party_kind: 'user' | 'daemon' | 'mediator';
  party_id: string;
  party_label: string;
  tier: string;
  is_party: number;
  stance: 'accept' | 'reject' | null;
  position: string | null;
  signed_at: number | null;
}

export interface ParleyFixture {
  db: D1Database;
  users: FakeUser[];
  harbors: FakeHarbor[];
  memberships: FakeMembership[];
  parleys: FakeParley[];
  positions: FakePosition[];
  /** Set true to make every parley/position read throw (degraded-state tests). */
  failReads: { value: boolean };
}

/**
 * Build the stateful fake D1 plus its backing arrays.
 *
 * The arrays are returned alongside the handle on purpose: assertions about
 * what the mediator did or did not write are far more convincing when made
 * against the stored rows themselves ("signed_at is still null") than against
 * a rendered page or a returned envelope, which could both be right for the
 * wrong reason.
 *
 * @returns The D1 handle and direct references to its underlying tables.
 */
export function makeParleyDb(): ParleyFixture {
  const users: FakeUser[] = [
    mkUser('u_alice', 1, 'alice'),
    mkUser('u_bob', 2, 'bob'),
    mkUser('u_carol', 3, 'carol'),
    mkUser('u_mallory', 4, 'mallory'),
  ];
  const tokens = new Map<string, { user_id: string; expires_at: number | null; revoked_at: number | null }>([
    [hashHex(ALICE_TOKEN), { user_id: 'u_alice', expires_at: null, revoked_at: null }],
    [hashHex(BOB_TOKEN), { user_id: 'u_bob', expires_at: null, revoked_at: null }],
    [hashHex(CAROL_TOKEN), { user_id: 'u_carol', expires_at: null, revoked_at: null }],
    [hashHex(MALLORY_TOKEN), { user_id: 'u_mallory', expires_at: null, revoked_at: null }],
  ]);
  // web_sessions: token_hash → user. expires_at far in the future.
  const sessions = new Map<string, { user_id: string; expires_at: number }>([
    [hashHex(ALICE_SESSION), { user_id: 'u_alice', expires_at: 4_000_000_000 }],
    [hashHex(BOB_SESSION), { user_id: 'u_bob', expires_at: 4_000_000_000 }],
    [hashHex(CAROL_SESSION), { user_id: 'u_carol', expires_at: 4_000_000_000 }],
    [hashHex(MALLORY_SESSION), { user_id: 'u_mallory', expires_at: 4_000_000_000 }],
  ]);
  const identities = [
    {
      daemon_fingerprint: DAEMON_FP,
      pub_key: 'ff'.repeat(32),
      proof_method: 'oidc',
      proof_metadata: '{}',
      expires_at: null,
      revoked: 0,
      revoked_reason: null,
    },
  ];
  const harbors: FakeHarbor[] = [];
  const memberships: FakeMembership[] = [];
  const parleys: FakeParley[] = [];
  const positions: FakePosition[] = [];
  const failReads = { value: false };

  const ok = { success: true, meta: { changes: 1 } };
  const changes = (n: number) => ({ success: true, meta: { changes: n } });

  function prepare(sql: string) {
    let args: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        args = v;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        if (sql.includes('FROM user_tokens')) return (tokens.get(args[0] as string) ?? null) as T | null;
        if (sql.startsWith('SELECT user_id, gh_token_enc')) {
          const s = sessions.get(args[0] as string);
          return (s ? { user_id: s.user_id, gh_token_enc: null, gh_token_iv: null, expires_at: s.expires_at } : null) as T | null;
        }
        if (sql.includes('FROM users WHERE id = ?')) {
          return (users.find((u) => u.id === args[0] && u.deleted_at === null) ?? null) as T | null;
        }
        if (sql.includes('FROM users WHERE login')) {
          const q = (args[0] as string).toLowerCase();
          return (users.find((u) => u.login.toLowerCase() === q && u.deleted_at === null) ?? null) as T | null;
        }
        if (sql.includes('FROM harbors WHERE namespace = ? AND name = ?')) {
          return (harbors.find((h) => h.namespace === args[0] && h.name === args[1]) ?? null) as T | null;
        }
        if (sql.includes('SELECT role FROM harbor_memberships')) {
          const m = memberships.find(
            (x) => x.harbor_id === args[0] && x.member_kind === args[1] && x.member_id === args[2],
          );
          return (m ? { role: m.role } : null) as T | null;
        }
        if (sql.includes('FROM identities')) {
          return (identities.find((i) => i.daemon_fingerprint === args[0]) ?? null) as T | null;
        }
        if (sql.includes('COUNT(*) AS n FROM parley_positions')) {
          const n = positions.filter((p) => p.parley_id === args[0] && p.is_party === 1 && p.stance !== 'accept').length;
          return { n } as T;
        }
        if (sql.includes('FROM parleys WHERE id = ?')) {
          if (failReads.value) throw new Error('D1 read failure (simulated)');
          return (parleys.find((p) => p.id === args[0]) ?? null) as T | null;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (sql.includes('FROM parleys WHERE harbor_id = ?')) {
          if (failReads.value) throw new Error('D1 read failure (simulated)');
          const limit = typeof args[1] === 'number' ? args[1] : 50;
          const rows = parleys
            .filter((p) => p.harbor_id === args[0])
            .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
            .slice(0, limit);
          return { results: rows as T[] };
        }
        if (sql.includes('FROM parley_positions WHERE parley_id = ?')) {
          if (failReads.value) throw new Error('D1 read failure (simulated)');
          const rows = positions
            .filter((p) => p.parley_id === args[0])
            .sort(
              (a, b) =>
                b.is_party - a.is_party ||
                a.party_kind.localeCompare(b.party_kind) ||
                a.party_id.localeCompare(b.party_id),
            );
          return { results: rows as T[] };
        }
        // tallyParleySignatures — GROUP BY over a bounded IN list.
        if (sql.includes('SUM(CASE WHEN signed_at IS NOT NULL')) {
          if (failReads.value) throw new Error('D1 read failure (simulated)');
          const ids = args as string[];
          const out: Array<{ parley_id: string; parties: number; signed: number }> = [];
          for (const id of ids) {
            const rows = positions.filter((p) => p.parley_id === id && p.is_party === 1);
            if (rows.length === 0) continue;
            out.push({
              parley_id: id,
              parties: rows.length,
              signed: rows.filter((p) => p.signed_at !== null).length,
            });
          }
          return { results: out as T[] };
        }
        // listHarborsForUser
        if (sql.includes('JOIN harbor_memberships m ON m.harbor_id = h.id')) {
          const mine = memberships.filter((m) => m.member_kind === 'user' && m.member_id === args[0]);
          const rows = mine
            .map((m) => {
              const h = harbors.find((x) => x.id === m.harbor_id);
              return h ? { ...h, role: m.role } : null;
            })
            .filter((x): x is FakeHarbor & { role: string } => x !== null)
            .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
          return { results: rows as T[] };
        }
        return { results: [] };
      },
      async run() {
        if (sql.includes('UPDATE user_tokens SET last_used_at')) return ok;
        if (sql.includes('INSERT INTO harbors')) {
          const [id, namespace, name, pubkey, created_by, created_at] = args as [string, string, string, string, string, number];
          if (harbors.some((h) => h.namespace === namespace && h.name === name)) {
            throw new Error('UNIQUE constraint failed: harbors.namespace, harbors.name');
          }
          harbors.push({ id, namespace, name, pubkey, created_by, created_at });
          return ok;
        }
        if (sql.includes('INSERT INTO harbor_memberships')) {
          const [harbor_id, member_kind, member_id, role, added_at, added_by] = args as [
            string, 'user' | 'daemon', string, 'owner' | 'member', number, string,
          ];
          if (memberships.some((m) => m.harbor_id === harbor_id && m.member_kind === member_kind && m.member_id === member_id)) {
            throw new Error('UNIQUE constraint failed: harbor_memberships');
          }
          memberships.push({ harbor_id, member_kind, member_id, role, added_at, added_by });
          return ok;
        }
        if (sql.includes('INSERT INTO parleys')) {
          const [id, harbor_id, subject, proposer_id, proposer_label, deadline_at, created_at] = args as [
            string, string, string, string, string, number, number,
          ];
          parleys.push({ id, harbor_id, subject, proposer_id, proposer_label, state: 'open', deadline_at, created_at, resolved_at: null });
          return ok;
        }
        if (sql.includes('INSERT INTO parley_positions')) {
          const [parley_id, party_kind, party_id, party_label, tier, is_party] = args as [
            string, 'user' | 'daemon' | 'mediator', string, string, string, number,
          ];
          positions.push({ parley_id, party_kind, party_id, party_label, tier, is_party, stance: null, position: null, signed_at: null });
          return ok;
        }
        // ── recordMediatorObservation — the guard under test ─────────────────
        // SET position ONLY; WHERE pins mediator + observer + unsigned. This
        // branch evaluates every conjunct so the mediator's structural claims
        // are actually exercised rather than assumed.
        if (sql.includes('UPDATE parley_positions SET position = ?')) {
          const [note, parley_id] = args as [string, string];
          const row = positions.find(
            (p) =>
              p.parley_id === parley_id &&
              p.party_kind === 'mediator' &&
              p.is_party === 0 &&
              p.signed_at === null,
          );
          if (!row) return changes(0);
          row.position = note;
          // Deliberately NOT touching stance/signed_at: the real SET list
          // cannot name them, and this fake must not be more permissive.
          return changes(1);
        }
        // signParleyPosition (write-once CAS, named parties only)
        if (sql.includes('UPDATE parley_positions SET stance')) {
          const [stance, position, signed_at, parley_id, party_kind, party_id] = args as [
            'accept' | 'reject', string | null, number, string, 'user' | 'daemon' | 'mediator', string,
          ];
          const row = positions.find(
            (p) =>
              p.parley_id === parley_id && p.party_kind === party_kind && p.party_id === party_id &&
              p.is_party === 1 && p.signed_at === null,
          );
          if (!row) return changes(0);
          row.stance = stance;
          row.position = position;
          row.signed_at = signed_at;
          return changes(1);
        }
        if (sql.includes('UPDATE parleys SET state = ?, resolved_at = ? WHERE id = ?')) {
          const [state, resolved_at, id] = args as ['agreed' | 'lapsed', number, string];
          const row = parleys.find((p) => p.id === id && p.state === 'open');
          if (!row) return changes(0);
          row.state = state;
          row.resolved_at = resolved_at;
          return changes(1);
        }
        if (sql.includes("UPDATE parleys SET state = 'lapsed'")) {
          const [resolved_at, harbor_id, now] = args as [number, string, number];
          let n = 0;
          for (const p of parleys) {
            if (p.harbor_id === harbor_id && p.state === 'open' && p.deadline_at < now) {
              p.state = 'lapsed';
              p.resolved_at = resolved_at;
              n += 1;
            }
          }
          return changes(n);
        }
        return ok;
      },
    };
    return stmt;
  }

  const db = {
    prepare,
    async batch(stmts: Array<{ run(): Promise<unknown> }>) {
      const out: unknown[] = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  return { db: db as unknown as D1Database, users, harbors, memberships, parleys, positions, failReads };
}

/**
 * Build a test Env around a fake D1.
 *
 * `PUBLIC_BASE_URL` is set to {@link BASE} so `isSameOrigin` has a real
 * expected origin to compare against — without it the CSRF guard would fall
 * back to the request's own URL and the cross-origin tests would be vacuous.
 *
 * @param db The fake D1 handle.
 * @param extra Overrides merged over the defaults (e.g. PARLEY_MEDIATOR, AI).
 * @returns An Env suitable for the relay handlers under test.
 */
export function makeParleyEnv(db: D1Database, extra: Partial<Env> = {}): Env {
  return {
    DB: db,
    KV: { get: async () => null, put: async () => {}, delete: async () => {} } as unknown as KVNamespace,
    PUBLIC_BASE_URL: BASE,
    RELAY_VERSION: '0.1.0-test',
    ...extra,
  } as unknown as Env;
}

/** Build a request with optional bearer token, session cookie, origin, body. */
export function req(
  path: string,
  opts: { method?: string; token?: string; session?: string; body?: unknown; origin?: string; form?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.session) headers.Cookie = `${SESSION_COOKIE}=${opts.session}`;
  if (opts.origin) headers.Origin = opts.origin;
  let body: string | undefined;
  if (opts.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(opts.form).toString();
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  return new Request(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}

export const PUBKEY = '1234abcd'.repeat(8);
