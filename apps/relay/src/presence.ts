/**
 * X3 PRESENCE + HELM v1 — presence first, the Helm without ballots
 * (docs/proposals/relay-grand-plan.md §X3, decisions D5 + D6; MVP slice).
 *
 * Presence: per-harbor "who's in the water" roster held in the HarborChannel
 * Durable Object (src/harbor-channel.ts) — hot data with a ~90s TTL, never D1.
 *
 *   POST /v1/harbors/:namespace/:name/presence   heartbeat (member-gated)
 *   GET  /v1/harbors/:namespace/:name/presence   who is online (member-gated)
 *
 * Helm: one explicit authority record per harbor in D1 — the holder plus an
 * ORDERED succession list, owner-set. **No voting machinery, anywhere, ever**
 * (grand-plan D6): the helm changes only by an owner's PUT or by the dead-man
 * rule below.
 *
 *   PUT  /v1/harbors/:namespace/:name/helm       set holder + succession (owner-gated)
 *   GET  /v1/harbors/:namespace/:name/helm       read helm (member-gated; runs dead-man)
 *
 * Dead-man rule (checked lazily ON READ — the relay has no per-harbor timer):
 * if the holder's presence has been expired for longer than the grace period
 * (measured from the LATER of their last heartbeat and the helm's own
 * updated_at, so a freshly set helm always gets a full window), the helm
 * passes to the first successor who is PRESENT right now. No present
 * successor ⇒ the helm goes vacant AND flagged. Every transition is recorded
 * as a helm_events audit row — a helm NEVER changes silently.
 *
 * Trust boundaries (grand-plan §X3 doctrine):
 *  - The relay orders and attests; the daemon enforces. Presence and the Helm
 *    are ADVISORY coordination surfaces — nothing here can stop a human from
 *    coding, only from coordinating rudely.
 *  - All routes are operator-plane (session/pdu auth) and member-gated with
 *    the X2 no-existence-oracle rule: unknown harbor and not-a-member are the
 *    same 404. Browser writes require same-origin (CSRF).
 *  - Daemon presence in v1 is VOUCHED by an authenticated member operator
 *    (their tooling beats on the daemon's behalf, and the daemon must itself
 *    be a registered, unrevoked identity AND a harbor member). The daemon's
 *    own zero-trust chained-publish path is NOT widened by any of this.
 *  - Fail semantics: every gate fails closed (unknown → 404, unauthenticated
 *    → 401, insufficient role → 403, bad shapes → 400); D1/DO throws bubble
 *    to index.ts's controlled INTERNAL_ERROR envelope. The dead-man write is
 *    CAS-guarded by helm seq, so concurrent readers elect exactly one winner.
 *
 * Deferred from the plan (v2+), marked honestly:
 *  - the claims feed (worktree-watch soft claims, `pd guard check` lookup) and
 *    its ADR-0101 widensScope consent screen;
 *  - stage-2 enforcement (WARN → acknowledge → helm-configurable blocking);
 *  - repo-scoped `repo_helm` with GitHub-ADMIN bootstrap verification — v1's
 *    helm is HARBOR-scoped and rides X2's owner role instead;
 *  - the plan's officers-quorum temporary helm: this slice replaces it with
 *    the owner-set ordered succession list per D6's no-ballots doctrine;
 *  - Mercy stale-helm `warn` signal + contention golden signals;
 *  - export/delete integration for helm rows (X3's GDPR shipping criterion).
 */

import type { Env } from './types.js';
import { harborChannelKey, type PresenceEntry } from './harbor-channel.js';
import { resolveUserFromRequest } from './device-flow.js';
import { isSameOrigin } from './auth-github.js';
import {
  applyHelmTransition,
  getHarborByName,
  getHarborRole,
  getHelm,
  getIdentity,
  getUserByLogin,
  insertHelmEvent,
  listHelmEvents,
  setHelm,
  type HarborRole,
  type HarborRow,
  type HelmPrincipal,
  type HelmRow,
  type UserRow,
} from './db.js';

// ── Policy constants ──────────────────────────────────────────────────────────

/** A principal is "online" while their last heartbeat is at most this old. */
export const PRESENCE_TTL_SECONDS = 90;
/** Dead-man grace: the helm passes only once the holder's presence has been
 *  EXPIRED for longer than this (i.e. silent > TTL + grace in total). */
export const HELM_GRACE_SECONDS = 120;
/** Succession lists are short by design — an ordered handful, not a ballot. */
const MAX_SUCCESSORS = 10;

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

// ── Presence roster access (HarborChannel DO, channel 'presence') ─────────────

