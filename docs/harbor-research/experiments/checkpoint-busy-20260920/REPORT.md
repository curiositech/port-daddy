# Checkpoint-busy witness — bounded protocol

One new synthetic database; two explicit Python sqlite3 connections, called serially. No existing database input, subprocess, network, daemon, crash, payment, or power-loss operation. Canonical repository remains read-only.

Both connections set and read back WAL, NORMAL, busy_timeout=0, wal_autocheckpoint=0. The writer commits baseline row 1. The reader executes BEGIN and SELECT, establishing a snapshot. The writer commits row 2. While the reader still sees row 1 alone, the writer requests `PRAGMA main.wal_checkpoint(FULL)`. Expected result: busy=1, fewer checkpointed frames than total frames. Release the reader with ROLLBACK; retry the same command. Expected result: busy=0 and equal nonnegative frame counts. A new reader observation should see both rows.

The finite claim is **a checkpoint command can return without completing**. A completed second checkpoint is not a power-loss or physical-persistence witness. The deliberate-lie tests reject promoting “issued” to verified completion or promoting completion to durability proof.

Safety: run directory and database file are exclusively created. Existing run names, paths and symlinks are refused. SQLite opens the pre-created file with `mode=rw`; it is never given an existing user database. Preserve all outputs. Before normal connection close, save byte copies of quiescent database/WAL/shm files; those are witness copies, not a tested backup mechanism. No cleanup command is used.

```sh
/usr/bin/python3 -B checkpoint_busy.py --run run-01
/usr/bin/python3 -B test_checkpoint_busy.py
```

Do not repeat run-01; it must fail closed if present. A separately authorized reproduction can use a fresh run-NN. Frame counts are observed, not hard-coded; they can differ across SQLite versions. Tests read the existing result and bytes without opening any database. The direct test command also refuses to overwrite its existing `tests-results.json`; a read-only recheck can use `/usr/bin/python3 -B -m unittest -v test_checkpoint_busy.py`.

## Result

**Reproduced once, run-01, 2026-09-20 13:49:39 UTC.** Original [results.json](run-01/results.json) is unchanged. It contains all 34 SQL commands, exact returned rows, transaction-state readbacks, both connections' settings, versions and source identity.

The triple is `(busy, WAL frames, checkpointed frames)`; frames are not table rows.

| Stage | Reader transaction | Exact checkpoint triple | Writer row IDs | Reader row IDs |
|---|---|---|---|---|
| After row 2 commits; first FULL attempt | Still pinned | **(1, 4, 3)** | 1, 2 | 1 |
| After reader ROLLBACK; second FULL attempt | Released | **(0, 4, 4)** | 1, 2 observed before release | 1, 2 in new observation |

Exact values are `(1, 'synthetic baseline')` and `(2, 'synthetic later commit')`. The busy result did not undo row 2. Initial BEGIN was followed by SELECT to establish the snapshot; BEGIN alone was not treated as sufficient. Both connections read back `journal_mode=wal`, `synchronous=1` (NORMAL), `busy_timeout=0`, `wal_autocheckpoint=0`.

**12/12 checks pass**, including immutable source/file hash readback, command/release order, snapshot isolation, exclusive new-file creation, refusal of existing/traversal/symlink targets, and rejection of deliberately false settings/observations/claims. [Test record](tests-results.json). Tests opened zero SQLite connections. Exactly two explicit connections were opened by the one measured run; no observer connection or second experiment was used.

Python: **3.9.6**, Clang 17.0.0; invocation `/usr/bin/python3`, resolved executable `/Applications/Xcode.app/Contents/Developer/usr/bin/python3`. Linked SQLite reports **3.51.0**, Python sqlite3 module **2.6.0**. Exact SQLite source ID: `2025-06-12 13:14:41 f0ca7bba1c5e232e5d279fad6338121ab55af0c8c68c84cdfb18ba5114dcaapl`. Preserve both reported identifiers; no claim of an unmodified upstream build or canonical runtime version.

## Meaning and exclusions

Observed: issuing FULL did not guarantee its completion while the reader held an older snapshot; releasing that snapshot allowed the next attempt to complete. The negative witness is `command_issued=true` with `completion_verified=false`.

**Neither triple measures durable storage.** The first result does not establish that row 2 remained unsynchronized or would be lost on power failure; incomplete checkpoint copying is not the same as absence of WAL synchronization. The second result establishes reported checkpoint completion, not hardware flush correctness or survival. `durability_verified`, `process_crash_tested`, and `power_loss_tested` remain false. Completion is not promoted into a durable acknowledgment certificate. No database corruption, recovery, power loss, kernel restart, real workload, or deployed Port Daddy behavior was exercised.

## Preserved witnesses and exact hashes

- [Runner](checkpoint_busy.py): `b4aa8fddcab47b83713de31a0718d858537b57b17fd02cf6e799d490ac4e7363`.
- [Tests](test_checkpoint_busy.py): `ce77e072e3f55813659b619198494c57f79bc191bbdff606751a9e3b833cb3c5`.
- [Measured JSON](run-01/results.json): **`bbd26649e30c3e3389e0282fbdf6a63374f84082c14c73ec3f53590f9e3426e3`**.
- [Test-results JSON](tests-results.json): `71bf74cb901d30c39d03014286dd405291269f709d6de614cb456d56e3526de9`.
- Final synthetic database, 8,192 bytes: `c783aac58a74ba88777fc148aefec96b6243d4371e7b7c93e551510d0befd8ae`.
- Pre-close WAL copy, 16,512 bytes: `70874ebdda60b862fe0d0aa38ac508975c3313af3dcd9229998dbb9ed8624e5b`.
- Pre-close shm copy, 32,768 bytes: `cfa7b8d277dd73f2bc440b76082b9867e4f90964f8da29c4d02073fe5d9e2db4`.

The pre-close database copy has the same hash as the final synthetic database. All three pre-close files are retained in `run-01/pre-close-files/`; database and connections were quiescent when copied. Normal SQLite last-close housekeeping is allowed to remove its active WAL/shm files, so copies were saved beforehand. No destructive cleanup was performed. Parent owns archive/integration decisions; no canonical files were written and no further execution is needed.
