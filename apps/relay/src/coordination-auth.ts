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
