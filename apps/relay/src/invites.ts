/**
 * X2 REMOTE HARBORS — single-use invites + join
 * (lifts the v1 deferral named in src/harbors.ts: "signed single-use invite
 * JTIs + /join"; epoch clock per docs/adr/0122-harbor-authority.md §4).
 *
 * An invite is exactly four facts: a single-use JTI, a HARBOR, an INVITER,
 * and a hard EXPIRY. Redeeming one records a membership and ticks the
 * harbor's authority-epoch clock.
 *
 *   POST /v1/harbors/:ns/:name/invites              mint (member-gated)
 *   GET  /v1/harbors/:ns/:name/invites              list (member-gated)
 *   POST /v1/harbors/:ns/:name/invites/:jti/revoke  revoke (inviter-or-owner)
 *   POST /v1/harbors/:ns/:name/join                 redeem an invite (any authed user)
 *
 * Trust boundaries (grand-plan §X2 doctrine + ADR-0122):
 *  - NO KEY MATERIAL, either direction. An invite body carries a bearer
 *    token and the harbor's name — never a pubkey, privkey, or channel key.
 *    Admission to the phone book is not key distribution; keys move
 *    daemon-to-daemon. The relay stays a phone book, never a key holder.
 *  - SINGLE-USE BY CAS. Consume is one UPDATE gated on `consumed_at IS NULL`
 *    (db.ts consumeHarborInvite) — under two concurrent redeems exactly one
 *    wins and the loser is indistinguishable from a holder of no invite.
 *    Never read-then-write.
 *  - BOUNDED AND REVOCABLE (invariant I3). Every invite carries a mandatory
 *    expiry (default 72h, max 7d) and can be revoked by its inviter or any
 *    owner while still unredeemed. The store keeps only the token's SHA-256
 *    hash, so a D1 dump yields no redeemable invites.
 *  - NEVER WIDENS (invariant I4). An invite grants exactly plain 'member'
 *    role — CHECK-pinned in the migration, not just here. A member can mint
 *    (inviting is the point of membership); only ownership grants more, and
 *    ownership never arrives by invite.
 *  - NO EXISTENCE ORACLE, extended to join: to an invalid invite holder,
 *    "harbor does not exist", "no such invite", "expired", "revoked", and
 *    "already consumed by someone else" are ONE byte-identical 404. The
 *    member-gated mint/list/revoke routes keep X2's original rule (unknown
 *    harbor and not-a-member answer identically).
 *  - IDEMPOTENT JOIN. A replay of a successful join by the SAME member
 *    (consumed_by = caller) answers 200 with the standing membership and
 *    does NOT tick the epoch again; it also repairs the crash window where
 *    the consume landed but the membership write did not.
 *  - EPOCH CLOCK, NOT AUTHORITY (ADR-0122 §2–4). A successful join ticks
 *    harbors.authority_epoch atomically with the membership INSERT — the
 *    membership-change counter of the registry the relay already owns. The
 *    relay still signs nothing, grants no writer lease, and authors no
 *    authority record; the signed record stays with the owning daemon.
 *  - Fail semantics: every gate fails closed (unknown → 404, unauthenticated
 *    → 401, insufficient role → 403, bad shapes → 400, closed invite → 409);
 *    D1 throws bubble to index.ts's controlled INTERNAL_ERROR envelope.
 */

import type { Env } from './types.js';
import { hashHex, randomHex } from './crypto.js';
import { resolveUserFromRequest } from './device-flow.js';
import { isSameOrigin } from './auth-github.js';
import { resolveHarborMembership } from './parleys.js';
import {
  addHarborMembership,
  consumeHarborInvite,
  createHarborInvite,
  getHarborByName,
  getHarborInviteByJti,
  getHarborInviteByTokenHash,
  getHarborRole,
  listHarborInvites,
  revokeHarborInvite,
  type HarborInviteListRow,
  type HarborRole,
  type HarborRow,
  type UserRow,
} from './db.js';

// ── Policy constants ──────────────────────────────────────────────────────────

/** Invites default to 72h and are bounded 1h..7d (same ceiling as parleys). */
export const DEFAULT_INVITE_TTL_HOURS = 72;
export const MIN_INVITE_TTL_HOURS = 1;
export const MAX_INVITE_TTL_HOURS = 168;

/** Bearer token shape: 'pdi_' + 32 random bytes hex. Returned once, stored only hashed. */
const INVITE_TOKEN_BYTES = 32;
const INVITE_TOKEN_PREFIX = 'pdi_';

// ── Shared response helpers (same envelope as src/harbors.ts) ─────────────────

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const unauthenticated = () => json(401, { code: 'UNAUTHENTICATED', error: 'sign in (session cookie or pdu_ bearer token) required' });
const crossOrigin = () => json(403, { code: 'CROSS_ORIGIN', error: 'cross-origin request refused' });
/** Unknown harbor and not-a-member are the SAME response — no existence oracle. */
const harborNotFound = () => json(404, { code: 'NOT_FOUND', error: 'no such harbor' });
/**
 * The join route's ONLY negative answer. Nonexistent harbor, nonexistent
 * invite, expired, revoked, and consumed-by-another-holder all produce this
 * exact body: an invalid invite holder learns nothing — not even whether the
 * harbor they are knocking on exists.
 */
