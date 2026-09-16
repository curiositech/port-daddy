/**
 * The daemon classification chokepoint (lib/relay-seal.ts):
 *
 *   1. BINDING PARITY — the daemon's envelopeBindingMessage reproduces the
 *      relay's pinned known-answer digests (apps/relay/tests/envelope.test.ts
 *      and the schema description carry the same constants). This is the
 *      cross-implementation contract: the two sides cannot import each other,
 *      so the shared vectors are what keeps a daemon signature verifiable at
 *      the relay.
 *   2. SEALING — sealRelayEvent emits an A1 sealed envelope whose ciphertext
 *      is the pd-vault construction (opens back exactly; splices fail with the
 *      vault's one opaque error).
 *   3. NO THIRD STATE — the classifier throws UNCLASSIFIED on unlabeled
 *      bodies, relay_readable demands a non-blank reason, and the runtime
 *      transit assertion kills a cast-past-the-brand before the wire.
 *
 * Premise assertions throughout: each negative first proves its setup really
 * creates the condition under test.
 */

import { describe, it, expect } from '@jest/globals';
import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

import {
  ENVELOPE_SCHEMA_ID,
  classifyDaemonRelayEnvelope,
  envelopeBindingMessage,
  canonicalJson,
  sealRelayEvent,
  relayReadableEvent,
  openSealedRelayEvent,
  assertClassifiedTransit,
  DaemonEnvelopeError,
  type EnvelopeSigner,
  type RelayRouting,
  type SealedEnvelope,
} from '../../lib/relay-seal.js';
import { VaultTsError } from '../../lib/pd-vault-ts.js';

// ── Test signer: the SAME documented key as the relay's vectors ──────────────
// Private key = '11' * 32 (the relay suite's signing key), wrapped as PKCS8 so
// node:crypto can hold it. Deriving the public key here and asserting it
// equals the schema-documented VECTOR_KEY is itself a premise assertion: it
// proves node-crypto and the relay's @noble derive the same identity from the
// same seed before any signature is compared.
const SEED = Buffer.from('11'.repeat(32), 'hex');
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const privKey = createPrivateKey({
  key: Buffer.concat([PKCS8_ED25519_PREFIX, SEED]),
  format: 'der',
  type: 'pkcs8',
});
const pubKeyObj = createPublicKey(privKey);
const PUB_HEX = (pubKeyObj.export({ type: 'spki', format: 'der' }) as Buffer)
  .subarray(-32)
  .toString('hex');
const VECTOR_KEY = 'd04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737';

const signer: EnvelopeSigner = {
  keyIdHex: PUB_HEX,
  signHex: async (msgHex: string) =>
    cryptoSign(null, Buffer.from(msgHex, 'hex'), privKey).toString('hex'),
};

const HARBOR = 'a'.repeat(64);
const routing: RelayRouting = {
  harbor: HARBOR,
  channel: `${HARBOR}:ops:deploys`,
  sender: 'f'.repeat(64),
  seq: 9,
  iat: 1755648000,
};
const harborSecret = Buffer.alloc(32, 0x5a);

