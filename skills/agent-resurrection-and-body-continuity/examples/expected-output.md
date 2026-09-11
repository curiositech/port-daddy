# Expected output for the synthetic incident

**Verdict:** `QUARANTINED`

The worker identity and work obligation remain intact, but a successor must not
start yet:

1. predecessor process state is unknown, so its generation must be fenced and
   the process tree observed before replacement authority exists;
2. `push-demo-02` was dispatched without an authoritative result, so it is
   ambiguous and cannot be replayed;
3. a different harness requires a sanitized successor capsule, not provider
   session transfer; and
4. destination subscription capacity is unknown, so no autonomous provider call
   is admissible.

Next safe action: remain blocked until the external lifecycle authority issues
and receipts the fence; meanwhile perform only read-only remote reconciliation
for `push-demo-02` and retain the verified capsule without a live body. This
skill does not issue that fence. No credential, context directory, session token,
or claim is copied.
