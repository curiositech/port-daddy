# Scheduling methods and source scope

## Researched source boundaries

- Python 3.14 [`graphlib`](https://docs.python.org/3/library/graphlib.html), relevant `TopologicalSorter`, `get_ready`, `done`, and `CycleError` API sections were directly read in the B06 research record on 2026-09-24. `get_ready()` concerns predecessor completion; `done()` tells the sorter that processing a node has finished; requiring accepted completion evidence before that call is this skill’s local policy. The API does not schedule resources, calendars, gates, retries, or external effects.
- Ronald L. Graham, [“Bounds for Certain Multiprocessing Anomalies” (1966)](https://ia801900.us.archive.org/27/items/bstj45-9-1563/bstj45-9-1563_text.pdf), *Bell System Technical Journal* 45(9), 1563–1581, was inspected in the B06 research record. Its list-scheduling model has a finite task set, fixed processing times, identical processors, precedence constraints, and no interruption after a task begins. Under that model, a list schedule on `m` identical processors has the bound `Cmax ≤ (2 − 1/m) Cmax*`. This bound is not an optimality, heterogeneous-resource, uncertain-duration, communication-cost, or agent-runtime guarantee.

## Local policy boundary

The ready-queue versus fixed-barrier choice, artifact/gate evidence, approval/action authority, calendar/resource admission, timeout reconciliation, and replanning boundary are local engineering policy. The source result does not decide them.

Use a scheduling record with task ID, predecessor evidence, duration estimate and unit, resource class/capacity/compatibility, calendar interval, selected policy, reservation, planned start/end, and observed outcome. A width is a structural antichain bound, and a topological level is a chosen layering. Neither reports the current ready frontier or proves duration-optimal allocation.
