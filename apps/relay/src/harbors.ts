/**
 * X2 REMOTE HARBORS v1 — keypair + namespace + membership, nothing more
 * (docs/proposals/relay-grand-plan.md §X2; MVP slice).
 *
 * A remote harbor here is exactly three facts: a NAME in a NAMESPACE, an
 * ed25519 PUBKEY, and a MEMBERSHIP list.
 *
 *   POST /v1/harbors                          create (session/pdu auth)
 *   GET  /v1/harbors                          mine (harbors I belong to)
 *   GET  /v1/harbors/:namespace/:name         detail + members (member-gated)
 *   POST /v1/harbors/:namespace/:name/members add a member (owner-gated)
 *
 * Trust boundaries (grand-plan §X2 doctrine):
 *  - The keypair is generated CLIENT-side; the client supplies only the PUBLIC
 *    key and the relay signs nothing on a harbor's behalf — the relay stays a
 *    phone book, never a key holder.
 *  - The namespace is the creator's GitHub login (server-derived, NEVER
 *    client-supplied), so namespaces cannot be squatted.
 *  - Discovery never grants admission: membership rows do. Non-members get the
 *    same 404 as a nonexistent harbor — no existence oracle.
 *  - harbor_memberships rows are OPERATOR-plane (session/pdu auth) and are NOT
 *    the zero-trust `harbor_members` daemon-admission table the
 *    handshake/publish path gates on (handlers.ts). A row here grants API
 *    visibility only — a session-auth write can never widen the crypto plane.
 *  - Fail semantics: every gate fails closed (unknown → 404, unauthenticated →
 *    401, insufficient role → 403); D1 throws bubble to index.ts's controlled
 *    INTERNAL_ERROR envelope.
 *
 * SHIPPED since v1: single-use invite JTIs + /join with the ADR-0122 §4
 * authority-epoch clock (src/invites.ts; migrations/2026-08-23-harbor-invites)
 * — every membership write now ticks harbors.authority_epoch atomically via
 * db.ts addHarborMembership, so the add-member route below bumps it too.
 *
 * Deferred from the plan (v2+), marked honestly: per-harbor issuer keys at
 * /v1/keys/:harborFp, daemon-to-daemon E2E channel-key distribution, member
 * removal + lazy key rotation, reachability verdicts
 * (possible|degraded|impossible|unknown), and the per-harbor `remote_harbors`
 * mercy verdict (v1 ships only the harbor count on /mercy).
 */

import type { Env } from './types.js';
import { randomHex } from './crypto.js';
import { resolveUserFromRequest } from './device-flow.js';
import { isSameOrigin } from './auth-github.js';
import {
  addHarborMembership,
  createHarbor,
  getHarborByName,
  getHarborRole,
  getIdentity,
  getUserByLogin,
  listHarborMembers,
  listHarborsForUser,
  type HarborMemberListRow,
  type HarborRole,
  type HarborRow,
  type UserRow,
} from './db.js';

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

// 2–64 chars, lowercase dns-label style: [a-z0-9] with interior hyphens.
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
// ed25519 public key: 32 bytes hex. Format-validated only in v1 (see caveats).
const PUBKEY_RE = /^[0-9a-f]{64}$/;

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

function memberJson(m: HarborMemberListRow): Record<string, unknown> {
  return {
    kind: m.member_kind,
    // Users are shown by login (falling back to the opaque id for erased
    // accounts); daemons by fingerprint. Never emails, never tokens.
    member: m.member_kind === 'user' ? (m.login ?? m.member_id) : m.member_id,
    role: m.role,
    addedAt: m.added_at,
  };
}

/**
 * Resolve the request's harbor + the caller's role, applying the member gate.
 * Returns null (already-responded 404) semantics via a discriminated union.
 */
async function resolveMemberGate(
  env: Env,
  user: UserRow,
  namespace: string,
  name: string,
): Promise<{ harbor: HarborRow; role: HarborRole } | null> {
  const harbor = await getHarborByName(env.DB, namespace.toLowerCase(), name.toLowerCase());
  if (!harbor) return null;
  const role = await getHarborRole(env.DB, harbor.id, 'user', user.id);
  if (!role) return null; // non-member: indistinguishable from nonexistent
  return { harbor, role };
}

// ── POST /v1/harbors — create (session/pdu auth) ──────────────────────────────