function presenceStub(env: Env, harborId: string): DurableObjectStub {
  const doId = env.HARBOR_CHANNEL.idFromName(harborChannelKey(harborId, 'presence'));
  return env.HARBOR_CHANNEL.get(doId);
}

async function recordBeat(env: Env, harborId: string, entry: PresenceEntry): Promise<void> {
  await presenceStub(env, harborId).fetch('http://do/?action=presence-beat', {
    method: 'POST',
    body: JSON.stringify(entry),
  });
}

async function listPresence(env: Env, harborId: string): Promise<PresenceEntry[]> {
  const res = await presenceStub(env, harborId).fetch('http://do/?action=presence-list');
  const body = (await res.json()) as { entries?: PresenceEntry[] };
  return body.entries ?? [];
}

const isOnline = (e: PresenceEntry, now: number): boolean => now - e.last_seen <= PRESENCE_TTL_SECONDS;

// ── POST /v1/harbors/:ns/:name/presence — heartbeat (member-gated) ────────────

export async function handlePresenceBeat(
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

  // Body is optional: an empty/absent body beats for the calling human.
  let body: { daemon?: unknown } = {};
  const raw = await request.text();
  if (raw.trim() !== '') {
    try {
      body = JSON.parse(raw) as { daemon?: unknown };
    } catch {
      return json(400, { code: 'BAD_REQUEST', error: 'body must be empty or JSON, optionally { daemon: fingerprint }' });
    }
  }

  const now = Math.floor(Date.now() / 1000);
  let entry: PresenceEntry;
  if (body.daemon !== undefined) {
    // v1: a member operator vouches for their daemon's liveness. The daemon
    // must be a registered, UNREVOKED identity AND a member of this harbor —
    // fail closed on anything the registries do not vouch for.
    if (typeof body.daemon !== 'string' || body.daemon.trim() === '') {
      return json(400, { code: 'BAD_REQUEST', error: 'daemon must be a fingerprint string' });
    }
    const fp = body.daemon.trim().toLowerCase();
    const identity = await getIdentity(env.DB, fp);
    if (!identity || identity.revoked) {
      return json(400, { code: 'UNKNOWN_DAEMON', error: 'no registered, unrevoked daemon identity with that fingerprint' });
    }
    const daemonRole = await getHarborRole(env.DB, gate.harbor.id, 'daemon', fp);
    if (!daemonRole) {
      return json(400, { code: 'NOT_A_MEMBER', error: 'that daemon is not a member of this harbor' });
    }
    entry = { kind: 'daemon', id: fp, label: fp, tier: identity.proof_method, last_seen: now };
  } else {
    entry = { kind: 'user', id: user.id, label: user.login, tier: 'human', last_seen: now };
  }

  await recordBeat(env, gate.harbor.id, entry);
  return json(200, {
    code: 'OK',
    error: null,
    presence: { kind: entry.kind, member: entry.label, tier: entry.tier, ttlSeconds: PRESENCE_TTL_SECONDS },
  });
}

// ── GET /v1/harbors/:ns/:name/presence — who is online (member-gated) ─────────

export async function handleGetPresence(
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
  const entries = await listPresence(env, gate.harbor.id);
  const online = entries
    .filter((e) => isOnline(e, now))
    .sort((a, b) => b.last_seen - a.last_seen || a.id.localeCompare(b.id))
    .map((e) => ({ kind: e.kind, member: e.label, tier: e.tier, lastSeenAt: e.last_seen }));
  return json(200, { code: 'OK', error: null, online, ttlSeconds: PRESENCE_TTL_SECONDS });
}

// ── Helm principal resolution ─────────────────────────────────────────────────

/**
 * Resolve one `{user: login}` | `{daemon: fingerprint}` spec to a verified
 * harbor-member principal. Returns a string error (→ 400) when the spec is
 * malformed, the principal does not exist, or it is not a member.
 */
