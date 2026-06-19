/**
 * Port Daddy Relay — Cryptographic helpers
 *
 * All crypto is Web Crypto API (Workers-native).
 * Ed25519 operations use @noble/ed25519 for sign/verify in Workers
 * (Web Crypto API does not support Ed25519 in all Workers runtimes yet).
 *
 * Hash algorithm: SHA-256.
 * Signature algorithm: Ed25519 (raw 32-byte seed, raw 32-byte pubkey, raw 64-byte sig, hex transport).
 */

import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';

// Wire @noble/ed25519's SYNCHRONOUS hash. signAsync/verifyAsync use WebCrypto's
// async SHA-512, but the sync getPublicKey() (used by pubKeyFromPrivKey, which
// every handshake/publish/exchange calls to derive the relay's own fingerprint)
// needs ed.etc.sha512Sync set or it throws "hashes.sha512Sync not set". Nothing
// else wired it, so the sync path threw on every publish — undetected until the
// handlePublish tests. Set it once at module load.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export const ZERO_HASH = '0'.repeat(64);

// ── Hex helpers ──────────────────────────────────────────────────────────────

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// ── SHA-256 ──────────────────────────────────────────────────────────────────

export function hashHex(input: string): string {
  const enc = new TextEncoder();
  return toHex(sha256(enc.encode(input)));
}

export function hashBytes(input: Uint8Array): Uint8Array {
  return sha256(input);
}

// ── Event chain hash ─────────────────────────────────────────────────────────
//
// Canonical fields committed per event (cross-language compatible with
// skills/pd-relay-zero-trust/scripts/chain_verify.py):
//   prev_hash (hex) + sender (hex) + channel + seq (decimal) + iat (decimal) + ciphertext
//
// All fields are ASCII/UTF-8; concatenated with '|' separator.

export function computeEventHash(fields: {
  prev_hash: string;
  sender: string;
  channel: string;
  seq: number;
  iat: number;
  ciphertext: string;
}): string {
  const canonical = [
    fields.prev_hash,
    fields.sender,
    fields.channel,
    String(fields.seq),
    String(fields.iat),
    fields.ciphertext,
  ].join('|');
  return hashHex(canonical);
}

// ── Ed25519 ──────────────────────────────────────────────────────────────────

export async function verifyEd25519(
  pubKeyHex: string,
  messageHex: string,
  sigHex: string
): Promise<boolean> {
  try {
    const pubKey = fromHex(pubKeyHex);
    const message = fromHex(messageHex);
    const sig = fromHex(sigHex);
    return await ed.verifyAsync(sig, message, pubKey);
  } catch {
    return false;
  }
}

export async function signEd25519(
  privKeyHex: string,
  messageHex: string
): Promise<string> {
  const privKey = fromHex(privKeyHex);
  const message = fromHex(messageHex);
  const sig = await ed.signAsync(message, privKey);
  return toHex(sig);
}

export function pubKeyFromPrivKey(privKeyHex: string): string {
  const privKey = fromHex(privKeyHex);
  return toHex(ed.getPublicKey(privKey));
}

// ── Constant-time string compare ─────────────────────────────────────────────

export function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= ca ^ cb;
  }
  return mismatch === 0;
}

// ── Random ───────────────────────────────────────────────────────────────────

export function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

// ── Base64URL ────────────────────────────────────────────────────────────────

export function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = 4 - (padded.length % 4 || 4);
  const b64 = padded + '='.repeat(pad === 4 ? 0 : pad);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function base64UrlEncode(input: Uint8Array): string {
  return btoa(String.fromCharCode(...input))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ── Chain head signing ───────────────────────────────────────────────────────
//
// Relay signs chain heads so subscribers can verify they haven't been tampered.
// Message: SHA256( sender + "|" + channel + "|" + tip_seq + "|" + tip_hash )

export async function signChainHead(
  relayPrivKeyHex: string,
  sender: string,
  channel: string,
  tipSeq: number,
  tipHash: string
): Promise<string> {
  const msg = hashHex([sender, channel, String(tipSeq), tipHash].join('|'));
  return signEd25519(relayPrivKeyHex, msg);
}

// ── ServerHello signing ──────────────────────────────────────────────────────

export async function signServerHello(
  relayPrivKeyHex: string,
  sessionId: string,
  nonceC: string,
  nonceS: string
): Promise<string> {
  const msg = hashHex([sessionId, nonceC, nonceS].join('|'));
  return signEd25519(relayPrivKeyHex, msg);
}
