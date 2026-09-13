/** Macaroon capability boundary for ADR-0092 coordination rooms. */

import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { isCoordinationScopeId } from '../../../lib/coordination-ledger.js';
import { base64UrlDecode, base64UrlEncode, fromHex, randomHex, timingSafeEqual, toHex } from './crypto.js';

const encoder = new TextEncoder();
const ROOT_KEY_RE = /^[0-9a-f]{64}$/i;
const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_CAVEATS = 16;
export const COORDINATION_MAX_GRANT_TTL_MS = 24 * 60 * 60 * 1000;
export const COORDINATION_DEFAULT_GRANT_TTL_MS = 6 * 60 * 60 * 1000;
export const COORDINATION_SYNC_VERB = 'coordination-sync';
export const INTERRUPTION_CREATE_VERB = 'operator-interruption:create';
export const INTERRUPTION_READ_OWN_VERB = 'operator-interruption:read-own';
export const INTERRUPTION_READ_ALL_VERB = 'operator-interruption:read-all';

export type InterruptionCapabilityVerb =
  | typeof INTERRUPTION_CREATE_VERB
  | typeof INTERRUPTION_READ_OWN_VERB
  | typeof INTERRUPTION_READ_ALL_VERB;

const INTERRUPTION_CAPABILITY_VERBS = new Set<string>([
  INTERRUPTION_CREATE_VERB,
  INTERRUPTION_READ_OWN_VERB,
  INTERRUPTION_READ_ALL_VERB,
]);

export interface InterruptionCapabilityScope {
  verb: InterruptionCapabilityVerb;
  userId: string;
  sourceAgent?: string;
  sourceSession?: string;
  requestKey?: string;
  requestFingerprint?: string;
}

export interface InterruptionCapabilityVerification extends CoordinationGrantVerification {
  scope?: InterruptionCapabilityScope;
}

export interface CoordinationMacaroon {
  location: string;
  identifier: string;
  caveats: Array<{ cid: string }>;
  signature: string;
}

export interface CoordinationGrantContext {
  project: string;
  actorId: string;
  nowMs: number;
}

export interface CoordinationGrantVerification {
  authorized: boolean;
  reason: string;
  macaroon?: CoordinationMacaroon;
}

function mac(key: Uint8Array, message: string): Uint8Array {
  return hmac(sha256, key, encoder.encode(message));
}

function rootKey(rootKeyHex: string): Uint8Array {
  if (!ROOT_KEY_RE.test(rootKeyHex)) throw new Error('coordination macaroon root key must be 32-byte hex');
  return fromHex(rootKeyHex);
}

function sign(root: Uint8Array, identifier: string, caveats: Array<{ cid: string }>): string {
  let signature = mac(root, identifier);
  for (const caveat of caveats) signature = mac(signature, caveat.cid);
  return toHex(signature);
}

function encodeToken(macaroon: CoordinationMacaroon): string {
  return base64UrlEncode(encoder.encode(JSON.stringify(macaroon)));
}

function decodeToken(token: string): CoordinationMacaroon | null {
  if (!token || token.length > MAX_TOKEN_BYTES) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(token))) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    if (typeof value.location !== 'string' || typeof value.identifier !== 'string') return null;
    if (typeof value.signature !== 'string' || !ROOT_KEY_RE.test(value.signature)) return null;
    if (!Array.isArray(value.caveats) || value.caveats.length > MAX_CAVEATS) return null;
    const caveats: Array<{ cid: string }> = [];
    for (const item of value.caveats) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
      const caveat = item as Record<string, unknown>;
      // Coordination grants are first-party-only. A vid/cl is a different
      // authority dialect and fails closed rather than being ignored.
      if (typeof caveat.cid !== 'string' || caveat.vid !== undefined || caveat.cl !== undefined) return null;
      caveats.push({ cid: caveat.cid });
    }
    return {
      location: value.location,
      identifier: value.identifier,
      signature: value.signature,
      caveats,
    };
  } catch {
    return null;
  }
}