describe('binding parity with the relay (shared known-answer digests)', () => {
  it('premise: node-crypto derives the documented vector key from the documented seed', () => {
    expect(PUB_HEX).toBe(VECTOR_KEY);
  });

  it('KNOWN ANSWER: relay_readable binding digest matches the relay suite', () => {
    const readable = {
      schema: ENVELOPE_SCHEMA_ID,
      v: 1,
      classification: 'relay_readable',
      harbor: 'github',
      channel: 'github:webhook:pull_request',
      sender: 'f'.repeat(64),
      seq: 3,
      iat: 1755648000,
      payload: { event_type: 'pull_request', delivery_id: 'd-3' },
      reason: 'github webhook relay: payload is GitHub-public data',
    } as never;
    expect(envelopeBindingMessage(readable, VECTOR_KEY)).toBe(
      'dba03ec1e47df6c683967c20bedad01f4b94d4f013de98132dab089c3a62404c'
    );
  });

  it('KNOWN ANSWER: sealed binding digest matches the relay suite', () => {
    const sealed = {
      schema: ENVELOPE_SCHEMA_ID,
      v: 1,
      classification: 'sealed',
      harbor: 'a'.repeat(64),
      channel: `${'a'.repeat(64)}:ops:deploys`,
      sender: 'f'.repeat(64),
      seq: 9,
      iat: 1755648000,
      alg: 'aes-256-gcm',
      epoch: 1,
      nonce: 'AAAAAAAAAAAAAAAB',
      ciphertext: 'kx3fO2ZQm1sVJb9tYc4hRw7nE8pLdAq6uG5iT0XyBjM',
    } as never;
    expect(envelopeBindingMessage(sealed, VECTOR_KEY)).toBe(
      'c4b649b4985c0150b9d7c4b5c4bcf6776146f13c00a7d980659f977d0c61101c'
    );
  });

  it('canonicalJson sorts keys, keeps array order, drops undefined (relay semantics)', () => {
    expect(canonicalJson({ b: 1, a: [2, 1], c: undefined })).toBe('{"a":[2,1],"b":1}');
  });
});

describe('sealRelayEvent — the sealed half of the chokepoint', () => {
  it('emits a classified, signed, pd-vault-sealed A1 envelope that opens back exactly', async () => {
    const classified = await sealRelayEvent({
      routing,
      plaintext: 'berth 4 is clear',
      harborSecret,
      epoch: 4,
      signer,
    });

    const env = classified.envelope as SealedEnvelope;
    expect(env.classification).toBe('sealed');
    expect(env.alg).toBe('xchacha20-poly1305');
    expect(env.epoch).toBe(4);
    // PREMISE: the ciphertext is not the plaintext in disguise.
    expect(Buffer.from(env.ciphertext, 'base64url').toString('utf8')).not.toBe('berth 4 is clear');
    // The classifier accepts its own product (self-parity of mint and gate).
    expect(() => classifyDaemonRelayEnvelope(env)).not.toThrow();

    // The transit is the base64url JSON of exactly this envelope.
    expect(JSON.parse(Buffer.from(classified.transit, 'base64url').toString('utf8'))).toEqual(env);

    // Round trip: the subscriber-side inverse recovers the plaintext.
    const opened = openSealedRelayEvent(env, harborSecret);
    expect(opened.toString('utf8')).toBe('berth 4 is clear');
  });

  it('signature verifies against the binding and dies when the routing tuple moves', async () => {
    const classified = await sealRelayEvent({
      routing,
      plaintext: 'all fast',
      harborSecret,
      epoch: 1,
      signer,
    });
    const env = classified.envelope;

    const verifies = (candidate: typeof env) =>
      cryptoVerify(
        null,
        Buffer.from(envelopeBindingMessage(candidate, PUB_HEX), 'hex'),
        pubKeyObj,
        Buffer.from(env.sig.value, 'hex')
      );

    // PREMISE: the untouched envelope verifies.
    expect(verifies(env)).toBe(true);
    // A replayed seq is a different binding message, so the signature fails.
    expect(verifies({ ...env, seq: env.seq + 1 })).toBe(false);
    // Same for a channel splice.
    expect(verifies({ ...env, channel: `${HARBOR}:ops:other` })).toBe(false);
  });

  it('the sealed body cannot be opened under a spliced context (vault AAD binding)', async () => {
    const classified = await sealRelayEvent({
      routing,
      plaintext: 'secret cargo',
      harborSecret,
      epoch: 2,
      signer,
    });
    const env = classified.envelope as SealedEnvelope;

    // PREMISE: it opens under its own context.
    expect(openSealedRelayEvent(env, harborSecret).toString('utf8')).toBe('secret cargo');

    // Relabelled into a sibling channel (with the harbor prefix intact so the
    // classifier is not what rejects it): the AEAD refuses, opaquely.
    const spliced = { ...env, channel: `${HARBOR}:ops:other` };
    try {
      openSealedRelayEvent(spliced, harborSecret);
      throw new Error('expected the splice to fail');
    } catch (e) {
      expect(e).toBeInstanceOf(VaultTsError);
      expect((e as VaultTsError).message).toBe('decryption failed');
    }
  });

  it('refuses a routing tuple whose channel does not carry the harbor prefix', async () => {
    await expect(
      sealRelayEvent({
        routing: { ...routing, channel: 'other:ops:deploys' },
        plaintext: 'x',
        harborSecret,
        epoch: 1,
        signer,
      })
    ).rejects.toThrow(DaemonEnvelopeError);
  });
});

