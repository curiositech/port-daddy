/**
 * X4 PARLEY v1 — signed multi-party agreements over harbors
 * (docs/proposals/relay-grand-plan.md §X4; MVP slice, built on X2 harbors).
 *
 * A parley is an ARTIFACT: a harbor, a subject, a proposer, a hard deadline,
 * and named parties who each sign exactly one position. State machine:
 *
 *   open ──(every named party signs 'accept')──► agreed     (terminal)
 *   open ──(any named party signs 'reject')────► lapsed     (terminal)
 *   open ──(deadline passes, checked lazily)───► lapsed     (terminal)
 *
 *   POST /v1/harbors/:ns/:name/parleys              convene (member-gated)
 *   GET  /v1/harbors/:ns/:name/parleys              list (member-gated)
 *   GET  /v1/harbors/:ns/:name/parleys/:id          detail + positions (member-gated)
 *   POST /v1/harbors/:ns/:name/parleys/:id/respond  sign a position (named-party-gated)
 *
 * Trust boundaries (grand-plan §X4 doctrine):
 *  - The relay ORDERS AND ATTESTS; it never judges. A parley artifact records
 *    who signed what and when — enforcement (merge gates, check runs) stays
 *    with daemons/CI. Nothing here can stop a human from coding.
 *  - All routes are operator-plane (session/pdu auth) and member-gated with
 *    X2's no-existence-oracle rule: unknown harbor/parley and not-a-member
 *    are the same 404. Browser writes require same-origin (CSRF).
 *  - Positions enter only via authenticated principals: a user signs as
 *    themselves; a daemon party's position is VOUCHED by an authenticated
 *    member operator (X3's presence idiom) and the daemon must be a
 *    registered, unrevoked identity. No bearer path, no free-text identities.
 *  - IMMUTABILITY: agreed and lapsed are terminal — no route writes to a
 *    non-open parley (CAS on state='open'), and a signed position is
 *    write-once (CAS on signed_at IS NULL). Signatures are never edited.
 *  - LIVENESS: expiry is checked lazily on every list/detail/respond (no
 *    per-parley timer) — parley is never a liveness hole.
 *  - MEDIATOR: the identity 'pd-mediator' is RESERVED. Every parley carries a
 *    tier-labeled pd-mediator observer seat in parley_positions, but v1 gives
 *    it NO auto-behavior and it can never sign or be named as a party — the
 *    plan gates the mediator's real body (executor + harbor card) behind N2.
 *  - Fail semantics: every gate fails closed (unknown → 404, unauthenticated
 *    → 401, insufficient role → 403, bad shapes → 400, closed/duplicate →
 *    409); D1 throws bubble to index.ts's controlled INTERNAL_ERROR envelope.
 *
 * Deferred from the plan (v2+), marked honestly:
 *  - turns on `parley:<id>` channels, agent-first summons + daemon
 *    refuse/escalate (D11), and delivery-acknowledged summonses;
 *  - the human gate (Approve/Modify/Reject with Modify re-injection) before
 *    irreversible actions, and Helm-configured default outcomes on expiry
 *    (v1 expiry is a plain lapse — the artifact records that no agreement
 *    was reached);
 *  - the mediator's real body: conflict prediction, neutral check runs,
 *    auto-convening at ≥0.7 confidence, `kill-mediator` flag;
 *  - parley receipts as merge currency (receipt_sig, check-run attachment);
 *  - Mercy summons-ack SLO + parley-fatigue metric (v1 ships only the open
 *    parley count on /mercy, fail-safe null).
 */

import type { Env } from './types.js';
import { randomHex } from './crypto.js';
import { resolveUserFromRequest } from './device-flow.js';
import { isSameOrigin } from './auth-github.js';
import {
  countUnacceptedParties,
  createParley,
  getHarborByName,
  getHarborRole,
  getIdentity,
  getParley,
  getUserByLogin,
  lapseExpiredParleys,
  listParleyPositions,
  listParleys,
  resolveParleyState,
  signParleyPosition,
  type HarborRole,
  type HarborRow,
  type ParleyPartySeed,
  type ParleyPositionRow,
  type ParleyRow,
  type UserRow,
} from './db.js';

// ── Policy constants ──────────────────────────────────────────────────────────

