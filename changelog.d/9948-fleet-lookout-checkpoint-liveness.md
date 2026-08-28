type: fixed

- **One-ship Fleet continuations now advance past Lookout instead of repeating it forever.** The executor freezes Lookout's exact open-PR and recent-branch projection before checkpoint binding, supplies that identical snapshot to model work, and invalidates only when the bound projection or mediator orders actually change; direct multi-invocation regressions prove later ships execute once and the run terminates while preserving the one-ship-per-isolate memory boundary.
