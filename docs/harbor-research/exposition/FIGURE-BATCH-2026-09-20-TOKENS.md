# Token and revocation redraws — 20 September 2026

Native lower-cost Luna worker Harvey drafted the two fragments; the parent
rejected the first geometry/duplicate-fingerprint argument, replaced the geometry,
and owns the final semantic and assembled-page review. A compiled worker candidate
is not an approved figure. Only the website fragment copies exist.

## V/fig:anchor-cuckoo-inline

- Reader question: why does raw bitwise OR fail where semantic ID union works?
- Claim: two individually valid fingerprint arrays can OR into an array containing
  neither original fingerprint.
- Required evidence: two one-slot buckets; three-bit fingerprints; both keys use
  candidate pair (0,1). A=[001,000], B=[010,000], OR=[011,000].
  Zero is the empty-slot sentinel. Exact fingerprint lookup loses both keys.
- Correct alternative: union IDs {c1,c2}, then insert into a new local filter
  as [001,010], with insertion failure handled by the protocol.
- Grammar: aligned binary counterexample beside a record-to-storage projection.
  Paper shapes denote authoritative ID records, not fingerprints.
- Counter-reading: duplicate fingerprints are allowed; their existence alone
  does not invalidate a filter. This is an authored counterexample, not a
  benchmark or a reproduction of a particular library's packed representation.
- Rejected form: a duplicate-placement overlay conflated multiplicity with
  invalidity. A load plot would answer a different question.
- Five-second test: identify the lost values and the artifact that preserves
  the information needed to rebuild them.

Primary verification: Fan, Andersen, Kaminsky and Mitzenmacher,
[Cuckoo Filter: Practically Better Than Bloom](https://www.cs.cmu.edu/~binfan/papers/conext14_cuckoofilter.pdf),
sections 3.1–3.3. Entries store fingerprints, lookup compares for a match, and
repeated fingerprints are allowed. The bitwise counterexample is our derivation
from those operations, checked separately in the regression fixture.

The neighboring manuscript paragraph now makes that argument directly; the
previous “no single consistent filter state” assertion is removed.

## VI/fig:magic-link-inline

- Reader question: can two overlapping requests consume the same unused token?
- Claim: serialized conditional updates admit only one committed consumption.
- Required evidence: both requests arrive before the first commit; A changes
  NULL to t1; B observes t1 and returns no row; the audit identifies A.
- Grammar: three-lifeline sequence, a folded audit receipt, and one readable SQL
  specimen. A vertical order arrow is ordinal, not measured elapsed time.
- Counter-reading: A is the winner in this illustrative schedule, not every
  schedule. SQL omits authentication/expiry checks; the diagram is not a complete
  recovery protocol or proof of power-loss durability.
- Rejected form: a narrow three-column pipeline squeezed the SQL and confused
  overlapping arrival with simultaneous writes.
- Five-second test: distinguish request concurrency from the two ordered updates.

The adjacent prose now says at most once. Injectivity alone does not guarantee
that the token is ever redeemed.

## Review evidence

Parent inspected all four native-size batch proof pages in the actual Book
preamble with privately supplied Suisse fonts. No scaling or smaller labels.
These two ink boxes measure 318.3pt and 316.8pt against the 325.215pt column.
Eight semantic/source tests include the filter counterexample and an in-memory
SQLite conditional-update fixture with either caller winning. These tests do
not exercise Port Daddy or establish deployed behavior.

Full-Book page locations, hash, caption/bounds results and remaining layout
debt are recorded in the batch handoff after the complete build.
