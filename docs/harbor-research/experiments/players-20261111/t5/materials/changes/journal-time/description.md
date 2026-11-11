# journal: stamp entries with the time they were written

Payloads carry times under different keys, or none, so the journal could not be cut by time. `append` takes an optional `at` and stores it on the entry next to `seq` and `kind`, and `entries_since(at)` returns the entries written at or after a time. Callers that pass no time are unaffected.
