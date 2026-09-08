/**
 * WS-B SLICE B3 (relay half) — device X25519-key registry + wrap-relay routes
 * (docs/adr/0123-cloud-vault-account-kms.md; lifts A4's crypto primitives,
 * lib/pd-vault-ts.ts KeyWrapAad/WrappedKey, onto the relay's wire).
 *
 * The relay routes HPKE-wrapped channel keys between a harbor's members'
 * devices. It never sees a channel key in the clear, never wraps or unwraps
 * anything itself, and enforces no grant/purpose/writer policy — it is a
 * phone book for public device keys plus a mailbox for opaque ciphertext,
 * exactly like the rest of X2/X4 is a phone book for harbor membership.
 *
 *   POST /v1/devices/keys                              register/rotate my own device's X25519 pubkey (any authed user)
 *   GET  /v1/devices/keys                               list my own registered devices (any authed user)
 *   GET  /v1/harbors/:ns/:name/devices/:deviceId/key    fetch one device's pubkey, scoped to a shared harbor (member-gated)
 *   POST /v1/harbors/:ns/:name/wraps                    post an HPKE-wrapped envelope (member-gated; blind relay)
 *   GET  /v1/harbors/:ns/:name/wraps                    fetch pending wraps for MY OWN device (member-gated + device-ownership-gated)
 *
 * Trust boundaries (ADR-0123 §1–3 doctrine):
 *  - DEVICE IDENTITY IS ACCOUNT-SCOPED, NOT HARBOR-SCOPED. A device card is
 *    enrolled once per account (its X25519 private key never leaves the
 *    device's OS keychain) and receives wraps across every harbor the account
 *    belongs to — so registration is a top-level /v1/devices/... route,
 *    mirroring push-apns.ts's /v1/push/apns/devices, NOT nested under
 *    /v1/harbors/. A wrapped envelope, by contrast, IS harbor+epoch+purpose+
 *    key scoped, so those routes nest under /v1/harbors/:ns/:name/ like every
 *    other harbor sub-resource.
 *  - THE RELAY NEVER VERIFIES CIPHERTEXT, BUT IT DOES VERIFY ROUTING
 *    METADATA. `enc`/`ciphertext` are opaque Base64URL blobs, never decoded
 *    or inspected — but a wrap POST names a recipientDeviceId, the relay
 *    looks that device up in device_keys, and the resulting
 *    recipient_user_id is what actually goes in the stored row — never
 *    trusted from the caller's body. Same "server-derived, never client
 *    input" discipline harbors.ts applies to namespace.
 *  - ANY HARBOR MEMBER MAY POST A WRAP, not just "the writer" — the relay has
 *    no concept of writer-vs-member enforcement today (that authority lives
 *    in pd-vault/the daemon per ADR-0123 §2's "grant/purpose enforcement
 *    belongs to the caller, not the vault"), the identical reasoning
 *    invites.ts already applies to minting invites.
 *  - NO CONSUMPTION/ACK BOOKKEEPING IN THIS SLICE. GET .../wraps lists
 *    pending wraps; it never deletes or marks them delivered. Idempotent
 *    redelivery is safe because storage itself is idempotent (the composite
 *    primary key IS the AAD's uniqueness) and unwrapChannelKeyForDevice is a
 *    pure function — refetching costs nothing. Deletion/expiry is an open
 *    question, not built here (see the implementation spec's risk list).
 *  - NEVER LEAK A WRAP ACROSS HARBORS OR ACCOUNTS. GET .../wraps stacks TWO
 *    gates: harbor membership (like every other harbor sub-resource) AND
 *    device ownership (the queried deviceId must belong to the caller's own
 *    account) — nobody may fetch another member's device's key wraps, even
 *    within the same harbor they both belong to.
 *  - Fail semantics: every gate fails closed (unknown → 404, unauthenticated
 *    → 401, insufficient role → 403, bad shapes → 400, closed coordinate →
 *    409); D1 throws bubble to index.ts's controlled INTERNAL_ERROR envelope.
 */

