# What substrate-study is

The standalone study asks when a shared repository with enforced write claims works better than per-agent worktrees and a merge queue. This is a testable design choice in the Book. Its pre-registered hypotheses include conditions under which the Book should stop prescribing the single-writer coordination model.

S2 uses scripted cooperative/impatient workers, real historical Git patches, seeded work durations, seven coordination configurations and reproducible event logs. It measures throughput, discarded edits, conflicts, time to land and evidence completeness. This isolates some coordination mechanics; it does not measure skill-grafted LLM competence or establish deployed sandbox confinement. S1 separately proposes actual process/container/microVM enforcement and overhead tests.

The saved pilot contains 80 one-row summary CSVs out of84 designed cells, one Python corpus and two seeds per cell. The full three-corpus, four-concurrency-level,20-seed design is not delivered. Four high-concurrency merge-queue cells are missing, and the completed merge-queue cells are compromised by a documented harness defect. A zero unresolved-conflict-marker count does not prove semantic correctness.

Root reproduced a concrete part of that defect and prepared a [bounded offline repair](inherited-repairs/substrate-study/README.md): rebase only the task commit, not its unrelated historical ancestors. Four focused Git regressions pass with that correction; the original code fails three. Historical pilot numbers stay historical until a corrected, documented experiment is run.

Source references: `studies/substrate-study/README.md`, `PROTOCOL.md`, `PILOT.md`, `CHANGELOG.md` and `harness/substrates.py` at the campaign's verified base. No Book prose changed.
