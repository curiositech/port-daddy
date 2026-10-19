# Issued is not completed

Parent reviewed the complete runner, test source and report, then independently
reproduced the two-connection synthetic protocol on 20 September 2026. Both
runs returned `(1, 4, 3)` with the reader pinned, then `(0, 4, 4)` after release.
These columns mean busy status, WAL frames, checkpointed frames—not table rows.
The committed second row remained visible to the writer after the busy result.

`REPORT.md` preserves the specialist's original one-run report. `run-02` is the
parent's separate reproduction; its JSON SHA256 is
`1f2f4a870d4fd143d2a3d478ab948e2eb430da37196ef39e5eac91d944d29a28`.
The parent re-ran the original twelve readback/negative tests successfully.
The canonical regression also checks both runs and all preserved byte hashes.
No source was changed between runs. Absolute paths inside result metadata name
the original execution locations, not this later archival destination.

The result agrees with SQLite's [checkpoint return contract](https://www.sqlite.org/pragma.html#pragma_wal_checkpoint):
a FULL checkpoint can report busy instead of completion. Neither result proves
physical durability. In particular, incomplete copying is not proof of an
unsynchronized WAL. The [synchronization contract](https://www.sqlite.org/pragma.html#pragma_synchronous)
distinguishes WAL synchronization from copying frames to the database.

No crash, power interruption, real database, Port Daddy runtime or paid model
call was used. Preserved quiescent byte copies are witnesses, not a verified
backup procedure. Runs exclusively create fresh run-NN directories and refuse
reuse. Do not rerun an archived name. The author's selective-checkpoint prose
question remains open; this archive does not silently change that contract.

Possible Book exhibit: two command/result records joined by reader release,
beside the acknowledgment contract. It should show completion status, not a
durability meter or a graph of invented timing observations. Integration is
pending the substantive wording decision; the process-crash/power-loss drawing
is a separate illustration and does not cite these runs as its evidence.