async function resolveHelmPrincipal(
  env: Env,
  harborId: string,
  spec: unknown,
): Promise<HelmPrincipal | string> {
  if (typeof spec !== 'object' || spec === null) return 'each principal must be { user: login } or { daemon: fingerprint }';
  const s = spec as { user?: unknown; daemon?: unknown };
  const hasUser = typeof s.user === 'string' && s.user.trim() !== '';
  const hasDaemon = typeof s.daemon === 'string' && s.daemon.trim() !== '';
  if (hasUser === hasDaemon) return 'each principal must name exactly one of user (login) or daemon (fingerprint)';

  if (hasUser) {
    const target = await getUserByLogin(env.DB, (s.user as string).trim());
    if (!target) return `no relay account with login '${(s.user as string).trim()}'`;
    const role = await getHarborRole(env.DB, harborId, 'user', target.id);
    if (!role) return `user '${target.login}' is not a member of this harbor`;
    return { kind: 'user', id: target.id, label: target.login };
  }

  const fp = (s.daemon as string).trim().toLowerCase();
  const identity = await getIdentity(env.DB, fp);
  if (!identity || identity.revoked) return 'no registered, unrevoked daemon identity with that fingerprint';
  const role = await getHarborRole(env.DB, harborId, 'daemon', fp);
  if (!role) return `daemon '${fp}' is not a member of this harbor`;
  return { kind: 'daemon', id: fp, label: fp };
}

const principalJson = (p: HelmPrincipal) => ({ kind: p.kind, member: p.label });

function parseSuccession(json_: string): HelmPrincipal[] {
  try {
    const arr = JSON.parse(json_) as unknown;
    return Array.isArray(arr) ? (arr as HelmPrincipal[]) : [];
  } catch {
    return [];
  }
}

// ── PUT /v1/harbors/:ns/:name/helm — set holder + succession (owner-gated) ────

export async function handleSetHelm(
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
    return json(403, { code: 'FORBIDDEN', error: 'only a harbor owner may set the helm' });
  }

  let body: { holder?: unknown; succession?: unknown; parleyExpiryDefault?: unknown };
  try {
    body = (await request.json()) as { holder?: unknown; succession?: unknown; parleyExpiryDefault?: unknown };
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'JSON body with holder and optional succession[] required' });
  }

  // Mediator-body: the Helm configures what a parley DEADLINE LAPSE does in
  // this harbor. Omitted ⇒ the existing setting is PRESERVED (an owner
  // re-pointing the helm must not silently reset expiry policy); invalid ⇒
  // 400, fail closed.
  let parleyExpiryDefault: 'lapse' | 'first-proceeds' | undefined;
  if (body.parleyExpiryDefault !== undefined) {
    if (body.parleyExpiryDefault !== 'lapse' && body.parleyExpiryDefault !== 'first-proceeds') {
      return json(400, {
        code: 'BAD_EXPIRY_DEFAULT',
        error: "parleyExpiryDefault must be 'lapse' or 'first-proceeds'",
      });
    }
    parleyExpiryDefault = body.parleyExpiryDefault;
  }

  const holder = await resolveHelmPrincipal(env, gate.harbor.id, body.holder);
  if (typeof holder === 'string') return json(400, { code: 'BAD_HOLDER', error: holder });

  const rawSuccession = body.succession === undefined ? [] : body.succession;
  if (!Array.isArray(rawSuccession)) {
    return json(400, { code: 'BAD_SUCCESSION', error: 'succession must be an ordered array of principals' });
  }
  if (rawSuccession.length > MAX_SUCCESSORS) {
    return json(400, { code: 'BAD_SUCCESSION', error: `succession is capped at ${MAX_SUCCESSORS} principals` });
  }
  const succession: HelmPrincipal[] = [];
  const seen = new Set<string>([`${holder.kind}:${holder.id}`]);
  for (const spec of rawSuccession) {
    const p = await resolveHelmPrincipal(env, gate.harbor.id, spec);
    if (typeof p === 'string') return json(400, { code: 'BAD_SUCCESSION', error: p });
    const key = `${p.kind}:${p.id}`;
    if (seen.has(key)) {
      return json(400, { code: 'BAD_SUCCESSION', error: 'succession must not repeat the holder or another successor' });
    }
    seen.add(key);
    succession.push(p);
  }

  const now = Math.floor(Date.now() / 1000);
  const existing = await getHelm(env.DB, gate.harbor.id);
  const seq = (existing?.seq ?? 0) + 1;
  const effectiveExpiryDefault =
    parleyExpiryDefault ?? existing?.parley_expiry_default ?? 'lapse';
  await setHelm(env.DB, {
    harborId: gate.harbor.id,
    holder,
    successionJson: JSON.stringify(succession),
    seq,
    updatedAt: now,
    updatedBy: user.id,
    parleyExpiryDefault: effectiveExpiryDefault,
  });
  // Audit row: helm changes are never silent, including owner sets.
  await insertHelmEvent(env.DB, {
    harborId: gate.harbor.id,
    at: now,
    kind: 'helm_set',
    detail: {
      by: user.login,
      holder: principalJson(holder),
      succession: succession.map(principalJson),
    },
  });

  return json(200, {
    code: 'OK',
    error: null,
    helm: {
      holder: principalJson(holder),
      succession: succession.map(principalJson),
      state: 'held',
      vacantFlagged: false,
      seq,
      updatedAt: now,
      parleyExpiryDefault: effectiveExpiryDefault,
    },
  });
}