describe('relayReadableEvent — the labeled-plaintext half', () => {
  it('emits a classified envelope carrying payload and reason', async () => {
    const classified = await relayReadableEvent({
      routing,
      payload: { kind: 'heartbeat', ok: true },
      reason: 'operational heartbeat: contains no payload data, only liveness',
      signer,
    });
    expect(classified.envelope.classification).toBe('relay_readable');
    expect(() => classifyDaemonRelayEnvelope(classified.envelope)).not.toThrow();
  });

  it.each(['', '   ', '  '])(
    'refuses a blank reason (%j) — the label is the audit trail',
    async (reason) => {
      // PREMISE: each candidate is non-null and (for the non-empty ones) has
      // length — the exact property a naive `.length` check would pass.
      expect(typeof reason).toBe('string');
      await expect(
        relayReadableEvent({ routing, payload: {}, reason, signer })
      ).rejects.toMatchObject({ code: 'MISSING_REASON' });
    }
  );
});

describe('no third state — unclassified cannot pass any gate', () => {
  it('classifier throws UNCLASSIFIED on an unlabeled body (the pre-N1 shape)', () => {
    const preN1 = { v: 1, sender: 'f'.repeat(64), body: 'aGVsbG8', sig: 'aa' };
    try {
      classifyDaemonRelayEnvelope(preN1);
      throw new Error('expected UNCLASSIFIED');
    } catch (e) {
      expect(e).toBeInstanceOf(DaemonEnvelopeError);
      expect((e as DaemonEnvelopeError).code).toBe('UNCLASSIFIED');
    }
  });

  it('assertClassifiedTransit accepts the mint and kills a forged transit at runtime', async () => {
    const classified = await relayReadableEvent({
      routing,
      payload: { n: 1 },
      reason: 'test stream: synthetic payload with no operator data',
      signer,
    });
    // PREMISE + positive: the minted transit re-classifies cleanly.
    expect(() => assertClassifiedTransit(classified.transit)).not.toThrow();

    // A caller that casts a raw base64url body past the brand reaches the
    // runtime gate and dies there — the wire is unreachable for it.
    const forged = Buffer.from(JSON.stringify({ hello: 'relay' }), 'utf8').toString('base64url');
    expect(() => assertClassifiedTransit(forged)).toThrow(DaemonEnvelopeError);
    // And a body that is not even base64url JSON is UNCLASSIFIED, not a crash.
    try {
      assertClassifiedTransit('%%%not-base64url%%%');
      throw new Error('expected UNCLASSIFIED');
    } catch (e) {
      expect((e as DaemonEnvelopeError).code).toBe('UNCLASSIFIED');
    }
  });

  it('an unsigned envelope does not classify (EMPTY_SIG family)', async () => {
    const classified = await relayReadableEvent({
      routing,
      payload: {},
      reason: 'test stream: synthetic payload with no operator data',
      signer,
    });
    const { sig: _sig, ...unsigned } = classified.envelope;
    expect(() => classifyDaemonRelayEnvelope(unsigned)).toThrow(DaemonEnvelopeError);
  });
});
