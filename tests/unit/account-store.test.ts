import { afterEach, describe, expect, test } from '@jest/globals';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  readStoredAccount,
  removeStoredAccount,
  writeStoredAccount,
  type AccountSecretStore,
  type StoredAccount,
} from '../../lib/account-store.js';

const roots: string[] = [];
function scratch(): string {
  const parent = join(homedir(), 'coding', 'tmp');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'pd-account-store-test-'));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const account: StoredAccount = {
  token: `pdu_${'a'.repeat(64)}`,
  login: 'fleet-operator',
  relayUrl: 'https://relay.portdaddy.dev',
  createdAt: 1,
};

function memoryStore(seed: string | null = null, overrides: Partial<AccountSecretStore> = {}) {
  let value = seed;
  const store: AccountSecretStore = {
    available: () => true,
    load: () => value,
    save: (next) => { value = next; return true; },
    delete: () => { value = null; return true; },
    description: 'test keychain',
    ...overrides,
  };
  return { store, value: () => value };
}

describe('OS-backed account store', () => {
  test('stores only in the credential backend and requires exact read-back', () => {
    const root = scratch();
    const secret = memoryStore();
    writeStoredAccount(account, { secrets: secret.store, legacyPath: join(root, 'absent.json') });
    expect(readStoredAccount({ secrets: secret.store, legacyPath: join(root, 'absent.json') })).toEqual(account);
    expect(secret.value()).toContain('fleet-operator');
  });

  test('a confirmed new login removes the exact stale legacy plaintext', () => {
    const path = join(scratch(), 'account.json');
    const stale = { ...account, token: `pdu_${'b'.repeat(64)}` };
    writeFileSync(path, JSON.stringify(stale), { mode: 0o600 });
    const secret = memoryStore();

    writeStoredAccount(account, { secrets: secret.store, legacyPath: path });

    expect(() => readFileSync(path, 'utf8')).toThrow();
    expect(JSON.parse(secret.value() ?? '{}')).toEqual(account);
  });

  test('migrates a private legacy record, verifies read-back, then deletes it', () => {
    const path = join(scratch(), 'account.json');
    writeFileSync(path, JSON.stringify(account), { mode: 0o600 });
    const secret = memoryStore();
    expect(readStoredAccount({ secrets: secret.store, legacyPath: path })).toEqual(account);
    expect(() => readFileSync(path, 'utf8')).toThrow();
    expect(JSON.parse(secret.value() ?? '{}')).toEqual(account);
  });

  test('preserves legacy bytes when Keychain read-back is ambiguous', () => {
    const path = join(scratch(), 'account.json');
    writeFileSync(path, JSON.stringify(account), { mode: 0o600 });
    const secret = memoryStore(null, { load: () => null });
    expect(() => readStoredAccount({ secrets: secret.store, legacyPath: path })).toThrow(/read-back failed/);
    expect(readFileSync(path, 'utf8')).toContain('fleet-operator');
  });

  test('refuses plaintext fallback when the OS backend is unavailable', () => {
    const path = join(scratch(), 'account.json');
    writeFileSync(path, JSON.stringify(account), { mode: 0o600 });
    const secret = memoryStore(null, { available: () => false });
    expect(() => readStoredAccount({ secrets: secret.store, legacyPath: path })).toThrow(/unavailable/);
    expect(readFileSync(path, 'utf8')).toContain('fleet-operator');
  });

  test('rejects weak-mode and symlink legacy records without touching targets', () => {
    const root = scratch();
    const path = join(root, 'account.json');
    writeFileSync(path, JSON.stringify(account), { mode: 0o644 });
    chmodSync(path, 0o644);
    expect(() => readStoredAccount({ secrets: memoryStore().store, legacyPath: path })).toThrow(/0600/);
    rmSync(path);
    const target = join(root, 'target.json');
    writeFileSync(target, JSON.stringify(account), { mode: 0o600 });
    symlinkSync(target, path);
    expect(() => readStoredAccount({ secrets: memoryStore().store, legacyPath: path })).toThrow(/unsafe ownership/);
    expect(readFileSync(target, 'utf8')).toContain('fleet-operator');
  });

  test('write and logout fail before changing Keychain when legacy cleanup is unsafe', () => {
    const root = scratch();
    const path = join(root, 'account.json');
    const original = JSON.stringify({ ...account, token: `pdu_${'b'.repeat(64)}` });
    writeFileSync(path, original, { mode: 0o644 });
    chmodSync(path, 0o644);
    const secret = memoryStore(JSON.stringify(account));

    expect(() => writeStoredAccount({ ...account, login: 'new-login' }, {
      secrets: secret.store,
      legacyPath: path,
    })).toThrow(/0600/);
    expect(JSON.parse(secret.value() ?? '{}')).toEqual(account);
    expect(() => removeStoredAccount({ secrets: secret.store, legacyPath: path })).toThrow(/0600/);
    expect(JSON.parse(secret.value() ?? '{}')).toEqual(account);
    expect(readFileSync(path, 'utf8')).toBe(original);

    rmSync(path);
    const target = join(root, 'target.json');
    writeFileSync(target, original, { mode: 0o600 });
    symlinkSync(target, path);
    expect(() => writeStoredAccount(account, { secrets: secret.store, legacyPath: path })).toThrow(/unsafe ownership/);
    expect(() => removeStoredAccount({ secrets: secret.store, legacyPath: path })).toThrow(/unsafe ownership/);
    expect(JSON.parse(secret.value() ?? '{}')).toEqual(account);
    expect(readFileSync(target, 'utf8')).toBe(original);
  });

  test('never returns a removed token and rejects malformed stored values', () => {
    const root = scratch();
    const secret = memoryStore(JSON.stringify(account));
    expect(removeStoredAccount({ secrets: secret.store, legacyPath: join(root, 'absent.json') })).toBe(true);
    expect(secret.value()).toBeNull();
    const malformed = memoryStore(JSON.stringify({ ...account, token: 'ghp_secret' }));
    expect(() => readStoredAccount({ secrets: malformed.store, legacyPath: join(root, 'absent.json') })).toThrow(/invalid shape/);
  });

  test('logout removes a safely validated legacy plaintext and the secure credential', () => {
    const path = join(scratch(), 'account.json');
    const stale = { ...account, token: `pdu_${'b'.repeat(64)}` };
    writeFileSync(path, JSON.stringify(stale), { mode: 0o600 });
    const secret = memoryStore(JSON.stringify(account));

    expect(removeStoredAccount({ secrets: secret.store, legacyPath: path })).toBe(true);
    expect(secret.value()).toBeNull();
    expect(() => readFileSync(path, 'utf8')).toThrow();
  });
});