const inviteNotFound = () => json(404, { code: 'NOT_FOUND', error: 'no such invite' });

// ── JSON shapes ───────────────────────────────────────────────────────────────

function harborJson(h: HarborRow, role: HarborRole): Record<string, unknown> {
  return {
    id: h.id,
    namespace: h.namespace,
    name: h.name,
    pubkey: h.pubkey,
    createdAt: h.created_at,
    authorityEpoch: h.authority_epoch,
    role,
  };
}

function inviteStatus(i: HarborInviteListRow, now: number): 'pending' | 'consumed' | 'revoked' | 'expired' {
  if (i.consumed_at !== null) return 'consumed';
  if (i.revoked_at !== null) return 'revoked';
  if (i.expires_at <= now) return 'expired';
  return 'pending';
}

/** List entry: JTI + lifecycle only. Never the token, never its hash. */
function inviteJson(i: HarborInviteListRow, now: number): Record<string, unknown> {
  return {
    jti: i.jti,
    inviter: i.inviter_login ?? i.invited_by,
    role: i.role,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
    status: inviteStatus(i, now),
    consumedAt: i.consumed_at,
    revokedAt: i.revoked_at,
  };
}

// ── POST /v1/harbors/:ns/:name/invites — mint (member-gated) ──────────────────

export async function handleMintHarborInvite(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
): Promise<Response> {
  if (!isSameOrigin(request, env)) return crossOrigin();
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const gate = await resolveHarborMembership(env, user, namespace, name);
  if (!gate) return harborNotFound();
  // Any member may mint (inviting is the point of membership); the invite can
  // only ever grant plain 'member', so minting never widens rights (I4).

  let ttlHours = DEFAULT_INVITE_TTL_HOURS;
  const raw = await request.text();
  if (raw !== '') {
    let body: { ttlHours?: unknown };
    try {
      body = JSON.parse(raw) as { ttlHours?: unknown };
    } catch {
      return json(400, { code: 'BAD_REQUEST', error: 'body must be JSON ({ ttlHours? }) or empty' });
    }
    if (body.ttlHours !== undefined) {
      if (typeof body.ttlHours !== 'number' || !Number.isFinite(body.ttlHours)) {
        return json(400, { code: 'BAD_TTL', error: 'ttlHours must be a number' });
      }
      if (body.ttlHours < MIN_INVITE_TTL_HOURS || body.ttlHours > MAX_INVITE_TTL_HOURS) {
        return json(400, {
          code: 'BAD_TTL',
          error: `ttlHours must be between ${MIN_INVITE_TTL_HOURS} and ${MAX_INVITE_TTL_HOURS}`,
        });
      }
      ttlHours = body.ttlHours;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + Math.round(ttlHours * 3600);
  const jti = `hi_${randomHex(16)}`;
  // The bearer token exists in exactly two places, ever: this response and
  // the redeeming request. The store keeps only its hash.
  const token = `${INVITE_TOKEN_PREFIX}${randomHex(INVITE_TOKEN_BYTES)}`;
  await createHarborInvite(env.DB, {
    jti,
    harborId: gate.harbor.id,
    tokenHash: hashHex(token),
    invitedBy: user.id,
    createdAt: now,
    expiresAt,
  });
  return json(201, {
    code: 'OK',
    error: null,
    invite: {
      jti,
      token, // shown once; not recoverable from the relay afterwards
      harbor: `${gate.harbor.namespace}/${gate.harbor.name}`,
      role: 'member',
      createdAt: now,
      expiresAt,
    },
  });
}

// ── GET /v1/harbors/:ns/:name/invites — list (member-gated) ───────────────────

export async function handleListHarborInvites(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const gate = await resolveHarborMembership(env, user, namespace, name);
  if (!gate) return harborNotFound();
  const now = Math.floor(Date.now() / 1000);
  const invites = await listHarborInvites(env.DB, gate.harbor.id);
  return json(200, { code: 'OK', error: null, invites: invites.map((i) => inviteJson(i, now)) });
}

// ── POST /v1/harbors/:ns/:name/invites/:jti/revoke — inviter-or-owner ─────────

export async function handleRevokeHarborInvite(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
  jti: string,
): Promise<Response> {
  if (!isSameOrigin(request, env)) return crossOrigin();
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const gate = await resolveHarborMembership(env, user, namespace, name);
  if (!gate) return harborNotFound();

  const invite = await getHarborInviteByJti(env.DB, gate.harbor.id, jti);
  if (!invite) return json(404, { code: 'NOT_FOUND', error: 'no such invite' });
  if (invite.invited_by !== user.id && gate.role !== 'owner') {
    return json(403, { code: 'FORBIDDEN', error: 'only the inviter or a harbor owner may revoke an invite' });
  }

  const now = Math.floor(Date.now() / 1000);
  const revoked = await revokeHarborInvite(env.DB, {
    harborId: gate.harbor.id,
    jti,
    revokedBy: user.id,
    now,
  });
  if (revoked) {
    return json(200, { code: 'OK', error: null, jti, revokedAt: now });
  }
  // The CAS refused: the invite is already closed. Re-read to say which way —
  // this surface is member-gated, so naming the state leaks nothing.
  const after = await getHarborInviteByJti(env.DB, gate.harbor.id, jti);
  if (after?.consumed_at != null) {
    return json(409, {
      code: 'ALREADY_CONSUMED',
      error: 'invite was already redeemed — revoking it cannot undo the membership; remove the member instead',
    });
  }
  // Already revoked: the desired end state stands. Idempotent success.
  return json(200, { code: 'OK', error: null, jti, revokedAt: after?.revoked_at ?? now });
}

// ── POST /v1/harbors/:ns/:name/join — redeem an invite ────────────────────────

/**
 * Record the membership + epoch tick for a redeemed invite, and resolve the
 * caller's standing role. 'duplicate' from addHarborMembership means the
 * caller was already a member — the batch rolled back, so the epoch did NOT
 * tick (the clock counts membership CHANGES, not join calls).
 */
async function recordJoin(
  env: Env,
  harbor: HarborRow,
  user: UserRow,
  now: number,
): Promise<{ inserted: boolean; role: HarborRole }> {
  const res = await addHarborMembership(env.DB, {
    harborId: harbor.id,
    kind: 'user',
    memberId: user.id,
    role: 'member', // invites grant exactly this (I4); never 'owner'
    addedAt: now,
    addedBy: user.id,
  });
  if (res === 'ok') return { inserted: true, role: 'member' };
  const role = await getHarborRole(env.DB, harbor.id, 'user', user.id);
  return { inserted: false, role: role ?? 'member' };
}

export async function handleJoinHarbor(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
): Promise<Response> {
  if (!isSameOrigin(request, env)) return crossOrigin();
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();

  // Shape errors are 400 (they precede any harbor lookup, so they leak
  // nothing); every failure AFTER this point is the one byte-identical 404.
  let body: { token?: unknown };
  try {
    body = (await request.json()) as { token?: unknown };
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'JSON body with token required' });
  }
  if (typeof body.token !== 'string' || body.token === '') {
    return json(400, { code: 'BAD_REQUEST', error: 'JSON body with token required' });
  }

  const harbor = await getHarborByName(env.DB, namespace.toLowerCase(), name.toLowerCase());
  if (!harbor) return inviteNotFound(); // NOT harborNotFound: identical to a bad token on a real harbor

  const tokenHash = hashHex(body.token);
  const now = Math.floor(Date.now() / 1000);

  // THE compare-and-swap: one UPDATE decides the winner (I3, single-use).
  const won = await consumeHarborInvite(env.DB, {
    harborId: harbor.id,
    tokenHash,
    userId: user.id,
    now,
  });

  if (!won) {
    // Losing the CAS is terminal for everyone EXCEPT the member who already
    // won it: a replay by the consumer is idempotent. All other causes —
    // nonexistent, expired, revoked, consumed by someone else — answer
    // byte-identically with the nonexistent-harbor case above.
    const invite = await getHarborInviteByTokenHash(env.DB, harbor.id, tokenHash);
    if (!invite || invite.consumed_by !== user.id) return inviteNotFound();
    const standingRole = await getHarborRole(env.DB, harbor.id, 'user', user.id);
    if (standingRole) {
      // The normal replay: membership stands, nothing changes, no epoch tick.
      const fresh = (await getHarborByName(env.DB, harbor.namespace, harbor.name)) ?? harbor;
      return json(200, { code: 'OK', error: null, joined: false, harbor: harborJson(fresh, standingRole) });
    }
    // Consumed by this caller but no membership: the crash window between
    // consume and membership write. Repair it — but only while the invite is
    // still unexpired, so a spent invite can never serve as an indefinite
    // re-admission token (e.g. after a future member removal).
    if (invite.expires_at <= now) return inviteNotFound();
    const repaired = await recordJoin(env, harbor, user, now);
    const fresh = (await getHarborByName(env.DB, harbor.namespace, harbor.name)) ?? harbor;
    return json(repaired.inserted ? 201 : 200, {
      code: 'OK',
      error: null,
      joined: repaired.inserted,
      harbor: harborJson(fresh, repaired.role),
    });
  }

  const joined = await recordJoin(env, harbor, user, now);
  // Re-read for the authoritative post-join epoch (another membership write
  // may have raced; the row is the truth, not local arithmetic).
  const fresh = (await getHarborByName(env.DB, harbor.namespace, harbor.name)) ?? harbor;
  if (!joined.inserted) {
    // Already a member (e.g. an owner redeemed an invite to their own
    // harbor): the invite is spent, but no membership changed and no epoch
    // ticked. Idempotent-shaped 200, honest joined:false.
    return json(200, { code: 'OK', error: null, joined: false, harbor: harborJson(fresh, joined.role) });
  }
  return json(201, { code: 'OK', error: null, joined: true, harbor: harborJson(fresh, joined.role) });
}