/** Deadlines default 24h (grand-plan §X4) and are bounded 1h..7d in v1. */
export const DEFAULT_PARLEY_DEADLINE_HOURS = 24;
export const MIN_PARLEY_DEADLINE_HOURS = 1;
export const MAX_PARLEY_DEADLINE_HOURS = 168;
/** A parley is a conversation between a handful of parties, not a congress. */
const MAX_PARTIES = 10;
const MAX_SUBJECT_CHARS = 500;
const MAX_POSITION_CHARS = 2000;
/** Reserved mediator identity: present in positions, tier-labeled, NO body yet. */
export const MEDIATOR_ID = 'pd-mediator';
export const MEDIATOR_TIER = 'mediator';

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
/** Unknown parley (or one from another harbor) — same shape, no oracle. */
const parleyNotFound = () => json(404, { code: 'NOT_FOUND', error: 'no such parley' });

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

// ── Serialization ─────────────────────────────────────────────────────────────

function parleyJson(p: ParleyRow): Record<string, unknown> {
  return {
    id: p.id,
    subject: p.subject,
    proposer: p.proposer_label,
    state: p.state,
    deadlineAt: p.deadline_at,
    createdAt: p.created_at,
    resolvedAt: p.resolved_at,
  };
}

function positionJson(pos: ParleyPositionRow): Record<string, unknown> {
  return {
    kind: pos.party_kind,
    party: pos.party_label,
    tier: pos.tier,
    named: pos.is_party === 1,
    stance: pos.stance,
    position: pos.position,
    signedAt: pos.signed_at,
  };
}

// ── Party resolution (convene-time) ───────────────────────────────────────────

/**
 * Resolve one `{user: login}` | `{daemon: fingerprint}` spec to a verified
 * harbor-member party seed. Returns a string error (→ 400) when the spec is
 * malformed, reserved, unregistered, or not a member of this harbor.
 */
async function resolvePartySpec(
  env: Env,
  harborId: string,
  spec: unknown,
): Promise<ParleyPartySeed | string> {
  if (typeof spec !== 'object' || spec === null) return 'each party must be { user: login } or { daemon: fingerprint }';
  const s = spec as { user?: unknown; daemon?: unknown };
  const hasUser = typeof s.user === 'string' && s.user.trim() !== '';
  const hasDaemon = typeof s.daemon === 'string' && s.daemon.trim() !== '';
  if (hasUser === hasDaemon) return 'each party must name exactly one of user (login) or daemon (fingerprint)';

  if (hasUser) {
    const login = (s.user as string).trim();
    // The mediator identity is reserved: it holds an observer seat on every
    // parley but can never be a NAMED party (it has no body to sign with yet).
    if (login.toLowerCase() === MEDIATOR_ID) return `'${MEDIATOR_ID}' is a reserved identity and cannot be named as a party`;
    const target = await getUserByLogin(env.DB, login);
    if (!target) return `no relay account with login '${login}'`;
    const role = await getHarborRole(env.DB, harborId, 'user', target.id);
    if (!role) return `user '${target.login}' is not a member of this harbor`;
    return { kind: 'user', id: target.id, label: target.login, tier: 'human', isParty: true };
  }

  const fp = (s.daemon as string).trim().toLowerCase();
  const identity = await getIdentity(env.DB, fp);
  if (!identity || identity.revoked) return 'no registered, unrevoked daemon identity with that fingerprint';
  const role = await getHarborRole(env.DB, harborId, 'daemon', fp);
  if (!role) return `daemon '${fp}' is not a member of this harbor`;
  return { kind: 'daemon', id: fp, label: fp, tier: identity.proof_method, isParty: true };
}

// ── POST /v1/harbors/:ns/:name/parleys — convene (member-gated) ──────────────

