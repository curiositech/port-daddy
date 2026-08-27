# Figure brief — II.5 Claim lifecycle

- **Reader question:** Which durable state does a claim occupy, and exactly what
  does each lifecycle operation do to that row?
- **Claim:** Atomic acquire, idempotent re-claim/release, and lazy expiry are
  distinct operations with different durable effects and invariants.
- **Chosen grammar:** state records plus a transition ledger.
- **Rejected grammar:** loop-heavy state bubbles hide idempotence and force the
  observable result of each transition into an arrow label.
- **Five-second acceptance test:** a reader can identify the stored row for
  each state and the unique durable effect of acquire, release, and lazy sweep.
