/**
 * lib/account.ts — First-class Port Daddy user identity (ADR-0029, Phases A0 + A1).
 *
 * ════════════════════════════════════════════════════════════════════════
 *  WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════
 * Port Daddy's identity stack historically had one layer: the per-machine
 * *daemon* key. A *user* — the human behind one or more daemons — had no
 * first-class representation, so a second machine was a stranger and there
 * was no way to say "this Mac and this PC belong to the same person."
 *
 * This module adds the second layer ADR-0029 calls for:
 *
 *   1. ACCOUNT IDENTITY (A0) — a durable account-owned Ed25519 keypair that
 *      is NOT the daemon key. The private seed lives in the OS keychain
 *      (file fallback when the keychain is unavailable); only public
 *      metadata is written to `~/.port-daddy/account.json`.
 *
 *   2. DEVICE / DAEMON IDENTITY — a per-machine Ed25519 key whose fingerprint
 *      (SHA-256 of its public key) names "this daemon" in pairing receipts.
 *
 *   3. THE PAIRING RECEIPT (A1) — the bilaterally-signed record that binds an
 *      account to a daemon. BOTH the account key and the device/daemon key
 *      sign the same RFC 8785 (JCS) canonical JSON. Neither is the root
 *      authority alone: an account-only signature proves intent but not
 *      daemon agreement, and vice versa.
 *
 * Everything here is local and offline. Cross-device transport (the relay
 * mesh of ADR-0027) and the portdaddy.dev account surface (ADR-0039) compose
 * on top of these primitives; they are out of scope for this slice.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  KEY CUSTODY
 * ════════════════════════════════════════════════════════════════════════
 * Account and device private seeds are 32-byte Ed25519 seeds, stored hex.
 * Preference order, per ADR-0029:
 *   1. OS keychain (`lib/keychain.ts`) when available.
 *   2. `~/.config/port-daddy/<name>.key`, mode 0600, as the documented
 *      file fallback.
 * Public material (account id, public keys, pairing receipts) is plaintext.
 */

import { createPrivateKey, createPublicKey, randomBytes, sign as edSignRaw, verify as edVerifyRaw, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, bytesToHex, hexToBytes } from './merkle-chain.js';
import { keychain, KEYCHAIN_SERVICE } from './keychain.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default capabilities granted to a freshly paired device (ADR-0029 §3 v1 sync scope). */
export const DEFAULT_PAIRING_CAPABILITIES = ['sync:sessions', 'sync:notes', 'sync:claims'];

/** Keychain account names for the two private seeds this module owns. */
const KEYCHAIN_ACCOUNT_SEED = 'account-ed25519-seed';
const KEYCHAIN_DEVICE_SEED = 'device-ed25519-seed';

/**
 * Standard DER prefixes for raw Ed25519 keys. Ed25519 keys are fixed-length,
 * so the ASN.1 wrappers are constant and a raw 32-byte key can be lifted into
 * a Node KeyObject by prepending the well-known prefix.
 */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OidcBinding {
  issuer: string;
  subject: string;
  boundAt: number;
}

/** Public account metadata, persisted to `~/.port-daddy/account.json`. */
export interface PdAccount {
  accountId: string; // base58btc(SHA-256(accountPubkey))
  accountPubkey: string; // base64url raw Ed25519 public key
  displayName: string; // cosmetic only; never authoritative
  oidcBindings: OidcBinding[];
  createdAt: number;
  revokedAt?: number;
}

/** Public device (daemon) metadata, persisted to `~/.port-daddy/device.json`. */
export interface PdDevice {
  daemonFingerprint: string; // SHA-256(devicePubkey), hex
  devicePubkey: string; // hex raw Ed25519 public key
  label: string;
  createdAt: number;
}

/** ADR-0029 §2 — the bilaterally-signed account⇄daemon binding. */
export interface PairingReceipt {
  version: 2;
  accountId: string;
  accountPubkey: string; // base64url raw Ed25519 public key
  daemonFingerprint: string; // SHA-256(devicePubkey), hex
  deviceLabel: string;
  issuedAt: number;
  expiresAt: number; // 0 = never
  nonce: string; // 128-bit random, hex; prevents replay
  capabilities: string[];
  accountSig: string; // Ed25519 sig over JCS of the receipt sans signatures, hex
  daemonSig: string; // daemon Ed25519 sig over the same bytes, hex
  revokedAt?: number; // local revocation marker (list-devices / revoke-device)
}

export interface VerifyReceiptResult {
  valid: boolean;
  accountSigValid: boolean;
  daemonSigValid: boolean;
  fingerprintMatches: boolean;
  expired: boolean;
}

