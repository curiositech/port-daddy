(* ============================================================
   Merkle Forest binding — EasyCrypt placeholder

   Status: SKELETON, not yet a verified theory file.

   This file fixes the names and shape of the future EasyCrypt
   mechanization. It is intentionally NOT loadable in EasyCrypt as-is
   (the proof bodies are admit. lines). The empirical artifact at
   tests/unit/merkle-binding-property.test.js and the game-based
   spec at proofs/bonded/merkle/binding.md are what currently
   carry the §4.2 binding claim.

   When a higher-assurance audit asks for machine-checked binding,
   the work is:

     1. Replace the abstract H with EasyCrypt's PROM library.
     2. Replace the recursive build_root / verify_proof bodies with
        the operator definitions matching lib/merkle-tree.ts.
     3. Discharge each `admit.` with the reduction sketched in
        binding.md §3.

   Estimated effort: 200-400 lines + 1 week of an EasyCrypt-fluent
   author. Not on the v2.4 path.
   ============================================================ *)

require import AllCore List Distr.
(* require import PROM. *)

type leaf, hash.

op H : hash list -> hash.   (* random oracle in the real proof *)

op leafPrefix     : hash.
op internalPrefix : hash.
op emptyPrefix    : hash.

op hashLeaf (x : leaf) : hash =
  H [leafPrefix; ofLeaf x]
  axiomatized by hashLeafE.

op hashInternal (l r : hash) : hash =
  H [internalPrefix; l; r]
  axiomatized by hashInternalE.

op emptyRoot : hash =
  H [emptyPrefix]
  axiomatized by emptyRootE.

(* build_root and verify_proof would be operator definitions matching
   the TypeScript implementation; omitted from the skeleton. *)

op build_root  : leaf list -> hash.
type proof.
op verify_proof : leaf -> proof -> hash -> bool.
op build_proof  : leaf list -> int -> proof.

(* The binding game. *)
module type Adv_Bind = {
  proc guess() : leaf list * int * leaf * proof
}.

module Bind (A : Adv_Bind) = {
  proc main() : bool = {
    var leaves, i, leaf', pr, root;
    (leaves, i, leaf', pr) <@ A.guess();
    root <- build_root leaves;
    return  0 <= i < size leaves
         /\ leaf' <> nth witness leaves i
         /\ verify_proof leaf' pr root;
  }
}.

(* The collision game on H. *)
module type Adv_CR = {
  proc guess() : (hash list) * (hash list)
}.

module CR (A : Adv_CR) = {
  proc main() : bool = {
    var x, y;
    (x, y) <@ A.guess();
    return x <> y /\ H x = H y;
  }
}.

(* Theorem (binding ≤ collision-resistance).
   Stated; not yet proved. The reduction B is constructed by walking
   the witness path returned by A and locating the level at which the
   adversary's accumulator first agrees with the honest accumulator;
   the inputs to the agreeing internal-hash form a SHA-256 collision. *)
lemma binding_reduction (A <: Adv_Bind) :
  Pr[ Bind(A).main() @ &m : res ]
    <= Pr[ CR(<reduction B from A>).main() @ &m : res ].
proof.
  admit.
qed.

(* Helper lemma: leaf-level collision.
   If leaf' <> leaves[i] but their leaf-hashes agree, that is a
   collision on (0x00 || leaf'). *)
lemma leaf_collision_bound (A <: Adv_Bind) :
  Pr[ Bind(A).main() @ &m : res /\ leaf_level_agreement ]
    <= Pr[ CR(<leaf-collision reduction>).main() @ &m : res ].
proof.
  admit.
qed.

(* Helper lemma: internal-level collision.
   If accumulators agree at some internal level but the inputs to
   hashInternal differ, that is a collision on (0x01 || l || r). *)
lemma internal_collision_bound (A <: Adv_Bind) :
  Pr[ Bind(A).main() @ &m : res /\ internal_level_agreement ]
    <= Pr[ CR(<internal-collision reduction>).main() @ &m : res ].
proof.
  admit.
qed.
