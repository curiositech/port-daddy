# Fidelity method

The ledger makes reconstruction choices inspectable. It does not prove a claim
true or confer authority.

- `explicit`: stated in the identified source.
- `inferred`: a bounded interpretation supported by a locator; holder
  endorsement remains unknown until confirmed.
- `supplemented`: introduced by the reviewer from an identified source; never
  attribute it silently to the holder.

Lock thesis, scope, audience, and burden before adding support. Canonical source
comparison can reach `SOURCE_BOUND`. Only a confirmer whose identity exactly
matches `targetPosition.sourceHolder`, over the canonical digest of the entire
ledger with only `confirmationReceipt.ledgerDigest` omitted, can reach
`HOLDER_CONFIRMED`. Any post-confirmation change invalidates that receipt.
Neither state implies truth.

For reciprocal review, apply one evidence policy to all sides. Record
agreements, learned updates, surviving disagreement, and falsifiers. Do not
erase minority dissent merely because a majority converged.