/** Override storage roots — used by tests; production reads env / home dir. */
export interface AccountPaths {
  home?: string; // default $PORT_DADDY_HOME or ~/.port-daddy
  config?: string; // default $PORT_DADDY_CONFIG or ~/.config/port-daddy
}

// ─── Path resolution ──────────────────────────────────────────────────────────

function homeDir(p?: AccountPaths): string {
  return p?.home ?? process.env.PORT_DADDY_HOME ?? join(homedir(), '.port-daddy');
}
function configDir(p?: AccountPaths): string {
  return p?.config ?? process.env.PORT_DADDY_CONFIG ?? join(homedir(), '.config', 'port-daddy');
}
function accountJsonPath(p?: AccountPaths): string {
  return join(homeDir(p), 'account.json');
}
function deviceJsonPath(p?: AccountPaths): string {
  return join(homeDir(p), 'device.json');
}
function pairingsPath(p?: AccountPaths): string {
  return join(homeDir(p), 'account-pairings.json');
}

// ─── Low-level Ed25519 (raw 32-byte seeds / public keys) ──────────────────────

function privFromSeed(seed: Buffer): ReturnType<typeof createPrivateKey> {
  if (seed.length !== 32) throw new Error(`Ed25519 seed must be 32 bytes (got ${seed.length})`);
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}
function pubFromRaw(raw: Buffer): ReturnType<typeof createPublicKey> {
  if (raw.length !== 32) throw new Error(`Ed25519 public key must be 32 bytes (got ${raw.length})`);
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}
/** Derive the raw 32-byte public key for a seed. */
export function rawPubFromSeed(seed: Buffer): Buffer {
  const der = createPublicKey(privFromSeed(seed)).export({ format: 'der', type: 'spki' }) as Buffer;
  return der.subarray(-32);
}
function edSign(seed: Buffer, msg: Buffer): Buffer {
  return edSignRaw(null, msg, privFromSeed(seed));
}
function edVerify(rawPub: Buffer, msg: Buffer, sig: Buffer): boolean {
  try {
    return edVerifyRaw(null, msg, pubFromRaw(rawPub), sig);
  } catch {
    return false;
  }
}

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

// ─── base58btc (Bitcoin alphabet) ─────────────────────────────────────────────

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Encode bytes as base58btc. Leading zero bytes map to leading '1's. */
export function base58btcEncode(bytes: Buffer): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  // Convert the big-endian byte string into a base-58 digit string.
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}
function fromBase64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

/** Account id = base58btc(SHA-256(rawPublicKey)). */
export function accountIdFromRawPub(rawPub: Buffer): string {
  return base58btcEncode(sha256(rawPub));
}
/** Daemon fingerprint = SHA-256(rawPublicKey), hex. */
export function fingerprintFromRawPub(rawPub: Buffer): string {
  return bytesToHex(sha256(rawPub));
}

// ─── Private-seed custody (keychain preferred, file fallback) ──────────────────

function loadSeed(keychainAccount: string, fileName: string, p?: AccountPaths): Buffer | null {
  if (keychain.available()) {
    const hex = keychain.loadSecret(KEYCHAIN_SERVICE, keychainAccount);
    if (hex) return hexToBytes(hex.trim()) as unknown as Buffer;
  }
  const file = join(configDir(p), fileName);
  if (existsSync(file)) return hexToBytes(readFileSync(file, 'utf8').trim()) as unknown as Buffer;
  return null;
}

function saveSeed(keychainAccount: string, fileName: string, seed: Buffer, p?: AccountPaths): void {
  const hex = bytesToHex(seed);
  if (keychain.available() && keychain.saveSecret(KEYCHAIN_SERVICE, keychainAccount, hex)) return;
  const dir = configDir(p);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, fileName);
  writeFileSync(file, hex, { mode: 0o600 });
  chmodSync(file, 0o600); // writeFileSync mode is pre-umask; force 0600
}

function deleteSeed(keychainAccount: string, fileName: string, p?: AccountPaths): void {
  if (keychain.available()) keychain.deleteSecret(KEYCHAIN_SERVICE, keychainAccount);
  const file = join(configDir(p), fileName);
  if (existsSync(file)) rmSync(file);
}

// ─── Account identity (A0) ─────────────────────────────────────────────────────

export function loadAccount(p?: AccountPaths): PdAccount | null {
  const file = accountJsonPath(p);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as PdAccount;
}

export function loadAccountSeed(p?: AccountPaths): Buffer | null {
  return loadSeed(KEYCHAIN_ACCOUNT_SEED, 'account.key', p);
}

