/**
 * Merkle Forest level-2/level-3 reference implementation
 * (Bonded Commons §4.2 session-tree and harbor-tree).
 *
 * The note chain (level 1) lives in `lib/merkle-chain.ts`. This module
 * implements the binary-tree levels:
 *
 *   - session_root  — Merkle tree over the per-session note hashes
 *   - harbor_root   — Merkle tree over the per-epoch session roots
 *
 * Both layers use RFC 6962 domain-separated hashing:
 *
 *   leaf(x)            := SHA-256( 0x00 || x )
 *   internal(left, r)  := SHA-256( 0x01 || left || right )
 *
 * The 0x00 / 0x01 prefix prevents the second-preimage attack where an
 * attacker presents an internal node as a leaf (Crosby & Wallach, 2009).
 *
 * Empty tree convention: root([]) := SHA-256( 0x02 ). This is a
 * domain-separated empty marker, so an empty session/harbor cannot be
 * confused with a single-leaf tree. (RFC 6962 uses SHA-256("") which we
 * could match, but the explicit prefix is more honest about intent.)
 *
 * Odd-arity convention: when a level has an odd number of nodes, the
 * trailing node is duplicated (Bitcoin convention). This is *not*
 * RFC 6962 — RFC 6962 promotes the trailing node unchanged. We use the
 * Bitcoin convention because it produces a perfect binary tree at every
 * level and makes the proof shape uniform; the security argument is the
 * same modulo a different encoding of the structure.
 *
 * Binding property: under SHA-256 collision resistance, the only
 * (index, leaf) openings that verify against `root` are the original
 * (index, leaves[index]) pairs. See:
 *   - tests/unit/merkle-binding-property.test.js (fast-check empirical)
 *   - whitepaper/formal/easycrypt/bonded-merkle/binding.md (game-based spec for EasyCrypt)
 */

import { createHash } from 'node:crypto';

const LEAF_PREFIX = Uint8Array.from([0x00]);
const INTERNAL_PREFIX = Uint8Array.from([0x01]);
const EMPTY_PREFIX = Uint8Array.from([0x02]);

export type Hash = Uint8Array;

export interface InclusionProof {
  /** Index of the leaf in the original ordered list. */
  index: number;
  /** Total number of leaves the proof was built against. */
  leafCount: number;
  /**
   * Sibling hashes from leaf level upward. siblings[0] is the sibling
   * at the bottom level; siblings[depth-1] is the sibling at the level
   * just below the root.
   */
  siblings: Hash[];
}

// ─── Hashing primitives ──────────────────────────────────────────────────

function sha256(...parts: Uint8Array[]): Hash {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
}

export function hashLeaf(value: Uint8Array): Hash {
  return sha256(LEAF_PREFIX, value);
}

export function hashInternal(left: Hash, right: Hash): Hash {
  if (left.length !== 32 || right.length !== 32) {
    throw new Error('hashInternal: children must be 32-byte hashes');
  }
  return sha256(INTERNAL_PREFIX, left, right);
}

export function emptyRoot(): Hash {
  return sha256(EMPTY_PREFIX);
}

// ─── Build root ──────────────────────────────────────────────────────────

/**
 * Compute the Merkle root over an ordered list of leaf payloads.
 *
 * Returns `emptyRoot()` for [].
 *
 * Cost: O(n) hash evaluations, O(n) intermediate memory.
 */
export function buildRoot(leaves: Uint8Array[]): Hash {
  if (leaves.length === 0) return emptyRoot();

  let level: Hash[] = leaves.map(hashLeaf);
  while (level.length > 1) {
    const next: Hash[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      // Bitcoin-style odd-arity: duplicate the trailing node.
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(hashInternal(left, right));
    }
    level = next;
  }
  return level[0];
}

// ─── Build proof ─────────────────────────────────────────────────────────

/**
 * Build an inclusion proof for `leaves[index]` against `buildRoot(leaves)`.
 *
 * Throws if `index` is out of range. Returns the sibling hash at each
 * level needed to reconstruct the root from the leaf upward.
 */
export function buildProof(leaves: Uint8Array[], index: number): InclusionProof {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new Error(`buildProof: index ${index} out of range [0, ${leaves.length})`);
  }
  const leafCount = leaves.length;
  if (leafCount === 0) {
    throw new Error('buildProof: cannot prove inclusion in an empty tree');
  }

  let level: Hash[] = leaves.map(hashLeaf);
  let pos = index;
  const siblings: Hash[] = [];

  while (level.length > 1) {
    const isRight = pos % 2 === 1;
    const siblingPos = isRight ? pos - 1 : pos + 1;
    const sibling = siblingPos < level.length ? level[siblingPos] : level[pos];
    siblings.push(sibling);

    const next: Hash[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(hashInternal(left, right));
    }
    level = next;
    pos = Math.floor(pos / 2);
  }

  return { index, leafCount, siblings };
}

// ─── Verify proof ────────────────────────────────────────────────────────

/**
 * Verify that `leaf` is the value at position `proof.index` in a tree of
 * `proof.leafCount` leaves whose root is `expectedRoot`.
 *
 * Returns true iff reconstruction yields exactly `expectedRoot`. Returns
 * false on any structural mismatch (wrong index, wrong sibling count,
 * wrong leaf count).
 */
export function verifyProof(
  leaf: Uint8Array,
  proof: InclusionProof,
  expectedRoot: Hash,
): boolean {
  if (proof.leafCount <= 0) return false;
  if (proof.index < 0 || proof.index >= proof.leafCount) return false;

  const expectedDepth = Math.max(1, Math.ceil(Math.log2(proof.leafCount)));
  // For leafCount === 1, depth is 0; siblings should be empty.
  if (proof.leafCount === 1) {
    if (proof.siblings.length !== 0) return false;
    const computed = hashLeaf(leaf);
    return constantTimeEqual(computed, expectedRoot);
  }
  if (proof.siblings.length !== expectedDepth) return false;

  let acc = hashLeaf(leaf);
  let pos = proof.index;
  let levelSize = proof.leafCount;

  for (const sibling of proof.siblings) {
    if (sibling.length !== 32) return false;
    const isRight = pos % 2 === 1;
    if (isRight) {
      acc = hashInternal(sibling, acc);
    } else {
      // Even position: if pos === levelSize - 1 (lone trailing node),
      // sibling should equal acc (Bitcoin odd-arity duplication). Either
      // way, the verifier just hashes acc with sibling as the right child.
      acc = hashInternal(acc, sibling);
    }
    pos = Math.floor(pos / 2);
    levelSize = Math.ceil(levelSize / 2);
  }

  return constantTimeEqual(acc, expectedRoot);
}

// ─── Utilities ───────────────────────────────────────────────────────────

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function bytesToHex(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, '0');
  return out;
}
