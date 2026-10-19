# Benchmark protocol

Performance is subordinate to correctness. Run this only after the contract and
bypass corpus pass.

## Required benchmark manifest

- exact repository commit and dirty-state digest;
- compiler/runtime versions and optimization flags;
- machine, OS, CPU, memory, and power mode;
- policy, state, authority, proposal, and verifier digests;
- warm/cold-cache distinction;
- request distribution and payload sizes;
- sample count, warmup, repetition, and random seeds;
- raw observations and analysis script digests;
- p50, p90, p95, p99, maximum, confidence interval, and failure count;
- separated serialization, authority verification, policy evaluation, durable
  redemption, and provider time; and
- evidence of whether the measured path is the real effect path or a fixture.

## Invalid shortcuts

- another product's number as a local service objective;
- one successful run or mean-only reporting;
- a microbenchmark presented as end-to-end overhead;
- proof-generation time presented as proof-check time or vice versa;
- a warm-cache number without cold-start behavior;
- benchmark code that skips durable writes, signatures, witnesses, or policy
  state used in the proposed architecture; or
- benchmark success used to claim mediation or correctness.

If the runtime is halted, create the benchmark manifest and leave observations
`NOT_PROVISIONED`; do not start the subject to fill them in.