export async function handleCreateHarbor(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return crossOrigin();
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();

  let body: { name?: unknown; pubkey?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; pubkey?: unknown };
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'JSON body with name and pubkey required' });
  }

  const name = typeof body.name === 'string' ? body.name.trim().toLowerCase() : '';
  if (!NAME_RE.test(name)) {
    return json(400, { code: 'BAD_NAME', error: 'name must be 2–64 chars of [a-z0-9] with interior hyphens' });
  }
  const pubkey = typeof body.pubkey === 'string' ? body.pubkey.trim().toLowerCase() : '';
  if (!PUBKEY_RE.test(pubkey)) {
    return json(400, { code: 'BAD_PUBKEY', error: 'pubkey must be an ed25519 public key as 64 hex chars' });
  }

  // Namespace = the creator's GitHub login, server-derived. Not client input.
  const namespace = user.login.toLowerCase();
  const harbor: HarborRow = {
    id: `h_${randomHex(16)}`,
    namespace,
    name,
    pubkey,
    created_by: user.id,
    created_at: Math.floor(Date.now() / 1000),
    authority_epoch: 1, // ADR-0122 §4 clock; creation with the founding owner is epoch 1
  };
  const res = await createHarbor(env.DB, {
    id: harbor.id,
    namespace,
    name,
    pubkey,
    createdBy: user.id,
    createdAt: harbor.created_at,
  });
  if (res === 'duplicate') {
    return json(409, { code: 'DUPLICATE_NAME', error: `harbor ${namespace}/${name} already exists` });
  }
  return json(201, { code: 'OK', error: null, harbor: harborJson(harbor, 'owner') });
}

// ── GET /v1/harbors — mine ────────────────────────────────────────────────────

export async function handleListMyHarbors(request: Request, env: Env): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const rows = await listHarborsForUser(env.DB, user.id);
  return json(200, {
    code: 'OK',
    error: null,
    harbors: rows.map((h) => harborJson(h, h.role)),
  });
}

// ── GET /v1/harbors/:namespace/:name — detail + members (member-gated) ────────

export async function handleGetHarbor(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const gate = await resolveMemberGate(env, user, namespace, name);
  if (!gate) return harborNotFound();
  const members = await listHarborMembers(env.DB, gate.harbor.id);
  return json(200, {
    code: 'OK',
    error: null,
    harbor: harborJson(gate.harbor, gate.role),
    members: members.map(memberJson),
  });
}

// ── POST /v1/harbors/:namespace/:name/members — add member (owner-gated) ──────

export async function handleAddHarborMember(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
): Promise<Response> {
  if (!isSameOrigin(request, env)) return crossOrigin();
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const gate = await resolveMemberGate(env, user, namespace, name);
  if (!gate) return harborNotFound();
  if (gate.role !== 'owner') {
    return json(403, { code: 'FORBIDDEN', error: 'only a harbor owner may add members' });
  }

  let body: { user?: unknown; daemon?: unknown; role?: unknown };
  try {
    body = (await request.json()) as { user?: unknown; daemon?: unknown; role?: unknown };
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'JSON body with exactly one of user (login) or daemon (fingerprint) required' });
  }

  const hasUser = typeof body.user === 'string' && body.user.trim() !== '';
  const hasDaemon = typeof body.daemon === 'string' && body.daemon.trim() !== '';
  if (hasUser === hasDaemon) {
    return json(400, { code: 'BAD_REQUEST', error: 'exactly one of user (login) or daemon (fingerprint) required' });
  }
  const role = body.role === undefined ? 'member' : body.role;
  if (role !== 'member' && role !== 'owner') {
    return json(400, { code: 'BAD_ROLE', error: "role must be 'member' or 'owner'" });
  }

  let kind: 'user' | 'daemon';
  let memberId: string;
  let memberLabel: string;
  if (hasUser) {
    // The member must already have a relay account — membership rows reference
    // real principals, never free-text names.
    const target = await getUserByLogin(env.DB, (body.user as string).trim());
    if (!target) return json(400, { code: 'UNKNOWN_USER', error: 'no relay account with that GitHub login' });
    kind = 'user';
    memberId = target.id;
    memberLabel = target.login;
  } else {
    // Daemon members must be registered, unrevoked identities — fail closed on
    // anything the identity registry does not vouch for.
    const fp = (body.daemon as string).trim().toLowerCase();
    const identity = await getIdentity(env.DB, fp);
    if (!identity || identity.revoked) {
      return json(400, { code: 'UNKNOWN_DAEMON', error: 'no registered, unrevoked daemon identity with that fingerprint' });
    }
    kind = 'daemon';
    memberId = fp;
    memberLabel = fp;
  }

  const addedAt = Math.floor(Date.now() / 1000);
  const res = await addHarborMembership(env.DB, {
    harborId: gate.harbor.id,
    kind,
    memberId,
    role,
    addedAt,
    addedBy: user.id,
  });
  if (res === 'duplicate') {
    return json(409, { code: 'ALREADY_MEMBER', error: 'that principal is already a member of this harbor' });
  }
  return json(201, {
    code: 'OK',
    error: null,
    member: { kind, member: memberLabel, role, addedAt },
  });
}
