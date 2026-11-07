# Dispatch state-model conformance

Research date: 6 November 2026. Work record: NEXT-P6. Executable case: `tests/unit/future-admission-conformance.test.js`.

## Result and scope

The public dispatch graph is generated from the operation relation in `lib/dispatch/admission.ts`. It covers preparation, recovery, conflict recovery, settlement shortcuts and creation/import operations. `nextStates()` uses that graph. The regression below deliberately removes both recovery edges from a copy of the model and replays the resulting counterexample through the actual SQLite queue.

For a row already in `claimed` or `in_progress`, `recoverStranded()` can write `proposed`. The omitted-edge mutant cannot reach `proposed` from either starting state. A constructed positive policy then exposes a false-safe verdict: the mutant returns `safe`, while the intact graph returns `unsafe` with a one-transition witness. The queue replays that witness and the test reads the persisted row back. This is an executable counterexample to incomplete modeling, not a claim that production dispatches carry conflicting obligations.

## Reproducible contract

Each test has a fresh `:memory:` SQLite database, a deterministic dispatch ID, and an injected clock starting at `1700000000000`. Setup materializes a row, claims it, and, for the second case, starts it. Only then does the test capture the current row and construct the model's initial set. The initial set is exactly `{claimed}` or `{in_progress}`. The earlier proposal is setup history, not an initial model state; starting at `proposed` would make the comparison vacuous.

The abstraction retains the row's dispatch state. Its current label is `{dispatch_is_proposed}` precisely at `proposed`, and empty elsewhere. Two fixed deontic rules use that positive fact to activate `O(execute_dispatch)` and `F(execute_dispatch)` over the same synthetic scope and closed interval `[0,1]`. There are no baseline facts, Horn rules, resource claims, or temporal constraints. These labels and rules are test declarations, not discovered production policy.

The mutant obtains edges from the actual `nextStates()` over ten declared states and removes both recovery edges. The intact model restores `claimed -> proposed` and `in_progress -> proposed`, each named for `queue.recoverStranded`. The unchanged [finite provider](../../../skills/harbor-results/scripts/future_fact_reachability.py) runs with at most ten states and one hundred examined transitions. Its subprocess has a five-second wall-clock limit and a one-megabyte output limit; the reviewed input is fixed and small.

For the witness replay, the injected clock advances by 60,001 ms. Recovery uses a 60,000 ms grace window and permits one requeue; the fresh row has no prior recovery marker. The test requires a one-edge witness with the matching operation name, invokes that queue method, reads the final row, compares the observed state sequence and label with the witness, and verifies that the worker/session/start fields were cleared. No worker death is inferred from elapsed time: the test deliberately supplies an eligible row to an isolated recovery function.

## Controls

| Case | Expected finite-provider result | Required observed queue result |
| --- | --- | --- |
| Omitted-edge mutant, current `claimed` | Safe after complete exploration | Recovery writes `proposed`, which fails mutant conformance |
| Omitted-edge mutant, current `in_progress` | Safe after complete exploration | Recovery writes `proposed`, which fails mutant conformance |
| Intact graph, either current state | Unsafe with the direct recovery witness | The actual recovery step matches the witness |
| Both recovery edges removed from the second model | Safe after complete exploration | The same actual step fails conformance against the deletion mutant |
| Row still inside grace window, either current state | No provider invocation needed | Recovery changes nothing; abstract stutter is accepted |
| Zero remaining requeues, either current state | No provider invocation needed | Recovery writes `salvage`, an edge present in the table |
| Attempt to claim an `in_progress` row | No provider invocation needed | Claim throws and the persisted row remains unchanged |

The suite has nine test cases: two admission/witness comparisons, two deletion mutants, two grace-window controls, two salvage controls, and one rejected-operation control. The mutant removes both recovery edges because deleting only `claimed -> proposed` leaves the indirect table edge to `in_progress` followed by its recovery edge.

The observed-step assertion checks the same dispatch identity, declared states, current fact labels, and an edge or explicit abstract stutter. This is a bounded trace check. It does not establish that unobserved steps, other writers, or all concrete rows simulate the model.

## Relationship to atomic admission

These nine cases establish bounded trace conformance and an omitted-edge negative control. They do not by themselves establish complete writer coverage or atomic consumption. The [atomic admission result](dispatch-admission-binding.md) records the separate source inventory, compulsory production mutation registry, revision/authority binding, affected-ID checks, original rollback receipt and independent controls.

The state abstraction omits ownership, timestamps, retry counts, worker liveness and cost. Recovery cycles overapproximate retryability. A policy that depends on omitted fields needs another abstraction. Privileged SQL, storage restoration and external launches/merges remain explicit boundaries, rather than becoming safe because the graph was traversed.

## Execution boundary

Local validation on 6 November 2026 passed all nine cases in one suite (zero snapshots) under Node v22.17.1. The local runner reused the repository's unit configuration with an isolated native SQLite dependency, roots restricted to `tests/unit`, and worktree-local caches. An initial attempt with the shared dependencies stopped at the missing native SQLite binding before queue construction; that was a dependency failure, not a conformance verdict.

From a verified linked worktree with compatible dependencies, the focused suite runs under the repository's Jest unit project:

```sh
mkdir -p .cache/test-tmp
TMPDIR="$PWD/.cache/test-tmp" node --experimental-vm-modules node_modules/jest/bin/jest.js \
  --selectProjects unit --runInBand --cacheDirectory "$PWD/.cache/jest" \
  --runTestsByPath tests/unit/future-admission-conformance.test.js
```

Use dependencies with a native `better-sqlite3` build matching the selected Node runtime. Keep temporary files and the Jest cache in the dedicated worktree, and restrict Jest roots if retained research dependency caches contain unrelated snapshots. Selecting the unit project avoids the repository's integration setup.

Only the queue module, the inert central-table module, SQLite, Node built-ins, and the bounded Python checker participate. There is no imported worker/runner/spawn adapter, daemon, local Port Daddy CLI, service, hook, network request, or launched agent. Stored worktree and session strings are fixture metadata; they create no filesystem worktree or runtime session.

Skill guidance applied offline: [Port Daddy agent](../../../skills/port-daddy-agent-skill/SKILL.md), [internal contributor](../../../skills/port-daddy-internal-dev/SKILL.md), and [runtime verification](../../../skills/runtime-verification-for-agents/SKILL.md). The latter supplies the distinction between a finite observed trace, complete event/writer coverage, and compulsory effect mediation. Its live-runtime examples remain suspended by the operator halt.
