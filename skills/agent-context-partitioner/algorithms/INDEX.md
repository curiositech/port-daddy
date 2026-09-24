# Algorithms for agent-context-partitioner

Reference implementations for the partitioning and pressure-estimation logic described in SKILL.md.

| File | When to load |
|------|--------------|
| [context_pressure_estimator.py](context_pressure_estimator.py) | You need to estimate how close a session is to a context-window ceiling before deciding to partition |
| [dag_partitioner.py](dag_partitioner.py) | You're splitting a task DAG into context-sized partitions that preserve dependency order |
| [memory_dump_schema.json](memory_dump_schema.json) | You need the schema for a knowledge dump handed between partitions |
| [online_k_selector.py](online_k_selector.py) | You need to pick the number of partitions online as pressure changes, rather than fixing it up front |
