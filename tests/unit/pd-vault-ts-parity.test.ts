/**
 * Parity gate: the pure-TS reference vault (lib/pd-vault-ts.ts) must
 * reproduce the canonical Rust pd-vault crate byte for byte.
 *
 * The vectors in tests/fixtures/pd-vault-parity-vectors.json are copied from
 * the crate's known-answer constants (core/kernel/pd-vault, PR #9313). Per
 * ADR-0120, a second implementation of kernel crypto exists ONLY under a
 * shared fixture asserted by both suites — this file is the TS side of that
 * contract. If either implementation changes its bytes, this suite (or the
 * crate's) goes red instead of the two forking silently.
 *
 * Every negative test asserts its PREMISE first (the untampered input
 * actually opens; the collision actually collides) so a vacuous pass is
 * impossible.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  CHANNEL_KEY_LABEL,
  SEAL_AAD_LABEL,
  MIN_HARBOR_SECRET_LEN,
  NONCE_LEN,
  TAG_LEN,
  deriveChannelKey,
  encodeSealAad,
  hchacha20,
  open,
  randomNonce,
  referenceVault,
  seal,
  unambiguousEncoding,
  VaultTsError,
  type SealAad,
} from '../../lib/pd-vault-ts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(path.resolve(HERE, '../fixtures/pd-vault-parity-vectors.json'), 'utf8')
) as {
  labels: { channel_key_label: string; seal_aad_label: string };
  encoding_layout: { components_hex: string[]; encoded_hex: string };
  channel_key: {
    harbor_secret_hex: string;
    channel_id: string;
    epoch: number;
    key_hex: string;
    rotated_epoch: number;
    rotated_key_hex: string;
  };
  seal: {
    harbor_secret_hex: string;
    harbor_id: string;
    channel_id: string;
    epoch: number;
    seq: number;
    nonce_hex: string;
    plaintext_utf8: string;
    aad_hex: string;
    ciphertext_hex: string;
  };
};

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const fromHex = (h: string): Buffer => Buffer.from(h, 'hex');

const katSecret = fromHex(vectors.seal.harbor_secret_hex);
const katAad: SealAad = {
  harborId: vectors.seal.harbor_id,
  channelId: vectors.seal.channel_id,
  epoch: vectors.seal.epoch,
  seq: vectors.seal.seq,
};
const katKey = () => deriveChannelKey(katSecret, vectors.seal.channel_id, vectors.seal.epoch);
const katNonce = fromHex(vectors.seal.nonce_hex);
const katPlaintext = Buffer.from(vectors.seal.plaintext_utf8, 'utf8');

describe('pd-vault parity — labels and encoding layout', () => {
  it('uses the exact domain-separation labels the crate versions', () => {
    expect(CHANNEL_KEY_LABEL).toBe(vectors.labels.channel_key_label);
    expect(SEAL_AAD_LABEL).toBe(vectors.labels.seal_aad_label);
    // The two labels must be distinct or an AAD string could be mistaken for
    // a KDF info string.
    expect(CHANNEL_KEY_LABEL).not.toBe(SEAL_AAD_LABEL);
  });

  it('KNOWN ANSWER: unambiguous_encoding layout is byte-stable', () => {
    const encoded = unambiguousEncoding(vectors.encoding_layout.components_hex.map(fromHex));
    expect(hex(encoded)).toBe(vectors.encoding_layout.encoded_hex);
  });

  it('encoding is injective across the classic concatenation collision', () => {
    // PREMISE: these two component lists genuinely collide under plain
    // concatenation — otherwise this test passes against an encoder that does
    // nothing at all.
    const naiveLeft = Buffer.concat([Buffer.from('a'), Buffer.from('11')]);
    const naiveRight = Buffer.concat([Buffer.from('a1'), Buffer.from('1')]);
    expect(naiveLeft.equals(naiveRight)).toBe(true);

    const left = unambiguousEncoding([Buffer.from('a'), Buffer.from('11')]);
    const right = unambiguousEncoding([Buffer.from('a1'), Buffer.from('1')]);
    expect(left.equals(right)).toBe(false);
  });

  it('encoding separates arity and component boundaries', () => {
    expect(
      unambiguousEncoding([Buffer.from('ab'), Buffer.from('c')]).equals(
        unambiguousEncoding([Buffer.from('a'), Buffer.from('bc')])
      )
    ).toBe(false);
    expect(
      unambiguousEncoding([Buffer.from('a')]).equals(
        unambiguousEncoding([Buffer.from('a'), Buffer.alloc(0)])
      )
    ).toBe(false);
  });
});

describe('pd-vault parity — channel key derivation', () => {
  it('KNOWN ANSWER: derives the crate-pinned channel key and its rotation', () => {
    // PREMISE: the fixture's two epochs differ, so the rotation assertion is
    // about rotation and not a re-run of the first derivation.
    expect(vectors.channel_key.rotated_epoch).not.toBe(vectors.channel_key.epoch);

    const secret = fromHex(vectors.channel_key.harbor_secret_hex);
    const key = deriveChannelKey(secret, vectors.channel_key.channel_id, vectors.channel_key.epoch);
    expect(hex(key)).toBe(vectors.channel_key.key_hex);

    const rotated = deriveChannelKey(
      secret,
      vectors.channel_key.channel_id,
      vectors.channel_key.rotated_epoch
    );
    expect(hex(rotated)).toBe(vectors.channel_key.rotated_key_hex);
    expect(hex(rotated)).not.toBe(hex(key));
  });

  it('channel/epoch pairs cannot collide by concatenation', () => {
    const secret = fromHex(vectors.channel_key.harbor_secret_hex);
    expect(hex(deriveChannelKey(secret, 'a', 11))).not.toBe(hex(deriveChannelKey(secret, 'a1', 1)));
  });

  it('refuses a short harbor secret rather than stretching it', () => {
    // PREMISE: the refused input really is one byte under the floor.
    const short = Buffer.alloc(MIN_HARBOR_SECRET_LEN - 1, 1);
    expect(short.length).toBe(MIN_HARBOR_SECRET_LEN - 1);
    expect(() => deriveChannelKey(short, 'ops', 1)).toThrow(VaultTsError);
    try {
      deriveChannelKey(short, 'ops', 1);
    } catch (e) {
      expect((e as VaultTsError).code).toBe('WEAK_HARBOR_SECRET');
    }
  });

  it('refuses an empty channel id — an empty binding binds nothing', () => {
    expect(() => deriveChannelKey(katSecret, '', 1)).toThrow(/empty channel id/);
  });
});

describe('pd-vault parity — sealed payloads', () => {
  it('KNOWN ANSWER: AAD encoding and sealed ciphertext are byte-stable', () => {
    expect(hex(encodeSealAad(katAad))).toBe(vectors.seal.aad_hex);

    const sealed = seal(katKey(), katNonce, katPlaintext, katAad);
    expect(hex(sealed)).toBe(vectors.seal.ciphertext_hex);
    // And the exact inverse recovers the plaintext.
    expect(open(katKey(), katNonce, sealed, katAad).equals(katPlaintext)).toBe(true);
  });

  it('round-trips with a random nonce and appends exactly one tag', () => {
    const nonce = randomNonce();
    expect(nonce.length).toBe(NONCE_LEN);
    const sealed = seal(katKey(), nonce, katPlaintext, katAad);
    // PREMISE: the sealed bytes are not the plaintext (the AEAD ran at all).
    expect(sealed.equals(katPlaintext)).toBe(false);
    expect(sealed.length).toBe(katPlaintext.length + TAG_LEN);
    expect(open(katKey(), nonce, sealed, katAad).equals(katPlaintext)).toBe(true);
  });

  it('HChaCha20 matches the IETF draft test vector (draft-irtf-cfrg-xchacha §2.2.1)', () => {
    // Independent of the pd-vault fixture: this pins the ONE hand-implemented
    // primitive against its own published vector, so a wrong rotation or a
    // missing round is caught even if the fixture were regenerated wrongly.
    const key = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    const nonce = fromHex('000000090000004a0000000031415927');
    expect(hex(hchacha20(key, nonce))).toBe(
      '82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc'
    );
  });

  describe('every context splice fails closed with the one opaque error', () => {
    // PREMISE for the whole block, asserted once: the untampered ciphertext
    // opens. Without this, every negative below could pass because the setup
    // was broken, not because the defense worked.
    const sealed = seal(katKey(), katNonce, katPlaintext, katAad);
    it('premise: the untampered ciphertext opens under the sealing context', () => {
      expect(open(katKey(), katNonce, sealed, katAad).equals(katPlaintext)).toBe(true);
    });

    const expectOpaqueFailure = (fn: () => unknown) => {
      try {
        fn();
        throw new Error('expected a decryption failure');
      } catch (e) {
        expect(e).toBeInstanceOf(VaultTsError);
        expect((e as VaultTsError).code).toBe('DECRYPT');
        // The no-oracle invariant: the MESSAGE is identical for every failure
        // mode, so a caller that logs it cannot leak which check failed.
        expect((e as VaultTsError).message).toBe('decryption failed');
      }
    };

    it('wrong key fails', () => {
      const wrong = deriveChannelKey(Buffer.alloc(32, 1), katAad.channelId, katAad.epoch);
      expectOpaqueFailure(() => open(wrong, katNonce, sealed, katAad));
    });

    it('a flipped bit anywhere in the ciphertext fails', () => {
      for (const index of [0, sealed.length - TAG_LEN, sealed.length - 1]) {
        const tampered = Buffer.from(sealed);
        tampered[index] ^= 0x01;
        expectOpaqueFailure(() => open(katKey(), katNonce, tampered, katAad));
      }
    });

    it('a flipped nonce bit fails', () => {
      const nonce = Buffer.from(katNonce);
      nonce[0] ^= 0x01;
      expectOpaqueFailure(() => open(katKey(), nonce, sealed, katAad));
    });

    it('cross-channel relabel fails even with the sealing key', () => {
      expectOpaqueFailure(() =>
        open(katKey(), katNonce, sealed, { ...katAad, channelId: 'harbor/beta' })
      );
    });

    it('cross-epoch relabel fails under both the old and the rotated key', () => {
      const nextEpoch = { ...katAad, epoch: katAad.epoch + 1 };
      expectOpaqueFailure(() => open(katKey(), katNonce, sealed, nextEpoch));
      const rotated = deriveChannelKey(katSecret, katAad.channelId, katAad.epoch + 1);
      expectOpaqueFailure(() => open(rotated, katNonce, sealed, nextEpoch));
    });

    it('cross-harbor and sequence relabels fail', () => {
      expectOpaqueFailure(() =>
        open(katKey(), katNonce, sealed, { ...katAad, harborId: 'harbor-other' })
      );
      expectOpaqueFailure(() => open(katKey(), katNonce, sealed, { ...katAad, seq: katAad.seq + 1 }));
    });

    it('truncation fails, including below the tag boundary', () => {
      for (const cut of [0, 1, TAG_LEN - 1, TAG_LEN, sealed.length - 1]) {
        expectOpaqueFailure(() => open(katKey(), katNonce, sealed.subarray(0, cut), katAad));
      }
    });
  });

  it('the provider object exposes the same functions the module exports', () => {
    // The FFI seam: consumers hold VaultSealProvider, so the provider must be
    // the real functions, not near-copies that could drift.
    expect(referenceVault.deriveChannelKey).toBe(deriveChannelKey);
    expect(referenceVault.seal).toBe(seal);
    expect(referenceVault.open).toBe(open);
    expect(referenceVault.randomNonce).toBe(randomNonce);
  });
});
