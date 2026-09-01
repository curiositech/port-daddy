# Merkle Forest Binding — Game-Based Spec

**Status:** game definition + hand-stated EasyCrypt reduction with
three remaining `admit.` lines. Full machine-check still deferred
pending an installed EasyCrypt and discharge of the structural
admits documented in `binding.ec`. See `binding.run.log` for the
honest capture of the most recent `easycrypt -check` attempt.
**Implementation under spec:** `lib/merkle-tree.ts`.
**Empirical verification:** `tests/unit/merkle-binding-property.test.js`.
**Typed reduction skeleton:** `binding.ec` (BindToCR, LeafCollFinder,
InternalCollFinder).

This document fixes the precise property and reduction that any future
EasyCrypt (or CryptoVerif, or Coq) mechanization must discharge. It is
deliberately written in EasyCrypt-flavored pseudocode so the gap between
"what we have empirically" and "what a higher-assurance audit would
mechanize" is small.

## 1. Algorithm spec

We model the level-2/3 tree (session_root, harbor_root) of Bonded
Commons §4.2. Domain separation follows RFC 6962-style prefixes:

```
hashLeaf(x)               := H(0x00 || x)
hashInternal(left, right) := H(0x01 || left || right)
emptyRoot                 := H(0x02)
```

`H` is a hash function modeled in the random-oracle model. In the
implementation, `H = SHA-256`; the security argument reduces to
SHA-256 collision resistance.

`buildRoot(leaves)` and `buildProof(leaves, i)` and
`verifyProof(leaf, proof, root)` are as defined in `lib/merkle-tree.ts`.
Odd-arity levels duplicate the trailing node (Bitcoin convention).

## 2. Binding game

```
Game Bind^A_MerkleTree :
  // The adversary chooses two openings of the same root.
  (leaves, i, j, leaf', proof_i, proof_j) <- A()
  root_i <- buildRoot(leaves)             // the honest reference root
  return  i = j
       /\ leaf' /= leaves[i]
       /\ verifyProof(leaf',         proof_i, root_i) = true
       /\ verifyProof(leaves[i],     proof_j, root_i) = true
```

A wins if it can produce a position `i` and a `leaf' ≠ leaves[i]` such
that `proof_i` verifies `leaf'` at `i` against the honest root for the
honest leaves.

**Theorem (Binding).** For any PPT adversary A,

```
Pr[ Bind^A_MerkleTree = true ]  ≤  AdvCR_H(B)
```

where `B` is a SHA-256 collision-finder constructed from A's transcript.

## 3. Reduction sketch

Suppose A wins. Then there is some level `ℓ ≤ depth` at which the
honest reconstruction-from-`leaves[i]` and the adversary's
reconstruction-from-`leaf'` first agree on the accumulator value.
At that level:

- the two paths agree on the input pair `(left, right)` to
  `hashInternal`, OR
- the two paths disagree on `(left, right)` but produce the same
  output of `hashInternal`.

The first case propagates upward: by induction the paths agree at
every level, contradicting `leaf' ≠ leaves[i]` (because at level 0
the two leaves differ, hence their `hashLeaf` images differ unless
SHA-256 has a collision on `0x00 || leaves[i]` vs. `0x00 || leaf'`).

The second case is exactly a SHA-256 collision on the
`0x01 || left || right` inputs.

Therefore A's success probability is bounded by the chance that one
of the at-most-`depth` internal-hash evaluations along the two
paths collides, plus the chance that the two leaf hashes collide.
Each is bounded by `AdvCR_H`. Union-bound gives the stated bound.

## 4. What the empirical test discharges

`tests/unit/merkle-binding-property.test.js` runs 100 random cases
per property. For each case:

- B1 soundness: the honest opening always verifies (sanity check on
  the implementation).
- B2 positional binding: the adversary substitutes `leaf'` at the
  honest position `i` and `verifyProof` is shown to reject.
- B3 cross-index binding: the adversary moves the proof for `i` to a
  different position `j` and `verifyProof` is shown to reject.
- B4 cross-tree: the adversary tries to verify a proof under a
  different tree's root.
- B5 sibling tamper: flipping any bit in any sibling rejects.
- B6 empty-tree separation: `emptyRoot` is distinct from any
  single-leaf root.

A binding break under random inputs would constitute a SHA-256
collision (witnessed in the test transcript). Across 100 runs × 8
properties × ~10 internal hashes per case = ~8,000 hash evaluations,
the chance of a coincidental collision is bounded by `2¹³ · 2⁻²⁵⁶`,
which is negligible. So passing all 8 properties is empirical evidence
that the implementation does not introduce a binding break beyond
what `AdvCR_SHA-256` already allows.

## 5. What is still deferred

`binding.ec` now contains a typed reduction skeleton with two
explicit reduction modules (`LeafCollFinder`, `InternalCollFinder`)
and three theorem statements (`leaf_collision_bound`,
`internal_collision_bound`, `binding_reduction`). Three `admit.`
lines remain, each with an inline comment describing the routine
plumbing it represents. To convert this into a fully machine-checked
bound

```
Pr[ Bind^A = true ] ≤ AdvCR_H(B)
```

still requires:

1. **Installed EasyCrypt.** The advertised binary path was missing
   on the host that produced this branch (see `binding.run.log`),
   so `easycrypt -check binding.ec` was not exercised. CI must gate
   the proof on a green `-check` once EC is available.
2. **The PROM (programmable random oracle model) library** to lift
   `H` from an abstract operator to a lazy-sampled oracle and produce
   a true cryptographic-reduction statement.
3. **Recursive definitions** of `build_root`, `verify_proof`,
   `acc_path`, `honest_path`, and `first_agree_idx` matching
   `lib/merkle-tree.ts`, so the seven structural axioms in
   `binding.ec` (`ax_verify_root`, `ax_honest_root`, `ax_path_lengths`,
   `ax_acc_path_head`, `ax_honest_path_head`, `ax_acc_step`,
   `ax_honest_step`) become lemmas.
4. **Discharge of the three `admit.` lines** — routine `byequiv` /
   `byphoare` plumbing, estimated ~120 lines of EasyCrypt for a
   fluent author.

(1)–(2) are formal-methods labour with no implementation impact;
(3)–(4) are mechanical once (1)–(2) are in place. The work is
deferred until a higher-assurance audit specifically requests
machine-checked binding.

The honest current claim, citable by the paper, is:

> The Merkle Forest binding property is empirically verified against
> the reference implementation in `lib/merkle-tree.ts` over 100
> random adversarial cases per property in
> `tests/unit/merkle-binding-property.test.js`. The reduction to
> SHA-256 collision resistance is sketched in
> `whitepaper/formal/easycrypt/bonded-merkle/binding.md` and stated as a typed EasyCrypt
> reduction (with three admitted plumbing steps) in
> `whitepaper/formal/easycrypt/bonded-merkle/binding.ec`. Full machine-checked
> mechanization, including PROM-based oracle modeling and discharge
> of the structural admits, remains deferred.
