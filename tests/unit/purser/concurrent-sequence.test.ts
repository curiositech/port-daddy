// tests/unit/purser/concurrent-sequence.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  emitSquidEvent,
  flushSquidEvents,
  resetSquidChains,
  computeSquidEventHash,
  SQUID_CHANNEL_FAMILY,
} from '../../../apps/fleet-executor/src/squid-events';
import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';

/**
 * Helper to create a minimal Ed25519 key pair and a matching harbor card JWT.
 * The card payload must contain `sub` equal to the public‑key fingerprint
 * (SHA‑256 hex of the public key) and `iss` equal to the relay fingerprint.
 */
function createIdentity(seedHex: string, relayFp: string) {
  const seed = Uint8Array.from(Buffer.from(seedHex, 'hex'));
  const pub = ed.getPublicKey(seed);
  const fingerprint = Buffer.from(sha256(pub)).toString('hex');

  // Base64url encode helper
  const b64url = (buf: Buffer) =>
    buf.toString('base64').replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');

  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'EdDSA', kid: relayFp })));
  const payload = b64url(Buffer.from(JSON.stringify({ sub: fingerprint, iss: relayFp })));
  // Signature is irrelevant for the tests – the code never verifies it.
  const card = `${header}.${payload}.`;

  return { seedHex, fingerprint, card };
}

describe('squid-events concurrent sequence handling', () => {
  const relayUrl = 'http://mock-relay';
  const relayFp = 'relayFp';
  const runId = 'run-123';
  const tenantOptIn = true;

  // Use a deterministic seed
  const seedHex = '0000000000000000000000000000000000000000000000000000000000000000';
  const { card, fingerprint } = createIdentity(seedHex, relayFp);

  // Mock fetch to capture requests
  const fetchCalls: any[] = [];
  beforeEach(() => {
    fetchCalls.length = 0;
    vi.stubGlobal('fetch', async (_url: string, opts: any) => {
      // Capture the request body
      fetchCalls.push(JSON.parse(opts.body));
      return { status: 200 };
    });
    // Reset chains and identity cache before each test
    resetSquidChains();
  });

  it('emits events with strictly increasing seq numbers and correct hash chain', async () => {
    const env = {
      RELAY_PUBLISH_URL: relayUrl,
      FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: seedHex,
      FLEET_EXECUTOR_HARBOR_CARD: card,
      FLEET_DEPLOYMENT: 'default',
    };

    // Emit 5 events concurrently
    const payloads = Array.from({ length: 5 }, (_, i) => ({
      runId,
      repo: `org/repo-${i}`,
      pr: i + 1,
    }));
    // Fire them without awaiting – they queue on the channel tail
    payloads.forEach((p) => emitSquidEvent(env, 'run-started', p, tenantOptIn));

    // Wait for all queued publishes to finish
    await flushSquidEvents();

    // Exactly 5 POSTs should have been made
    expect(fetchCalls).toHaveLength(5);

    // Verify sequence and chain integrity
    const channel = `${relayFp}:${SQUID_CHANNEL_FAMILY}:${runId}`;
    let expectedPrevHash = '0'.repeat(64);
    let expectedSeq = 1;

    for (const call of fetchCalls) {
      const { card: sentCard, event } = call;
      // Card must match the one we provided
      expect(sentCard).toBe(card);

      // Verify channel, seq, prev_hash, this_hash, and fingerprint
      expect(event.channel).toBe(channel);
      expect(event.seq).toBe(expectedSeq);
      expect(event.prev_hash).toBe(expectedPrevHash);
      expect(event.sender).toBe(fingerprint);
      expect(event.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));

      // Recompute this_hash and compare
      const expectedThisHash = computeSquidEventHash({
        prev_hash: event.prev_hash,
        sender: event.sender,
        channel: event.channel,
        seq: event.seq,
        iat: event.iat,
        ciphertext: event.ciphertext,
      });
      expect(event.this_hash).toBe(expectedThisHash);

      // Prepare for next iteration
      expectedPrevHash = event.this_hash;
      expectedSeq += 1;
    }
  });

  it('resets chain state correctly between tests', async () => {
    const env = {
      RELAY_PUBLISH_URL: relayUrl,
      FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX: seedHex,
      FLEET_EXECUTOR_HARBOR_CARD: card,
      FLEET_DEPLOYMENT: 'default',
    };

    // Emit a single event
    emitSquidEvent(env, 'run-started', { runId, repo: 'org/repo', pr: 1 }, tenantOptIn);
    await flushSquidEvents();

    expect(fetchCalls).toHaveLength(1);
    const firstSeq = fetchCalls[0].event.seq;
    expect(firstSeq).toBe(1);

    // Reset chains (as done in beforeEach) and emit again
    resetSquidChains();
    fetchCalls.length = 0;
    emitSquidEvent(env, 'run-started', { runId, repo: 'org/repo', pr: 2 }, tenantOptIn);
    await flushSquidEvents();

    expect(fetchCalls).toHaveLength(1);
    const secondSeq = fetchCalls[0].event.seq;
    // Sequence should start over after reset
    expect(secondSeq).toBe(1);
  });
});