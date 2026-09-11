/**
 * OS-mediated custody for the revocable Port Daddy account credential.
 *
 * The historic `~/.port-daddy/account.json` record is migration input only.
 * Production never writes a replacement plaintext file and never falls back
 * when the platform credential store is unavailable. A legacy record is
 * deleted only after a Keychain write and exact read-back both succeed.
 */

import {
  constants as fsConstants,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { keychain, KEYCHAIN_SERVICE } from './keychain.js';
import { PD_HOME } from '../shared/paths.js';

export const DEFAULT_ACCOUNTS_RELAY_URL = 'https://relay.portdaddy.dev';
export const LEGACY_ACCOUNT_FILE = join(PD_HOME, 'account.json');
export const ACCOUNT_KEYCHAIN_ACCOUNT = 'account-device-token-v1';

export interface StoredAccount {
  token: string;
  login: string;
  relayUrl: string;
  createdAt: number;
}

export interface AccountSecretStore {
  available(): boolean;
  load(): string | null;
  save(value: string): boolean;
  delete(): boolean;
  description: string;
}

export interface AccountStoreOptions {
  secrets?: AccountSecretStore;
  legacyPath?: string;
}

const PDU_TOKEN_RE = /^pdu_[0-9a-f]{64}$/i;

const keychainAccountStore: AccountSecretStore = {
  available: () => keychain.available(),
  load: () => keychain.loadSecret(KEYCHAIN_SERVICE, ACCOUNT_KEYCHAIN_ACCOUNT),
  save: (value) => keychain.saveSecret(KEYCHAIN_SERVICE, ACCOUNT_KEYCHAIN_ACCOUNT, value),
  delete: () => keychain.deleteSecret(KEYCHAIN_SERVICE, ACCOUNT_KEYCHAIN_ACCOUNT),
  description: 'OS Keychain',
};

export function configuredAccountsRelayUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.PD_ACCOUNTS_RELAY_URL?.trim() || DEFAULT_ACCOUNTS_RELAY_URL;
  return normalizeRelayOrigin(value);
}

function normalizeRelayOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password
      || url.pathname.replace(/\/+$/, '') || url.search || url.hash) {
    throw new Error('Relay URL must be one HTTPS origin with no credentials, path, query, or fragment');
  }
  return url.origin;
}

function parseStoredAccount(raw: string): StoredAccount {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('account credential has invalid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('account credential has an invalid shape');
  }
  const row = parsed as Record<string, unknown>;
  if (typeof row.token !== 'string' || !PDU_TOKEN_RE.test(row.token)
      || typeof row.login !== 'string' || row.login.length > 255
      || !Number.isSafeInteger(row.createdAt) || (row.createdAt as number) <= 0
      || typeof row.relayUrl !== 'string') {
    throw new Error('account credential has an invalid shape');
  }
  let relayUrl: string;
  try { relayUrl = normalizeRelayOrigin(row.relayUrl); } catch { throw new Error('account credential has an invalid Relay origin'); }
  return {
    token: row.token,
    login: row.login,
    relayUrl,
    createdAt: row.createdAt as number,
  };
}

function serialize(account: StoredAccount): string {
  return JSON.stringify(parseStoredAccount(JSON.stringify(account)));
}

/** Read one legacy record without following links or accepting weak mode/owner state. */
function readLegacyAccount(path: string): StoredAccount | null {
  if (!existsSync(path)) return null;
  const before = lstatSync(path);
  const uid = process.getuid?.();
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1
      || (uid !== undefined && before.uid !== uid)) {
    throw new Error('legacy account credential has unsafe ownership or link state');
  }
  if ((before.mode & 0o077) !== 0) {
    throw new Error('legacy account credential permissions must be 0600 before migration');
  }
  let fd: number | null = null;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== before.ino || opened.dev !== before.dev
        || (uid !== undefined && opened.uid !== uid)) {
      throw new Error('legacy account credential changed while it was opened');
    }
    return parseStoredAccount(readFileSync(fd, 'utf8'));
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function removeVerifiedLegacy(path: string, expected: StoredAccount): void {
  const current = readLegacyAccount(path);
  if (!current || serialize(current) !== serialize(expected)) {
    throw new Error('legacy account credential changed before cleanup; it was preserved');
  }
  unlinkSync(path);
}

