/**
 * Port Daddy Relay — Harbor card verification (ADR-0049)
 *
 * Validates Phase 2 Ed25519 harbor cards presented by publishers and subscribers.
 * Enforces all capability checks at the relay boundary.
 *
 * Card format: JWT with alg: EdDSA, header.kid = issuer_fingerprint.
 * Payload: HarborCardPayload (see types.ts).
 */

import { base64UrlDecode, verifyEd25519 } from './crypto.js';
import { isRevoked } from './db.js';
import type { HarborCardPayload, CapabilityEntry, Env } from './types.js';

export class CardError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'CardError';
  }
}

interface DecodedCard {
  header: { alg: string; kid?: string };
  payload: HarborCardPayload;
  headerB64: string;
  payloadB64: string;
  sigB64: string;
}

function decodeCard(jwt: string): DecodedCard {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new CardError('MALFORMED', 'Card must be a 3-part JWT');
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const dec = new TextDecoder();
  const header = JSON.parse(dec.decode(base64UrlDecode(headerB64))) as { alg: string; kid?: string };
  const payload = JSON.parse(dec.decode(base64UrlDecode(payloadB64))) as HarborCardPayload;
  return { header, payload, headerB64, payloadB64, sigB64 };
}

export async function verifyCard(
  jwt: string,
  db: D1Database,
  issuerPubKeyHex: string,
  requiredOp: 'pub' | 'sub' | 'admin',
  requiredChannel: string
): Promise<HarborCardPayload> {
  const { header, payload, headerB64, payloadB64, sigB64 } = decodeCard(jwt);

  // Algorithm must be EdDSA
  if (header.alg !== 'EdDSA') {
    throw new CardError('WRONG_ALG', `Expected EdDSA, got ${header.alg}`);
  }

  // Harbor version must be 2
  if (payload.hv !== 2) {
    throw new CardError('WRONG_VERSION', `Expected hv:2, got ${payload.hv}`);
  }

  // Expiry
  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) {
    throw new CardError('EXPIRED', 'Card is expired');
  }
  if (payload.nbf && now < payload.nbf) {
    throw new CardError('NOT_YET_VALID', 'Card nbf is in the future');
  }

  // JTI revocation check
  if (await isRevoked(db, payload.jti)) {
    throw new CardError('REVOKED', `JTI ${payload.jti} has been revoked`);
  }

  // Signature verification
  // Message = SHA256(headerB64 + '.' + payloadB64) — same as JWT standard
  const signingInput = `${headerB64}.${payloadB64}`;
  const enc = new TextEncoder();
  const inputBytes = enc.encode(signingInput);
  const { sha256 } = await import('@noble/hashes/sha256');
  const { toHex, fromHex } = await import('./crypto.js');

  // Import hashHex pattern: hash the UTF-8 signing input, get hex
  const msgHex = toHex(sha256(inputBytes));
  const valid = await verifyEd25519(issuerPubKeyHex, msgHex, sigB64.replace(/-/g, '+').replace(/_/g, '/'));
  if (!valid) {
    throw new CardError('BAD_SIG', 'Card signature invalid');
  }

  // Capability check
  const capMatch = matchCapability(payload.cap, requiredOp, requiredChannel);
  if (!capMatch) {
    throw new CardError(
      'INSUFFICIENT_CAP',
      `Card has no ${requiredOp} capability for channel ${requiredChannel}`
    );
  }

  return payload;
}

export function matchCapability(
  caps: CapabilityEntry[],
  op: 'pub' | 'sub' | 'admin',
  channel: string
): CapabilityEntry | null {
  for (const cap of caps) {
    if (cap.op !== op && cap.op !== 'admin') continue;
    if (channelMatches(cap.channel, channel)) return cap;
  }
  return null;
}

function channelMatches(pattern: string, channel: string): boolean {
  if (pattern === '*') return true;
  if (pattern === channel) return true;
  if (pattern.endsWith('*')) {
    return channel.startsWith(pattern.slice(0, -1));
  }
  return false;
}

/**
 * Extract the sub (daemon_fingerprint) and issuer pub key from the card header.
 * The card's kid is the issuer's fingerprint; the relay looks up the pubkey in D1.
 */
export function extractCardSub(jwt: string): { sub: string; iss: string; jti: string } {
  const { payload } = decodeCard(jwt);
  return { sub: payload.sub, iss: payload.iss, jti: payload.jti };
}

/**
 * Extract a bare card from the Authorization header.
 * Expects: "Bearer <jwt>"
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}