/** Operator-side mint. Holders may only append caveats; they never see root. */
export function mintCoordinationMacaroon(
  rootKeyHex: string,
  project: string,
  actorId: string,
  options: { nowMs?: number; ttlMs?: number; location?: string } = {},
): { token: string; expiresAt: number; macaroon: CoordinationMacaroon } {
  if (!isCoordinationScopeId(project, 200)) throw new Error('invalid project');
  if (!isCoordinationScopeId(actorId)) throw new Error('invalid actorId');
  const nowMs = Math.max(1, Math.floor(options.nowMs ?? Date.now()));
  const ttlMs = Math.max(1, Math.min(
    COORDINATION_MAX_GRANT_TTL_MS,
    Math.floor(options.ttlMs ?? COORDINATION_DEFAULT_GRANT_TTL_MS),
  ));
  const expiresAt = nowMs + ttlMs;
  const caveats = [
    { cid: `op = ${COORDINATION_SYNC_VERB}` },
    { cid: `repo = ${project}` },
    { cid: `session = ${actorId}` },
    { cid: `expires = ${expiresAt}` },
  ];
  const macaroon: CoordinationMacaroon = {
    location: options.location ?? 'pd://relay/coordination',
    identifier: `coord-${randomHex(16)}`,
    caveats,
    signature: '',
  };
  macaroon.signature = sign(rootKey(rootKeyHex), macaroon.identifier, caveats);
  return { token: encodeToken(macaroon), expiresAt, macaroon };
}

/** Verify the same HMAC chain as pd-anchor/lib/macaroon, first-party-only. */
export function verifyCoordinationMacaroon(
  token: string,
  rootKeyHex: string,
  context: CoordinationGrantContext,
): CoordinationGrantVerification {
  let root: Uint8Array;
  try {
    root = rootKey(rootKeyHex);
  } catch {
    return { authorized: false, reason: 'coordination macaroon gate is not configured' };
  }
  const macaroon = decodeToken(token);
  if (!macaroon) return { authorized: false, reason: 'malformed coordination macaroon' };
  const expected = sign(root, macaroon.identifier, macaroon.caveats);
  if (!timingSafeEqual(expected, macaroon.signature)) {
    return { authorized: false, reason: 'coordination macaroon signature mismatch' };
  }

  const required = new Set(['op', 'repo', 'session', 'expires']);
  for (const caveat of macaroon.caveats) {
    const match = caveat.cid.match(/^(op|repo|session|expires)\s*=\s*(.+)$/);
    if (!match) return { authorized: false, reason: 'unsupported coordination caveat' };
    const [, field, rawValue] = match;
    required.delete(field!);
    switch (field) {
      case 'op':
        if (rawValue !== COORDINATION_SYNC_VERB) return { authorized: false, reason: 'verb caveat mismatch' };
        break;
      case 'repo':
        if (rawValue !== context.project) return { authorized: false, reason: 'project caveat mismatch' };
        break;
      case 'session':
        if (rawValue !== context.actorId) return { authorized: false, reason: 'actor caveat mismatch' };
        break;
      case 'expires': {
        const expiresAt = Number(rawValue);
        if (!Number.isSafeInteger(expiresAt) || context.nowMs <= 0 || context.nowMs > expiresAt) {
          return { authorized: false, reason: 'coordination macaroon expired' };
        }
        break;
      }
    }
  }
  if (required.size > 0) {
    return { authorized: false, reason: `coordination macaroon missing ${[...required].join(',')} scope` };
  }
  return { authorized: true, reason: 'verified', macaroon };
}