export async function handleCreateParley(
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

  let body: { subject?: unknown; parties?: unknown; deadlineHours?: unknown };
  try {
    body = (await request.json()) as { subject?: unknown; parties?: unknown; deadlineHours?: unknown };
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'JSON body with subject and parties[] required' });
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (subject === '' || subject.length > MAX_SUBJECT_CHARS) {
    return json(400, { code: 'BAD_SUBJECT', error: `subject must be 1–${MAX_SUBJECT_CHARS} chars` });
  }

  let deadlineHours = DEFAULT_PARLEY_DEADLINE_HOURS;
  if (body.deadlineHours !== undefined) {
    if (
      typeof body.deadlineHours !== 'number' ||
      !Number.isFinite(body.deadlineHours) ||
      body.deadlineHours < MIN_PARLEY_DEADLINE_HOURS ||
      body.deadlineHours > MAX_PARLEY_DEADLINE_HOURS
    ) {
      return json(400, {
        code: 'BAD_DEADLINE',
        error: `deadlineHours must be a number between ${MIN_PARLEY_DEADLINE_HOURS} and ${MAX_PARLEY_DEADLINE_HOURS}`,
      });
    }
    deadlineHours = body.deadlineHours;
  }

  if (!Array.isArray(body.parties) || body.parties.length === 0) {
    return json(400, { code: 'BAD_PARTIES', error: 'parties must be a non-empty array of { user } | { daemon } specs' });
  }

  // The proposer is ALWAYS a named party — a parley they need not sign would
  // let them bind others to an "agreement" they never entered themselves.
  const parties: ParleyPartySeed[] = [
    { kind: 'user', id: user.id, label: user.login, tier: 'human', isParty: true },
  ];
  const seen = new Set<string>([`user:${user.id}`]);
  for (const spec of body.parties) {
    const p = await resolvePartySpec(env, gate.harbor.id, spec);
    if (typeof p === 'string') return json(400, { code: 'BAD_PARTIES', error: p });
    const key = `${p.kind}:${p.id}`;
    if (seen.has(key)) continue; // naming the proposer or a duplicate is a no-op, not an error
    seen.add(key);
    parties.push(p);
  }
  if (parties.length < 2) {
    return json(400, { code: 'BAD_PARTIES', error: 'a parley needs at least one named party besides the proposer' });
  }
  if (parties.length > MAX_PARTIES) {
    return json(400, { code: 'BAD_PARTIES', error: `parleys are capped at ${MAX_PARTIES} named parties` });
  }
  // Reserved mediator seat: tier-labeled, observer-only, NO auto-behavior in
  // v1 (is_party=0 — its accept is never required and it can never sign).
  parties.push({ kind: 'mediator', id: MEDIATOR_ID, label: MEDIATOR_ID, tier: MEDIATOR_TIER, isParty: false });

  const now = Math.floor(Date.now() / 1000);
  const parley: ParleyRow = {
    id: `p_${randomHex(16)}`,
    harbor_id: gate.harbor.id,
    subject,
    proposer_id: user.id,
    proposer_label: user.login,
    state: 'open',
    deadline_at: now + Math.round(deadlineHours * 3600),
    created_at: now,
    resolved_at: null,
  };
  await createParley(env.DB, {
    id: parley.id,
    harborId: parley.harbor_id,
    subject,
    proposerId: user.id,
    proposerLabel: user.login,
    deadlineAt: parley.deadline_at,
    createdAt: now,
    parties,
  });

  const positions = await listParleyPositions(env.DB, parley.id);
  return json(201, {
    code: 'OK',
    error: null,
    parley: parleyJson(parley),
    positions: positions.map(positionJson),
  });
}

// ── GET /v1/harbors/:ns/:name/parleys — list (member-gated) ──────────────────

export async function handleListParleys(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const gate = await resolveMemberGate(env, user, namespace, name);
  if (!gate) return harborNotFound();

  const now = Math.floor(Date.now() / 1000);
  // Lazy expiry: every expired open parley lapses before we serve the list —
  // a deadline that has passed is never rendered as still-open.
  await lapseExpiredParleys(env.DB, gate.harbor.id, now);
  const rows = await listParleys(env.DB, gate.harbor.id);
  return json(200, { code: 'OK', error: null, parleys: rows.map(parleyJson) });
}

// ── Parley gate: harbor member gate + parley-belongs-to-harbor + lazy expiry ──

async function resolveParleyGate(
  env: Env,
  user: UserRow,
  namespace: string,
  name: string,
  parleyId: string,
  now: number,
): Promise<{ harbor: HarborRow; role: HarborRole; parley: ParleyRow } | Response> {
  const gate = await resolveMemberGate(env, user, namespace, name);
  if (!gate) return harborNotFound();
  let parley = await getParley(env.DB, parleyId);
  // A parley reached through the wrong harbor path is a 404, not a leak.
  if (!parley || parley.harbor_id !== gate.harbor.id) return parleyNotFound();
  if (parley.state === 'open' && parley.deadline_at < now) {
    await resolveParleyState(env.DB, { parleyId: parley.id, state: 'lapsed', at: now });
    parley = (await getParley(env.DB, parleyId)) ?? parley;
  }
  return { harbor: gate.harbor, role: gate.role, parley };
}

// ── GET /v1/harbors/:ns/:name/parleys/:id — detail (member-gated) ─────────────

export async function handleGetParley(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
  parleyId: string,
): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const now = Math.floor(Date.now() / 1000);
  const gate = await resolveParleyGate(env, user, namespace, name, parleyId, now);
  if (gate instanceof Response) return gate;

  const positions = await listParleyPositions(env.DB, gate.parley.id);
  return json(200, {
    code: 'OK',
    error: null,
    parley: parleyJson(gate.parley),
    positions: positions.map(positionJson),
  });
}

