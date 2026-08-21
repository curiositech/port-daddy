// tests/unit/purser/invalid-identity.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { emitSquidEvent, flushSquidEvents, resetSquidChains } from '../../../apps/fleet-executor/src/squid-events';
import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';

/** Simple helpers used only in the test suite */
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const b64url = (str: string) =>
  Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

/** Create a minimal harbor card (JWT) that passes the identity check */
function makeCard(seedHex: string, fingerprint: string, relayFp: string): string {
  const header = { alg: 'EdDSA', kid: relayFp };
  const payload = { sub: fingerprint, iss: relayFp };
  return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.`;
}

/** A very simple Ed25519 seed (32 zero bytes). */
const ZERO_SEED_HEX = '00'.repeat(64);
const ZERO_SEED = new Uint8Array(32);
const ZERO_FINGERPRINT = toHex(sha256(ed.getPublicKey(ZERO_SEED)));

const VISIBLE_URL = 'https://fake.relay/v1/publish';
const TENANT_OPT_IN = true;

/** Reset the squid chain state between tests. */
beforeEach(() => {
  resetSquidChains();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('squid-events: invalid or missing identity credentials', () => {
  it('silently disables when private key is missing', async () => {
    const env = {
      RELAY_PUBLISH_URL: VISIBLE_URL,
      FLEET_EXECUTOR_HARBOR_CARD: makeCard(ZERO_SEED_HEX, ZERO_FINGERPRINT, ZERO_FINGERPRINT),
      tenantOptIn: TENANT_OPT_IN,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.spyOn(global, 'fetch').mockImplementation(fetchMock);

    expect(() => emitSquidEvent(env, 'run-started', { runId: '123', repoFullName: 'org/repo', pr: 1 })).not.toThrow();
    await flushSquidEvents();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('silently disables when harbor card is missing', async () => {
    const env = {
      RELAY_PUBLISH_URL: VISIBLE_URL,
      FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: ZERO_SEED_HEX,
      tenantOptIn: TENANT_OPT_IN,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.spyOn(global, 'fetch').mockImplementation(fetchMock);

    expect(() => emitSquidEvent(env, 'run-started', { runId: '123', repoFullName: 'org/repo', pr: 1 })).not.toThrow();
    await flushSquidEvents();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('silently disables when private key hex is invalid', async () => {
    const env = {
      RELAY_PUBLISH_URL: VISIBLE_URL,
      FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', // invalid hex
      FLEET_EXECUTOR_HARBOR_CARD: makeCard(ZERO_SEED_HEX, ZERO_FINGERPRINT, ZERO_FINGERPRINT),
      tenantOptIn: TENANT_OPT_IN,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.spyOn(global, 'fetch').mockImplementation(fetchMock);

    expect(() => emitSquidEvent(env, 'run-started', { runId: '123', repoFullName: 'org/repo', pr: 1 })).not.toThrow();
    await flushSquidEvents();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('silently disables when harbor card payload.sub mismatches fingerprint', async () => {
    const env = {
      RELAY_PUBLISH_URL: VISIBLE_URL,
      FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: ZERO_SEED_HEX,
      // fabricate a card with a different sub
      FLEET_EXECUTOR_HARBOR_CARD: makeCard(ZERO_SEED_HEX, 'deadbeef', ZERO_FINGERPRINT),
      tenantOptIn: TENANT_OPT_IN,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.spyOn(global, 'fetch').mockImplementation(fetchMock);

    expect(() => emitSquidEvent(env, 'run-started', { runId: '123', repoFullName: 'org/repo', pr: 1 })).not.toThrow();
    await flushSquidEvents();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('silently disables when harbor card is malformed', async () => {
    const env = {
      RELAY_PUBLISH_URL: VISIBLE_URL,
      FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: ZERO_SEED_HEX,
      // malformed JWT (no payload part)
      FLEET_EXECUTOR_HARBOR_CARD: 'malformed.jwt',
      tenantOptIn: TENANT_OPT_IN,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.spyOn(global, 'fetch').mockImplementation(fetchMock);

    expect(() => emitSquidEvent(env, 'run-started', { runId: '123', repoFullName: 'org/repo', pr: 1 })).not.toThrow();
    await flushSquidEvents();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});