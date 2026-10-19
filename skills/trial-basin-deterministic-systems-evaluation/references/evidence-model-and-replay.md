# Evidence, model, and replay

## Source-to-claim ledger

| Source | Narrow support used here | What it does **not** prove |
|---|---|---|
| Claessen and Hughes, [“QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs”](https://doi.org/10.1145/351240.351266) | Executable properties, generated inputs, and custom generators can expose counterexamples beyond hand-picked examples; generator quality and preconditions matter. | Passing generated cases is not exhaustive proof, and a generator cannot establish that the model or property matches the production claim. |
| Zeller and Hildebrandt, [“Simplifying and Isolating Failure-Inducing Input”](https://doi.org/10.1109/32.988498) | A failure-inducing input can be minimized while repeatedly checking the same failure predicate. | A minimal reproducer is not necessarily a unique cause, and minimization is invalid if the oracle, schedule, or environment silently changes. |
| Alvaro, Rosen, and Hellerstein, [“Lineage-driven Fault Injection”](https://people.ucsc.edu/~palvaro/molly.pdf) | Outcome lineage can focus fault injection on failures capable of preventing a desired result instead of enumerating every fault combination. | The explored lineage is not evidence of complete fault coverage, production fidelity, or correctness outside the modeled outcomes. |
| IETF RFC 9162, [Certificate Transparency Version 2.0](https://www.rfc-editor.org/rfc/rfc9162.html) | Merkle inclusion proofs establish that a committed leaf is in a named tree; consistency proofs establish append-only extension between tree heads. | Inclusion and consistency do not establish that a trace is truthful, that an oracle is sound, or that the committed bytes support a product claim. |

The Trial Basin result vector, promotion ceiling, raw-custody rule, and
replayability contract below are Drydock design invariants. These references
motivate test mechanisms and proof boundaries; they do not certify an
implementation.

## Provenance is not evaluation

A signature, digest, or Merkle inclusion can identify bytes and ordering. It does not state which proposition those bytes test, whether the model corresponds to the target, whether the oracle is sound, or whether negative controls were detected.

## Raw custody

The recorder commits a raw manifest and trace before minimization or oracle revision. The minimizer references that commitment. An independent adjudicator checks that raw and minimized traces trigger the same named predicate.

## Result vectors

Keep each claimed axis separate. Reducer conformance can pass while containment is unknown and accessibility is incomplete. Aggregate displays may summarize but cannot erase subordinate results.

## Promotion ceiling

Static fixtures may become versioned regression fixtures. Deterministic fakes may support properties inside their sealed model. Shadow and canary evidence require separate authority, containment, and release gates. This skill cannot grant them.

## Counterexample durability

Every discovered counterexample carries envelope digest, raw trace digest, minimized trace digest, failing predicate, schedule, faults, model revision, and oracle revision. It remains replayable or is explicitly marked stale with a reason.