export function coordinationMacaroonFromRequest(request: Request): string | null {
  const authorization = request.headers.get('Authorization') ?? '';
  const match = authorization.match(/^Macaroon\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function interruptionScopeId(value: unknown, max = 160): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
}

function validateInterruptionScope(scope: InterruptionCapabilityScope): void {
  if (!INTERRUPTION_CAPABILITY_VERBS.has(scope.verb)) throw new Error('invalid interruption verb');
  if (!interruptionScopeId(scope.userId)) throw new Error('invalid interruption user');
  if (scope.verb === INTERRUPTION_READ_ALL_VERB) {
    if (
      scope.sourceAgent !== undefined
      || scope.sourceSession !== undefined
      || scope.requestKey !== undefined
      || scope.requestFingerprint !== undefined
    ) throw new Error('read-all interruption grants cannot carry source or request scope');
    return;
  }
  if (!interruptionScopeId(scope.sourceAgent, 120)) throw new Error('invalid interruption source agent');
  if (!interruptionScopeId(scope.sourceSession, 120)) throw new Error('invalid interruption source session');
  if (scope.verb === INTERRUPTION_CREATE_VERB) {
    if (!/^pd_oi_[a-f0-9]{64}$/.test(scope.requestKey ?? '')) {
      throw new Error('invalid interruption request key');
    }
    if (!/^[a-f0-9]{64}$/.test(scope.requestFingerprint ?? '')) {
      throw new Error('invalid interruption request fingerprint');
    }
  } else if (scope.requestKey !== undefined || scope.requestFingerprint !== undefined) {
    throw new Error('read-own interruption grants cannot carry request scope');
  }
}

/** Mint one Relay-root capability for exactly one interruption operation. */
export function mintInterruptionMacaroon(
  rootKeyHex: string,
  scope: InterruptionCapabilityScope,
  options: { nowMs?: number; ttlMs?: number; location?: string } = {},
): { token: string; expiresAt: number; macaroon: CoordinationMacaroon } {
  validateInterruptionScope(scope);
  const root = rootKey(rootKeyHex);
  const nowMs = Math.max(1, Math.floor(options.nowMs ?? Date.now()));
  const ttlMs = Math.max(1, Math.min(5 * 60_000, Math.floor(options.ttlMs ?? 60_000)));
  const expiresAt = nowMs + ttlMs;
  const caveats: Array<{ cid: string }> = [
    { cid: `op = ${scope.verb}` },
    { cid: `user = ${scope.userId}` },
  ];
  if (scope.verb !== INTERRUPTION_READ_ALL_VERB) {
    caveats.push(
      { cid: `source_agent = ${scope.sourceAgent}` },
      { cid: `source_session = ${scope.sourceSession}` },
    );
  }
  if (scope.verb === INTERRUPTION_CREATE_VERB) {
    caveats.push(
      { cid: `request_key = ${scope.requestKey}` },
      { cid: `request_fingerprint = ${scope.requestFingerprint}` },
    );
  }
  caveats.push({ cid: `expires = ${expiresAt}` });
  const macaroon: CoordinationMacaroon = {
    location: options.location ?? 'pd://relay/operator-interruptions',
    identifier: `oi-${randomHex(16)}`,
    caveats,
    signature: '',
  };
  macaroon.signature = sign(root, macaroon.identifier, caveats);
  return { token: encodeToken(macaroon), expiresAt, macaroon };
}

/**
 * Verify a first-party interruption capability and return only signed scope.
 * Caller-supplied source fields never participate in authority decisions.
 */
export function verifyInterruptionMacaroon(
  token: string,
  rootKeyHex: string,
  expectedVerb: InterruptionCapabilityVerb | readonly InterruptionCapabilityVerb[],
  nowMs = Date.now(),
): InterruptionCapabilityVerification {
  let root: Uint8Array;
  try {
    root = rootKey(rootKeyHex);
  } catch {
    return { authorized: false, reason: 'interruption macaroon gate is not configured' };
  }
  const macaroon = decodeToken(token);
  if (!macaroon || !macaroon.identifier.startsWith('oi-')) {
    return { authorized: false, reason: 'malformed interruption macaroon' };
  }
  if (!timingSafeEqual(sign(root, macaroon.identifier, macaroon.caveats), macaroon.signature)) {
    return { authorized: false, reason: 'interruption macaroon signature mismatch' };
  }

  const values = new Map<string, string>();
  for (const caveat of macaroon.caveats) {
    const match = caveat.cid.match(/^(op|user|source_agent|source_session|request_key|request_fingerprint|expires)\s*=\s*(.+)$/);
    if (!match) return { authorized: false, reason: 'unsupported interruption caveat' };
    const field = match[1]!;
    if (values.has(field)) return { authorized: false, reason: `duplicate interruption ${field} caveat` };
    values.set(field, match[2]!);
  }

  const allowedVerbs = Array.isArray(expectedVerb) ? expectedVerb : [expectedVerb];
  const signedVerb = values.get('op');
  if (!signedVerb || !allowedVerbs.includes(signedVerb as InterruptionCapabilityVerb)) {
    return { authorized: false, reason: 'interruption verb caveat mismatch' };
  }
  const expiresAt = Number(values.get('expires'));
  if (!Number.isSafeInteger(expiresAt) || nowMs <= 0 || nowMs > expiresAt) {
    return { authorized: false, reason: 'interruption macaroon expired' };
  }
  const scope: InterruptionCapabilityScope = {
    verb: signedVerb as InterruptionCapabilityVerb,
    userId: values.get('user') ?? '',
    ...(values.has('source_agent') ? { sourceAgent: values.get('source_agent')! } : {}),
    ...(values.has('source_session') ? { sourceSession: values.get('source_session')! } : {}),
    ...(values.has('request_key') ? { requestKey: values.get('request_key')! } : {}),
    ...(values.has('request_fingerprint') ? { requestFingerprint: values.get('request_fingerprint')! } : {}),
  };
  try {
    validateInterruptionScope(scope);
  } catch (error) {
    return { authorized: false, reason: error instanceof Error ? error.message : 'invalid interruption scope' };
  }
  return { authorized: true, reason: 'verified', macaroon, scope };
}
