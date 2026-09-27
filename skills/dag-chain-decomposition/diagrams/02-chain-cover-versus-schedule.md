# Order cover is separate from a weighted processor schedule

```mermaid
flowchart LR
  subgraph Order[Reachability order]
    A[A duration 5] --> C[C duration 1] --> D[D duration 1]
    B[B duration 20] --> C
  end
  subgraph Schedule[Constructed two-worker schedule]
    W1[worker 1: A 0 to 5; idle; C 20 to 21; D 21 to 22]
    W2[worker 2: B 0 to 20]
    M[makespan 22 under stated assumptions]
    W1 --> M
    W2 --> M
  end
  Order -->|does not determine workers or durations| Schedule
```

The chains `[A,C,D]` and `[B]` form an order cover. This schedule is a constructed calculation with two identical workers, no setup/preemption/communication delay, and fixed durations. The chain cover and the schedule optimize different objectives.
