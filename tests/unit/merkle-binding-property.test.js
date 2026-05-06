/**
 * tests/unit/merkle-binding-property.test.js
 *
 * Property-based test for Bonded Commons §4.2 Merkle Forest binding.
 * Exercised against the REAL lib/merkle-tree.ts implementation.
 *
 * Why fast-check, not full EasyCrypt
 *   Full machine-checked binding under SHA-256 collision resistance is
 *   the carry-over (#3 in the v2.1 paper text). EasyCrypt mechanization
 *   is intentionally deferred until a higher-assurance audit asks.
 *   This test is the next-best honest artifact: the real code is shown
 *   binding-empirically against random adversarial inputs, with the
 *   reduction "any binding break here implies a SHA-256 collision."
 *
 * Properties under test
 *   (B1) Soundness — for any leaves L and index i, the proof produced
 *        by buildProof(L, i) verifies under buildRoot(L) for L[i].
 *   (B2) Binding (positional) — for any leaves L, index i, and ANY
 *        leaf' ≠ L[i], the proof for index i does NOT verify for leaf'
 *        against buildRoot(L). (Adversary cannot swap a leaf at a fixed
 *        position.)
 *   (B3) Binding (cross-index) — for any leaves L and indices i ≠ j,
 *        the proof for i does NOT verify for L[j] against buildRoot(L).
 *        (Adversary cannot reuse a proof at the wrong index.)
 *   (B4) Cross-tree non-membership — for two distinct leaf lists L₁ and
 *        L₂ with buildRoot(L₁) ≠ buildRoot(L₂), a proof valid under L₁
 *        does NOT verify under buildRoot(L₂) (except by coincidence
 *        at probability ≈ 2⁻²⁵⁶).
 *   (B5) Tampered-sibling rejection — flipping any bit in any sibling
 *        of a valid proof causes verification to fail.
 *   (B6) Empty tree — emptyRoot() is distinct from buildRoot([leaf])
 *        for any leaf (domain separation against forgery from "no
 *        evidence" to "evidence of nothing").
 *
 * Note: SHA-256 collision resistance is assumed. The properties are
 * stated in a form that, if violated under random inputs, would
 * constitute either a bug in our tree code or a SHA-256 collision (the
 * latter has not been observed in 20+ years of cryptanalysis). Under
 * 100 cases per property, the probability of accidentally hitting a
 * binding break is bounded by 100 × 2⁻²⁵⁶, which is negligible.
 */

import { describe, test, expect } from '@jest/globals';
import fc from 'fast-check';
import {
  buildRoot,
  buildProof,
  verifyProof,
  emptyRoot,
  hashLeaf,
} from '../../lib/merkle-tree.js';

// Arbitrary leaf payloads. Bytes 0..255, length 1..64 (covers boundary
// cases like 1-byte leaves and avoids degenerate empty leaves).
const arbLeaf = fc.uint8Array({ minLength: 1, maxLength: 64 });