import type { Env } from './types.js';
import { base64UrlDecode } from './crypto.js';
import { resolveUserFromRequest } from './device-flow.js';
import { isSameOrigin } from './auth-github.js';
import { resolveHarborMembership } from './parleys.js';
import {
  getDeviceKey,
  getDeviceKeyOwner,
  getHarborRole,
  insertHarborKeyWrap,
  listDeviceKeys,
  listHarborKeyWraps,
  upsertDeviceKey,
} from './db.js';

// ── Shared response helpers (same envelope as src/harbors.ts / src/invites.ts;
//    duplicated inline per those files' own precedent — never imported across
//    route modules) ────────────────────────────────────────────────────────

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

// ── Validation constants (bounded-but-non-semantic, matching harbors.ts's
//    NAME_RE/PUBKEY_RE style) ───────────────────────────────────────────────

// Bare caller-supplied id — bounded for wire hygiene only, per the scope note
// (no enum, no existence check, matches KeyWrapAad.recipientDeviceId).
const DEVICE_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
// Raw X25519 public key: 32 bytes hex. Format-validated only, same posture as
// harbors.ts's PUBKEY_RE for the harbor ed25519 key — no low-order-point
// rejection at the relay; that check lives in pd-vault at open() time.
const X25519_PUBKEY_RE = /^[0-9a-f]{64}$/;
// Freeform, bounded, non-enum — mirrors lib/pd-vault-ts.ts's own posture on
// KeyWrapAad.grant / .keyPurpose / .keyId ("this type does not enforce that
// set... only emptiness is rejected here").
const MAX_FREEFORM_LEN = 64;

// ── POST /v1/devices/keys — register or rotate my device's pubkey ─────────

export async function handleRegisterDeviceKey(request: Request, env: Env): Promise<Response> {
  if (!isSameOrigin(request, env)) return crossOrigin();
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();

  let body: { deviceId?: unknown; pubkey?: unknown };
  try {
    body = (await request.json()) as { deviceId?: unknown; pubkey?: unknown };
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'JSON body with deviceId and pubkey required' });
  }
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
  if (!DEVICE_ID_RE.test(deviceId)) {
    return json(400, { code: 'BAD_DEVICE_ID', error: 'deviceId must be 1-128 chars of [A-Za-z0-9_.:-]' });
  }
  const pubkey = typeof body.pubkey === 'string' ? body.pubkey.trim().toLowerCase() : '';
  if (!X25519_PUBKEY_RE.test(pubkey)) {
    return json(400, { code: 'BAD_PUBKEY', error: 'pubkey must be a raw X25519 public key as 64 hex chars' });
  }

  const now = Math.floor(Date.now() / 1000);
  const res = await upsertDeviceKey(env.DB, { userId: user.id, deviceId, pubkey, now });
  if (res === 'conflict') {
    return json(409, {
      code: 'CONFLICT',
      error: 'deviceId is already registered to a different account — choose a different deviceId',
    });
  }
  return json(res === 'rotated' ? 200 : 201, {
    code: 'OK',
    error: null,
    device: { deviceId, pubkey, updatedAt: now },
  });
}

// ── GET /v1/devices/keys — list my own devices ─────────────────────────────

export async function handleListDeviceKeys(request: Request, env: Env): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const rows = await listDeviceKeys(env.DB, user.id);
  return json(200, {
    code: 'OK',
    error: null,
    devices: rows.map((d) => ({ deviceId: d.device_id, pubkey: d.x25519_pubkey, updatedAt: d.updated_at })),
  });
}

// ── GET /v1/harbors/:ns/:name/devices/:deviceId/key — a peer's pubkey ──────

/**
 * The route a harbor's active writer (running wrapChannelKeyForDevice
 * locally, off-relay, per ADR-0123 §2) calls to learn a fellow member's
 * device pubkey before wrapping. Must never let a member enumerate devices
 * belonging to accounts OUTSIDE the shared harbor — "no such device" covers
 * BOTH a nonexistent device id AND a real device whose account is not a
 * member of THIS harbor, collapsing them the same way harbors.ts/invites.ts
 * already collapse "no such harbor" and "not a member".
 */
