# Porthole contract security: source-only boundary

This focused slice follows [PR #9970](https://github.com/curiositech/port-daddy/pull/9970)
without replacing its preserved program/design history. It supplies internal
schemas and an unexposed storage implementation. Nothing here starts capture,
adds a daemon route, reads an operator recording, or deploys a service. Native
Porthole delivery and reuse of FleetBar's signing/notarization procedure remain
separately owned work.

## Implemented checks

- **Strict schemas:** stage, perspective, event, control lease, disclosure,
  completeness, and regression receipts have versioned fixtures. Opaque stage
  descriptors reject extra title/URL fields. Disclosure review completion stays
  beside its review receipt in `artifact.reviewedPreview`; it is not render time.
  A required step-up must be verified with receipt/time before a lease can be
  authorized; pending/failed requests cannot carry active authority. Timestamp
  comparisons remain semantic conformance obligations, not JSON Schema checks.
- **Time-slot completeness:** slot `i` is `[start + i * interval, min(start +
  (i + 1) * interval, boundary))`. A segment or gap must start inside its own
  slot and end no later than that slot's end. The count rounds up to include a
  partial final interval; multiple samples at one instant cannot fill later
  slots. Append checks run before blob/ledger writes. Receipt and evidence
  verification repeat slot checks independently of hashes and signatures;
  `chronologyValid` reports timing separately from chain integrity.
- **Canonical commitments:** hashing rejects custom serializers, accessors,
  cycles, sparse arrays, symbols, and non-JSON values. It must not invoke a
  caller's `toJSON` while deciding what bytes a receipt commits to.
- **Envelope validation:** `validatePortholeCiphertextEnvelope` accepts an unknown
  candidate and independently supplied perspective/harbor/channel/index/epoch.
  It rejects missing or extra fields, mismatched coordinates, noncanonical
  encodings, invalid nonce length, and ciphertext without a payload and tag.
  It runs before blob ingestion and again on read. This structural validator
  does **not** authenticate ciphertext: `pd-vault` AEAD opening does that.
- **One cryptographic boundary:** the existing `SealAad` has `harborId`,
  `channelId`, `epoch`, and `seq`. Perspective identity is checked against the
  envelope and its manifest. Schedule commitments belong to the manifest and
  completeness receipt, not an invented second AAD format or an epoch hash.
- **Immutable event writes:** SQLite `BEFORE UPDATE` and `BEFORE DELETE` abort
  changes. A `BEFORE INSERT` collision guard also prevents `REPLACE` from
  replacing any existing event sequence, event ID, or perspective/ordinal pair
  when recursive delete triggers are disabled. This guards DML, not an attacker
  who can rewrite the database or drop triggers; hash/signature checks are
  independent integrity witnesses, not filesystem access control.
- **Independent authority:** privacy evidence binds exact sanitized bytes,
  capture index, source descriptor, and participant context. Completeness
  signatures bind the terminal event and schedule. An injected verification-only
  authority checks authorization; an issuer cannot supply its own verifier.
  The disclosure schema names independently enrolled Ed25519 verifier keys.
- **Keystore failure:** only proven missing Keychain entries permit root-key
  creation. Unavailable/error states fail closed. Create-only insertion and
  read-back adopt a concurrent winner rather than overwriting it.

## Reproducible test evidence

Run from the repository with its supported Node toolchain and installed native
SQLite dependency:

```sh
npm test -- --runInBand tests/unit/porthole-recording.test.ts tests/unit/agent-harbor-contracts.test.js tests/unit/agent-harbor-governance.test.js tests/unit/keychain-save-secret-if-absent.test.ts
npm run typecheck
```

The focused suite includes regression tests for the independently discovered
burst-completeness and unsatisfied-step-up defects. Exact current test counts
and coverage results are recorded with the reviewed source checkpoint in the PR.
The recording suite includes actual SQLite and filesystem/blob integration
checks, not merely SQL-string snapshots or mocked vault success. Root CI's
`unit` project discovers these files on every applicable test run. Test count
and source identity are also recorded in the PR; neither establishes installed
runtime or capture proof.

The trigger cases include direct mutation, both replacement syntaxes, every
unique-key collision, recursive triggers off/on, UPSERT, and multirow statement
rollback while surrounding transaction work survives. The envelope and receipt
cases cover substituted routing, extra/missing fields, malformed encodings,
tampering, missing blobs, quarantine, changed schedules, and rejected authority.

## Dependency checklist before exposure

This is a review/handoff checklist under the existing Porthole program item,
not a second roadmap authority or a claim that these dependencies are assigned.

1. **Retention/GC:** integrate immutable ciphertext references with shared blob
   pinning, prove that live evidence cannot disappear under GC, and cover crash
   recovery and orphan cleanup. Until then, tests use dedicated stores outside
   generic GC. Retention metadata alone is not a pin.
2. **Enrolled authority:** wire the existing canonical signing/verification
   mechanism and key lifecycle across the Rust boundary. Test revocation, wrong
   participant/body, and stale context. Enforce step-up chronology and verify
   actual proof authority before consuming a control lease; schema conformance
   alone never grants control. Do not introduce a second crypto library
   or let a self-attesting signer satisfy the verification seam.
3. **Adapter admission:** connect only approved sources with an immutable capture
   lease, pre-persistence exclusion/redaction, and explicit gaps. Keep candidate
   discovery, preview, live share, and persistence separately authorized. Do not
   disable security tests to accommodate a held upstream integration.
4. **Service admission:** prove storage lifetime, process-contention behavior,
   bounded resource use, and recovery before any daemon ingestion/retrieval route
   or standalone validator command is exposed. Structural envelope acceptance
   must never be presented as cryptographic verification.
5. **Native release/proof:** the native owner supplies real app lifecycle and
   synthetic proof, packaging, and the existing FleetBar notarization checks.
   This contract PR does not claim a signed app, notarization, screenshot, or
   recording.

Raw encrypted evidence, authorized-device retrieval projections, and scrubbed
warehouse aggregates remain separate planes. Successful source tests do not
authorize moving data between them.
