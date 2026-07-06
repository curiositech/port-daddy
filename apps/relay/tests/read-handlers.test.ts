/**
 * Tests for handleKeys, handleChainHead, and handleAudit (ADR-0049).
 *
 * These are the read-side handlers:
 *   - handleKeys: public harbor key directory — returns non-revoked members of a
 *     harbor (no auth). We pin the response shape and that the JOIN result is
 *     mapped to {daemon_fingerprint, pub_key}.
 *   - handleChainHead: returns a chain head or 404. Shape + not-found gate.
 *   - handleAudit: OPERATOR-ONLY. We pin the operator-token gate (missing/wrong
 *     → 401), the missing-param gate, and the success shape.
 */

import { describe, it, expect } from 'vitest';
import { handleKeys, handleChainHead, handleAudit } from '../src/handlers.js';
import type { Env } from '../src/types.js';

const HARBOR = 'a'.repeat(64);
// >= 32 chars: operatorOnly() fail-closes (500 MISCONFIGURED) below the minimum.
const OPERATOR = 'super-secret-operator-token-32bytes-min';

// ── D1 mock driven by callbacks per query shape ───────────────────────────────
function makeMockD1(handlers: {
  onFirst?: (query: string, bound: unknown[]) => unknown;
  onAll?: (query: string, bound: unknown[]) => unknown[];
}): D1Database {
  const stmtFor = (query: string) => {
    let bound: unknown[] = [];
    const stmt = {
      bind(...vals: unknown[]) { bound = vals; return stmt; },
      async first<T>(): Promise<T | null> {
        return (handlers.onFirst?.(query, bound) ?? null) as T | null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        return { results: (handlers.onAll?.(query, bound) ?? []) as T[] };
      },
      async run() { return { success: true }; },
    };
    return stmt as unknown as D1PreparedStatement;
  };
  return {
    prepare: stmtFor,
    batch: async () => [],
    exec: async () => ({ count: 0, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
  } as unknown as D1Database;
}

function makeEnv(db: D1Database, operatorToken = OPERATOR): Env {
  return {
    DB: db,
    HARBOR_CHANNEL: {} as unknown as DurableObjectNamespace,
    KV: {} as KVNamespace,
    RELAY_OPERATOR_TOKEN: operatorToken,
    RELAY_ED25519_PRIVATE_KEY_HEX: '00'.repeat(32),
    RELAY_VERSION: '0.0.0-test',
    EVENT_RETENTION_DAYS: '7',
    SESSION_TTL_SECONDS: '3600',
    JWKS_CACHE_TTL_SECONDS: '300',
    JWKS_FAIL_SOFT_SECONDS: '600',
    REVOCATION_BROADCAST_TIMEOUT_MS: '5000',
    RATE_LIMIT_WINDOW_MS: '60000',
  } as unknown as Env;
}

// ── handleKeys ────────────────────────────────────────────────────────────────

describe('handleKeys — public harbor key directory', () => {
  it('returns the non-revoked members of the harbor, mapped to {daemon_fingerprint, pub_key}', async () => {
    const db = makeMockD1({
      onAll: (q) => {
        expect(q).toContain('FROM identities');
        expect(q).toContain('harbor_members');
        expect(q).toContain('revoked = 0'); // revoked members excluded by SQL
        return [
          { daemon_fingerprint: 'd1', pub_key: 'pk1' },
          { daemon_fingerprint: 'd2', pub_key: 'pk2' },
        ];
      },
    });
    const res = await handleKeys(makeEnv(db), HARBOR);
    expect(res.status).toBe(200);
    const json = await res.json() as { harbor_fingerprint: string; members: Array<{ daemon_fingerprint: string; pub_key: string }> };
    expect(json.harbor_fingerprint).toBe(HARBOR);
    expect(json.members).toEqual([
      { daemon_fingerprint: 'd1', pub_key: 'pk1' },
      { daemon_fingerprint: 'd2', pub_key: 'pk2' },
    ]);
  });

  it('returns an empty members list for a harbor with no members', async () => {
    const db = makeMockD1({ onAll: () => [] });
    const res = await handleKeys(makeEnv(db), HARBOR);
    const json = await res.json() as { members: unknown[] };
    expect(json.members).toEqual([]);
  });
});

// ── handleChainHead ───────────────────────────────────────────────────────────

describe('handleChainHead', () => {
  const SENDER = 'd'.repeat(64);
  const CHANNEL = `${HARBOR}:room`;

  it('404 NOT_FOUND when there is no chain head for sender+channel', async () => {
    const db = makeMockD1({ onFirst: () => null });
    const res = await handleChainHead(makeEnv(db), SENDER, CHANNEL);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('NOT_FOUND');
  });

  it('returns the chain head with its tip when present', async () => {
    const db = makeMockD1({
      onFirst: (q) => {
        expect(q).toContain('FROM chain_heads');
        return {
          sender: SENDER, channel: CHANNEL, tip_seq: 42, tip_hash: 'ff'.repeat(32),
          issued_at: 1_700_000_000, signed_head: 'sig', anchors_json: null,
        };
      },
    });
    const res = await handleChainHead(makeEnv(db), SENDER, CHANNEL);
    expect(res.status).toBe(200);
    const json = await res.json() as { sender: string; channel: string; tip_seq: number; tip_hash: string };
    expect(json.sender).toBe(SENDER);
    expect(json.channel).toBe(CHANNEL);
    expect(json.tip_seq).toBe(42);
    expect(json.tip_hash).toBe('ff'.repeat(32));
  });
});

// ── handleAudit (operator-only) ───────────────────────────────────────────────

function auditReq(token: string | null, query = '?fingerprint=' + 'd'.repeat(64)): Request {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request(`https://relay.example.com/v1/audit${query}`, { headers });
}

describe('handleAudit — operator gate + query', () => {
  it('401 UNAUTHORIZED when the operator token is missing', async () => {
    const db = makeMockD1({});
    const res = await handleAudit(auditReq(null), makeEnv(db));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('UNAUTHORIZED');
  });

  it('401 UNAUTHORIZED when the operator token is wrong', async () => {
    const db = makeMockD1({});
    const res = await handleAudit(auditReq('nope'), makeEnv(db));
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('UNAUTHORIZED');
  });

  it('400 MISSING_PARAMS when fingerprint is absent (after auth passes)', async () => {
    const db = makeMockD1({});
    const res = await handleAudit(auditReq(OPERATOR, ''), makeEnv(db));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('MISSING_PARAMS');
  });

  it('200 + returns audit rows for the requested fingerprint', async () => {
    const fp = 'd'.repeat(64);
    const db = makeMockD1({
      onAll: (q, bound) => {
        expect(q).toContain('FROM audit_log');
        expect(bound[0]).toBe(fp); // queried for the requested fingerprint
        return [{ at: 1_700_000_000, action: 'publish', target: `${HARBOR}:room`, ip: '1.2.3.4', detail: 'seq=1' }];
      },
    });
    const res = await handleAudit(auditReq(OPERATOR, `?fingerprint=${fp}`), makeEnv(db));
    expect(res.status).toBe(200);
    const json = await res.json() as { fingerprint: string; rows: Array<{ action: string }> };
    expect(json.fingerprint).toBe(fp);
    expect(json.rows).toHaveLength(1);
    expect(json.rows[0]!.action).toBe('publish');
  });
});