export async function handleGetHarborDeviceKey(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
  deviceId: string,
): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const gate = await resolveHarborMembership(env, user, namespace, name);
  if (!gate) return harborNotFound();

  // deviceId is a URL path segment here, not attacker-shaped JSON — but still
  // reject anything the registry could never have stored, before touching D1.
  if (!DEVICE_ID_RE.test(deviceId)) return json(404, { code: 'NOT_FOUND', error: 'no such device' });

  const owner = await getDeviceKeyOwner(env.DB, deviceId);
  // ONE 404 for "no such device" AND "device exists but its account is not a
  // member of THIS harbor" — same no-existence-oracle doctrine as above.
  if (!owner) return json(404, { code: 'NOT_FOUND', error: 'no such device' });
  const ownerRole = await getHarborRole(env.DB, gate.harbor.id, 'user', owner.userId);
  if (!ownerRole) return json(404, { code: 'NOT_FOUND', error: 'no such device' });

  return json(200, { code: 'OK', error: null, device: { deviceId, pubkey: owner.pubkey, updatedAt: owner.updatedAt } });
}

// ── POST /v1/harbors/:ns/:name/wraps — post an HPKE-wrapped envelope ──────

interface PostWrapBody {
  recipientDeviceId?: unknown;
  authorityEpoch?: unknown;
  grant?: unknown;
  keyPurpose?: unknown;
  keyId?: unknown;
  enc?: unknown; // Base64URL
  ciphertext?: unknown; // Base64URL
}

export async function handlePostHarborWrap(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
): Promise<Response> {
  if (!isSameOrigin(request, env)) return crossOrigin();
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const gate = await resolveHarborMembership(env, user, namespace, name);
  if (!gate) return harborNotFound(); // any member may post — see module doc

  let body: PostWrapBody;
  try {
    body = (await request.json()) as PostWrapBody;
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'JSON body required' });
  }

  const recipientDeviceId = typeof body.recipientDeviceId === 'string' ? body.recipientDeviceId.trim() : '';
  if (!DEVICE_ID_RE.test(recipientDeviceId)) {
    return json(400, { code: 'BAD_DEVICE_ID', error: 'recipientDeviceId is required' });
  }
  const authorityEpoch =
    typeof body.authorityEpoch === 'number' && Number.isInteger(body.authorityEpoch) ? body.authorityEpoch : NaN;
  if (!(authorityEpoch >= 1)) {
    return json(400, { code: 'BAD_EPOCH', error: 'authorityEpoch must be a positive integer' });
  }
  if (authorityEpoch > gate.harbor.authority_epoch) {
    return json(400, { code: 'BAD_EPOCH', error: "authorityEpoch exceeds the harbor's current epoch" });
  }
  const grant = typeof body.grant === 'string' ? body.grant.trim() : '';
  const keyPurpose = typeof body.keyPurpose === 'string' ? body.keyPurpose.trim() : '';
  const keyId = typeof body.keyId === 'string' ? body.keyId.trim() : '';
  if (!grant || grant.length > MAX_FREEFORM_LEN) {
    return json(400, { code: 'BAD_REQUEST', error: 'grant is required (max 64 chars)' });
  }
  if (!keyPurpose || keyPurpose.length > MAX_FREEFORM_LEN) {
    return json(400, { code: 'BAD_REQUEST', error: 'keyPurpose is required (max 64 chars)' });
  }
  if (!keyId || keyId.length > MAX_FREEFORM_LEN) {
    return json(400, { code: 'BAD_REQUEST', error: 'keyId is required (max 64 chars)' });
  }

  // Base64URL-decodability check only — the relay does not know or enforce
  // HPKE/AES-GCM byte lengths (that is the vault's job at open() time; the
  // relay stays blind to the crypto SHAPE, not just the plaintext).
  let encBytes: Uint8Array;
  let ctBytes: Uint8Array;
  try {
    encBytes = base64UrlDecode(typeof body.enc === 'string' ? body.enc : '');
    ctBytes = base64UrlDecode(typeof body.ciphertext === 'string' ? body.ciphertext : '');
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'enc and ciphertext must be Base64URL' });
  }
  if (encBytes.length === 0 || ctBytes.length === 0) {
    return json(400, { code: 'BAD_REQUEST', error: 'enc and ciphertext are required' });
  }

  // Routing-plane check: the recipient device must be registered AND its
  // owning account must be a member of THIS harbor — otherwise a wrap could
  // be filed for a device that has no business receiving this harbor's keys.
  const owner = await getDeviceKeyOwner(env.DB, recipientDeviceId);
  if (!owner) return json(404, { code: 'UNKNOWN_DEVICE', error: 'recipientDeviceId is not a registered device' });
  const ownerRole = await getHarborRole(env.DB, gate.harbor.id, 'user', owner.userId);
  if (!ownerRole) {
    return json(400, { code: 'RECIPIENT_NOT_MEMBER', error: "recipient device's account is not a member of this harbor" });
  }

  const now = Math.floor(Date.now() / 1000);
  const res = await insertHarborKeyWrap(env.DB, {
    harborId: gate.harbor.id,
    authorityEpoch,
    recipientDeviceId,
    keyPurpose,
    keyId,
    grant,
    recipientUserId: owner.userId,
    enc: body.enc as string,
    ciphertext: body.ciphertext as string,
    wrappedBy: user.id,
    now,
  });
  if (res === 'conflict') {
    return json(409, {
      code: 'CONFLICT',
      error: 'a different wrap already exists at this (epoch, keyPurpose, keyId) coordinate — use a new keyId or epoch, do not overwrite',
    });
  }
  return json(res === 'replay' ? 200 : 201, {
    code: 'OK',
    error: null,
    wrap: {
      harbor: `${gate.harbor.namespace}/${gate.harbor.name}`,
      recipientDeviceId,
      authorityEpoch,
      grant,
      keyPurpose,
      keyId,
      createdAt: now,
    },
  });
}

