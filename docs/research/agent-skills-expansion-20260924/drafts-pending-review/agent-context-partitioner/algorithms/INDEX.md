# Algorithms for agent-context-partitioner

| File | Purpose and limits |
|---|---|
| [partition_feasibility.py](partition_feasibility.py) | Deterministic proposal-only assignment to a supplied target set; preserves declared parent edges as explicit transfers; greedy, not optimal |
| [test_partition_feasibility.py](test_partition_feasibility.py) | Local tests for transfer, unknown, infeasibility, capacity, and cycle cases |
| [context_pressure_estimator.py](context_pressure_estimator.py) | Archived-import diagnostic only; do not use for dispatch, K selection, admission, or effects |
| [memory_dump_schema.json](memory_dump_schema.json) | Historical schema retained for provenance; not the active Context IR proposal contract |