function backend(options: AccountStoreOptions): AccountSecretStore {
  return options.secrets ?? keychainAccountStore;
}

/**
 * Load from the OS store, performing the one supported plaintext migration.
 * No raw credential is printed or persisted anew.
 */
export function readStoredAccount(options: AccountStoreOptions = {}): StoredAccount | null {
  const secrets = backend(options);
  const legacyPath = options.legacyPath ?? LEGACY_ACCOUNT_FILE;
  if (!secrets.available()) {
    if (existsSync(legacyPath)) {
      throw new Error(`${secrets.description} is unavailable; legacy credential was preserved and cannot be used`);
    }
    return null;
  }

  const storedRaw = secrets.load();
  const legacy = readLegacyAccount(legacyPath);
  if (storedRaw) {
    const stored = parseStoredAccount(storedRaw);
    if (legacy) {
      if (serialize(legacy) !== serialize(stored)) {
        throw new Error('Keychain and legacy account credentials disagree; neither was changed');
      }
      removeVerifiedLegacy(legacyPath, legacy);
    }
    return stored;
  }
  if (!legacy) return null;

  const encoded = serialize(legacy);
  if (!secrets.save(encoded)) throw new Error(`failed to migrate account credential into ${secrets.description}`);
  const confirmed = secrets.load();
  if (!confirmed || serialize(parseStoredAccount(confirmed)) !== encoded) {
    throw new Error(`${secrets.description} read-back failed; legacy credential was preserved`);
  }
  removeVerifiedLegacy(legacyPath, legacy);
  return legacy;
}

/** Store only in the OS credential backend and require exact read-back. */
export function writeStoredAccount(account: StoredAccount, options: AccountStoreOptions = {}): void {
  const secrets = backend(options);
  const legacyPath = options.legacyPath ?? LEGACY_ACCOUNT_FILE;
  if (!secrets.available()) throw new Error(`${secrets.description} is unavailable; account credential was not stored`);
  // Snapshot and validate any historic plaintext before changing authority.
  // It may contain an older login token; after the new Keychain value is
  // confirmed, that exact old file is stale secret material and must go.
  const legacy = readLegacyAccount(legacyPath);
  const encoded = serialize(account);
  if (!secrets.save(encoded)) throw new Error(`failed to save account credential in ${secrets.description}`);
  const confirmed = secrets.load();
  if (!confirmed || serialize(parseStoredAccount(confirmed)) !== encoded) {
    throw new Error(`${secrets.description} read-back failed; account login is not confirmed`);
  }
  if (legacy) removeVerifiedLegacy(legacyPath, legacy);
}

/** Remove both secure authority and any exact, safely-validated legacy secret. */
export function removeStoredAccount(options: AccountStoreOptions = {}): boolean {
  const secrets = backend(options);
  const legacyPath = options.legacyPath ?? LEGACY_ACCOUNT_FILE;
  if (!secrets.available()) throw new Error(`${secrets.description} is unavailable; account credential was not removed`);
  const legacy = readLegacyAccount(legacyPath);
  const existed = secrets.load() !== null;
  // Remove plaintext first. If its inode or bytes raced, preserve both
  // authorities and make logout fail loudly rather than resurrecting a stale
  // account.json after the Keychain entry was deleted.
  if (legacy) removeVerifiedLegacy(legacyPath, legacy);
  if (existed && !secrets.delete()) throw new Error(`failed to remove account credential from ${secrets.description}`);
  if (secrets.load() !== null) throw new Error(`${secrets.description} still returns the removed credential`);
  return existed || legacy !== null;
}
