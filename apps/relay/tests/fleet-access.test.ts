/** Account-backed Cloud Fleet operator authorization regressions. */

import { describe, expect, it } from 'vitest';
import { fleetOperatorOnly } from '../src/fleet-access.js';
import type { UserRow } from '../src/db.js';
import type { Env } from '../src/types.js';

const BREAK_GLASS = 'break-glass-operator-token-32bytes-minimum';
const PDU = `pdu_${'a'.repeat(64)}`;
const OWNER_GITHUB_ID = 2_093_678;

const USER: UserRow = {
  id: 'u_owner',
  github_user_id: OWNER_GITHUB_ID,
  login: 'erichowens',
  display_name: 'Eric Owens',
  avatar_url: null,
  primary_email: null,
  email_verified: 0,
  created_at: 1,
  last_login_at: 1,
  deleted_at: null,
};

function request(token?: string): Request {
  return new Request('https://relay.example/v1/fleet/health', {
    headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
  });
}

function fixture(options: { user?: UserRow | null; operatorRole?: boolean; failRoles?: boolean } = {}) {
  let operatorRole = options.operatorRole ?? false;
  const user = options.user === undefined ? USER : options.user;
  const writes: Array<{ sql: string; bound: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        async first<T>() {
          if (sql.includes('FROM user_tokens')) {
            return (user ? { user_id: user.id, expires_at: null, revoked_at: null } : null) as T | null;
          }
          if (sql.includes('FROM users WHERE id')) return user as T | null;
          if (sql.includes('FROM user_roles')) {
            if (options.failRoles) throw new Error('no such table: user_roles');
            return (operatorRole ? { allowed: 1 } : null) as T | null;
          }
          return null;
        },
        async run() {
          writes.push({ sql, bound });
          if (sql.includes('INSERT INTO user_roles')) operatorRole = true;
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, writes, hasOperatorRole: () => operatorRole };
}

function env(db: D1Database, ownerId: string | null = String(OWNER_GITHUB_ID)): Env {
  return {
    DB: db,
    RELAY_OPERATOR_TOKEN: BREAK_GLASS,
    RELAY_OPERATOR_GITHUB_USER_ID: ownerId ?? undefined,
  } as unknown as Env;
}

describe('fleetOperatorOnly', () => {
  it('keeps the operator secret as break-glass access without touching account data', async () => {
    const f = fixture({ failRoles: true });
    expect(await fleetOperatorOnly(request(BREAK_GLASS), env(f.db))).toEqual({ kind: 'break-glass' });
    expect(f.writes).toEqual([]);
  });

  it('rejects missing and unknown credentials', async () => {
    const f = fixture({ user: null });
    expect((await fleetOperatorOnly(request(), env(f.db)))?.status).toBe(401);
    expect((await fleetOperatorOnly(request(PDU), env(f.db)))?.status).toBe(401);
  });

  it('does not widen native fleet controls to browser cookies', async () => {
    const f = fixture({ operatorRole: true });
    const browserRequest = new Request('https://relay.example/v1/fleet/pause', {
      headers: { Cookie: '__Host-pd_session=browser-session' },
    });
    expect((await fleetOperatorOnly(browserRequest, env(f.db)))?.status).toBe(401);
    expect(f.writes).toEqual([]);
  });

  it('materializes the configured GitHub owner and accepts the existing pdu token', async () => {
    const f = fixture();
    expect(await fleetOperatorOnly(request(PDU), env(f.db))).toEqual({
      kind: 'account',
      userId: 'u_owner',
      githubUserId: OWNER_GITHUB_ID,
    });
    expect(f.hasOperatorRole()).toBe(true);
    const grant = f.writes.find((write) => write.sql.includes('INSERT INTO user_roles'));
    expect(grant?.bound.slice(0, 3)).toEqual(['u_owner', 'operator', 'configured-github-owner']);

    // The durable role remains authoritative even if bootstrap config is later
    // removed; this is a grant ledger, not a request-time identity shortcut.
    expect(await fleetOperatorOnly(request(PDU), env(f.db, null))).toMatchObject({ kind: 'account' });
    expect(f.writes.filter((write) => write.sql.includes('UPDATE user_tokens'))).toEqual([]);
    expect(f.writes.filter((write) => write.sql.includes('INSERT INTO user_roles'))).toHaveLength(1);
  });

  it('accepts an existing operator role without matching bootstrap config', async () => {
    const f = fixture({ operatorRole: true });
    expect(await fleetOperatorOnly(request(PDU), env(f.db, '999'))).toMatchObject({
      kind: 'account',
      userId: 'u_owner',
    });
    expect(f.writes.filter((write) => write.sql.includes('INSERT INTO user_roles'))).toEqual([]);
  });

  it('returns 403 for an authenticated account that is not an operator', async () => {
    const f = fixture();
    const response = await fleetOperatorOnly(request(PDU), env(f.db, '999'));
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(f.hasOperatorRole()).toBe(false);
  });

  it('fails closed when the role ledger is unavailable', async () => {
    const f = fixture({ failRoles: true });
    const response = await fleetOperatorOnly(request(PDU), env(f.db));
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ code: 'FLEET_AUTH_UNAVAILABLE' });
  });
});