// ── POST /v1/harbors/:ns/:name/parleys/:id/respond — sign (party-gated) ───────

export async function handleRespondParley(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
  parleyId: string,
): Promise<Response> {
  if (!isSameOrigin(request, env)) return crossOrigin();
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const now = Math.floor(Date.now() / 1000);
  const gate = await resolveParleyGate(env, user, namespace, name, parleyId, now);
  if (gate instanceof Response) return gate;

  let body: { stance?: unknown; position?: unknown; daemon?: unknown };
  try {
    body = (await request.json()) as { stance?: unknown; position?: unknown; daemon?: unknown };
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: "JSON body with stance ('accept'|'reject'), optional position text, optional daemon fingerprint required" });
  }

  const stance = body.stance;
  if (stance !== 'accept' && stance !== 'reject') {
    return json(400, { code: 'BAD_STANCE', error: "stance must be 'accept' or 'reject'" });
  }
  let position: string | null = null;
  if (body.position !== undefined) {
    if (typeof body.position !== 'string' || body.position.length > MAX_POSITION_CHARS) {
      return json(400, { code: 'BAD_POSITION', error: `position must be a string of at most ${MAX_POSITION_CHARS} chars` });
    }
    position = body.position.trim() === '' ? null : body.position.trim();
  }

  // Whose seat is being signed? A user signs as themselves; a daemon seat is
  // vouched by an authenticated member operator (X3 presence idiom) and the
  // daemon must be a registered, unrevoked identity — fail closed.
  let kind: 'user' | 'daemon';
  let partyId: string;
  let partyLabel: string;
  if (body.daemon !== undefined) {
    if (typeof body.daemon !== 'string' || body.daemon.trim() === '') {
      return json(400, { code: 'BAD_REQUEST', error: 'daemon must be a fingerprint string' });
    }
    const fp = body.daemon.trim().toLowerCase();
    const identity = await getIdentity(env.DB, fp);
    if (!identity || identity.revoked) {
      return json(400, { code: 'UNKNOWN_DAEMON', error: 'no registered, unrevoked daemon identity with that fingerprint' });
    }
    kind = 'daemon';
    partyId = fp;
    partyLabel = fp;
  } else {
    kind = 'user';
    partyId = user.id;
    partyLabel = user.login;
  }

  // Immutability: agreed and lapsed are terminal.
  if (gate.parley.state !== 'open') {
    return json(409, {
      code: 'PARLEY_CLOSED',
      error: `this parley is ${gate.parley.state} and immutable — no further positions can be signed`,
    });
  }

  // Named-party gate: only a seat created at convene time can be signed.
  const positions = await listParleyPositions(env.DB, gate.parley.id);
  const seat = positions.find((p) => p.party_kind === kind && p.party_id === partyId);
  if (!seat || seat.is_party !== 1) {
    return json(403, { code: 'NOT_A_PARTY', error: 'you are not a named party of this parley' });
  }
  if (seat.signed_at !== null) {
    return json(409, { code: 'ALREADY_SIGNED', error: 'this party has already signed a position — signatures are write-once' });
  }

  const signed = await signParleyPosition(env.DB, {
    parleyId: gate.parley.id,
    kind,
    partyId,
    stance,
    position,
    signedAt: now,
  });
  if (!signed) {
    // A concurrent signer won the write-once CAS between our read and write.
    return json(409, { code: 'ALREADY_SIGNED', error: 'this party has already signed a position — signatures are write-once' });
  }

  // State machine: any reject closes the parley (agreement is now impossible
  // and positions are write-once — an open-but-doomed parley would be a
  // zombie); all named parties accepted ⇒ agreed. Both CAS on state='open'.
  if (stance === 'reject') {
    await resolveParleyState(env.DB, { parleyId: gate.parley.id, state: 'lapsed', at: now });
  } else {
    const unaccepted = await countUnacceptedParties(env.DB, gate.parley.id);
    if (unaccepted === 0) {
      await resolveParleyState(env.DB, { parleyId: gate.parley.id, state: 'agreed', at: now });
    }
  }

  const after = (await getParley(env.DB, gate.parley.id)) ?? gate.parley;
  return json(200, {
    code: 'OK',
    error: null,
    parley: parleyJson(after),
    signed: { kind, party: partyLabel, stance, position, signedAt: now },
  });
}