export function accountExists(p?: AccountPaths): boolean {
  return loadAccount(p) !== null;
}

/**
 * Create the account-owned Ed25519 identity (ADR-0029 A0). Generates a fresh
 * 32-byte seed, derives the account id, persists public metadata, and stashes
 * the private seed in the keychain (or file fallback).
 *
 * @throws if an account already exists and `force` is not set.
 */
export function createAccount(
  opts: { displayName?: string; force?: boolean } & AccountPaths = {},
): PdAccount {
  if (accountExists(opts) && !opts.force) {
    throw new Error('account already exists; pass force to overwrite (this rotates your account id)');
  }
  const seed = randomBytes(32);
  const rawPub = rawPubFromSeed(seed);
  const account: PdAccount = {
    accountId: accountIdFromRawPub(rawPub),
    accountPubkey: base64url(rawPub),
    displayName: opts.displayName ?? '',
    oidcBindings: [],
    createdAt: Date.now(),
  };
  const dir = homeDir(opts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(accountJsonPath(opts), JSON.stringify(account, null, 2) + '\n');
  saveSeed(KEYCHAIN_ACCOUNT_SEED, 'account.key', seed, opts);
  return account;
}

// ─── Device / daemon identity ──────────────────────────────────────────────────

export function loadDevice(p?: AccountPaths): PdDevice | null {
  const file = deviceJsonPath(p);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as PdDevice;
}

export function loadDeviceSeed(p?: AccountPaths): Buffer | null {
  return loadSeed(KEYCHAIN_DEVICE_SEED, 'device.key', p);
}

/**
 * Ensure a device (daemon) identity exists for this machine, creating one on
 * first use. The fingerprint of this key is what a pairing receipt binds an
 * account to. `label` is only applied when the device is first created.
 */
export function ensureDevice(label: string, p?: AccountPaths): PdDevice {
  const existing = loadDevice(p);
  if (existing) return existing;
  const seed = randomBytes(32);
  const rawPub = rawPubFromSeed(seed);
  const device: PdDevice = {
    daemonFingerprint: fingerprintFromRawPub(rawPub),
    devicePubkey: bytesToHex(rawPub),
    label,
    createdAt: Date.now(),
  };
  const dir = homeDir(p);
  mkdirSync(dir, { recursive: true });
  writeFileSync(deviceJsonPath(p), JSON.stringify(device, null, 2) + '\n');
  saveSeed(KEYCHAIN_DEVICE_SEED, 'device.key', seed, p);
  return device;
}

// ─── Pairing receipts (A1) ─────────────────────────────────────────────────────

/**
 * Canonical bytes that both keys sign: the receipt minus its two signatures
 * and the local-only `revokedAt` marker. RFC 8785 (JCS) via canonicalJson.
 */
export function receiptSigningBytes(
  receipt: Omit<PairingReceipt, 'accountSig' | 'daemonSig' | 'revokedAt'>,
): Buffer {
  const core = {
    version: receipt.version,
    accountId: receipt.accountId,
    accountPubkey: receipt.accountPubkey,
    daemonFingerprint: receipt.daemonFingerprint,
    deviceLabel: receipt.deviceLabel,
    issuedAt: receipt.issuedAt,
    expiresAt: receipt.expiresAt,
    nonce: receipt.nonce,
    capabilities: receipt.capabilities,
  };
  return Buffer.from(canonicalJson(core), 'utf8');
}

/**
 * Build a fully bilaterally-signed pairing receipt. Both the account seed and
 * the device seed sign the identical canonical bytes (ADR-0029 §2).
 */
export function buildPairingReceipt(input: {
  account: PdAccount;
  accountSeed: Buffer;
  device: PdDevice;
  deviceSeed: Buffer;
  deviceLabel?: string;
  expiresAt?: number;
  capabilities?: string[];
  issuedAt?: number;
  nonce?: string;
}): PairingReceipt {
  const core = {
    version: 2 as const,
    accountId: input.account.accountId,
    accountPubkey: input.account.accountPubkey,
    daemonFingerprint: input.device.daemonFingerprint,
    deviceLabel: input.deviceLabel ?? input.device.label,
    issuedAt: input.issuedAt ?? Date.now(),
    expiresAt: input.expiresAt ?? 0,
    nonce: input.nonce ?? bytesToHex(randomBytes(16)),
    capabilities: input.capabilities ?? [...DEFAULT_PAIRING_CAPABILITIES],
  };
  const msg = receiptSigningBytes(core);
  return {
    ...core,
    accountSig: bytesToHex(edSign(input.accountSeed, msg)),
    daemonSig: bytesToHex(edSign(input.deviceSeed, msg)),
  };
}

/**
 * Verify a pairing receipt. The daemon public key is supplied out-of-band
 * (the receipt stores only the fingerprint), and we check it hashes to the
 * receipt's `daemonFingerprint` before trusting the daemon signature.
 */
export function verifyPairingReceipt(
  receipt: PairingReceipt,
  accountPubkeyRaw: Buffer,
  devicePubkeyRaw: Buffer,
  now: number = Date.now(),
): VerifyReceiptResult {
  const msg = receiptSigningBytes(receipt);
  const fingerprintMatches = fingerprintFromRawPub(devicePubkeyRaw) === receipt.daemonFingerprint;
  const accountKeyMatches = base64url(accountPubkeyRaw) === receipt.accountPubkey;
  let accountSigValid = false;
  let daemonSigValid = false;
  try {
    accountSigValid = accountKeyMatches && edVerify(accountPubkeyRaw, msg, hexToBytes(receipt.accountSig) as unknown as Buffer);
  } catch {
    accountSigValid = false;
  }
  try {
    daemonSigValid = fingerprintMatches && edVerify(devicePubkeyRaw, msg, hexToBytes(receipt.daemonSig) as unknown as Buffer);
  } catch {
    daemonSigValid = false;
  }
  const expired = receipt.expiresAt !== 0 && now > receipt.expiresAt;
  return {
    valid: accountSigValid && daemonSigValid && fingerprintMatches && !expired,
    accountSigValid,
    daemonSigValid,
    fingerprintMatches,
    expired,
  };
}

// ─── Pairing store (local registry of receipts) ────────────────────────────────

export function loadPairings(p?: AccountPaths): PairingReceipt[] {
  const file = pairingsPath(p);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')) as PairingReceipt[];
}

function writePairings(receipts: PairingReceipt[], p?: AccountPaths): void {
  const dir = homeDir(p);
  mkdirSync(dir, { recursive: true });
  writeFileSync(pairingsPath(p), JSON.stringify(receipts, null, 2) + '\n');
}

/** Append a receipt, replacing any prior active receipt for the same fingerprint. */
export function savePairing(receipt: PairingReceipt, p?: AccountPaths): void {
  const all = loadPairings(p).filter(
    (r) => !(r.daemonFingerprint === receipt.daemonFingerprint && !r.revokedAt),
  );
  all.push(receipt);
  writePairings(all, p);
}

/** Mark the active receipt for a fingerprint revoked. Returns true if one was revoked. */
export function revokePairing(fingerprint: string, p?: AccountPaths): boolean {
  const all = loadPairings(p);
  let revoked = false;
  for (const r of all) {
    if (r.daemonFingerprint === fingerprint && !r.revokedAt) {
      r.revokedAt = Date.now();
      revoked = true;
    }
  }
  if (revoked) writePairings(all, p);
  return revoked;
}

/** Convenience: pair the local account with the local device, sign, and store. */
export function pairLocalDevice(
  opts: { deviceLabel?: string; expiresAt?: number; capabilities?: string[] } & AccountPaths = {},
): PairingReceipt {
  const account = loadAccount(opts);
  if (!account) throw new Error('no account; run `pd account create` first');
  const accountSeed = loadAccountSeed(opts);
  if (!accountSeed) throw new Error('account private key missing; cannot sign pairing receipt');
  const device = ensureDevice(opts.deviceLabel ?? 'this-device', opts);
  const deviceSeed = loadDeviceSeed(opts);
  if (!deviceSeed) throw new Error('device private key missing; cannot co-sign pairing receipt');
  const receipt = buildPairingReceipt({
    account,
    accountSeed,
    device,
    deviceSeed,
    deviceLabel: opts.deviceLabel,
    expiresAt: opts.expiresAt,
    capabilities: opts.capabilities,
  });
  savePairing(receipt, opts);
  return receipt;
}

/** Account public key as raw bytes, for verification. */
export function accountPubkeyRaw(account: PdAccount): Buffer {
  return fromBase64url(account.accountPubkey);
}
/** Device public key as raw bytes, for verification. */
export function devicePubkeyRaw(device: PdDevice): Buffer {
  return hexToBytes(device.devicePubkey) as unknown as Buffer;
}

/** Wipe local account + device credentials. Does NOT revoke published receipts. */
export function logoutLocal(p?: AccountPaths): void {
  deleteSeed(KEYCHAIN_ACCOUNT_SEED, 'account.key', p);
  for (const f of [accountJsonPath(p)]) if (existsSync(f)) rmSync(f);
}