// ── GET /v1/harbors/:ns/:name/wraps — fetch pending wraps for MY device ────

/**
 * Two gates stack: harbor membership (like every other harbor sub-resource)
 * AND device ownership (the queried deviceId must belong to the caller —
 * nobody may fetch another member's device's key wraps, even within the
 * same harbor). This is the "must not leak wrapped envelopes across harbors
 * or accounts" surface — the harbor segment of the row scopes across
 * harbors, the ownership check scopes across accounts.
 */
export async function handleGetHarborWraps(
  request: Request,
  env: Env,
  namespace: string,
  name: string,
): Promise<Response> {
  const user = await resolveUserFromRequest(request, env);
  if (!user) return unauthenticated();
  const gate = await resolveHarborMembership(env, user, namespace, name);
  if (!gate) return harborNotFound();

  const url = new URL(request.url);
  const deviceId = url.searchParams.get('deviceId') ?? '';
  if (!DEVICE_ID_RE.test(deviceId)) {
    return json(400, { code: 'BAD_REQUEST', error: 'deviceId query param is required' });
  }
  // Ownership check collapses "not registered" and "registered to someone
  // else" into ONE answer — the caller already knows their own devices, so
  // there is no oracle value in distinguishing the two, and distinguishing
  // them WOULD let a member probe which device ids belong to other accounts.
  const dk = await getDeviceKey(env.DB, user.id, deviceId);
  if (!dk) {
    return json(403, { code: 'FORBIDDEN', error: 'deviceId does not belong to the authenticated account' });
  }

  const sinceEpochRaw = url.searchParams.get('sinceEpoch');
  const sinceEpoch = sinceEpochRaw !== null && /^\d+$/.test(sinceEpochRaw) ? Number(sinceEpochRaw) : undefined;

  const rows = await listHarborKeyWraps(env.DB, gate.harbor.id, deviceId, sinceEpoch);
  return json(200, {
    code: 'OK',
    error: null,
    wraps: rows.map((r) => ({
      authorityEpoch: r.authority_epoch,
      grant: r.grant,
      keyPurpose: r.key_purpose,
      keyId: r.key_id,
      enc: r.enc,
      ciphertext: r.ciphertext,
      createdAt: r.created_at,
    })),
  });
}