// ── Dead-man succession (runs lazily on helm read) ────────────────────────────

/**
 * Apply the dead-man rule to a held helm. Returns the row to serve (the
 * original when nothing fired, or a fresh read after a transition).
 */
async function runDeadMan(env: Env, harborId: string, helm: HelmRow, now: number): Promise<HelmRow> {
  if (helm.state !== 'held' || helm.holder_kind === null || helm.holder_id === null) return helm;

  const entries = await listPresence(env, harborId);
  const holderEntry = entries.find((e) => e.kind === helm.holder_kind && e.id === helm.holder_id);
  // A freshly set helm gets a full window even if the holder never beat:
  // absence is measured from the LATER of last heartbeat and updated_at.
  const lastAlive = Math.max(holderEntry?.last_seen ?? 0, helm.updated_at);
  if (now - lastAlive <= PRESENCE_TTL_SECONDS + HELM_GRACE_SECONDS) return helm;

  const from = { kind: helm.holder_kind, id: helm.holder_id, label: helm.holder_label ?? helm.holder_id };
  const succession = parseSuccession(helm.succession_json);
  const nextIdx = succession.findIndex((p) => {
    const e = entries.find((x) => x.kind === p.kind && x.id === p.id);
    return e !== undefined && isOnline(e, now);
  });

  let won: boolean;
  if (nextIdx >= 0) {
    const next = succession[nextIdx];
    if (!next) return helm; // unreachable (findIndex bound); satisfies noUncheckedIndexedAccess
    // The new holder leaves the list; everyone else keeps their order. The
    // silent ex-holder is NOT auto-reinserted — re-adding them is an explicit
    // owner decision.
    const remaining = succession.filter((_, i) => i !== nextIdx);
    won = await applyHelmTransition(env.DB, {
      harborId,
      expectedSeq: helm.seq,
      holder: next,
      successionJson: JSON.stringify(remaining),
      vacantFlagged: false,
      updatedAt: now,
    });
    if (won) {
      await insertHelmEvent(env.DB, {
        harborId,
        at: now,
        kind: 'dead_man_pass',
        detail: {
          from: principalJson(from),
          to: principalJson(next),
          holderLastSeenAt: holderEntry?.last_seen ?? null,
          expiredForSeconds: now - lastAlive - PRESENCE_TTL_SECONDS,
        },
      });
    }
  } else {
    // No successor is present: vacant + FLAGGED, never a silent limbo.
    won = await applyHelmTransition(env.DB, {
      harborId,
      expectedSeq: helm.seq,
      holder: null,
      successionJson: helm.succession_json, // list preserved for the owner to inspect
      vacantFlagged: true,
      updatedAt: now,
    });
    if (won) {
      await insertHelmEvent(env.DB, {
        harborId,
        at: now,
        kind: 'dead_man_vacant',
        detail: {
          from: principalJson(from),
          holderLastSeenAt: holderEntry?.last_seen ?? null,
          reason: 'holder presence expired past grace and no successor was present',
        },
      });
    }
  }

  // Serve the post-transition truth (also when a concurrent reader won the CAS).
  return (await getHelm(env.DB, harborId)) ?? helm;
}

// ── GET /v1/harbors/:ns/:name/helm — read helm + audit (member-gated) ─────────

export async function handleGetHelm(
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
  let helm = await getHelm(env.DB, gate.harbor.id);
  if (helm) helm = await runDeadMan(env, gate.harbor.id, helm, now);
  const events = await listHelmEvents(env.DB, gate.harbor.id);

  return json(200, {
    code: 'OK',
    error: null,
    // helm: null means "never set" — distinct from vacant (set, then emptied
    // by the dead-man rule with the vacancy flagged and audited).
    helm: helm
      ? {
          holder:
            helm.holder_kind !== null && helm.holder_id !== null
              ? { kind: helm.holder_kind, member: helm.holder_label ?? helm.holder_id }
              : null,
          succession: parseSuccession(helm.succession_json).map(principalJson),
          state: helm.state,
          vacantFlagged: helm.vacant_flagged === 1,
          seq: helm.seq,
          updatedAt: helm.updated_at,
          parleyExpiryDefault: helm.parley_expiry_default ?? 'lapse',
        }
      : null,
    events: events.map((e) => ({ at: e.at, kind: e.kind, detail: JSON.parse(e.detail) as unknown })),
  });
}
