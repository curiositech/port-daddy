// the complete contents of tests/unit/purser/missing-env-vars.test.ts
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  emitSquidEvent,
  flushSquidEvents,
  resetSquidChains,
} from '../../../apps/fleet-executor/src/squid-events';
import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';

/** Helper: hex-encode a byte array. */
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Helper: base64url-encode a byte array. */
const base64UrlEncode = (bytes: Uint8Array) => {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

/** Construct a minimal payload for a squid event. */
const payload = { repo: 'test/repo', pr: 1, runId: '123' };

/** Generate a valid Ed25519 seed and corresponding harbor card. */
const generateIdentity = () => {
  const seed = ed.utils.randomPrivateKey(); // 32 bytes
  const seedHex = toHex(seed);
  const pub = ed.getPublicKey(seed);
  const fingerprint = toHex(sha256(pub));

  // Header can be anything; payload must contain sub and iss.
  const header = base64UrlEncode(new TextEncoder().encode('{}'));
  const cardPayload = { sub: fingerprint, iss: 'relay-fp' };
  const payloadPart = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(cardPayload))
  );
  const card = `${header}.${payloadPart}`;

  return { seedHex, card };
};

describe('squid event publishing – missing env vars', () => {
  let fetchMock: vi.Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-ignore
    globalThis.fetch = fetchMock;
    resetSquidChains();
  });

  afterEach(() => {
    resetSquidChains();
  });

  const expectNoFetch = async () => {
    // Wait a tick in case any async code fires.
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  };

  it('silently disables when RELAY_PUBLISH_URL is missing', async () => {
    const env = {
      FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: 'a'.repeat(64),
      FLEET_EXECUTOR_HARBOR_CARD: 'header.payload',
    } as any;
    expectNoFetch();
    emitSquidEvent(env, 'run-started', payload, true);
    await expectNoFetch();
  });

  it('silently disables when FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX is missing', async () => {
    const env = {
      RELAY_PUBLISH_URL: 'https://relay.example',
      FLEET_EXECUTOR_HARBOR_CARD: 'header.payload',
    } as any;
    expectNoFetch();
    emitSquidEvent(env, 'run-started', payload, true);
    await expectNoFetch();
  });

  it('silently disables when FLEET_EXECUTOR_HARBOR_CARD is missing', async () => {
    const env = {
      RELAY_PUBLISH_URL: 'https://relay.example',
      FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: 'a'.repeat(64),
    } as any;
    expectNoFetch();
    emitSquidEvent(env, 'run-started', payload, true);
    await expectNoFetch();
  });

  it('silently disables when tenantOptIn is false', async () => {
    const { seedHex, card } = generateIdentity();
    const env = {
      RELAY_PUBLISH_URL: 'https://relay.example',
      FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: seedHex,
      FLEET_EXECUTOR_HARBOR_CARD: card,
    } as any;
    expectNoFetch();
    emitSquidEvent(env, 'run-started', payload, false);
    await expectNoFetch();
  });

  it('publishes when all required env vars are present and tenantOptIn is true', async () => {
    const { seedHex, card } = generateIdentity();
    const env = {
      RELAY_PUBLISH_URL: 'https://relay.example',
      FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: seedHex,
      FLEET_EXECUTOR_HARBOR_CARD: card,
    } as any;

    // Emit the event.
    emitSquidEvent(env, 'run-started', payload, true);

    // Wait for any queued publish to complete.
    await flushSquidEvents();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0];
    const [url, options] = callArgs;
    expect(url).toBe(env.RELAY_PUBLISH_URL);
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body as string);
    expect(body).toHaveProperty('card', card);
    expect(body).toHaveProperty('event');
    expect(body.event).toHaveProperty('sender');
    expect(body.event).toHaveProperty('channel');
    expect(body.event).toHaveProperty('seq');
    expect(body.event).toHaveProperty('prev_hash');
    expect(body.event).toHaveProperty('this_hash');
    expect(body.event).toHaveProperty('iat');
    expect(body.event).toHaveProperty('ciphertext');
    expect(body.event).toHaveProperty('sig');
  });
});