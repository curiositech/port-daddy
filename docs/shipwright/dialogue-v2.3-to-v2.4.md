# Dialogue: Bonded Commons v2.3 → v2.4

**Round:** v2.4
**Sealed at:** 2026-05-02
**Lead:** secops:lead
**Status:** complete; one carry-over partially closed, six previously hand-waved smells surfaced.

This round does two things: it lands the partial closure of the Merkle
Forest binding carry-over (#3 in the v2.1 list), and it audits the
registry honestly. The audit promotes six v2.1 smells from "staged"
(meaning: paper text was tightened, but no formal artifact was built)
into the explicit carry-over list, where they will compete for v2.5
attention.

---

## Closed this round

### Proof gap #03 — Merkle Forest binding (Bonded §4.2)

**Class:** crypto
**Severity:** high
**Carried from:** v2.1 (indefinite carry, scope-narrowed in paper text)

**Counter:** reference implementation + fast-check binding properties +
game-based spec.

**Honest scope decision.** The original target was full EasyCrypt
mechanization. The v2.1 paper text scope-narrowed this to "future
work; carry until a higher-assurance audit asks." That carry was
honest but unsatisfying: it deferred the *whole* property rather
than the *expensive* part of it.

The v2.4 split:

- **Implementation reduction (done).** §4.2 specifies a session-tree
  and a harbor-tree (the level-2 and level-3 of the forest). The
  level-1 note chain has lived in `lib/merkle-chain.ts` since v1.
  The tree levels were spec-only. We built `lib/merkle-tree.ts` —
  200 LOC, RFC 6962-style domain-separated binary tree, Bitcoin
  odd-arity duplication, explicit empty-tree marker.

- **Empirical binding (done).** `tests/unit/merkle-binding-property.test.js`
  exercises 8 binding properties via fast-check (100 cases per
  property):

  - B1 soundness: every honest opening verifies.
  - B2 positional binding: substituting `leaf' ≠ leaves[i]` at
    position `i` always rejects.
  - B3 cross-index binding: a proof for index `i` does not verify
    `leaves[j]` for `j ≠ i`.
  - B4 cross-tree: a proof from one tree does not verify against a
    different root.
  - B5 sibling tamper: flipping any bit in any sibling rejects.
  - B6 / B6.b: the empty marker is distinct from any single-leaf
    root and from a domain-confusion lookalike.
  - B7: 1024-leaf spot check for soundness + positional binding.

  All 8 pass. A binding break under random inputs would constitute a
  SHA-256 collision (witnessed in the test transcript).

- **Game spec (done).** `proofs/bonded/merkle/binding.md` fixes the
  precise game and the reduction to SHA-256 collision resistance:

  ```
  Pr[ Bind^A_MerkleTree = true ]  ≤  AdvCR_H(B)
  ```

  The reduction is sketched: at the level where the adversary's
  reconstruction-from-`leaf'` first agrees with the honest
  reconstruction-from-`leaves[i]`, either the inputs to
  `hashInternal` agree (the property propagates upward by induction)
  or they collide (a witness to A's collision-finding).

- **EasyCrypt skeleton (placeholder).** `proofs/bonded/merkle/binding.ec`
  contains the type signatures, the `Bind` and `CR` modules, and the
  `binding_reduction` lemma — all `admit.`'d. It is intentionally not
  yet a verified theory file. This is the precise target for a
  future heavy mechanization (estimated 200-400 LOC + 1 week of an
  EasyCrypt-fluent author).

**What carries forward.** Full machine-checked binding under SHA-256
collision resistance remains deferred behind the EasyCrypt skeleton,
to be closed when a higher-assurance audit asks specifically. The
empirical artifact + game spec is the honest current claim; we are
not pretending it is mechanized.

**Artifact:**
- `lib/merkle-tree.ts`
- `tests/unit/merkle-binding-property.test.js`
- `proofs/bonded/merkle/binding.md`
- `proofs/bonded/merkle/binding.ec` (placeholder)

---

## Audit — six previously hand-waved smells (surfaced, not closed)

The v2.0 → v2.1 round produced 13 exchanges. Of those:

- 4 were closed with real artifacts (passkey-pair, Conservation,
  Federated, No-Overdraft) across v2.2 / v2.3.
- 2 were intentionally carried (Merkle binding, Pareto).
- 1 was a same-user adversary boundary clarification (no artifact
  expected — it's a scope statement).
- **6 were tagged "staged" — meaning the paper text was tightened
  but no formal artifact was built.** Those are surfaced now.

| # | Section | Smell | Paper text says | What's missing |
|---|---|---|---|---|
| 1 | Anchor §3 | Algorithm confusion in token verify | Explicit algorithm whitelist | No ProVerif on verify path |
| 2 | Anchor §3 | Delegation chain replay | Nonce + ID binding | No ProVerif / property test on chain walker |
| 3 | Anchor §2.4 | Cuckoo filter pollution | Rate limits + capacity bound | No adversarial fill test |
| 4 | Bonded §7.x | Email magic-link race | Single-use TTL spec | No ProVerif on token state machine |
| 5 | Bonded §8.4 | Sybil insurers | Registration deposit required | No equilibrium simulation |
| 6 | Bonded §8.4 | Insurer collusion / cartel | Public auction required | No collusion-resistance proof under repeated play |

These were honestly-tagged in v2.1's `fix_status: "staged"`, but they
faded in subsequent rounds while the high-impact mechanizations
(passkey, Conservation, Federated, No-Overdraft) absorbed attention.
Surfacing them in the v2.4 carry-over list re-arms them for v2.5.

**Why now.** The user asked an audit question — "all smells covered?"
— and the honest answer is no. v2.4 names the six gaps explicitly so
no future round can plausibly say "we forgot." The reputation delta
for `proof-gap-auditor` reflects vindication: the v2.1 tagging caught
real gaps even though it took three rounds for them to be named in
the carry-over.

---

## Still carried into v2.5

| # | Theorem                                       | Reason              |
|---|-----------------------------------------------|---------------------|
| 3 | Merkle Forest binding — full EasyCrypt mechanization | Skeleton landed v2.4; full mechanization paid only when a higher-assurance audit asks |
| 7 | Pareto dominance (§8.4.4)                    | External, depends on Youle's pending formal proof |
| A1 | Algorithm confusion (Anchor §3)             | Audit-promoted; ProVerif scheduled v2.5 |
| A2 | Delegation chain replay (Anchor §3)         | Audit-promoted; ProVerif scheduled v2.5 |
| A3 | Cuckoo filter pollution (Anchor §2.4)       | Audit-promoted; awaits lib/cuckoo-filter.ts implementation |
| A4 | Email magic-link race (Bonded §7.x)         | Audit-promoted; ProVerif scheduled v2.5 |
| A5 | Sybil insurers (Bonded §8.4)                | Audit-promoted; mechanism-design simulation candidate |
| A6 | Insurer cartel (Bonded §8.4)                | Audit-promoted; same target as A5 |

The high-impact crypto mechanization queue is no longer empty —
A1, A2, and A4 are honest crypto smells that need ProVerif models in
v2.5. The audit re-prioritizes the work the round protocol forgot.

---

## Paper changes in v2.4

- §4.2 Merkle Forest: cite the new artifacts; replace "future work
  for full mechanization" with "empirical binding verified against
  reference impl over 100 random adversarial cases per property;
  reduction to SHA-256 collision resistance sketched in
  `proofs/bonded/merkle/binding.md`; full EasyCrypt mechanization
  deferred with skeleton at `binding.ec`."
- §A.3 Mechanization gap registry: update Merkle binding entry to
  reflect partial closure; add the six audit-promoted gaps.

---

## Reputation deltas at round close

| Persona              | Delta                                                            |
|----------------------|------------------------------------------------------------------|
| proof-completer      | +1 partial (Merkle binding empirical + game spec)                 |
| defense-crypto       | +1 co-signed (Merkle reference impl matches §4.2 spec)            |
| secops:lead          | +1 self-audit (surfaced six previously hand-waved smells)         |
| proof-gap-auditor    | +1 vindicated (v2.1 tagging caught real gaps)                     |

No bonds slashed. The audit-promotions are not slashes — they are
honest re-categorizations of work that was always honestly tagged but
got de-prioritized.
