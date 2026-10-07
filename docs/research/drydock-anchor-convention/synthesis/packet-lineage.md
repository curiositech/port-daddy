# Packet lineage and seal reconciliation

## Decision

Do not rewrite the first seal to make the expanded packet look continuous.

The correct lineage is two receipts:

1. **v1 is historical.** It records the 43-file packet supplied to the first
   reciprocal and correction rounds at repository anchor
   `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`.
2. **v2 is the expanded packet.** It binds the completed functional beats,
   reciprocal beat reviews, final manager synthesis, operator prototype, all
   current audits, and the twelve amended or created skill bundles.

Both seals carry `T0_STATIC` and `runtimeAuthority: NONE`.

## Why v1 does not reproduce from the expanded worktree

The first packet was assembled while the entire directory was untracked. Its
manifest records 43 files and digest
`5c3abfa1ee4d073555b5570e06a8de7fb650c93501e08241c089d6dddc493911`.
After that seal:

- the cryptoeconomic skill audit became the eighth audit;
- Engineering, Product, and Design beats and their reciprocal reviews landed;
- the final manager synthesis landed;
- skills were replaced or created;
- the graft matrix and README were updated; and
- the operator prototype was added and visually reviewed.

The manager correctly observed that the old glob-based seal script then read 44
files and produced a different digest. Because there was no immutable Git
commit for the original untracked bytes, the current branch cannot reconstruct
the exact v1 input set. The v1 digest is retained as a historical receipt, not
misrepresented as reproducible from v2.

## Deterministic profiles

`seal-packet.mjs` now has explicit profiles:

- `v1` selects the original seven-audit scope and is a comparison tool. It is
  expected to differ after in-place edits to files that were in v1.
- `v2` recursively binds the current convention packet plus these skill roots:
  the seven replaced discourse/coordination/evidence skills, the replaced
  cryptoeconomic skill, the three new focused skills, and
  `drydock-program-architecture`.

The sealer, v1 manifest, and v2 manifest are excluded from v2's own digest.
That avoids a self-referential hash while leaving the exact algorithm and scope
inspectable. `sealed-packet-v2.json` records the final count and digest.
Its `verificationCommand` runs the sealer in fail-closed check mode: receipt
drift produces a nonzero exit instead of merely printing a different digest.

## What a seal proves

A matching seal proves only that the named bytes and paths match the recorded
packet. It does not prove:

- the claims inside those bytes are true;
- evaluation challenges are adequate;
- VM or process containment;
- provider spend control or cancellation;
- accessibility or operator comprehension;
- market demand;
- lawful custody, payment, or settlement; or
- permission to start Port Daddy.

Those claims require the witness classes and promotion gates in the final
roadmap.
