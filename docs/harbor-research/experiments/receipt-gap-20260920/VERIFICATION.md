# Repository packaging verification — 2026-09-20

## Final outcome

**19 focused unittest tests passed** in the final invocation (reported 1.412 s).
Its separate fresh reproduction ran 36 real crash/recovery workers and passed
all 22 experiment gates. The nine original oracle corruptions were rejected.
The fresh primary/mutation/binding/restoration/oracle records and checks equal
historical run-02 exactly; fresh provenance and environment are not relabeled
as historical measurements.

The original result is at the parent figure regression's requested filename:
[experiment-results.json](experiment-results.json). It has not been rewritten.
The parent-owned figure regression was neither edited nor run by this sidecar.

## Executed command

From the canonical repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B -m unittest discover \
  -s tests/harbor-research -p test_receipt_gap_experiment.py -v
```

The same command was run twice, with distinct fresh scratch roots. The first
matrix itself passed all 22 gates, but unittest then stopped before executing
test methods: the test class's Path attribute `run` shadowed
`unittest.TestCase.run`, causing `TypeError: 'PosixPath' object is not callable`.
Renaming it `matrix_dir` fixed the test harness. The second invocation passed
all 19 tests. No failed result was suppressed or called run-02.

Total for this packaging task: **72 actual experiment workers across two
distinct 36-worker reproductions**, plus the final suite's refusal-path CLI
checks. No automatic retry occurred. The two retained scratch trees occupy
1,469,186 bytes of regular, non-symlink files at verification time.
The final matrix has 38 tiny synthetic SQLite files. None are in the evidence
package; only text source, protocol, JSON and this report were added there.

## Fresh run identity

### First invocation — matrix passed, test harness errored

- Repository-relative data path: `.cache/receipt-gap-tests/reproduction-m1e0rjmq/matrix/experiment-results.json`.
- Result SHA256: `d57441dd42274ce1ca1906894a1cb1df2383b47bd40d5b9c7d7806ccba6c1bf7`.
- Fresh run UUID: `594f6a2d-90ed-4d49-bff4-0028041f2345`.
- Script SHA256: `bd770d0ccdb578bef086cbb1318bd304544ebc6d46ef64014a690364f287c2f4`.
- Experiment gates: 22/22; run kind: `fresh-reproduction`.

### Final invocation — all 19 tests passed

- Repository-relative data path: `.cache/receipt-gap-tests/reproduction-udglnorz/matrix/experiment-results.json`.
- Result SHA256: `390e74a7e82d53fae5174184296aa17254f20b64933d1959270b2b664ebd6392`.
- Fresh run UUID: `26beb3b1-4c10-48f5-9d84-12e7f768676f`.
- Script SHA256: `bd770d0ccdb578bef086cbb1318bd304544ebc6d46ef64014a690364f287c2f4`.
- Experiment gates: 22/22; run kind: `fresh-reproduction`.

Environment: Python 3.9.6 (Xcode/Clang 17.0.0 build in result JSON);
SQLite 3.51.0. No packages were installed.

## Verified behaviors and boundaries

- Actual `os._exit(70)` crashes at all declared cutpoints; one new recovery
  worker per case. Durable receiver effects and sender pending records survive
  the post-effect crash.
- Independent raw-row matrix assertions; exact archive hashes; exact compact
  matrix projection; equal sender histories with different receiver effects.
- All eight primary/restored dedup cases join sender receipt to the effect and
  retained key with the same key and payload.
- Wrong-payload rejection leaves all stored rows unchanged. The disabled-binding
  control returns the original receipt for the wrong request and is exposed.
- Key-loss and premature-done controls expose duplication and false completion.
  All nine receipt-link corruptions fail validation.
- Fresh-only defenses reject a forged cached count and a Boolean receipt.
  These are not retroactive run-02 checks.
- Fresh-only transaction fault: an aborting key-insert trigger rolls back the
  effect too; removing the trigger restores ordinary behavior.
- Recovery connection guards allow only sender DB access; controller snapshot
  calls fail the isolation test. Both hidden receiver histories yield the same
  recovery call pattern. The request interface is stubbed only for that test.
- Existing output, unmarked fixtures, broad/source paths, mixed CLI modes,
  mismatched run markers, database/journal symlinks and path aliases are refused.
  A simulated timeout propagates without retry.

The observer boundary is **interface-level, not OS isolation**. The mock receiver
runs in the worker process and commits effect plus key in one SQLite transaction.
No external irreversible effect, provider, PD runtime, network, paid call,
concurrency, key-expiry regime, power-loss durability or product guarantee was
tested. At-most-once alone remains possible by not retrying; useful recovery is
an additional obligation. No Book or source-pipeline files, Git state, or parent
figure/test sources were changed.

The falsification-first review shaped the observer guard, explicit broken
variants, rollback/restoration check, and the distinction between passing
negative-control detection and a safe receiver implementation.

## Packaged file hashes

These hashes were read back after the final tests. This report is intentionally
not self-hashed.

| Repository-relative file | SHA256 |
| --- | --- |
| `scripts/harbor-research/receipt_gap_experiment.py` | `bd770d0ccdb578bef086cbb1318bd304544ebc6d46ef64014a690364f287c2f4` |
| `tests/harbor-research/test_receipt_gap_experiment.py` | `0b2ffe0f75120e71fa09f2bccb4e362e277a5db7ddf9c5f20fe098c03a7b77c2` |
| `docs/harbor-research/experiments/receipt-gap-20260920/README.md` | `7f8cf34d7a7cb5a0e7c1340cff0ee662f71c213c31e6711233a42f4babd24455` |
| `docs/harbor-research/experiments/receipt-gap-20260920/experiment-results.json` | `e93863430b6b09d7845aa637304e719114e60c9444529deb3fc1ed6cadbc7a38` |
| `docs/harbor-research/experiments/receipt-gap-20260920/matrix.json` | `45b62a9a5047e185a91bc1b1b09a5f4de7182de0bde3a6026c8a564c506a4bf4` |
| `docs/harbor-research/experiments/receipt-gap-20260920/original/PROTOCOL.md` | `b4e2dc03efbb9842a2a2f41b8bf8bee91fc269d8a9de71959c36e77c44fbadc1` |
| `docs/harbor-research/experiments/receipt-gap-20260920/original/receipt_gap_experiment.py` | `8fcbe645943730e4473a050c6f54710892a502c55ae0ca42513e0002e176a880` |
| `docs/harbor-research/experiments/receipt-gap-20260920/provenance.json` | `2c2d9b7187db6b9dac5ddc52c3155abe484416b6094695dfc46e6dcb78f55147` |
