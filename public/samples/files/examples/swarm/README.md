# Swarm Coordination Example

`coordination-board.ts` runs a four-agent workflow in one process:

1. Scout publishes a finding.
2. Builder waits for the finding, claims the implementation lock, and publishes
   a patch plan.
3. Verifier waits for the patch plan, claims the test lock, and publishes test
   evidence.
4. Integrator waits for test evidence and publishes convergence.

It uses the current Port Daddy primitives together:

- sessions through `pd.begin()` / `pd.done()`
- declared logical channels through `ensureChannel()`
- pub/sub through `publish()`
- tuple space through `tupleOut()` / `tupleRd()` / `tupleScan()`
- exclusive sections through `withLock()`
- permanent notes through `note()`

Run:

```bash
npx tsx examples/swarm/coordination-board.ts
```

Optional:

```bash
PD_EXAMPLE_HARBOR=my-demo npx tsx examples/swarm/coordination-board.ts
pd tuple scan --harbor my-demo
pd channels discover examples --observed
```