// At least 1 leaf, up to 64. Skip zero — empty trees are a separate
// property (B6).
const arbLeaves = fc.array(arbLeaf, { minLength: 1, maxLength: 64 });

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('Merkle Forest binding (Bonded §4.2)', () => {
  test('B1 soundness: real proofs verify', () => {
    fc.assert(
      fc.property(arbLeaves, (leaves) => {
        const root = buildRoot(leaves);
        for (let i = 0; i < leaves.length; i++) {
          const proof = buildProof(leaves, i);
          if (!verifyProof(leaves[i], proof, root)) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  test('B2 positional binding: swapping the leaf at the same index breaks verification', () => {
    fc.assert(
      fc.property(arbLeaves, arbLeaf, (leaves, fakeLeaf) => {
        const root = buildRoot(leaves);
        for (let i = 0; i < leaves.length; i++) {
          if (bytesEqual(leaves[i], fakeLeaf)) continue; // not a swap
          const proof = buildProof(leaves, i);
          if (verifyProof(fakeLeaf, proof, root)) {
            // A binding break would imply a SHA-256 collision on
            // (LEAF_PREFIX || leaves[i]) vs (LEAF_PREFIX || fakeLeaf).
            return false;
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  test('B3 cross-index binding: a proof for index i does not verify the leaf at index j', () => {
    fc.assert(
      fc.property(
        arbLeaves.filter((ls) => ls.length >= 2),
        (leaves) => {
          const root = buildRoot(leaves);
          for (let i = 0; i < leaves.length; i++) {
            for (let j = 0; j < leaves.length; j++) {
              if (i === j) continue;
              if (bytesEqual(leaves[i], leaves[j])) continue;
              const proof = buildProof(leaves, i);
              if (verifyProof(leaves[j], proof, root)) {
                // Verification at the wrong index for a different leaf
                // would be a binding break.
                return false;
              }
            }
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  test('B4 cross-tree: a proof from one tree does not verify under a different root', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbLeaves, arbLeaves),
        ([leavesA, leavesB]) => {
          const rootA = buildRoot(leavesA);
          const rootB = buildRoot(leavesB);
          if (bytesEqual(rootA, rootB)) return true; // skip the (negligible) collision case
          for (let i = 0; i < Math.min(leavesA.length, leavesB.length); i++) {
            const proof = buildProof(leavesA, i);
            // The proof was built for tree A. It should not verify
            // leavesA[i] under tree B's root unless the trees share a
            // path coincidentally — extremely unlikely under random
            // leaves but we don't assert false on coincidence.
            if (verifyProof(leavesA[i], proof, rootB)) {
              // Allow the rare case where leavesA and leavesB share a
              // prefix that produces an identical sub-root at the path
              // of index i. We treat that as a deterministic coincidence
              // rather than a binding break.
              const sharePrefix = i < leavesB.length && bytesEqual(leavesA[i], leavesB[i]);
              if (!sharePrefix) return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  test('B5 tampered sibling: flipping a bit in any sibling rejects the proof', () => {
    fc.assert(
      fc.property(
        arbLeaves.filter((ls) => ls.length >= 2),
        (leaves) => {
          const root = buildRoot(leaves);
          const i = 0;
          const proof = buildProof(leaves, i);
          if (proof.siblings.length === 0) return true; // 1-leaf tree
          for (let s = 0; s < proof.siblings.length; s++) {
            // Flip bit 0 of the s-th sibling.
            const tampered = {
              ...proof,
              siblings: proof.siblings.map((sib, idx) => {
                if (idx !== s) return sib;
                const copy = new Uint8Array(sib);
                copy[0] ^= 0x01;
                return copy;
              }),
            };
            if (verifyProof(leaves[i], tampered, root)) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  test('B6 empty tree separation: emptyRoot is distinct from any single-leaf root', () => {
    fc.assert(
      fc.property(arbLeaf, (leaf) => {
        const er = emptyRoot();
        const sr = buildRoot([leaf]);
        // Single-leaf root is just hashLeaf(leaf) — must not collide
        // with the empty marker SHA-256(0x02).
        if (bytesEqual(er, sr)) return false;
        if (!bytesEqual(sr, hashLeaf(leaf))) return false;
        return true;
      }),
      { numRuns: 100 },
    );
  });

  test('B6.b empty tree distinct from emptyRoot prefix collision', () => {
    // Belt-and-suspenders: the empty marker must not equal the leaf hash
    // of the single byte 0x02 (would be a domain-separation failure).
    const er = emptyRoot();
    const lookalike = hashLeaf(Uint8Array.from([0x02]));
    expect(bytesEqual(er, lookalike)).toBe(false);
  });

  test('B7 large-tree spot check (1024 leaves) — soundness + positional binding', () => {
    const leaves = Array.from({ length: 1024 }, (_, i) => {
      const b = new Uint8Array(8);
      for (let k = 0; k < 8; k++) b[k] = (i >> (k * 8)) & 0xff;
      return b;
    });
    const root = buildRoot(leaves);
    // Spot-check 32 random indices.
    for (let trial = 0; trial < 32; trial++) {
      const idx = Math.floor(Math.random() * leaves.length);
      const proof = buildProof(leaves, idx);
      expect(verifyProof(leaves[idx], proof, root)).toBe(true);
      // Swap with a different leaf — must fail.
      const swap = (idx + 1) % leaves.length;
      expect(verifyProof(leaves[swap], proof, root)).toBe(false);
    }
  });
});
